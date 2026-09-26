// KataGo Android 进程内桥接：dlopen libkatago.so（含 yitugo_wrapper C 接口），
// 通过 line-JSON 协议与进程内 analysis 引擎通信。
// 模型/cfg 部署：nativeLibraryDir 下的 libmodel.so（= model.bin.gz）与 libhuman.so，
// cfg 由 Rust 端生成到 app_data_dir/katago/katago.cfg。
use super::{Capability, GoEngine, MoveIntent, MoveRequest};
use libloading::{Library, Symbol};
use std::sync::Mutex;

const SYM_INIT: &[u8] = b"yitugo_init\0";
const SYM_QUERY: &[u8] = b"yitugo_query\0";
const SYM_FREE: &[u8] = b"yitugo_free\0";

pub struct KataGoAndroid {
    lib: Mutex<Library>,
    config_path: String,
}

// libloading::Library 是 Send（Android 上 dlopen 的句柄线程安全使用受外层 Mutex 保护）
unsafe impl Send for KataGoAndroid {}

impl KataGoAndroid {
    /// 在常见位置查找 libkatago.so / libmodel.so / libhuman.so 并初始化。
    /// 引擎库在 nativeLibraryDir（形如 /data/app/~~xxx/com.yitugo.app-yyy/lib/arm64）。
    pub fn detect(data_dir: &std::path::Path) -> Result<Self, String> {
        let lib_path = find_native_library("libkatago.so").ok_or_else(|| {
            "未找到 libkatago.so（nativeLibraryDir 未部署引擎库）".to_string()
        })?;
        let model_path = find_native_library("libmodel.so").ok_or_else(|| {
            "未找到 libmodel.so（模型未随包部署）".to_string()
        })?;
        let human_path = find_native_library("libhuman.so");

        // 生成 cfg：modelFile 指向 nativeLibraryDir 的模型；humanSL 需 -human-model
        // 支持参数由 wrapper 侧 MainCmds::analysis 的 TCLAP 提供（-model/-config），
        // 因此 cfg 中写 modelFile 即可。
        let cfg_dir = data_dir.join("katago");
        std::fs::create_dir_all(&cfg_dir).ok();
        let cfg_path = cfg_dir.join("katago.cfg");
        // 内置模型为 humanSL 网络：单模型模式下必须在 cfg 声明 humanSLProfile，
        // 否则引擎报 SGFMetadata 缺失（文档 5.1 单模型部署）
        let human_sl_profile_line = "humanSLProfile = rank_1d".to_string();
        std::fs::write(
            &cfg_path,
            format!(
                "numAnalysisThreads = 1\n\
                 numSearchThreads = 2\n\
                 nnMaxBatchSize = 8\n\
                 nnCacheSizePowerOfTwo = 18\n\
                 maxVisits = 150\n\
                 maxTime = 3.0\n\
                 reportAnalysisWinratesAs = SIDETOMOVE\n\
                 modelFile = {}\n\
                 {}\n",
                model_path.display(),
                human_sl_profile_line
            ),
        )
        .map_err(|e| format!("写 cfg 失败: {e}"))?;

        let lib = unsafe { Library::new(&lib_path) }
            .map_err(|e| format!("dlopen libkatago 失败: {e}"))?;

        let s = Self { lib: Mutex::new(lib), config_path: cfg_path.display().to_string() };
        {
            let lib = s.lib.lock().unwrap();
            unsafe {
                let init: Symbol<unsafe extern "C" fn(*const std::ffi::c_char) -> i32> =
                    lib.get(SYM_INIT).map_err(|e| e.to_string())?;
                let cpath = std::ffi::CString::new(s.config_path.clone()).map_err(|e| e.to_string())?;
                let rc = init(cpath.as_ptr());
                if rc != 0 {
                    return Err(format!("yitugo_init 失败: {rc}"));
                }
            }
        }
        Ok(s)
    }

    fn query_raw(&self, payload: &str) -> Result<String, String> {
        let lib = self.lib.lock().unwrap();
        unsafe {
            let query: Symbol<unsafe extern "C" fn(*const std::ffi::c_char) -> *mut std::ffi::c_char> =
                lib.get(SYM_QUERY).map_err(|e| e.to_string())?;
            let free: Symbol<unsafe extern "C" fn(*mut std::ffi::c_char)> =
                lib.get(SYM_FREE).map_err(|e| e.to_string())?;
            let cq = std::ffi::CString::new(payload).map_err(|e| e.to_string())?;
            let ptr = query(cq.as_ptr());
            if ptr.is_null() {
                return Err("引擎无响应".into());
            }
            let result = std::ffi::CStr::from_ptr(ptr).to_string_lossy().into_owned();
            free(ptr);
            Ok(result)
        }
    }
}

