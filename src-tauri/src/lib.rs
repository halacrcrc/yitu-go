pub mod ai;
pub mod commands;
pub mod engine;
pub mod sgf;
pub mod store;

use commands::{AiState, GameMutex};
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(GameMutex(Mutex::new(None)))
        .manage(AiState(Mutex::new(None))) // 引擎懒加载：首次用时探测
        .invoke_handler(tauri::generate_handler![
            commands::new_game,
            commands::get_state,
            commands::play_move,
            commands::pass_turn,
            commands::undo_move,
            commands::resign,
            commands::ai_move,
            commands::hint,
            commands::ai_status,
            commands::analyze_moves,
            commands::judge_position,
            commands::enter_scoring,
            commands::toggle_dead,
            commands::resume_scoring,
            commands::confirm_result,
            commands::get_autosave,
            commands::continue_autosave,
            commands::discard_autosave_cmd,
            commands::get_profile,
            commands::update_profile,
            commands::list_records,
            commands::get_record,
            commands::delete_record,
            commands::export_record_sgf,
            commands::import_sgf,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use crate::engine::*;

    fn pos(size: usize, x: usize, y: usize) -> usize {
        y * size + x
    }

    #[test]
    fn test_capture_single_stone() {
        let mut g = Game::new(9, 7.5, 0, ("b", false, ""), ("w", false, ""), false, None);
        let p = |x: usize, y: usize| pos(9, x, y);
        // 白 E5 = (4,4)，黑围三面，黑落最后一口气提子
        g.board[p(4, 4)] = WHITE;
        g.board[p(3, 4)] = BLACK;
        g.board[p(5, 4)] = BLACK;
        g.board[p(4, 3)] = BLACK;
        g.turn = Side::Black;
        let captured = g.try_move(p(4, 5), Side::Black).unwrap();
        assert_eq!(captured, vec![p(4, 4)]);
        g.play(p(4, 5)).unwrap();
        assert_eq!(g.board[p(4, 4)], EMPTY);
        assert_eq!(g.captures.0, 1);
    }

    #[test]
    fn test_suicide_forbidden() {
        let mut g = Game::new(9, 7.5, 0, ("b", false, ""), ("w", false, ""), false, None);
        let p = |x: usize, y: usize| pos(9, x, y);
        // 黑子被白四面围住的一个空点，黑落子应被禁止
        g.board[p(4, 3)] = WHITE;
        g.board[p(4, 5)] = WHITE;
        g.board[p(3, 4)] = WHITE;
        g.board[p(5, 4)] = WHITE;
        g.turn = Side::Black;
        assert!(g.try_move(p(4, 4), Side::Black).is_err());
        // 但白方落这里可以（会提黑？无黑子，白落子合法）
        g.turn = Side::White;
        assert!(g.try_move(p(4, 4), Side::White).is_ok());
    }

    #[test]
    fn test_ko() {
        let mut g = Game::new(9, 7.5, 0, ("b", false, ""), ("w", false, ""), false, None);
        let p = |x: usize, y: usize| pos(9, x, y);
        // 经典劫形：
        //   黑: (4,3), (3,4), (5,4), (4,5)
        //   白: (3,3), (5,3), (4,2)
        // 黑 (4,3) 只剩 (4,4) 一口气；白下 (4,4) 提黑一子成劫
        g.board[p(4, 3)] = BLACK;
        g.board[p(3, 4)] = BLACK;
        g.board[p(5, 4)] = BLACK;
        g.board[p(4, 5)] = BLACK;
        g.board[p(3, 3)] = WHITE;
        g.board[p(5, 3)] = WHITE;
        g.board[p(4, 2)] = WHITE;
        g.turn = Side::White;
        let cap = g.try_move(p(4, 4), Side::White).unwrap();
        assert_eq!(cap, vec![p(4, 3)]);
        g.play(p(4, 4)).unwrap();
        // 劫点 = (4,3)
        assert_eq!(g.ko, Some(p(4, 3)));
        // 黑不能立即回提
        g.turn = Side::Black;
        assert!(g.try_move(p(4, 3), Side::Black).is_err());
        // 黑别处落子后可以回提
        g.play(p(0, 0)).unwrap();
        g.turn = Side::Black;
        assert!(g.try_move(p(4, 3), Side::Black).is_ok());
    }

    #[test]
    fn test_undo_rebuild() {
        let mut g = Game::new(9, 7.5, 0, ("b", false, ""), ("w", false, ""), false, None);
        let p = |x: usize, y: usize| pos(9, x, y);
        g.play(p(2, 2)).unwrap();
        g.play(p(6, 6)).unwrap();
        g.play(p(4, 4)).unwrap();
        assert_eq!(g.board[p(4, 4)], BLACK);
        g.undo();
        assert_eq!(g.board[p(4, 4)], EMPTY);
        assert_eq!(g.turn, Side::Black);
        assert_eq!(g.history.len(), 2);
        g.undo();
        g.undo();
        assert!(g.history.is_empty());
        assert_eq!(g.turn, Side::Black);
    }

    #[test]
    fn test_handicap_and_rebuild() {
        let mut g = Game::new(9, 0.5, 2, ("b", false, ""), ("w", false, ""), false, None);
        assert_eq!(g.turn, Side::White);
        assert_eq!(g.handicap_pos.len(), 2);
        g.play(pos(9, 4, 4)).unwrap(); // 白天元
        g.play(pos(9, 3, 4)).unwrap(); // 黑应一手
        assert_eq!(g.board[pos(9, 4, 4)], WHITE);
        g.undo();
        assert_eq!(g.board[pos(9, 4, 4)], WHITE); // 让子仍在，白棋那手也在
        assert_eq!(g.board[pos(9, 2, 2)], BLACK); // 让子仍在
        assert_eq!(g.board[pos(9, 3, 4)], EMPTY); // 黑棋最后一手被撤销
        assert_eq!(g.turn, Side::Black); // 撤销了黑棋那手，轮到黑棋
    }

    #[test]
    fn test_area_scoring() {
        let mut g = Game::new(9, 7.5, 0, ("b", false, ""), ("w", false, ""), false, None);
        // 黑: 左边 4 子纵队 (1,1),(1,2),(1,3),(1,4)?? 简单场景：
        // 黑围左下角: (1,1),(2,1),(1,2)?? 让黑拥有角地 A1? 
        // 黑子: (1,0),(0,1),(1,1)?? 这样 A1? 空点 (0,0) 被黑 (1,0),(0,1) 包围 → 黑地
        g.board[pos(9, 1, 0)] = BLACK;
        g.board[pos(9, 0, 1)] = BLACK;
        // 白围右上角: (7,0),(8,1)
        g.board[pos(9, 7, 0)] = WHITE;
        g.board[pos(9, 8, 1)] = WHITE;
        g.passes = 2;
        g.phase = Phase::Scoring;
        let (b, w, terr, _) = g.compute_score();
        assert_eq!(terr[pos(9, 0, 0)], BLACK);
        assert_eq!(terr[pos(9, 8, 0)], WHITE);
        assert_eq!(terr[pos(9, 4, 4)], 0); // 中腹中立
        // 黑 = 2 子 + 1 地 = 3；白 = 2 子 + 1 地 + 7.5 = 10.5
        assert_eq!(b, 3.0);
        assert_eq!(w, 10.5);
    }

    #[test]
    fn test_ladder_dead_semantics() {
        // 被网死的形：白 (4,4) 仅一口气 (4,3)，延出后四邻全黑 → 征死
        let mut g = Game::new(9, 7.5, 0, ("b", false, ""), ("w", false, ""), false, None);
        let p = |x: usize, y: usize| pos(9, x, y);
        for &(x, y) in &[
            (5, 4), (4, 5), (3, 4), // 白组三面
            (3, 3), (5, 3), (4, 2), // 延气点 (4,3) 的另三面
        ] {
            g.board[p(x, y)] = BLACK;
        }
        g.board[p(4, 4)] = WHITE;
        assert!(ladder_dead(&g.board, 9, p(4, 4), BLACK));

        // 开阔形：白 (4,4) 两口气，任一延气方向都能获得三口气 → 征不死
        let mut g2 = Game::new(9, 7.5, 0, ("b", false, ""), ("w", false, ""), false, None);
        g2.board[p(5, 4)] = BLACK;
        g2.board[p(4, 5)] = BLACK;
        g2.board[p(4, 4)] = WHITE;
        assert!(!ladder_dead(&g2.board, 9, p(4, 4), BLACK));
    }

    #[test]
    fn test_ai_returns_legal_move() {
        let mut g = Game::new(9, 7.5, 0, ("b", false, ""), ("w", true, ""), false, None);
        g.play(pos(9, 4, 4)).unwrap();
        g.ai_level = 4;
        let mv = ai_best_move(&g, 4);
        assert!(mv.is_some());
        let mv = mv.unwrap();
        assert_eq!(g.board[mv], EMPTY);
        assert!(g.try_move(mv, Side::White).is_ok());
    }
}
