use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, State};

use crate::ai::{GoEngine, AnalyzeRequest, MoveIntent, MoveRequest, MoveAnalysis, EngineManager};
use crate::engine::{Game, Phase, Side};
use crate::store::{self, Profile, RecordData, RecordMeta, AI_LEVEL_RATINGS};

pub struct GameMutex(pub Mutex<Option<Game>>);

/// AI 引擎管理器状态（懒加载：首次访问时探测 KataGo / 回退内置引擎）
pub struct AiState(pub Mutex<Option<std::sync::Arc<EngineManager>>>);

#[derive(Serialize, Clone)]
pub struct PlayerDto {
    pub name: String,
    pub is_ai: bool,
    pub rank: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct MoveDto {
    pub side: u8,
    pub pos: Option<usize>,
}

#[derive(Serialize, Clone)]
pub struct GameStateDto {
    pub size: usize,
    pub board: Vec<u8>,
    pub turn: u8,
    pub captures: [u32; 2],
    pub komi: f64,
    pub handicap: u8,
    pub phase: String,
    pub result: Option<String>,
    pub last_move: Option<usize>,
    pub moves: Vec<MoveDto>,
    pub move_number: usize,
    pub territory: Option<Vec<u8>>,
    pub dead: Vec<usize>,
    pub black: PlayerDto,
    pub white: PlayerDto,
    pub can_undo: bool,
    pub rated: bool,
    pub ko: Option<usize>,
    pub passes: u32,
    pub black_score: Option<f64>,
    pub white_score: Option<f64>,
}

fn player_dto(name: &str, is_ai: bool, rank: &str) -> PlayerDto {
    PlayerDto { name: name.into(), is_ai, rank: rank.into() }
}

fn to_dto(g: &Game, bs: Option<f64>, ws: Option<f64>) -> GameStateDto {
    let territory = if g.phase == Phase::Scoring {
        Some(g.compute_score().2)
    } else {
        Some(g.influence_territory())
    };
    GameStateDto {
        size: g.size,
        board: g.board.clone(),
        turn: g.turn.num(),
        captures: [g.captures.0, g.captures.1],
        komi: g.komi,
        handicap: g.handicap,
        phase: match g.phase {
            Phase::Playing => "playing".into(),
            Phase::Scoring => "scoring".into(),
            Phase::Ended => "ended".into(),
        },
        result: g.result.clone(),
        last_move: g.last_move_pos(),
        moves: g
            .history
            .iter()
            .map(|m| MoveDto { side: m.side.num(), pos: m.pos })
            .collect(),
        move_number: g.history.len(),
        territory,
        dead: {
            let mut d: Vec<usize> = g.dead.iter().copied().collect();
            d.sort_unstable();
            d
        },
        black: player_dto(&g.black_name, g.black_is_ai, &g.black_rank),
        white: player_dto(&g.white_name, g.white_is_ai, &g.white_rank),
        can_undo: !g.history.is_empty() && g.phase != Phase::Ended,
        rated: g.rated,
        ko: g.ko,
        passes: g.passes,
        black_score: bs,
        white_score: ws,
    }
}

#[derive(Deserialize)]
pub struct NewGameReq {
    pub size: usize,
    pub komi: f64,
    pub handicap: u8,
    pub ai_level: u8,
    pub mode: String,         // "ai" | "human"
    pub player_color: String, // "black" | "white"
    pub rated: bool,
}

#[tauri::command]
pub fn new_game(app: AppHandle, state: State<GameMutex>, req: NewGameReq) -> Result<GameStateDto, String> {
    let prof = store::load_profile(&app);
    let size = req.size.clamp(5, 19);
    let level = req.ai_level.clamp(1, 10);
    let is_ai_mode = req.mode == "ai";
    let player_is_white = req.player_color == "white";
    let rated = req.rated && is_ai_mode && req.handicap < 2;

    let player_name = prof.name.clone();
    let player_rank = store::rank_label(prof.rating);
    let ai_name = store::AI_NAMES[(level - 1) as usize].to_string();
    let ai_rank = store::ai_rank_label(level);

    let (black_name, black_ai, black_rank, white_name, white_ai, white_rank) = if is_ai_mode {
        if player_is_white {
            (ai_name, true, ai_rank, player_name, false, player_rank)
        } else {
            (player_name, false, player_rank, ai_name, true, ai_rank)
        }
    } else {
        ("黑方".to_string(), false, "对局".to_string(), "白方".to_string(), false, "对局".to_string())
    };

    let komi = if req.handicap >= 2 { 0.5 } else { req.komi };
    let rated_side = if rated {
        Some(if player_is_white { Side::White } else { Side::Black })
    } else {
        None
    };

    let mut g = Game::new(
        size,
        komi,
        req.handicap,
        (&black_name, black_ai, &black_rank),
        (&white_name, white_ai, &white_rank),
        rated,
        rated_side,
    );
    g.ai_level = level;

    store::discard_autosave(&app);
    let dto = to_dto(&g, None, None);
    *state.0.lock().map_err(|_| "状态错误")? = Some(g);
    Ok(dto)
}

#[tauri::command]
pub fn get_state(state: State<GameMutex>) -> Result<GameStateDto, String> {
    let guard = state.0.lock().map_err(|_| "状态错误")?;
    let g = guard.as_ref().ok_or("没有进行中的对局")?;
    Ok(to_dto(g, None, None))
}

fn autosave(app: &AppHandle, g: &Game) {
    if g.phase == Phase::Playing || g.phase == Phase::Scoring {
        store::save_autosave(app, g).ok();
    }
}

#[tauri::command]
pub fn play_move(app: AppHandle, state: State<GameMutex>, pos: usize) -> Result<GameStateDto, String> {
    let mut guard = state.0.lock().map_err(|_| "状态错误")?;
    let g = guard.as_mut().ok_or("没有进行中的对局")?;
    g.play(pos)?;
    autosave(&app, g);
    Ok(to_dto(g, None, None))
}

#[tauri::command]
pub fn pass_turn(app: AppHandle, state: State<GameMutex>) -> Result<GameStateDto, String> {
    let mut guard = state.0.lock().map_err(|_| "状态错误")?;
    let g = guard.as_mut().ok_or("没有进行中的对局")?;
    g.pass();
    autosave(&app, g);
    Ok(to_dto(g, None, None))
}

fn undo_impl(g: &mut Game) -> bool {
    if g.history.is_empty() || g.phase == Phase::Ended {
        return false;
    }
    let player_side: Option<Side> = match (g.black_is_ai, g.white_is_ai) {
        (true, false) => Some(Side::White),
        (false, true) => Some(Side::Black),
        _ => None,
    };
    g.undo();
    if let Some(ps) = player_side {
        while g.turn != ps && !g.history.is_empty() {
            g.undo();
        }
    }
    true
}

#[tauri::command]
pub fn undo_move(app: AppHandle, state: State<GameMutex>) -> Result<GameStateDto, String> {
    let mut guard = state.0.lock().map_err(|_| "状态错误")?;
    let g = guard.as_mut().ok_or("没有进行中的对局")?;
    if !undo_impl(g) {
        return Err("没有可以悔的棋".into());
    }
    autosave(&app, g);
    Ok(to_dto(g, None, None))
}

#[tauri::command]
pub fn resign(app: AppHandle, state: State<GameMutex>, side: String) -> Result<GameStateDto, String> {
    let mut guard = state.0.lock().map_err(|_| "状态错误")?;
    let g = guard.as_mut().ok_or("没有进行中的对局")?;
    let s = if side == "white" { Side::White } else { Side::Black };
    let player_side: Option<Side> = match (g.black_is_ai, g.white_is_ai) {
        (true, false) => Some(Side::White),
        (false, true) => Some(Side::Black),
        _ => None,
    };
    g.resign(s);
    // 计分与存档
    let mut prof = store::load_profile(&app);
    if g.rated {
        if let (Some(ps), Some(rs)) = (player_side, g.rated_side) {
            if ps == rs {
                let opp = AI_LEVEL_RATINGS[(g.ai_level.clamp(1, 10) - 1) as usize];
                store::apply_rating(&mut prof, opp, s != ps);
                store::push_rating_history(&mut prof, Some(s != ps));
            }
        }
    }
    let meta = RecordMeta {
        id: store::new_id(),
        date: store::now_string(),
        size: g.size,
        komi: g.komi,
        result: g.result.clone().unwrap_or_default(),
        black_name: g.black_name.clone(),
        white_name: g.white_name.clone(),
        moves: g.history.len(),
        reason: "中盘".into(),
    };
    let rec = RecordData {
        meta,
        handicap_pos: g.handicap_pos.clone(),
        handicap: g.handicap,
        history: g.history.clone(),
        black_is_ai: g.black_is_ai,
        white_is_ai: g.white_is_ai,
        ai_level: g.ai_level,
        black_rank: g.black_rank.clone(),
        white_rank: g.white_rank.clone(),
        black_score: None,
        white_score: None,
    };
    store::save_record(&app, &rec).ok();
    store::save_profile(&app, &prof).ok();
    store::discard_autosave(&app);
    let dto = to_dto(g, None, None);
    Ok(dto)
}

#[tauri::command]
pub async fn ai_move(
    app: AppHandle,
    state: State<'_, GameMutex>,
    ai: State<'_, AiState>,
) -> Result<GameStateDto, String> {
    let (game_clone, level) = {
        let guard = state.0.lock().map_err(|_| "状态错误")?;
        let g = guard.as_ref().ok_or("没有进行中的对局")?;
        if g.phase != Phase::Playing {
            return Err("对局已结束".into());
        }
        let is_ai = match g.turn {
            Side::Black => g.black_is_ai,
            Side::White => g.white_is_ai,
        };
        if !is_ai {
            return Err("当前轮到人类棋手".into());
        }
        (g.clone(), g.ai_level)
    };
    let engine = get_engine(app.clone(), ai).await?;
    let mv = tauri::async_runtime::spawn_blocking(move || {
        engine.best_move(&MoveRequest::from_game(&game_clone, level, MoveIntent::Play))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    let mut guard = state.0.lock().map_err(|_| "状态错误")?;
    let g = guard.as_mut().ok_or("没有进行中的对局")?;
    if g.phase != Phase::Playing {
        return Err("对局已结束".into());
    }
    if let Some(pos) = mv {
        g.play(pos).map_err(|e| e)?;
    } else {
        g.pass();
    }
    autosave(&app, g);
    Ok(to_dto(g, None, None))
}

#[tauri::command]
pub async fn hint(
    app: AppHandle,
    state: State<'_, GameMutex>,
    ai: State<'_, AiState>,
) -> Result<Option<usize>, String> {
    let game_clone = {
        let guard = state.0.lock().map_err(|_| "状态错误")?;
        let g = guard.as_ref().ok_or("没有进行中的对局")?;
        if g.phase != Phase::Playing {
            return Err("对局已结束".into());
        }
        g.clone()
    };
    // Hint 语义（文档 3.7）：固定正常模型 + 中档 visits，与对局档位无关
    let engine = get_engine(app.clone(), ai).await?;
    tauri::async_runtime::spawn_blocking(move || {
        engine.best_move(&MoveRequest::from_game(&game_clone, 0, MoveIntent::Hint))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ai_status(app: AppHandle, ai: State<'_, AiState>) -> Result<crate::ai::AiStatus, String> {
    let engine = get_engine(app.clone(), ai).await?;
    Ok(engine.status())
}

/// 复盘分析：对棋谱记录 [from, to) 手区间逐手评估（需要 KataGo）
#[tauri::command]
pub async fn analyze_moves(
    app: AppHandle,
    ai: State<'_, AiState>,
    size: usize,
    komi: f64,
    handicap: u8,
    handicap_pos: Vec<usize>,
    moves: Vec<MoveDto>,
    from: usize,
    to: usize,
    visits: u32,
) -> Result<Vec<MoveAnalysis>, String> {
    let engine = get_engine(app, ai).await?;

    // 从 DTO 重建只读对局状态（不进入 GameMutex，不影响正在进行的对局）
    let mut g = Game::new(size, komi, 0, ("", false, ""), ("w", false, ""), false, None);
    if handicap >= 2 {
        g.handicap_pos = handicap_pos.clone();
        for &p in &g.handicap_pos {
            g.board[p] = crate::engine::BLACK;
        }
        g.turn = Side::White;
        g.handicap = handicap;
    }
    for m in &moves {
        let side = if m.side == 1 { Side::Black } else { Side::White };
        match m.pos {
            Some(p) => {
                g.board[p] = side.num();
                g.history.push(crate::engine::MoveRecord { side, pos: Some(p), captured: vec![] });
            }
            None => g.history.push(crate::engine::MoveRecord { side, pos: None, captured: vec![] }),
        }
    }

    tauri::async_runtime::spawn_blocking(move || {
        engine.analyze(&AnalyzeRequest { game: g, from, to, visits })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 死活判题（文档第六章）：题面子进 initialStones（双色），moves 需已包含玩家这手；
/// target_points 为目标块，expect_owner: +1 目标块终属黑 / -1 终属白。
/// 三值判定：达成（≥0.8）/ 未达成（≤0.2）/ 不明确（劫或依赖后续，0.2~0.8）。
#[derive(Deserialize)]
pub struct InitialStoneDto {
    pub side: u8,
    pub pos: usize,
}

#[tauri::command]
pub async fn judge_position(
    app: AppHandle,
    ai: State<'_, AiState>,
    size: usize,
    komi: f64,
    initial_black: Vec<usize>,
    initial_white: Vec<usize>,
    moves: Vec<MoveDto>,
    target_points: Vec<usize>,
    expect_owner: i8,
    visits: u32,
) -> Result<crate::ai::Verdict, String> {
    let engine = get_engine(app, ai).await?;
    tauri::async_runtime::spawn_blocking(move || {
        engine.judge_position(&crate::ai::JudgeRequest {
            size,
            komi,
            initial_black,
            initial_white,
            moves: moves
                .into_iter()
                .map(|m| (m.side, m.pos.expect("判题手顺不允许 pass")))
                .collect(),
            target_points,
            expect_owner,
            visits: visits.clamp(32, 512),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 懒加载引擎管理器：首次访问时探测 app_data_dir/katago/（缺失则纯内置引擎）
async fn get_engine(app: AppHandle, ai: State<'_, AiState>) -> Result<std::sync::Arc<EngineManager>, String> {
    if let Some(m) = ai.0.lock().map_err(|_| "状态错误")?.clone() {
        return Ok(m);
    }
    let prof = store::load_profile(&app);
    let custom = prof.settings.katago_dir.trim().to_string();
    let custom = if custom.is_empty() { None } else { Some(custom) };
    let data_dir = store::data_dir(&app)?;
    let mgr = tauri::async_runtime::spawn_blocking(move || {
        std::sync::Arc::new(EngineManager::detect(&data_dir, custom.as_deref()))
    })
    .await
    .map_err(|e| e.to_string())?;
    *ai.0.lock().map_err(|_| "状态错误")? = Some(mgr.clone());
    Ok(mgr)
}

/// 设置自定义 KataGo 引擎目录（空串恢复默认），并重置引擎管理器使其重新探测
#[tauri::command]
pub fn set_katago_dir(
    app: AppHandle,
    ai: State<'_, AiState>,
    dir: String,
) -> Result<crate::ai::AiStatus, String> {
    let mut prof = store::load_profile(&app);
    prof.settings.katago_dir = dir.trim().to_string();
    store::save_profile(&app, &prof).ok();
    // 重置引擎管理器：下次请求按新目录重新探测
    *ai.0.lock().map_err(|_| "状态错误")? = None;
    let mgr = std::sync::Arc::new(EngineManager::detect(
        &store::data_dir(&app)?,
        if prof.settings.katago_dir.is_empty() {
            None
        } else {
            Some(prof.settings.katago_dir.as_str())
        },
    ));
    *ai.0.lock().map_err(|_| "状态错误")? = Some(mgr.clone());
    Ok(mgr.status())
}

#[tauri::command]
pub fn enter_scoring(state: State<GameMutex>) -> Result<GameStateDto, String> {
    let mut guard = state.0.lock().map_err(|_| "状态错误")?;
    let g = guard.as_mut().ok_or("没有进行中的对局")?;
    if g.phase != Phase::Playing {
        return Err("当前不处于对局阶段".into());
    }
    g.passes = 2;
    g.phase = Phase::Scoring;
    g.estimate_dead_public();
    Ok(to_dto(g, None, None))
}

#[tauri::command]
pub fn toggle_dead(state: State<GameMutex>, pos: usize) -> Result<GameStateDto, String> {
    let mut guard = state.0.lock().map_err(|_| "状态错误")?;
    let g = guard.as_mut().ok_or("没有进行中的对局")?;
    if g.phase != Phase::Scoring {
        return Err("当前不处于数子阶段".into());
    }
    g.toggle_dead(pos);
    Ok(to_dto(g, None, None))
}

#[tauri::command]
pub fn resume_scoring(state: State<GameMutex>) -> Result<GameStateDto, String> {
    let mut guard = state.0.lock().map_err(|_| "状态错误")?;
    let g = guard.as_mut().ok_or("没有进行中的对局")?;
    if g.phase == Phase::Scoring {
        g.phase = Phase::Playing;
        g.passes = 1;
        g.dead.clear();
    }
    Ok(to_dto(g, None, None))
}

#[tauri::command]
pub fn confirm_result(app: AppHandle, state: State<GameMutex>) -> Result<GameStateDto, String> {
    let mut guard = state.0.lock().map_err(|_| "状态错误")?;
    let g = guard.as_mut().ok_or("没有进行中的对局")?;
    if g.phase != Phase::Scoring {
        return Err("当前不处于数子阶段".into());
    }
    let (b, w, _, _) = g.compute_score();
    let diff = (b - w).abs();
    let winner = if b > w { "黑" } else { "白" };
    g.result = Some(format!("{}胜{:.1}目", winner, diff));
    g.phase = Phase::Ended;

    let mut prof = store::load_profile(&app);
    if g.rated {
        if let Some(ps) = g.rated_side {
            let opp = AI_LEVEL_RATINGS[(g.ai_level.clamp(1, 10) - 1) as usize];
            let player_won = match ps {
                Side::Black => b > w,
                Side::White => w > b,
            };
            store::apply_rating(&mut prof, opp, player_won);
            store::push_rating_history(&mut prof, Some(player_won));
        }
    }

    let meta = RecordMeta {
        id: store::new_id(),
        date: store::now_string(),
        size: g.size,
        komi: g.komi,
        result: g.result.clone().unwrap_or_default(),
        black_name: g.black_name.clone(),
        white_name: g.white_name.clone(),
        moves: g.history.len(),
        reason: "数子".into(),
    };
    let rec = RecordData {
        meta,
        handicap_pos: g.handicap_pos.clone(),
        handicap: g.handicap,
        history: g.history.clone(),
        black_is_ai: g.black_is_ai,
        white_is_ai: g.white_is_ai,
        ai_level: g.ai_level,
        black_rank: g.black_rank.clone(),
        white_rank: g.white_rank.clone(),
        black_score: Some(b),
        white_score: Some(w),
    };
    store::save_record(&app, &rec).ok();
    store::save_profile(&app, &prof).ok();
    store::discard_autosave(&app);
    Ok(to_dto(g, Some(b), Some(w)))
}

#[tauri::command]
pub fn get_autosave(app: AppHandle) -> Option<GameStateDto> {
    let g = store::load_autosave(&app)?;
    Some(to_dto(&g, None, None))
}

#[tauri::command]
pub fn continue_autosave(app: AppHandle, state: State<GameMutex>) -> Result<GameStateDto, String> {
    let g = store::load_autosave(&app).ok_or("没有可继续的对局")?;
    let dto = to_dto(&g, None, None);
    *state.0.lock().map_err(|_| "状态错误")? = Some(g);
    Ok(dto)
}

#[tauri::command]
pub fn discard_autosave_cmd(app: AppHandle) {
    store::discard_autosave(&app);
}

// ---------- 个人档案 ----------

#[tauri::command]
pub fn get_profile(app: AppHandle) -> Profile {
    store::load_profile(&app)
}

#[tauri::command]
pub fn update_profile(app: AppHandle, profile: Profile) -> Profile {
    store::save_profile(&app, &profile).ok();
    profile
}

// ---------- 棋谱库 ----------

#[tauri::command]
pub fn list_records(app: AppHandle) -> Vec<RecordMeta> {
    store::list_records(&app)
}

#[tauri::command]
pub fn get_record(app: AppHandle, id: String) -> Result<RecordData, String> {
    store::get_record(&app, &id)
}

#[tauri::command]
pub fn delete_record(app: AppHandle, id: String) -> Result<(), String> {
    store::delete_record(&app, &id)
}

#[tauri::command]
pub fn export_record_sgf(app: AppHandle, id: String, path: String) -> Result<(), String> {
    let rec = store::get_record(&app, &id)?;
    let sgf = crate::sgf::export_sgf(&rec);
    std::fs::write(&path, sgf).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_sgf(app: AppHandle, path: String) -> Result<RecordMeta, String> {
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let parsed = crate::sgf::parse_sgf(&text)?;
    let black_score = None;
    let white_score = None;
    let meta = RecordMeta {
        id: store::new_id(),
        date: if parsed.dt.is_empty() { store::now_string() } else { parsed.dt },
        size: parsed.size,
        komi: parsed.komi,
        result: if parsed.re.is_empty() { "未知".into() } else { parsed.re },
        black_name: parsed.pb,
        white_name: parsed.pw,
        moves: parsed.moves.len(),
        reason: "导入".into(),
    };
    let rec = RecordData {
        meta,
        handicap_pos: parsed.handicap_pos,
        handicap: parsed.handicap,
        history: parsed.moves,
        black_is_ai: false,
        white_is_ai: false,
        ai_level: 0,
        black_rank: String::new(),
        white_rank: String::new(),
        black_score,
        white_score,
    };
    store::save_record(&app, &rec)
}
