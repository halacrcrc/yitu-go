// KataGo 桌面端子进程适配器（文档《KataGo 接入改造方案 v2》第三章）
// analysis 协议：stdin 单行 JSON 查询、stdout 单行 JSON 结果、按 id 异步匹配。

use super::{Capability, GoEngine, MoveIntent, MoveRequest};
use crate::engine::Game;
use rand::Rng;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

type Dispatch = Arc<Mutex<HashMap<String, SyncSender<serde_json::Value>>>>;

pub struct KataGoDesktop {
    child: Arc<Mutex<Option<Child>>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    dispatch: Dispatch,
    seq: Arc<Mutex<u64>>,
    model: PathBuf,
    human_model: Option<PathBuf>,
    cfg: PathBuf,
    bin: PathBuf,
    backend: String,
    /// 单 humanSL 模型部署（model.bin.gz 即 humanSL 网络，须带 profile override）
    human_only: bool,
}

impl KataGoDesktop {
    /// 从引擎目录探测并启动。目录需要：katago(.exe)、model.bin.gz、katago.cfg，
    /// 可选 human.bin.gz（humanSL 分级用，文档 5.1）。
    pub fn from_dir(dir: &Path) -> Result<Self, String> {
        if !dir.is_dir() {
            return Err(format!("引擎目录不存在: {}", dir.display()));
        }
        let bin = ["katago.exe", "katago"]
            .iter()
            .map(|n| dir.join(n))
            .find(|p| p.is_file())
            .ok_or_else(|| "未找到 katago 可执行文件".to_string())?;
        let model = dir.join("model.bin.gz");
        if !model.is_file() {
            return Err("未找到模型 model.bin.gz".into());
        }
        let human_model_path = dir.join("human.bin.gz");
        let human_model = if human_model_path.is_file() { Some(human_model_path) } else { None };
        let cfg = dir.join("katago.cfg");
        if !cfg.is_file() {
            // 自动生成 CPU 档默认配置（文档 3.3 低档 + maxTime 兜底）
            std::fs::write(
                &cfg,
                "numSearchThreads = 4\n\
                 nnMaxBatchSize = 32\n\
                 nnCacheSizePowerOfTwo = 20\n\
                 numNNServerThreadsPerModel = 1\n\
                 maxVisits = 1600\n\
                 maxTime = 3.0\n\
                 reportAnalysisWinratesAs = SIDETOMOVE\n\
                 logAllSearchInfo = false\n\
                 logSearchInfoForChosenMove = false\n",
            )
            .map_err(|e| format!("写入默认配置失败: {e}"))?;
        }
        let backend = "eigen".to_string();
        let mut k = Self {
            child: Arc::new(Mutex::new(None)),
            stdin: Arc::new(Mutex::new(None)),
            dispatch: Arc::new(Mutex::new(HashMap::new())),
            seq: Arc::new(Mutex::new(0)),
            model,
            human_model,
            cfg,
            bin,
            backend,
            human_only: false,
        };
        k.spawn()?;
        k.probe_and_adapt()?;
        Ok(k)
    }

