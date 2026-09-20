use rand::seq::SliceRandom;
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const EMPTY: u8 = 0;
pub const BLACK: u8 = 1;
pub const WHITE: u8 = 2;

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub enum Side {
    Black,
    White,
}

impl Side {
    pub fn num(self) -> u8 {
        match self {
            Side::Black => BLACK,
            Side::White => WHITE,
        }
    }
    pub fn opp(self) -> Side {
        match self {
            Side::Black => Side::White,
            Side::White => Side::Black,
        }
    }
    pub fn from_num(n: u8) -> Side {
        if n == WHITE { Side::White } else { Side::Black }
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct MoveRecord {
    pub side: Side,
    /// None = 停一手 (pass)
    pub pos: Option<usize>,
    pub captured: Vec<usize>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub enum Phase {
    Playing,
    Scoring,
    Ended,
}

/// 一盘棋的完整状态（权威状态保存在 Rust 端）
#[derive(Clone, Serialize, Deserialize)]
pub struct Game {
    pub size: usize,
    pub board: Vec<u8>,
    pub turn: Side,
    /// (黑方提子数, 白方提子数)
    pub captures: (u32, u32),
    pub ko: Option<usize>,
    pub history: Vec<MoveRecord>,
    pub handicap_pos: Vec<usize>,
    pub komi: f64,
    pub handicap: u8,
    pub phase: Phase,
    pub passes: u32,
    pub resigned: Option<Side>,
    pub dead: HashSet<usize>,
    pub result: Option<String>,
    pub black_name: String,
    pub white_name: String,
    pub black_is_ai: bool,
    pub white_is_ai: bool,
    pub ai_level: u8,
    pub black_rank: String,
    pub white_rank: String,
    /// 是否计入段位评分
    pub rated: bool,
    pub rated_side: Option<Side>,
}

impl Game {
    pub fn new(
        size: usize,
        komi: f64,
        handicap: u8,
        black: (&str, bool, &str),
        white: (&str, bool, &str),
        rated: bool,
        rated_side: Option<Side>,
    ) -> Game {
        let mut g = Game {
            size,
            board: vec![EMPTY; size * size],
            turn: Side::Black,
            captures: (0, 0),
            ko: None,
            history: Vec::new(),
            handicap_pos: Vec::new(),
            komi,
            handicap: 0,
            phase: Phase::Playing,
            passes: 0,
            resigned: None,
            dead: HashSet::new(),
            result: None,
            black_name: black.0.to_string(),
            white_name: white.0.to_string(),
            black_is_ai: black.1,
            white_is_ai: white.1,
            ai_level: 3,
            black_rank: black.2.to_string(),
            white_rank: white.2.to_string(),
            rated,
            rated_side,
        };
        if handicap >= 2 {
            g.handicap = handicap;
            g.turn = Side::White;
            g.handicap_pos = handicap_points(size, handicap);
            for &p in &g.handicap_pos {
                g.board[p] = BLACK;
            }
        }
        g
    }

    pub fn idx(&self, x: usize, y: usize) -> usize {
        y * self.size + x
    }
    pub fn xy(&self, i: usize) -> (usize, usize) {
        (i % self.size, i / self.size)
    }

    pub fn neighbors(&self, i: usize) -> Vec<usize> {
        let (x, y) = self.xy(i);
        let mut v = Vec::with_capacity(4);
        if x > 0 { v.push(i - 1); }
        if x + 1 < self.size { v.push(i + 1); }
        if y > 0 { v.push(i - self.size); }
        if y + 1 < self.size { v.push(i + self.size); }
        v
    }

    /// 返回与 i 同色的连通棋块及其气集合
    pub fn group_at(&self, i: usize) -> (Vec<usize>, HashSet<usize>) {
        let color = self.board[i];
        let mut stones = vec![i];
        let mut seen: HashSet<usize> = [i].into();
        let mut libs: HashSet<usize> = HashSet::new();
        while let Some(&cur) = stones.last() {
            stones.pop();
            for &n in &self.neighbors(cur) {
                match self.board[n] {
                    EMPTY => {
                        libs.insert(n);
                    }
                    c if c == color => {
                        if seen.insert(n) {
                            stones.push(n);
                        }
                    }
                    _ => {}
                }
            }
        }
        (seen.into_iter().collect(), libs)
    }

    /// 模拟落子：返回 (提子列表) 或错误信息。不修改棋盘。
    pub fn try_move(&self, pos: usize, side: Side) -> Result<Vec<usize>, String> {
        if self.phase != Phase::Playing {
            return Err("当前不在对局中".into());
        }
        if self.board[pos] != EMPTY {
            return Err("此处已有棋子".into());
        }
        if self.ko == Some(pos) {
            return Err("打劫：需先在别处落子（寻劫材）".into());
        }
        let mut b = self.board.clone();
        b[pos] = side.num();
        let mut captured = Vec::new();
        for &n in &self.neighbors(pos) {
            if b[n] == side.opp().num() {
                let (group, libs) = Self::group_on(&b, self.size, n);
                if libs.is_empty() {
                    for &s in &group {
                        b[s] = EMPTY;
                        captured.push(s);
                    }
                }
            }
        }
        let (_, own_libs) = Self::group_on(&b, self.size, pos);
        if own_libs.is_empty() {
            return Err("禁入点：此处落子无气（不能自杀）".into());
        }
        Ok(captured)
    }

    fn group_on(b: &[u8], size: usize, i: usize) -> (Vec<usize>, HashSet<usize>) {
        let color = b[i];
        let mut stones = vec![i];
        let mut seen: HashSet<usize> = [i].into();
        let mut libs: HashSet<usize> = HashSet::new();
        while let Some(&cur) = stones.last() {
            stones.pop();
            let (x, y) = (cur % size, cur / size);
            let push = |n: usize, s: &mut Vec<usize>, seen: &mut HashSet<usize>, libs: &mut HashSet<usize>| {
                match b[n] {
                    EMPTY => {
                        libs.insert(n);
                    }
                    c if c == color => {
                        if seen.insert(n) {
                            s.push(n);
                        }
                    }
                    _ => {}
                }
            };
            if x > 0 { push(cur - 1, &mut stones, &mut seen, &mut libs); }
            if x + 1 < size { push(cur + 1, &mut stones, &mut seen, &mut libs); }
            if y > 0 { push(cur - size, &mut stones, &mut seen, &mut libs); }
            if y + 1 < size { push(cur + size, &mut stones, &mut seen, &mut libs); }
        }
        (seen.into_iter().collect(), libs)
    }

    /// 在棋盘上直接执行一步（不做合法性判断，前提已用 try_move 检查）
    fn apply(&mut self, pos: usize, side: Side, captured: Vec<usize>) {
        self.board[pos] = side.num();
        for &c in &captured {
            self.board[c] = EMPTY;
        }
        if side == Side::Black {
            self.captures.0 += captured.len() as u32;
        } else {
            self.captures.1 += captured.len() as u32;
        }
        // 简单劫：提一子、落子成单子且只有一口气
        let (group, libs) = self.group_at(pos);
        self.ko = if captured.len() == 1 && group.len() == 1 && libs.len() == 1 {
            Some(captured[0])
        } else {
            None
        };
        self.history.push(MoveRecord { side, pos: Some(pos), captured });
        self.passes = 0;
        self.turn = side.opp();
    }

    pub fn play(&mut self, pos: usize) -> Result<(), String> {
        let side = self.turn;
        let captured = self.try_move(pos, side)?;
        self.apply(pos, side, captured);
        Ok(())
    }

    pub fn pass(&mut self) {
        let side = self.turn;
        self.history.push(MoveRecord { side, pos: None, captured: Vec::new() });
        self.passes += 1;
        self.ko = None;
        self.turn = side.opp();
        if self.passes >= 2 && self.phase == Phase::Playing {
            self.phase = Phase::Scoring;
            self.estimate_dead();
        }
    }

    /// 悔一手：根据历史重建棋盘
    pub fn undo(&mut self) -> bool {
        if self.history.is_empty() {
            return false;
        }
        self.history.pop();
        self.rebuild();
        true
    }

    /// 从空盘+让子重建整个局面
    pub fn rebuild(&mut self) {
        self.board = vec![EMPTY; self.size * self.size];
        self.captures = (0, 0);
        self.ko = None;
        self.passes = 0;
        self.phase = Phase::Playing;
        self.resigned = None;
        self.dead.clear();
        self.result = None;
        self.turn = if self.handicap >= 2 { Side::White } else { Side::Black };
        for &p in &self.handicap_pos {
            self.board[p] = BLACK;
        }
        let hist = self.history.clone();
        self.history.clear();
        for rec in hist {
            match rec.pos {
                Some(pos) => {
                    let side = rec.side;
                    let captured = self.try_move_unchecked(pos, side);
                    self.apply_unchecked(pos, side, captured);
                }
                None => {
                    self.passes += 1;
                    self.turn = rec.side.opp();
                    self.ko = None;
                }
            }
        }
    }

    fn try_move_unchecked(&self, pos: usize, side: Side) -> Vec<usize> {
        self.try_move(pos, side).unwrap_or_default()
    }
    fn apply_unchecked(&mut self, pos: usize, side: Side, captured: Vec<usize>) {
        self.apply(pos, side, captured);
    }

    pub fn resign(&mut self, side: Side) {
        self.resigned = Some(side);
        self.phase = Phase::Ended;
        self.result = Some(match side {
            Side::Black => "白中盘胜".into(),
            Side::White => "黑中盘胜".into(),
        });
    }

    /// 势力范围估算（用于对局中的领地显示）：基于双方棋子的 BFS 距离
    pub fn influence_territory(&self) -> Vec<u8> {
        let n = self.size * self.size;
        let dist_b = multi_bfs(&self.board, self.size, BLACK);
        let dist_w = multi_bfs(&self.board, self.size, WHITE);
        let mut terr = vec![0u8; n];
        for i in 0..n {
            if self.board[i] == BLACK {
                terr[i] = BLACK;
            } else if self.board[i] == WHITE {
                terr[i] = WHITE;
            } else {
                let b = dist_b[i];
                let w = dist_w[i];
                if b + 2 < w {
                    terr[i] = BLACK;
                } else if w + 2 < b {
                    terr[i] = WHITE;
                }
            }
        }
        terr
    }

    /// 数子（中国规则）：死子从棋盘移除后，空点归属
    pub fn compute_score(&self) -> (f64, f64, Vec<u8>, Vec<usize>) {
        let n = self.size * self.size;
        let mut b = self.board.clone();
        for &d in &self.dead {
            b[d] = EMPTY;
        }
        let mut terr = vec![0u8; n];
        let mut visited = vec![false; n];
        let mut dead_list: Vec<usize> = self.dead.iter().copied().collect();
        dead_list.sort_unstable();
        for i in 0..n {
            if b[i] != EMPTY || visited[i] {
                continue;
            }
            // 洪水填充一个空点区域
            let mut region = vec![i];
            visited[i] = true;
            let mut borders_b = false;
            let mut borders_w = false;
            let mut k = 0;
            while k < region.len() {
                let cur = region[k];
                k += 1;
                let (x, y) = (cur % self.size, cur / self.size);
                let mut check = |nb: usize, region: &mut Vec<usize>, visited: &mut Vec<bool>| {
                    match b[nb] {
                        EMPTY => {
                            if !visited[nb] {
                                visited[nb] = true;
                                region.push(nb);
                            }
                        }
                        BLACK => borders_b = true,
                        _ => borders_w = true,
                    }
                };
                if x > 0 { check(cur - 1, &mut region, &mut visited); }
                if x + 1 < self.size { check(cur + 1, &mut region, &mut visited); }
                if y > 0 { check(cur - self.size, &mut region, &mut visited); }
                if y + 1 < self.size { check(cur + self.size, &mut region, &mut visited); }
            }
            let owner = match (borders_b, borders_w) {
                (true, false) => BLACK,
                (false, true) => WHITE,
                _ => 0,
            };
            for &r in &region {
                terr[r] = owner;
            }
        }
        let mut black = 0.0;
        let mut white = self.komi;
        for i in 0..n {
            match b[i] {
                BLACK => black += 1.0,
                WHITE => white += 1.0,
                _ => {
                    if terr[i] == BLACK {
                        black += 1.0;
                    } else if terr[i] == WHITE {
                        white += 1.0;
                    }
                }
            }
        }
        (black, white, terr, dead_list)
    }

    /// 进入数子阶段时的死子自动估计（简单启发：被对方强包围的小块判死）
    pub fn estimate_dead_public(&mut self) {
        self.estimate_dead();
    }

    fn estimate_dead(&mut self) {
        let terr = self.influence_territory();
        let mut visited = vec![false; self.size * self.size];
        let mut to_kill: Vec<usize> = Vec::new();
        for i in 0..self.size * self.size {
            let c = self.board[i];
            if c == EMPTY || visited[i] {
                continue;
            }
            let (group, libs) = self.group_at(i);
            for &g in &group {
                visited[g] = true;
            }
            // 块内及周围点里，对方势力点占比很高 且 气少 → 判死
            let opp = Side::from_num(c).opp().num();
            let mut opp_count = 0;
            let mut near = group.clone();
            for &g in &group {
                for &nb in &self.neighbors(g) {
                    near.push(nb);
                }
            }
            for &p in &near {
                if terr[p] == opp {
                    opp_count += 1;
                }
            }
            let ratio = opp_count as f64 / near.len() as f64;
            if libs.len() <= 3 && ratio > 0.75 && group.len() <= 6 {
                to_kill.extend(group);
            }
        }
        self.dead.extend(to_kill);
    }

    pub fn toggle_dead(&mut self, pos: usize) {
        if self.board[pos] == EMPTY {
            return;
        }
        let (group, _) = self.group_at(pos);
        if self.dead.contains(&pos) {
            for &g in &group {
                self.dead.remove(&g);
            }
        } else {
            for &g in &group {
                self.dead.insert(g);
            }
        }
    }

    pub fn last_move_pos(&self) -> Option<usize> {
        self.history.iter().rev().find_map(|r| r.pos)
    }

    pub fn move_number(&self) -> usize {
        self.history.len()
    }
}

fn multi_bfs(board: &[u8], size: usize, color: u8) -> Vec<u32> {
    let n = size * size;
    let mut dist = vec![u32::MAX; n];
    let mut queue = std::collections::VecDeque::new();
    for i in 0..n {
        if board[i] == color {
            dist[i] = 0;
            queue.push_back(i);
        }
    }
    while let Some(i) = queue.pop_front() {
        let (x, y) = (i % size, i / size);
        let visit = |j: usize, dist: &mut Vec<u32>, queue: &mut std::collections::VecDeque<usize>| {
            if board[j] != color && dist[j] > dist[i] + 1 {
                dist[j] = dist[i] + 1;
                queue.push_back(j);
            }
        };
        if x > 0 { visit(i - 1, &mut dist, &mut queue); }
        if x + 1 < size { visit(i + 1, &mut dist, &mut queue); }
        if y > 0 { visit(i - size, &mut dist, &mut queue); }
        if y + 1 < size { visit(i + size, &mut dist, &mut queue); }
    }
    dist
}

/// 标准让子点位（以右上角为 D4 风格，按常见布局）
pub fn handicap_points(size: usize, handicap: u8) -> Vec<usize> {
    let edge = if size >= 13 { 3 } else { 2 };
    let far = size - 1 - edge;
    let mid = (size - 1) / 2;
    let pts = [
        (edge, edge),
        (far, far),
        (far, edge),
        (edge, far),
        (edge, mid),
        (far, mid),
        (mid, edge),
        (mid, far),
        (mid, mid),
    ];
    let order: &[(usize, usize)] = match handicap {
        2 => &[pts[0], pts[1]],
        3 => &[pts[0], pts[1], pts[2]],
        4 => &[pts[0], pts[1], pts[2], pts[3]],
        5 => &[pts[0], pts[1], pts[2], pts[3], pts[4]],
        6 => &[pts[0], pts[1], pts[2], pts[3], pts[4], pts[5]],
        7 => &[pts[0], pts[1], pts[2], pts[3], pts[6], pts[7], pts[4]],
        8 => &[pts[0], pts[1], pts[2], pts[3], pts[4], pts[5], pts[6], pts[7]],
        9 => &pts,
        _ => &[],
    };
    order.iter().map(|&(x, y)| y * size + x).collect()
}

/// 判断某点是否是自己棋子的“真眼”（简化：四邻全为己方，且对角至少3个己方或位于边角时全己方）
fn is_true_eye(board: &[u8], size: usize, pos: usize, color: u8) -> bool {
    let (x, y) = (pos % size, pos / size);
    let nb = |xx: usize, yy: usize| board[yy * size + xx];
    // 四个直接邻居必须全为己方
    if x > 0 && nb(x - 1, y) != color { return false; }
    if x + 1 < size && nb(x + 1, y) != color { return false; }
    if y > 0 && nb(x, y - 1) != color { return false; }
    if y + 1 < size && nb(x, y + 1) != color { return false; }
    // 对角检查
    let mut off = 0;
    let mut opp_off = 0;
    {
        let mut diag = |dx: i64, dy: i64| {
            let nx = x as i64 + dx;
            let ny = y as i64 + dy;
            if nx < 0 || ny < 0 || nx >= size as i64 || ny >= size as i64 {
                off += 1; // 边角视为有利
            } else {
                match board[ny as usize * size + nx as usize] {
                    c if c == color => off += 1,
                    EMPTY => {}
                    _ => opp_off += 1,
                }
            }
        };
        diag(-1, -1);
        diag(1, -1);
        diag(-1, 1);
        diag(1, 1);
    }
    off >= 3 || (off >= 2 && opp_off == 0)
}

pub struct AiConfig {
    pub level: u8, // 1..=8
}

/// AI 选择落点。level 1 最弱，10 最强。
/// 9/10 级（职业级模拟）启用：多核并行评估 + 时间预算 + 征子读取。
pub fn ai_best_move(game: &Game, level: u8) -> Option<usize> {
    let side = game.turn;
    // 空盘开局：从星位/小目附近随机
    let stones: usize = game.board.iter().filter(|&&c| c != EMPTY).count();
    if stones == 0 {
        return opening_move(game.size);
    }

    let candidates = gen_candidates(game, side);
    if candidates.is_empty() {
        return None;
    }

    let lv = level.clamp(1, 10) as usize;

    // 启发式打分（含征子读取，越高等级读取越积极）
    let mut scored: Vec<(usize, f64)> = candidates
        .iter()
        .map(|&pos| (pos, heuristic(game, pos, side, lv)))
        .collect();
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    let top_k = (3 + lv).min(scored.len());
    // 各等级思考时间预算（毫秒），自适应硬件：核多/核快则同预算内算得更多
    let budget_ms: u64 = [80, 120, 180, 260, 380, 550, 800, 1200, 2200, 4000][lv - 1];

    let top: Vec<(usize, f64)> = scored
        .iter()
        .take(top_k)
        .map(|&(p, h)| (p, h))
        .collect();

    // root parallelism：每线程独立完整评估全部候选，最后合并胜率统计
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(2)
        .clamp(1, 6);
    let mut handles = Vec::with_capacity(threads);
    for _ in 0..threads {
        let g = game.clone();
        let top_c = top.clone();
        handles.push(std::thread::spawn(move || {
            let start = std::time::Instant::now();
            let mut wins = vec![0u32; top_c.len()];
            let mut runs = vec![0u32; top_c.len()];
            while start.elapsed().as_millis() < budget_ms as u128 {
                for (i, &(pos, _)) in top_c.iter().enumerate() {
                    if playout(&g, pos, side, lv) {
                        wins[i] += 1;
                    }
                    runs[i] += 1;
                }
            }
            (wins, runs)
        }));
    }

    let mut total_wins = vec![0f64; top_k];
    let mut total_runs = vec![0u32; top_k];
    for h in handles {
        if let Ok((w, r)) = h.join() {
            for i in 0..top_k {
                total_wins[i] += w[i] as f64;
                total_runs[i] += r[i];
            }
        }
    }

    let mut best_pos = top[0].0;
    let mut best_score = f64::MIN;
    for (i, &(pos, h)) in top.iter().enumerate() {
        if total_runs[i] == 0 {
            continue;
        }
        let rate = total_wins[i] / total_runs[i] as f64;
        let total = rate * 2.0 + h * 0.06;
        if total > best_score {
            best_score = total;
            best_pos = pos;
        }
    }

    // 低段位 AI 加入噪声/失误
    let mut rng = rand::thread_rng();
    let blunder_p = [0.45, 0.30, 0.18, 0.10, 0.05, 0.02, 0.0, 0.0, 0.0, 0.0][lv - 1];
    if rng.gen::<f64>() < blunder_p {
        // 从启发式前几名中随机挑一个较弱的
        let pick_k = (2 + rng.gen_range(1..=4).min(scored.len())).min(scored.len());
        let choice = rng.gen_range(0..pick_k);
        return Some(scored[choice].0);
    }
    Some(best_pos)
}

fn opening_move(size: usize) -> Option<usize> {
    let mut rng = rand::thread_rng();
    let edge = if size >= 13 { 3 } else { 2 };
    let far = size - 1 - edge;
    let mid = (size - 1) / 2;
    let opts: Vec<usize> = vec![
        (edge, edge), (far, far), (far, edge), (edge, far),
        (edge, mid), (far, mid), (mid, edge), (mid, far), (mid, mid),
        (edge + 1, edge + 1),
    ]
    .into_iter()
    .map(|(x, y)| y * size + x)
    .collect();
    opts.choose(&mut rng).copied()
}

/// 候选点：所有合法点，排除填自己的真眼
fn gen_candidates(game: &Game, side: Side) -> Vec<usize> {
    let color = side.num();
    let mut v = Vec::new();
    for i in 0..game.size * game.size {
        if game.board[i] != EMPTY {
            continue;
        }
        if game.ko == Some(i) {
            continue;
        }
        if is_true_eye(&game.board, game.size, i, color) {
            continue;
        }
        if game.try_move(i, side).is_ok() {
            v.push(i);
        }
    }
    v
}

/// 征子读取：判断 defender 组（含 seed）在 attacker 连续追杀下是否必死。
/// 前提：轮到 defender 行棋。defender 每手选延出气数最多的方向逃跑；
/// attacker 每手用一层前瞻选择最能压制逃跑的紧气点。
/// 组气 >= 3 视为逃出；逃无可逃或延后仍一口气视为被征死。
pub(crate) fn ladder_dead(b: &[u8], size: usize, seed: usize, attacker: u8) -> bool {
    let defender = if attacker == BLACK { WHITE } else { BLACK };
    let mut board = b.to_vec();
    let max_steps = (size * size / 2).max(40);
    for _ in 0..max_steps {
        let (_, libs) = Game::group_on(&board, size, seed);
        if libs.is_empty() {
            return true;
        }
        if libs.len() >= 3 {
            return false;
        }
        // defender：尝试每个气点，选延气后气数最大的方向
        let mut best_lib: Option<usize> = None;
        let mut best_libs_after = 0usize;
        for &lp in libs.iter() {
            let mut t = board.clone();
            t[lp] = defender;
            let (_, l2) = Game::group_on(&t, size, seed);
            if l2.len() > best_libs_after {
                best_libs_after = l2.len();
                best_lib = Some(lp);
            }
        }
        let lp = match best_lib {
            Some(l) => l,
            None => return true,
        };
        if best_libs_after >= 3 {
            return false;
        }
        if best_libs_after <= 1 {
            return true;
        }
        board[lp] = defender;
        // attacker：对每个紧气点做一层前瞻，选使 defender 最好延气结果最差的一点
        let (_, libs2) = Game::group_on(&board, size, seed);
        if libs2.is_empty() {
            return true;
        }
        if libs2.len() >= 3 {
            return false;
        }
        let mut choice = *libs2.iter().next().unwrap();
        let mut best_worst = usize::MAX;
        for &lp2 in libs2.iter() {
            let mut t = board.clone();
            t[lp2] = attacker;
            let (_, l2a) = Game::group_on(&t, size, seed);
            // defender 应一手后最多能得几口气（取最好），attacker 选使其最小的点
            let mut worst = usize::MAX;
            for &dl in l2a.iter() {
                let mut t2 = t.clone();
                t2[dl] = defender;
                let (_, l3) = Game::group_on(&t2, size, seed);
                if l3.len() < worst {
                    worst = l3.len();
                }
            }
            if worst < best_worst {
                best_worst = worst;
                choice = lp2;
            }
        }
        board[choice] = attacker;
    }
    false
}

/// 启发式打分：吃子/救子/打吃/征子读取/气权/位置
fn heuristic(game: &Game, pos: usize, side: Side, lv: usize) -> f64 {
    let color = side.num();
    let opp = side.opp().num();
    let mut score = 0.0;
    let captured = game.try_move(pos, side).unwrap_or_default();
    score += captured.len() as f64 * 30.0;

    let mut b = game.board.clone();
    b[pos] = color;
    for &c in &captured {
        b[c] = EMPTY;
    }

    // 自己处于被打吃的块能否得救
    for &nb in &game.neighbors(pos) {
        if game.board[nb] == color {
            let (group, libs) = game.group_at(nb);
            if libs.len() == 1 && libs.contains(&pos) && group.len() >= 2 {
                let (_, libs_after_self) = Game::group_on(&b, game.size, nb);
                if libs_after_self.len() == 1 {
                    // 延气后仍一口气：送吃
                } else if libs_after_self.len() == 2 && lv >= 7 && ladder_dead(&b, game.size, nb, opp) {
                    // 延气后仍被征死：白跑，降低优先级
                    score -= 25.0;
                } else {
                    score += group.len() as f64 * 18.0;
                }
            }
        }
        // 打吃对方大块
        if game.board[nb] == opp {
            let (group, libs_after) = Game::group_on(&b, game.size, nb);
            if libs_after.len() == 1 && group.len() >= 2 {
                // 征子读取：这步打吃能否一路征死对方
                let kills = lv >= 6 && ladder_dead(&b, game.size, group[0], color);
                score += group.len() as f64 * 9.0 + if kills { 45.0 } else { 0.0 };
            } else if libs_after.len() == 2 && group.len() >= 3 {
                score += group.len() as f64 * 3.0;
            }
        }
    }

    let (_, libs_now) = game.group_at(pos.min(game.board.len() - 1));
    let _ = libs_now;

    // 己方大块只剩两气时优先补气
    for &nb in &game.neighbors(pos) {
        if game.board[nb] == color {
            let (group, libs) = game.group_at(nb);
            if libs.len() == 2 && group.len() >= 4 {
                score += 6.0;
            }
        }
    }

    // 位置权重：序盘偏好三线四线，避开一二线
    let (x, y) = game.xy(pos);
    let s = game.size;
    let line_x = x.min(s - 1 - x) as f64;
    let line_y = y.min(s - 1 - y) as f64;
    let line = line_x.min(line_y);
    let moves = game.history.len() as f64;
    let opening_weight = (1.0 - moves / (s as f64 * 1.5)).max(0.0);
    if line == 0.0 {
        score -= 14.0 * (0.3 + opening_weight);
    } else if line == 1.0 {
        score -= 8.0 * (0.3 + opening_weight);
    } else if line == 2.0 || line == 3.0 {
        score += 4.0 * opening_weight;
    }

    // 接近最近一手
    if let Some(lm) = game.last_move_pos() {
        let (lx, ly) = game.xy(lm);
        let d = ((x as f64 - lx as f64).abs() + (y as f64 - ly as f64).abs()) as f64;
        score += (10.0 - d.min(10.0)) * 0.8;
    }

    score + rand::thread_rng().gen_range(0.0..1.5)
}

/// 从 pos 落子开始，双发随机收完一盘，返回 side 是否获胜（中国规则数子）
fn playout(game: &Game, first: usize, side: Side, lv: usize) -> bool {
    let mut b = game.board.clone();
    let mut ko: Option<usize> = game.ko;
    let mut pass_streak = 0;
    let size = game.size;
    let n = size * size;
    let max_moves = n * 2;

    // 先落第一手
    if apply_playout(&mut b, &mut ko, first, side, size).is_none() {
        return area_win(&b, game.size, game.komi, side);
    }
    let mut turn = side.opp();
    let mut moves = 1;
    while pass_streak < 2 && moves < max_moves {
        // 随机找合法点
        let mut placed = false;
        let tries = if lv >= 6 { n.min(90) } else { n.min(60) };
        let start = rand::thread_rng().gen_range(0..n);
        for k in 0..tries {
            let p = (start + k * 7 + k * k) % n; // 伪随机扫过棋盘
            if b[p] != EMPTY || ko == Some(p) {
                continue;
            }
            if is_true_eye(&b, size, p, turn.num()) {
                continue;
            }
            if apply_playout(&mut b, &mut ko, p, turn, size).is_some() {
                placed = true;
                break;
            }
        }
        if placed {
            pass_streak = 0;
        } else {
            pass_streak += 1;
        }
        turn = turn.opp();
        moves += 1;
    }
    area_win(&b, game.size, game.komi, side)
}

fn apply_playout(b: &mut Vec<u8>, ko: &mut Option<usize>, pos: usize, side: Side, size: usize) -> Option<usize> {
    let color = side.num();
    b[pos] = color;
    let mut captured = 0;
    let (x, y) = (pos % size, pos / size);
    let mut to_check: Vec<usize> = Vec::with_capacity(4);
    if x > 0 { to_check.push(pos - 1); }
    if x + 1 < size { to_check.push(pos + 1); }
    if y > 0 { to_check.push(pos - size); }
    if y + 1 < size { to_check.push(pos + size); }
    for &nb in &to_check {
        if b[nb] != EMPTY && b[nb] != color {
            let (group, libs) = Game::group_on(b, size, nb);
            if libs.is_empty() {
                for &s in &group {
                    b[s] = EMPTY;
                }
                captured += group.len();
            }
        }
    }
    let (_, libs) = Game::group_on(b, size, pos);
    if libs.is_empty() {
        b[pos] = EMPTY;
        // 自杀：回滚提子（罕见）
        return None;
    }
    *ko = if captured == 1 && libs.len() == 1 {
        // 单提劫：记录劫点
        let mut kp = None;
        for (i, &c) in b.iter().enumerate() {
            if c == EMPTY && *ko != Some(i) {
                // 找被提点：上一手提掉的那个点
                kp = Some(i);
                break;
            }
        }
        // 简化：不精确追踪提子点，劫在随机棋局中影响极小
        let _ = kp;
        None
    } else {
        None
    };
    Some(pos)
}

/// 终局判定（中国规则近似）：活子 + 空点归属。
/// v1.3 的实现只数盘上子数、不计空点，导致 rollout 胜率与真实局面优劣
/// 相关性弱（文档评审 1.2 指出的最大失真源）。空点归属用黑白双源 BFS
/// 距离比较：距一方显著更近（+2 缓冲）才计为该方地，中立点不计。
fn area_win(b: &[u8], size: usize, komi: f64, side: Side) -> bool {
    let dist_b = multi_bfs(b, size, BLACK);
    let dist_w = multi_bfs(b, size, WHITE);
    let mut black = 0.0f64;
    let mut white = komi;
    for (i, &c) in b.iter().enumerate() {
        match c {
            BLACK => black += 1.0,
            WHITE => white += 1.0,
            _ => {
                let db = dist_b[i];
                let dw = dist_w[i];
                if db == u32::MAX && dw == u32::MAX {
                    continue;
                }
                if db == u32::MAX {
                    white += 1.0;
                } else if dw == u32::MAX {
                    black += 1.0;
                } else if db + 2 < dw {
                    black += 1.0;
                } else if dw + 2 < db {
                    white += 1.0;
                }
            }
        }
    }
    match side {
        Side::Black => black > white,
        Side::White => white > black,
    }
}
