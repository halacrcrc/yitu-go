use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::engine::{Game, MoveRecord};

#[derive(Serialize, Deserialize, Clone)]
pub struct Settings {
    pub sound: bool,
    pub show_coords: bool,
    pub show_last_move: bool,
    pub show_territory: bool,
    pub confirm_move: bool,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default)]
    pub sidebar_collapsed: bool,
}

fn default_theme() -> String {
    "dark".into()
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            sound: true,
            show_coords: true,
            show_last_move: true,
            show_territory: false,
            confirm_move: false,
            theme: "dark".into(),
            sidebar_collapsed: false,
        }
    }
}

/// 一条战绩记录点（评分为空表示未计段位的对局）
#[derive(Serialize, Deserialize, Clone)]
pub struct RatingPoint {
    pub date: String,
    pub rating: i32,
    pub won: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Profile {
    pub name: String,
    pub rating: i32,
    pub wins: u32,
    pub losses: u32,
    pub draws: u32,
    pub puzzles_solved: Vec<String>,
    pub tutorial_done: Vec<String>,
    pub settings: Settings,
    #[serde(default)]
    pub rating_history: Vec<RatingPoint>,
}

impl Default for Profile {
    fn default() -> Self {
        Profile {
            name: "棋手".into(),
            rating: 800,
            wins: 0,
            losses: 0,
            draws: 0,
            puzzles_solved: Vec::new(),
            tutorial_done: Vec::new(),
            settings: Settings::default(),
            rating_history: Vec::new(),
        }
    }
}

/// 在战绩曲线末尾追加一个记录点（限制总量）
pub fn push_rating_history(prof: &mut Profile, won: Option<bool>) {
    let point = RatingPoint { date: now_string(), rating: prof.rating, won };
    prof.rating_history.push(point);
    let len = prof.rating_history.len();
    if len > 200 {
        prof.rating_history.drain(0..len - 200);
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RecordMeta {
    pub id: String,
    pub date: String,
    pub size: usize,
    pub komi: f64,
    pub result: String,
    pub black_name: String,
    pub white_name: String,
    pub moves: usize,
    pub reason: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RecordData {
    pub meta: RecordMeta,
    pub handicap_pos: Vec<usize>,
    pub handicap: u8,
    pub history: Vec<MoveRecord>,
    pub black_is_ai: bool,
    pub white_is_ai: bool,
    pub ai_level: u8,
    pub black_rank: String,
    pub white_rank: String,
    pub black_score: Option<f64>,
    pub white_score: Option<f64>,
}

/// AI 各难度对应等级分
pub const AI_LEVEL_RATINGS: [i32; 8] = [650, 850, 1050, 1250, 1450, 1650, 1850, 2100];

pub const AI_NAMES: [&str; 8] = [
    "木木小童", "入门棋童", "新手棋士", "进阶棋士", "业余好手", "业余强豪", "冲段高手", "棋院大师",
];

pub fn ai_rank_label(level: u8) -> String {
    let labels = [
        "入门·难度1", "初级·难度2", "初级·难度3", "中级·难度4", "中级·难度5", "高级·难度6", "高级·难度7", "特级·难度8",
    ];
    labels[(level.clamp(1, 8) - 1) as usize].to_string()
}

/// 段位换算（与前端 content.json 中的段位表保持一致）
pub fn rank_label(rating: i32) -> String {
    if rating < 2500 {
        let k = ((rating - 100).max(0) / 80) as u32;
        format!("{}级", 30 - k.min(29))
    } else if rating < 3800 {
        let d = ((rating - 2500) / 150) as u32 + 1;
        format!("业余{}段", d.min(9))
    } else {
        let d = ((rating - 3800) / 100) as u32 + 1;
        format!("职业{}段", d.min(9))
    }
}

pub fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("records")).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn load_profile(app: &tauri::AppHandle) -> Profile {
    if let Ok(dir) = data_dir(app) {
        if let Ok(text) = fs::read_to_string(dir.join("profile.json")) {
            if let Ok(mut prof) = serde_json::from_str::<Profile>(&text) {
                if prof.rating_history.is_empty() {
                    let t = now_string();
                    prof.rating_history.push(RatingPoint { date: t, rating: prof.rating, won: None });
                }
                return prof;
            }
        }
    }
    let mut prof = Profile::default();
    prof.rating_history.push(RatingPoint {
        date: now_string(),
        rating: prof.rating,
        won: None,
    });
    prof
}

pub fn save_profile(app: &tauri::AppHandle, prof: &Profile) -> Result<(), String> {
    let dir = data_dir(app)?;
    let text = serde_json::to_string_pretty(prof).map_err(|e| e.to_string())?;
    fs::write(dir.join("profile.json"), text).map_err(|e| e.to_string())
}

pub fn save_autosave(app: &tauri::AppHandle, game: &Game) -> Result<(), String> {
    let dir = data_dir(app)?;
    let text = serde_json::to_string(game).map_err(|e| e.to_string())?;
    fs::write(dir.join("autosave.json"), text).map_err(|e| e.to_string())
}

pub fn load_autosave(app: &tauri::AppHandle) -> Option<Game> {
    let dir = data_dir(app).ok()?;
    let text = fs::read_to_string(dir.join("autosave.json")).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn discard_autosave(app: &tauri::AppHandle) {
    if let Ok(dir) = data_dir(app) {
        let _ = fs::remove_file(dir.join("autosave.json"));
    }
}

pub fn save_record(app: &tauri::AppHandle, rec: &RecordData) -> Result<RecordMeta, String> {
    let dir = data_dir(app)?;
    let path = dir.join("records").join(format!("{}.json", rec.meta.id));
    let text = serde_json::to_string(rec).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())?;
    Ok(rec.meta.clone())
}

pub fn list_records(app: &tauri::AppHandle) -> Vec<RecordMeta> {
    let mut metas = Vec::new();
    if let Ok(dir) = data_dir(app) {
        if let Ok(entries) = fs::read_dir(dir.join("records")) {
            for e in entries.flatten() {
                let path = e.path();
                if path.extension().and_then(|s| s.to_str()) == Some("json") {
                    if let Ok(text) = fs::read_to_string(&path) {
                        if let Ok(rec) = serde_json::from_str::<RecordData>(&text) {
                            metas.push(rec.meta);
                        }
                    }
                }
            }
        }
    }
    metas.sort_by(|a, b| b.date.cmp(&a.date));
    metas
}

pub fn get_record(app: &tauri::AppHandle, id: &str) -> Result<RecordData, String> {
    let dir = data_dir(app)?;
    let path = dir.join("records").join(format!("{}.json", id));
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

pub fn delete_record(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let dir = data_dir(app)?;
    let path = dir.join("records").join(format!("{}.json", id));
    fs::remove_file(path).map_err(|e| e.to_string())
}

pub fn new_id() -> String {
    use rand::Rng;
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let r: u32 = rand::thread_rng().gen();
    format!("{:x}{:08x}", t, r)
}

/// Elo 更新（K=32，限制单局变动）
pub fn apply_rating(prof: &mut Profile, opp_rating: i32, player_won: bool) {
    let expected = 1.0 / (1.0 + 10f64.powf((opp_rating - prof.rating) as f64 / 400.0));
    let delta = (32.0 * (1.0 - expected)).round() as i32;
    let delta = if player_won { delta.max(3) } else { -((32.0 * expected).round() as i32).max(3) };
    prof.rating = (prof.rating + delta.clamp(-60, 60)).max(100);
    if player_won {
        prof.wins += 1;
    } else {
        prof.losses += 1;
    }
}

pub fn now_string() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
        + 8 * 3600; // UTC+8
    let days = (secs / 86400) as i64;
    let rem = secs % 86400;
    let (y, m, d) = civil_from_days(days);
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
        y, m, d, rem / 3600, (rem % 3600) / 60, rem % 60
    )
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}