    /// 探针查询：humanSL 模型单独部署时必须带 humanSLProfile；
    /// 检测到该情况则写回配置并标记（文档 5.1 的「单 humanSL 模型」降级部署）。
    fn probe_and_adapt(&mut self) -> Result<(), String> {
        let probe = serde_json::json!({
            "rules": "chinese",
            "komi": 7.5,
            "boardXSize": 9,
            "boardYSize": 9,
            "moves": [],
            "maxVisits": 1,
        });
        let need_profile = match self.query(probe, Duration::from_secs(30)) {
            Ok(_) => false,
            Err(_) => true,
        };
        if need_profile {
            let mut cfg_text = std::fs::read_to_string(&self.cfg).unwrap_or_default();
            if !cfg_text.contains("humanSLProfile") {
                cfg_text.push_str("
humanSLProfile = rank_1d
");
                std::fs::write(&self.cfg, cfg_text).map_err(|e| e.to_string())?;
            }
            self.human_only = true;
            self.spawn()?; // 带 profile 重启
            // 复测一次确认可用
            let probe2 = serde_json::json!({
                "rules": "chinese", "komi": 7.5, "boardXSize": 9, "boardYSize": 9,
                "moves": [], "maxVisits": 1, "includePolicy": true,
                "overrideSettings": {"humanSLProfile": "rank_1d"},
            });
            self.query(probe2, Duration::from_secs(30))?;
            eprintln!("[ai] 已适配单 humanSL 模型部署（各档位按段位 profile 切换）");
        }
        Ok(())
    }

    fn spawn(&mut self) -> Result<(), String> {
        let mut cmd = Command::new(&self.bin);
        cmd.arg("analysis")
            .arg("-model").arg(&self.model)
            .arg("-config").arg(&self.cfg);
        if let Some(h) = &self.human_model {
            cmd.arg("-human-model").arg(h); // 双模型：正常模型 + humanSL（文档 5.1）
        }
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped()); // 必须接管：stderr 不排空会堵死子进程（文档坑 1）

        let mut child = cmd.spawn().map_err(|e| format!("启动 KataGo 失败: {e}"))?;

        let stdout = child.stdout.take().expect("stdout");
        let stderr = child.stderr.take().expect("stderr");

        // 坑 1：stderr 持续排空
        std::thread::spawn(move || {
            let r = BufReader::new(stderr);
            for line in r.lines().map_while(Result::ok) {
                if !line.trim().is_empty() {
                    eprintln!("[katago] {}", line);
                }
            }
        });

        let dispatch: Dispatch = Arc::new(Mutex::new(HashMap::new()));
        let d2 = Arc::clone(&dispatch);

        // 后台分发线程：按 id 回投（协议异步，不能假设顺序）
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            let mut line = String::new();
            let mut reader = reader;
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) => {
                        if line.trim().is_empty() {
                            continue;
                        }
                        match serde_json::from_str::<serde_json::Value>(&line) {
                            Ok(v) => {
                                if let Some(id) = v.get("id").and_then(|x| x.as_str()) {
                                    let tx = d2.lock().unwrap().remove(id);
                                    if let Some(tx) = tx {
                                        let _ = tx.send(v);
                                    }
                                }
                            }
                            Err(e) => eprintln!("[katago] JSON 解析失败: {e}"),
                        }
                    }
                    Err(e) => {
                        eprintln!("[katago] 读 stdout 失败: {e}");
                        break;
                    }
                }
            }
        });

        let stdin = child.stdin.take().expect("stdin");
        *self.child.lock().unwrap() = Some(child);
        *self.stdin.lock().unwrap() = Some(stdin);
        self.dispatch = dispatch;
        Ok(())
    }

    /// 发送查询并阻塞等待对应 id 的结果（调用方须在 spawn_blocking 中）
    fn query(&self, mut payload: serde_json::Value, timeout: Duration) -> Result<serde_json::Value, String> {
        let id = {
            let mut s = self.seq.lock().unwrap();
            *s += 1;
            format!("yitu-{}", s)
        };
        payload["id"] = serde_json::Value::String(id.clone());

        let (tx, rx) = sync_channel::<serde_json::Value>(1);
        self.dispatch.lock().unwrap().insert(id.clone(), tx);

        // 坑 2：必须单行 JSON（to_string 不带换行，手动补 \n）
        let mut line = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
        line.push('\n');
        let mut sin_guard = self.stdin.lock().unwrap();
        let sin = sin_guard.as_mut().ok_or_else(|| "引擎未启动".to_string())?;
        sin.write_all(line.as_bytes()).map_err(|e| format!("写入失败: {e}"))?;
        sin.flush().map_err(|e| format!("flush 失败: {e}"))?;
        drop(sin_guard);

        match rx.recv_timeout(timeout) {
            Ok(v) => Ok(v),
            Err(_) => {
                self.dispatch.lock().unwrap().remove(&id);
                Err("KataGo 响应超时".into())
            }
        }
    }

    pub fn is_alive(&self) -> bool {
        let mut guard = self.child.lock().unwrap();
        match guard.as_mut() {
            Some(c) => matches!(c.try_wait(), Ok(None)),
            None => false,
        }
    }

    fn respawn(&mut self) -> Result<(), String> {
        if let Some(c) = self.child.lock().unwrap().as_mut() {
            let _ = c.kill();
        }
        {
            let mut d = self.dispatch.lock().unwrap();
            for (_, tx) in d.drain() {
                let _ = tx.send(serde_json::json!({"error": "engine_restart"}));
            }
        }
        self.spawn()
    }
}

