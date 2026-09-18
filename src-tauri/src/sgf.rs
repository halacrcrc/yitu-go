use crate::engine::{MoveRecord, Side};
use crate::store::RecordData;

fn coord_to_sgf(size: usize, pos: usize) -> String {
    let (x, y) = (pos % size, pos / size);
    let letters = b"abcdefghijklmnopqrstuvwxyz";
    format!("{}{}", letters[x] as char, letters[y] as char)
}

fn sgf_to_coord(size: usize, v: &str) -> Option<usize> {
    let chars: Vec<char> = v.chars().collect();
    if chars.len() < 2 {
        return None;
    }
    let letters = b"abcdefghijklmnopqrstuvwxyz";
    let x = letters.iter().position(|&c| c == chars[0] as u8)?;
    let y = letters.iter().position(|&c| c == chars[1] as u8)?;
    if x >= size || y >= size {
        return None; // 越界（如 19 路的 "tt" 表示停一手）
    }
    Some(y * size + x)
}

pub fn export_sgf(rec: &RecordData) -> String {
    let m = &rec.meta;
    let mut s = String::new();
    s.push_str("(;GM[1]FF[4]CA[UTF-8]AP[YiTuGo:1.0]");
    s.push_str(&format!("SZ[{}]", m.size));
    s.push_str(&format!("KM[{}]", m.komi));
    if !m.date.is_empty() {
        s.push_str(&format!("DT[{}]", m.date));
    }
    if !m.result.is_empty() {
        s.push_str(&format!("RE[{}]", m.result));
    }
    s.push_str(&format!("PB[{}]PW[{}]", m.black_name, m.white_name));
    if rec.handicap >= 2 {
        s.push_str(&format!("HA[{}]", rec.handicap));
        for &p in &rec.handicap_pos {
            s.push_str(&format!("AB[{}]", coord_to_sgf(m.size, p)));
        }
    }
    for mv in &rec.history {
        let tag = if mv.side == Side::Black { "B" } else { "W" };
        match mv.pos {
            Some(p) => s.push_str(&format!(";{}[{}]", tag, coord_to_sgf(m.size, p))),
            None => s.push_str(&format!(";{}[]", tag)),
        }
    }
    s.push(')');
    s
}

pub struct SgfGame {
    pub size: usize,
    pub komi: f64,
    pub handicap: u8,
    pub handicap_pos: Vec<usize>,
    pub moves: Vec<MoveRecord>,
    pub pb: String,
    pub pw: String,
    pub re: String,
    pub dt: String,
}

/// 极简 SGF 解析器：支持 SZ/KM/HA/PB/PW/RE/DT/AB/B/W
pub fn parse_sgf(text: &str) -> Result<SgfGame, String> {
    let chars: Vec<char> = text.chars().collect();
    let n = chars.len();
    let mut i = 0usize;

    let mut size = 19usize;
    let mut komi = 7.5f64;
    let mut handicap = 0u8;
    let mut ab: Vec<usize> = Vec::new();
    let mut moves: Vec<MoveRecord> = Vec::new();
    let mut pb = "黑方".to_string();
    let mut pw = "白方".to_string();
    let mut re = String::new();
    let mut dt = String::new();

    while i < n {
        match chars[i] {
            '(' | ')' | ';' => {
                i += 1;
            }
            '[' => {
                // 未知位置的值，跳过
                i += 1;
                while i < n && chars[i] != ']' {
                    if chars[i] == '\\' {
                        i += 1;
                    }
                    i += 1;
                }
                i += 1;
            }
            c if c.is_ascii_uppercase() => {
                let start = i;
                while i < n && chars[i].is_ascii_alphabetic() {
                    i += 1;
                }
                let key: String = chars[start..i].iter().collect();
                let mut vals: Vec<String> = Vec::new();
                loop {
                    while i < n && chars[i].is_whitespace() {
                        i += 1;
                    }
                    if i < n && chars[i] == '[' {
                        i += 1;
                        let mut v = String::new();
                        while i < n && chars[i] != ']' {
                            if chars[i] == '\\' && i + 1 < n {
                                i += 1;
                            }
                            v.push(chars[i]);
                            i += 1;
                        }
                        i += 1;
                        vals.push(v);
                    } else {
                        break;
                    }
                }
                match key.as_str() {
                    "SZ" => {
                        size = vals.first().and_then(|v| v.trim().parse().ok()).unwrap_or(19)
                    }
                    "KM" => {
                        komi = vals
                            .first()
                            .and_then(|v| v.trim().parse().ok())
                            .unwrap_or(7.5)
                    }
                    "HA" => {
                        handicap = vals
                            .first()
                            .and_then(|v| v.trim().parse().ok())
                            .unwrap_or(0)
                    }
                    "PB" => pb = vals.first().cloned().unwrap_or(pb),
                    "PW" => pw = vals.first().cloned().unwrap_or(pw),
                    "RE" => re = vals.first().cloned().unwrap_or_default(),
                    "DT" => dt = vals.first().cloned().unwrap_or_default(),
                    "AB" => {
                        for v in &vals {
                            if let Some(p) = sgf_to_coord(size, v) {
                                ab.push(p);
                            }
                        }
                    }
                    "B" | "W" => {
                        let side = if key == "B" { Side::Black } else { Side::White };
                        let pos = vals.first().and_then(|v| sgf_to_coord(size, v));
                        moves.push(MoveRecord { side, pos, captured: vec![] });
                    }
                    _ => {}
                }
            }
            _ => {
                i += 1;
            }
        }
    }

    let size = size.clamp(5, 25);
    if moves.is_empty() && ab.is_empty() {
        return Err("未找到有效的棋谱内容".into());
    }
    if handicap == 0 && ab.len() >= 2 {
        handicap = ab.len() as u8;
    }
    Ok(SgfGame { size, komi, handicap, handicap_pos: ab, moves, pb, pw, re, dt })
}
