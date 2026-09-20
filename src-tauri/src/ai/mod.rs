// AI 引擎抽象层（文档《KataGo 接入改造方案 v2》第二章）
// 规则层不动：棋盘权威状态仍在 Game（Rust 端），引擎只负责选点。

pub mod katago;

pub use katago::KataGoDesktop;

use crate::engine::{self, Game};

/// 选点意图：对弈与提示必须区分（文档 3.7 的 hint 语义陷阱）
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum MoveIntent {
    /// 对弈选点：按当前档位配置（可能启用 humanSL）
    Play,
    /// 提示选点：固定正常模型 + 中档 visits，与对局档位无关
    Hint,
}

pub struct MoveRequest {
    /// 完整对局克隆（棋盘状态权威保存在规则层）
    pub game: Game,
    /// 1..=10 档位（Hint 意图时忽略）
    pub level: u8,
    pub intent: MoveIntent,
}

impl MoveRequest {
    pub fn from_game(game: &Game, level: u8, intent: MoveIntent) -> Self {
        MoveRequest { game: game.clone(), level, intent }
    }
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct AiStatus {
    /// "katago" / "builtin"
    pub engine: String,
    /// "eigen" / "opencl" / "cuda" / "heuristic-mc"
    pub backend: String,
    pub human_sl: bool,
    /// 引擎文件已部署（katago 目录就绪）
    pub katago_installed: bool,
    /// 最近一次查询是否发生降级（用户可感知「AI 变笨了」的原因）
    pub degraded: bool,
    /// 引擎目录（用户往这里放文件）
    pub engine_dir: String,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct Capability {
    /// "katago" / "builtin"
    pub name: String,
    /// "eigen" / "opencl" / "cuda" / "heuristic-mc"
    pub backend: String,
    /// 是否加载了 humanSL 模型
    pub human_sl: bool,
}

pub trait GoEngine: Send + Sync {
    /// 返回落子点（0..size*size，y 向上），None 表示 pass
    fn best_move(&self, req: &MoveRequest) -> Result<Option<usize>, String>;
    /// 复盘分析：返回 [from, to) 每一手的评估（KataGo 支持，内置引擎不支持）
    fn analyze(&self, req: &AnalyzeRequest) -> Result<Vec<MoveAnalysis>, String> {
        let _ = req;
        Err("当前引擎不支持分析".into())
    }
    /// 死活判题（KataGo ownership，文档第六章；内置引擎不支持）
    fn judge_position(&self, req: &JudgeRequest) -> Result<Verdict, String> {
        let _ = req;
        Err("当前引擎不支持判题".into())
    }
    fn capability(&self) -> Capability;
}

/// 死活判题请求：判断 target_points 这块棋的最终归属是否符合预期
/// （文档第六章：判「死没死」，不判「是否下了预设手」）。
/// 题面摆子（黑白）进 initial，手顺（含玩家这手）进 moves——**不要用 Game 传**，
/// 否则题面白子会在 initialStones 构造时丢失（v1.5.0 实测踩坑）。
pub struct JudgeRequest {
    pub size: usize,
    pub komi: f64,
    pub initial_black: Vec<usize>,
    pub initial_white: Vec<usize>,
    /// 手顺（side_num: 1黑 2白；与 initial 合并后须为合法交替或由调用方保证一致）
    pub moves: Vec<(u8, usize)>,
    /// 目标块的所有点（棋盘序号）
    pub target_points: Vec<usize>,
    /// 期望的最终归属：+1 = 归黑（目标块被杀/己方做活），-1 = 归白
    pub expect_owner: i8,
    /// 搜索访问数（判题纪律：正常模型 + 足量 visits，禁止 humanSL/低 visit）
    pub visits: u32,
}

/// 三值判定结果（文档 6.2：劫活/复杂形不得粗暴判错）
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
pub enum Verdict {
    /// 达成（归属概率 ≥ 0.8 符合预期）
    Achieved,
    /// 未达成（归属概率 ≤ 0.2 符合预期反向）
    Failed,
    /// 不明确（0.2~0.8 之间，可能是劫/依赖后续手顺）
    Unclear,
}

impl Verdict {
    pub fn from_prob(match_prob: f64) -> Verdict {
        if match_prob >= 0.8 {
            Verdict::Achieved
        } else if match_prob <= 0.2 {
            Verdict::Failed
        } else {
            Verdict::Unclear
        }
    }
}

/// 复盘分析请求：对对局 [from, to) 手区间做逐手评估
pub struct AnalyzeRequest {
    pub game: Game,
    pub from: usize,
    pub to: usize,
    /// 每手搜索访问数（Eigen 档建议 8~24，GPU 档可 100+）
    pub visits: u32,
}

/// 单手评估（统一为黑方视角）
#[derive(Clone, Debug, serde::Serialize)]
pub struct MoveAnalysis {
    /// 落子序号（1-based）
    pub move_number: usize,
    pub side: u8,
    pub pos: Option<usize>,
    /// 落子后黑方胜率 0..1
    pub winrate_black: f64,
    /// 落子后黑方目差
    pub score_lead_black: f64,
}

/// 自研启发式兜底引擎（无外部依赖，永远可用；文档 5.3 降级链第 2 级）
pub struct FallbackEngine;

impl GoEngine for FallbackEngine {
    fn best_move(&self, req: &MoveRequest) -> Result<Option<usize>, String> {
        Ok(engine::ai_best_move(&req.game, req.level))
    }
    fn capability(&self) -> Capability {
        Capability {
            name: "builtin".into(),
            backend: "heuristic-mc".into(),
            human_sl: false,
        }
    }
}

/// 引擎管理器：优先 KataGo（若应用数据目录存在引擎文件），
/// 失败/超时/缺失时自动降级到 FallbackEngine（文档 5.3）；
/// KataGo 查询失败时自动重启重试一次（respawn 接线），并暴露降级状态。
pub struct EngineManager {
    katago: Option<std::sync::Arc<Mutex<katago::KataGoDesktop>>>,
    dir: std::path::PathBuf,
    degraded: std::sync::atomic::AtomicBool,
}

use std::sync::{Arc, Mutex};

impl EngineManager {
    /// 按文档 3.8：引擎目录 = app_data_dir/katago/
    /// 预期文件：katago.exe、model.bin.gz、katago.cfg，（可选）human.bin.gz
    pub fn detect(data_dir: &std::path::Path, custom_dir: Option<&str>) -> Self {
        // 目录优先级：用户自定义（有效时）> 默认 app_data_dir/katago
        let custom = custom_dir
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(std::path::PathBuf::from)
            .filter(|p| p.is_dir());
        let dir = custom.unwrap_or_else(|| data_dir.join("katago"));
        let katago = match katago::KataGoDesktop::from_dir(&dir) {
            Ok(k) => {
                eprintln!("[ai] KataGo 引擎已启用: {}", k.capability().backend);
                Some(Arc::new(Mutex::new(k)))
            }
            Err(e) => {
                eprintln!("[ai] KataGo 不可用（{}），使用内置引擎", e);
                None
            }
        };
        EngineManager {
            katago,
            dir,
            degraded: std::sync::atomic::AtomicBool::new(false),
        }
    }

    pub fn engine_dir(&self) -> &std::path::Path {
        &self.dir
    }

    pub fn capability(&self) -> Capability {
        if let Some(k) = &self.katago {
            return GoEngine::capability(&*k.lock().unwrap());
        }
        FallbackEngine.capability()
    }

    pub fn has_katago(&self) -> bool {
        self.katago.is_some()
    }

    pub fn degraded(&self) -> bool {
        self.degraded.load(std::sync::atomic::Ordering::Relaxed)
    }

    pub fn status(&self) -> AiStatus {
        let cap = self.capability();
        AiStatus {
            engine: cap.name,
            backend: cap.backend,
            human_sl: cap.human_sl,
            katago_installed: self.has_katago(),
            degraded: self.degraded(),
            engine_dir: self.dir.display().to_string(),
        }
    }
}

impl GoEngine for EngineManager {
    fn capability(&self) -> Capability {
        if let Some(k) = &self.katago {
            return GoEngine::capability(&*k.lock().unwrap());
        }
        FallbackEngine.capability()
    }

    fn best_move(&self, req: &MoveRequest) -> Result<Option<usize>, String> {
        use std::sync::atomic::Ordering;
        if let Some(k) = &self.katago {
            let k = k.lock().unwrap();
            match GoEngine::best_move(&*k, req) {
                Ok(m) => {
                    self.degraded.store(false, Ordering::Relaxed);
                    return Ok(m);
                }
                Err(e) => {
                    // 文档清单 P1-1：崩溃/超时后重启重试一次，再失败才降级内置引擎
                    eprintln!("[ai] KataGo 查询失败（{}），尝试重启重试", e);
                    if k.respawn().is_ok() {
                        match GoEngine::best_move(&*k, req) {
                            Ok(m) => {
                                self.degraded.store(false, Ordering::Relaxed);
                                return Ok(m);
                            }
                            Err(e2) => eprintln!("[ai] 重启后仍失败（{}）", e2),
                        }
                    }
                    eprintln!("[ai] 降级到内置引擎（本次请求）");
                    self.degraded.store(true, Ordering::Relaxed);
                }
            }
        }
        FallbackEngine.best_move(req)
    }
}