impl GoEngine for KataGoDesktop {
    fn best_move(&self, req: &MoveRequest) -> Result<Option<usize>, String> {
        if !self.is_alive() {
            return Err("KataGo 进程已退出".into());
        }
        let mut plan = level_plan(req.level, req.intent, self.human_model.is_some(), req.game.size == 19);
        if self.human_only {
            // 单 humanSL 部署：全部档位走 humanSL 选点，档位 = 不同段位 profile
            plan.use_human_sl = true;
            plan.profile = match req.level.clamp(1, 10) {
                1 => Some("rank_20k"),
                2 => Some("rank_15k"),
                3 => Some("rank_10k"),
                4 => Some("rank_5k"),
                5 => Some("rank_2k"),
                6 => Some("rank_1k"),
                7 => Some("rank_1d"),
                8 => Some("rank_3d"),
                9 => Some("rank_5d"),
                _ => Some("rank_9d"),
            };
            plan.max_visits = 1;
            plan.chosen_move_prop = 0.0; // 单模型不支持 ChosenMoveProp（会报错），直接 profile 采样
        }
        let payload = build_query(req, &plan);
        let v = self.query(payload, Duration::from_secs(20))?;

        if v.get("error").is_some() {
            return Err(format!(
                "KataGo 错误: {}",
                v.get("error").and_then(|x| x.as_str()).unwrap_or("unknown")
            ));
        }

        // 路线 A（humanSL 1-visit 全温度）：按 policy 概率采样选点
        if plan.use_human_sl {
            if let Some(policy) = v.get("policy").and_then(|x| x.as_array()) {
                if let Some(p) = sample_policy(policy, &req.game) {
                    return Ok(Some(p));
                }
            }
        }

        // 路线 B（搜索降档）：取访问数最高的着法
        let infos = v
            .get("moveInfos")
            .and_then(|x| x.as_array())
            .ok_or_else(|| "响应缺少 moveInfos".to_string())?;
        let best = infos
            .first()
            .and_then(|m| m.get("move"))
            .and_then(|x| x.as_str())
            .ok_or_else(|| "moveInfos 缺少 move 字段".to_string())?;
        if best == "pass" || best.is_empty() {
            return Ok(None);
        }
        Ok(gtp_move_to_pos(best, req.game.size))
    }

    fn capability(&self) -> Capability {
        Capability {
            name: "katago".into(),
            backend: self.backend.clone(),
            human_sl: self.human_model.is_some(),
        }
    }
}

// ---------- 分级映射（文档 5.2） ----------

struct LevelPlan {
    /// humanSL profile（None = 路线 B 纯搜索）
    profile: Option<&'static str>,
    /// 走人类着法的概率（humanSL 用）
    chosen_move_prop: f64,
    max_visits: u32,
    use_human_sl: bool,
}

fn level_plan(level: u8, intent: MoveIntent, has_human: bool, is_19x19: bool) -> LevelPlan {
    // Hint 意图：固定正常模型 + 中档 visits（文档 3.7 语义陷阱）
    if intent == MoveIntent::Hint {
        return LevelPlan { profile: None, chosen_move_prop: 0.0, max_visits: 150, use_human_sl: false };
    }
    let lv = level.clamp(1, 10);
    // 非 19 路退化为路线 B（humanSL 未对小盘标定，文档 5.2）
    let has_human = has_human && is_19x19;
    let route_b = |visits: u32| LevelPlan {
        profile: None,
        chosen_move_prop: 0.0,
        max_visits: visits,
        use_human_sl: false,
    };
    if !has_human {
        // 无 humanSL 模型：全部走路线 B，visits 按档位递增
        let visits = [8u32, 16, 30, 50, 80, 130, 200, 320, 500, 800][lv as usize - 1];
        return route_b(visits);
    }
    match lv {
        1 => LevelPlan { profile: Some("rank_20k"), chosen_move_prop: 1.0, max_visits: 1, use_human_sl: true },
        2 => LevelPlan { profile: Some("rank_15k"), chosen_move_prop: 1.0, max_visits: 1, use_human_sl: true },
        3 => LevelPlan { profile: Some("rank_10k"), chosen_move_prop: 1.0, max_visits: 1, use_human_sl: true },
        4 => LevelPlan { profile: Some("rank_5k"), chosen_move_prop: 1.0, max_visits: 1, use_human_sl: true },
        5 => LevelPlan { profile: Some("rank_2k"), chosen_move_prop: 0.9, max_visits: 5, use_human_sl: true },
        6 => LevelPlan { profile: Some("rank_1k"), chosen_move_prop: 0.8, max_visits: 20, use_human_sl: true },
        7 => LevelPlan { profile: Some("rank_1d"), chosen_move_prop: 0.6, max_visits: 100, use_human_sl: true },
        8 => LevelPlan { profile: Some("rank_3d"), chosen_move_prop: 0.3, max_visits: 400, use_human_sl: true },
        9 => LevelPlan { profile: Some("rank_5d"), chosen_move_prop: 0.0, max_visits: 800, use_human_sl: true },
        _ => route_b(1600), // 第 10 档：纯 KataGo 满配
    }
}

