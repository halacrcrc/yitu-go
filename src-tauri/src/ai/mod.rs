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
    fn capability(&self) -> Capability;
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
/// 失败/超时/缺失时自动降级到 FallbackEngine（文档 5.3）。
pub struct EngineManager {
    katago: Option<katago::KataGoDesktop>,
    dir: std::path::PathBuf,
}

impl EngineManager {
    /// 按文档 3.8：引擎目录 = app_data_dir/katago/
    /// 预期文件：katago.exe、model.bin.gz、katago.cfg，（可选）human.bin.gz
    pub fn detect(data_dir: &std::path::Path) -> Self {
        let dir = data_dir.join("katago");
        let katago = match katago::KataGoDesktop::from_dir(&dir) {
            Ok(k) => {
                eprintln!("[ai] KataGo 引擎已启用: {}", k.capability().backend);
                Some(k)
            }
            Err(e) => {
                eprintln!("[ai] KataGo 不可用（{}），使用内置引擎", e);
                None
            }
        };
        EngineManager { katago, dir }
    }

    pub fn engine_dir(&self) -> &std::path::Path {
        &self.dir
    }

    pub fn capability(&self) -> Capability {
        if let Some(k) = &self.katago {
            return k.capability();
        }
        FallbackEngine.capability()
    }

    pub fn has_katago(&self) -> bool {
        self.katago.is_some()
    }
}

impl GoEngine for EngineManager {
    fn capability(&self) -> Capability {
        if let Some(k) = &self.katago {
            return k.capability();
        }
        FallbackEngine.capability()
    }

    fn best_move(&self, req: &MoveRequest) -> Result<Option<usize>, String> {
        if let Some(k) = &self.katago {
            match k.best_move(req) {
                Ok(m) => return Ok(m),
                Err(e) => {
                    // 文档 3.7：超时/崩溃自动切 FallbackEngine，不能让应用不能下棋
                    eprintln!("[ai] KataGo 查询失败（{}），本次降级到内置引擎", e);
                }
            }
        }
        FallbackEngine.best_move(req)
    }
}
