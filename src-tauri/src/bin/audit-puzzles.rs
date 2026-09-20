// 题库 AI 审计：用本机 KataGo 对全部死活题的正解结果做 ownership 独立校验
// 运行：cargo run --release --bin audit-puzzles（需 YITU_KATAGO_DIR 或默认目录）
// 输出：docs/puzzle-audit.json

use yitu_go_lib::ai::{GoEngine, JudgeRequest, KataGoDesktop};
use yitu_go_lib::engine::{Game, Side, BLACK, WHITE};

fn coord(p: &str) -> usize {
    let x = p.as_bytes()[0] - b'a';
    let y = p.as_bytes()[1] - b'a';
    (y as usize) * 9 + (x as usize)
}

fn main() {
    let content = include_str!("../../../src/content.json");
    let v: serde_json::Value = serde_json::from_str(content).expect("content.json");
    let puzzles = v["puzzles"].as_array().expect("puzzles");

    let dir = std::env::var("YITU_KATAGO_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            std::path::PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_default())
                .join("com.yitugo.app")
                .join("katago")
        });
    let k = KataGoDesktop::from_dir(&dir).expect("KataGo 启动失败（检查 YITU_KATAGO_DIR）");
    println!("引擎已启动: {:?}", k.capability());

    let mut report = serde_json::Map::new();
    let mut ok = 0usize;
    let mut warn = 0usize;

    for p in puzzles {
        let id = p["id"].as_str().unwrap_or("?").to_string();
        let stones = &p["stones"];
        let solution = p["solution"].as_array().expect("solution");
        let to_move_black = p["toMove"].as_str() != Some("w");

        let mut g = Game::new(9, 7.5, 0, ("", false, ""), ("w", false, ""), false, None);
        for c in stones["black"].as_array().unwrap() {
            let s = c.as_str().unwrap();
            g.board[coord(s)] = BLACK;
            g.handicap_pos.push(coord(s));
        }
        for c in stones["white"].as_array().unwrap() {
            let s = c.as_str().unwrap();
            g.board[coord(s)] = WHITE;
        }
        // 正解手顺模拟（seq/exact/escape/eyes 都按 solution 走黑手 + replies 白手）
        let replies = p["replies"].as_array();
        let mut ri = 0usize;
        g.turn = if to_move_black { Side::Black } else { Side::White };
        for (i, s) in solution.iter().enumerate() {
            let pos = coord(s.as_str().unwrap());
            g.turn = if to_move_black { Side::Black } else { Side::White };
            let _ = g.play(pos);
            if let Some(r) = replies {
                if let Some(rc) = r.get(ri) {
                    let rc = rc.as_str().unwrap_or("");
                    if rc != "pass" {
                        g.turn = if to_move_black { Side::White } else { Side::Black };
                        let _ = g.play(coord(rc));
                    }
                    ri += 1;
                }
            }
            let _ = i;
        }

        // 目标与期望：targets 缺省 = 题面白子全部；期望 = 正解后目标被提/死（归对手=落子方）
        let targets: Vec<usize> = match p["targets"].as_array() {
            Some(a) => a.iter().map(|c| coord(c.as_str().unwrap())).collect(),
            None => stones["white"].as_array().map(|a| a.iter().map(|c| coord(c.as_str().unwrap())).collect()).unwrap_or_default(),
        };
        if targets.is_empty() {
            report.insert(id.clone(), serde_json::json!({"skipped": "no targets"}));
            continue;
        }
        let expect_owner: i8 = if to_move_black { 1 } else { -1 }; // 玩家(黑/白)吃掉目标 → 目标归玩家

        // 收集实际落子序列（黑白交替，含正解与应手）
        let moves_seq: Vec<(u8, usize)> = g.history.iter().map(|m| (m.side.num(), m.pos.unwrap_or(0))).collect();
        let verdict = k.judge_position(&JudgeRequest {
            size: 9,
            komi: 7.5,
            initial_black: stones["black"].as_array().unwrap().iter().map(|c| coord(c.as_str().unwrap())).collect(),
            initial_white: stones["white"].as_array().unwrap().iter().map(|c| coord(c.as_str().unwrap())).collect(),
            moves: moves_seq,
            target_points: targets.clone(),
            expect_owner,
            visits: 128,
        });

        match verdict {
            Ok(vv) => {
                let tag = match vv {
                    yitu_go_lib::ai::Verdict::Achieved => { ok += 1; "achieved" }
                    yitu_go_lib::ai::Verdict::Failed => { warn += 1; "failed" }
                    yitu_go_lib::ai::Verdict::Unclear => { warn += 1; "unclear" }
                };
                println!("{id}: {tag}");
                report.insert(id.clone(), serde_json::json!({"verdict": tag, "targets": targets}));
            }
            Err(e) => {
                warn += 1;
                println!("{id}: ERROR {e}");
                report.insert(id.clone(), serde_json::json!({"error": e}));
            }
        }
    }

    println!("
结果: {ok} achieved / {warn} 需复核");
    let out = serde_json::json!({ "ok": ok, "warn": warn, "puzzles": report });
    let _ = std::fs::create_dir_all("docs");
    std::fs::write("docs/puzzle-audit.json", serde_json::to_string_pretty(&out).unwrap()).ok();
    println!("报告已写入 docs/puzzle-audit.json");
}