// ---------- 查询构造与解析 ----------

fn gtp_letter(x: usize) -> char {
    // GTP 列字母跳过 I
    (b'A' + if x >= 8 { x as u8 + 1 } else { x as u8 }) as char
}

fn our_pos_to_gtp(pos: usize, size: usize) -> String {
    let x = pos % size;
    let y_from_top = size - 1 - pos / size;
    format!("{}{}", gtp_letter(x), y_from_top + 1)
}

fn gtp_move_to_pos(s: &str, size: usize) -> Option<usize> {
    let mut chars = s.chars();
    let col = chars.next()?;
    let row: String = chars.collect();
    let col_idx: usize = {
        let c = col.to_ascii_uppercase();
        if c == 'I' {
            return None;
        }
        let idx = ((c as u8) - b'A') as usize;
        if idx > 8 {
            idx - 1
        } else {
            idx
        }
    };
    let row_num: usize = row.trim().parse().ok()?;
    if col_idx >= size || row_num == 0 || row_num > size {
        return None;
    }
    let y = size - row_num; // 行号自底向上 → 我们的 y 自顶向下
    Some(y * size + col_idx)
}

fn build_query(req: &MoveRequest, plan: &LevelPlan) -> serde_json::Value {
    let g = &req.game;
    let coord = |p: usize| our_pos_to_gtp(p, g.size);
    let mut moves = Vec::new();
    for m in &g.history {
        let color = if m.side == crate::engine::Side::Black { "B" } else { "W" };
        match m.pos {
            Some(p) => moves.push(serde_json::json!([color, coord(p)])),
            None => moves.push(serde_json::json!([color, "pass"])),
        }
    }
    let initial: Vec<_> = g
        .handicap_pos
        .iter()
        .map(|&p| serde_json::json!(["B", coord(p)]))
        .collect();

    let mut override_settings = serde_json::Map::new();
    if let Some(profile) = plan.profile {
        override_settings.insert("humanSLProfile".into(), serde_json::json!(profile));
        if plan.chosen_move_prop > 0.0 {
            override_settings.insert("humanSLChosenMoveProp".into(), serde_json::json!(plan.chosen_move_prop));
            override_settings.insert("humanSLChosenMoveIgnorePass".into(), serde_json::json!(true));
            override_settings.insert("ignorePreRootHistory".into(), serde_json::json!(false));
        }
    }

    let mut q = serde_json::json!({
        "rules": "chinese", // 与 Rust 规则层的中国规则对齐（文档 P0-4）
        "komi": g.komi,
        "boardXSize": g.size,
        "boardYSize": g.size,
        "moves": moves,
        "maxVisits": plan.max_visits,
        "includePolicy": plan.use_human_sl,
    });
    if !initial.is_empty() {
        q["initialStones"] = serde_json::json!(initial);
    }
    if !override_settings.is_empty() {
        // humanSL 参数必须放 overrideSettings，放外层无效（文档 3.4）
        q["overrideSettings"] = serde_json::Value::Object(override_settings);
    }
    q
}

/// humanSL 路线：按 policy 概率采样选点（1-visit 全温度，文档 5.1 核心机制）
fn sample_policy(policy: &[serde_json::Value], game: &Game) -> Option<usize> {
    let size = game.size;
    let n = size * size;
    // policy 索引 = ky*size + kx（ky 自顶向下）；我们 pos 的 y 自底向上
    let to_our_pos = |idx: usize| -> Option<usize> {
        let kx = idx % size;
        let ky = idx / size;
        if kx >= size || ky >= size {
            return None;
        }
        let py = size - 1 - ky;
        let p = py * size + kx;
        if game.board[p] == crate::engine::EMPTY {
            Some(p)
        } else {
            None
        }
    };

    let mut entries: Vec<(usize, f64)> = Vec::new();
    for (idx, v) in policy.iter().enumerate().take(n) {
        let w = v.as_f64().unwrap_or(0.0);
        if w <= 0.0 {
            continue;
        }
        if let Some(p) = to_our_pos(idx) {
            entries.push((p, w));
        }
    }
    if entries.is_empty() {
        return None;
    }
    let total: f64 = entries.iter().map(|e| e.1).sum();
    if total <= 0.0 {
        return None;
    }
    // 温度化采样：温度高时偏向随机，低时接近取最大。humanSL 用全温度（纯概率采样）
    let mut rng = rand::thread_rng();
    let mut pick = rng.gen::<f64>() * total;
    for (p, w) in &entries {
        pick -= w;
        if pick <= 0.0 {
            return Some(*p);
        }
    }
    entries.last().map(|e| e.0)
}