impl crate::ai::KatagoEngineImpl for KataGoAndroid {
    fn best_move_impl(&self, req: &MoveRequest) -> Result<Option<usize>, String> {
        // 安卓端统一走 humanSL profile 采样（cfg 内已带 humanSLProfile/modelFile）
        let g = &req.game;
        let coord = |p: usize| {
            let x = p % g.size;
            let y_top = g.size - 1 - p / g.size;
            let letter = |i: usize| (b'A' + if i >= 8 { i as u8 + 1 } else { i as u8 }) as char;
            format!("{}{}", letter(x), y_top + 1)
        };
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
        let mut q = serde_json::json!({
            "rules": "chinese",
            "komi": g.komi,
            "boardXSize": g.size,
            "boardYSize": g.size,
            "moves": moves,
            "maxVisits": 1,
            "includePolicy": true,
            "overrideSettings": {
                "humanSLProfile": match req.level.clamp(1, 10) {
                    1 => "rank_20k",
                    2 => "rank_15k",
                    3 => "rank_10k",
                    4 => "rank_5k",
                    5 => "rank_2k",
                    6 => "rank_1k",
                    7 => "rank_1d",
                    8 => "rank_3d",
                    9 => "rank_5d",
                    _ => "rank_9d",
                }
            }
        });
        if !initial.is_empty() {
            q["initialStones"] = serde_json::json!(initial);
        }
        let response = self.query_raw(&q.to_string())?;
        let v: serde_json::Value =
            serde_json::from_str(&response).map_err(|e| format!("响应解析失败: {e}"))?;
        if let Some(err) = v.get("error").and_then(|x| x.as_str()) {
            return Err(format!("引擎错误: {err}"));
        }
        // policy 采样（1 visit 全温度，与 humanSL 分级一致）
        if let Some(policy) = v.get("policy").and_then(|x| x.as_array()) {
            let size = g.size;
            let mut entries: Vec<(usize, f64)> = Vec::new();
            for (idx, val) in policy.iter().enumerate().take(size * size) {
                let w = val.as_f64().unwrap_or(0.0);
                if w <= 0.0 { continue; }
                let kx = idx % size;
                let ky = idx / size;
                if kx >= size || ky >= size { continue; }
                let p = (size - 1 - ky) * size + kx;
                if g.board[p] == crate::engine::EMPTY {
                    entries.push((p, w));
                }
            }
            if !entries.is_empty() {
                let total: f64 = entries.iter().map(|e| e.1).sum();
                if total > 0.0 {
                    let mut pick = rand::random::<f64>() * total;
                    for (p, w) in &entries {
                        pick -= w;
                        if pick <= 0.0 {
                            return Ok(Some(*p));
                        }
                    }
                    return Ok(Some(entries[entries.len() - 1].0));
                }
            }
        }
        Ok(None)
    }

    fn respawn_impl(&self) -> Result<(), String> {
        // 进程内引擎生命周期由应用管理；失败时上层直接降级内置引擎
        Err("安卓进程内引擎不支持热重启".into())
    }
    fn capability_impl(&self) -> Capability {
        Capability {
            name: "katago".into(),
            backend: "eigen-android".into(),
            human_sl: true,
        }
    }
}

/// 在常见安装路径中查找原生库文件
fn find_native_library(name: &str) -> Option<std::path::PathBuf> {
    // nativeLibraryDir 形如 /data/app/~~随机/com.yitugo.app-随机/lib/arm64
    let app_dirs = std::fs::read_dir("/data/app").ok()?;
    for entry in app_dirs.flatten() {
        let lib_dir = entry.path().join("lib").join("arm64");
        let p = lib_dir.join(name);
        if p.is_file() {
            return Some(p);
        }
        // 部分设备目录结构为 /data/app/<pkg-base>/xxx/lib/arm64
        if let Ok(subs) = std::fs::read_dir(entry.path()) {
            for sub in subs.flatten() {
                let p2 = sub.path().join("lib").join("arm64").join(name);
                if p2.is_file() {
                    return Some(p2);
                }
            }
        }
    }
    None
}
