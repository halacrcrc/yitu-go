// 后端抽象层：Tauri 模式走 Rust 命令；浏览器模式使用本地 TS 引擎演示
import { invoke } from "@tauri-apps/api/core";
import { TsEngine, BLACK, WHITE, groupOn } from "./engine";
import { content, coordToPos, posToCoord } from "./content";

export const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// ---------- DTO（与 Rust 端一致） ----------
export interface PlayerDto {
  name: string;
  is_ai: boolean;
  rank: string;
}
export interface MoveDto {
  side: number;
  pos: number | null;
}
export interface GameStateDto {
  size: number;
  board: number[];
  turn: number;
  captures: [number, number];
  komi: number;
  handicap: number;
  phase: "playing" | "scoring" | "ended";
  result: string | null;
  last_move: number | null;
  moves: MoveDto[];
  move_number: number;
  territory: number[] | null;
  dead: number[];
  black: PlayerDto;
  white: PlayerDto;
  can_undo: boolean;
  rated: boolean;
  ko: number | null;
  passes: number;
  black_score: number | null;
  white_score: number | null;
}
export interface Profile {
  name: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  puzzles_solved: string[];
  tutorial_done: string[];
  settings: {
    sound: boolean;
    show_coords: boolean;
    show_last_move: boolean;
    show_territory: boolean;
    confirm_move: boolean;
  };
}
export interface RecordMeta {
  id: string;
  date: string;
  size: number;
  komi: number;
  result: string;
  black_name: string;
  white_name: string;
  moves: number;
  reason: string;
}
export interface RecordData {
  meta: RecordMeta;
  handicap_pos: number[];
  handicap: number;
  history: { side: number; pos: number | null; captured: number[] }[];
  black_is_ai: boolean;
  white_is_ai: boolean;
  ai_level: number;
  black_rank: string;
  white_rank: string;
  black_score: number | null;
  white_score: number | null;
}
export interface NewGameReq {
  size: number;
  komi: number;
  handicap: number;
  ai_level: number;
  mode: "ai" | "human";
  player_color: "black" | "white";
  rated: boolean;
}

// ---------- API ----------
export const api = {
  getProfile: (): Promise<Profile> => invokeOrLocal("get_profile"),
  updateProfile: (p: Profile): Promise<Profile> => invokeOrLocal("update_profile", { profile: p }),
  newGame: (req: NewGameReq): Promise<GameStateDto> => invokeOrLocal("new_game", { req }),
  getState: (): Promise<GameStateDto> => invokeOrLocal("get_state"),
  playMove: (pos: number): Promise<GameStateDto> => invokeOrLocal("play_move", { pos }),
  passTurn: (): Promise<GameStateDto> => invokeOrLocal("pass_turn"),
  undoMove: (): Promise<GameStateDto> => invokeOrLocal("undo_move"),
  resign: (side: "black" | "white"): Promise<GameStateDto> => invokeOrLocal("resign", { side }),
  aiMove: (): Promise<GameStateDto> => invokeOrLocal("ai_move"),
  hint: (): Promise<number | null> => invokeOrLocal("hint"),
  enterScoring: (): Promise<GameStateDto> => invokeOrLocal("enter_scoring"),
  toggleDead: (pos: number): Promise<GameStateDto> => invokeOrLocal("toggle_dead", { pos }),
  resumeScoring: (): Promise<GameStateDto> => invokeOrLocal("resume_scoring"),
  confirmResult: (): Promise<GameStateDto> => invokeOrLocal("confirm_result"),
  getAutosave: (): Promise<GameStateDto | null> => invokeOrLocal("get_autosave"),
  continueAutosave: (): Promise<GameStateDto> => invokeOrLocal("continue_autosave"),
  discardAutosave: (): Promise<void> => invokeOrLocal("discard_autosave_cmd"),
  listRecords: (): Promise<RecordMeta[]> => invokeOrLocal("list_records"),
  getRecord: (id: string): Promise<RecordData> => invokeOrLocal("get_record", { id }),
  deleteRecord: (id: string): Promise<void> => invokeOrLocal("delete_record", { id }),
  exportRecordSgf: (id: string, path: string): Promise<void> => invokeOrLocal("export_record_sgf", { id, path }),
  importSgf: (path: string): Promise<RecordMeta> => invokeOrLocal("import_sgf", { path }),
};

async function invokeOrLocal(cmd: string, args?: any): Promise<any> {
  if (IS_TAURI) return invoke(cmd, args);
  return local(cmd, args);
}

// ============================================================
// 浏览器演示模式（localStorage 持久化 + 简化 AI）
// ============================================================

const LS_PROFILE = "yitu_profile";
const LS_RECORDS = "yitu_records";
const LS_AUTOSAVE = "yitu_autosave";

function defaultProfile(): Profile {
  return {
    name: "棋手",
    rating: 800,
    wins: 0,
    losses: 0,
    draws: 0,
    puzzles_solved: [],
    tutorial_done: [],
    settings: { sound: true, show_coords: true, show_last_move: true, show_territory: false, confirm_move: false },
  };
}

function lsGet<T>(key: string): T | null {
  try {
    const t = localStorage.getItem(key);
    return t ? (JSON.parse(t) as T) : null;
  } catch {
    return null;
  }
}
function lsSet(key: string, v: any) {
  localStorage.setItem(key, JSON.stringify(v));
}

interface LocalGame {
  engine: TsEngine;
  phase: "playing" | "scoring" | "ended";
  dead: Set<number>;
  result: string | null;
  meta: {
    size: number;
    komi: number;
    handicap: number;
    aiLevel: number;
    mode: "ai" | "human";
    playerColor: "black" | "white";
    rated: boolean;
    blackName: string;
    whiteName: string;
    blackIsAi: boolean;
    whiteIsAi: boolean;
    blackRank: string;
    whiteRank: string;
  };
}

let localGame: LocalGame | null = null;

function rankLabel(r: number): string {
  if (r < 2500) return `${30 - Math.min(29, Math.max(0, Math.floor((r - 100) / 80)))}级`;
  if (r < 3800) return `业余${Math.min(9, Math.floor((r - 2500) / 150) + 1)}段`;
  return `职业${Math.min(9, Math.floor((r - 3800) / 100) + 1)}段`;
}

function localDto(): GameStateDto {
  const g = localGame!;
  const terr = g.phase === "scoring" ? scoreWithDead(g).terr : g.engine.influenceTerritory();
  return {
    size: g.meta.size,
    board: g.engine.board.slice(),
    turn: g.engine.turn,
    captures: [g.engine.captures[0], g.engine.captures[1]],
    komi: g.meta.komi,
    handicap: g.meta.handicap,
    phase: g.phase,
    result: g.result,
    last_move: g.engine.history.length ? (g.engine.history[g.engine.history.length - 1].pos ?? null) : null,
    moves: g.engine.history.map((m) => ({ side: m.side, pos: m.pos })),
    move_number: g.engine.history.length,
    territory: terr,
    dead: [...g.dead].sort((a, b) => a - b),
    black: { name: g.meta.blackName, is_ai: g.meta.blackIsAi, rank: g.meta.blackRank },
    white: { name: g.meta.whiteName, is_ai: g.meta.whiteIsAi, rank: g.meta.whiteRank },
    can_undo: g.engine.history.length > 0 && g.phase !== "ended",
    rated: g.meta.rated,
    ko: g.engine.ko,
    passes: 0,
    black_score: null,
    white_score: null,
  };
}

function scoreWithDead(g: LocalGame) {
  return g.engine.score(g.dead);
}

function persistLocal() {
  if (!localGame) return;
  const g = localGame;
  if (g.phase === "ended") {
    localStorage.removeItem(LS_AUTOSAVE);
    return;
  }
  lsSet(LS_AUTOSAVE, {
    board: g.engine.board,
    turn: g.engine.turn,
    captures: g.engine.captures,
    ko: g.engine.ko,
    history: g.engine.history,
    handicapPos: g.engine.handicapPos,
    komi: g.engine.komi,
    phase: g.phase,
    dead: [...g.dead],
    result: g.result,
    meta: g.meta,
  });
}

function restoreLocal(): LocalGame | null {
  const s = lsGet<any>(LS_AUTOSAVE);
  if (!s) return null;
  const e = new TsEngine(s.meta.size);
  e.board = s.board;
  e.turn = s.turn;
  e.captures = s.captures;
  e.ko = s.ko;
  e.history = s.history;
  e.handicapPos = s.handicapPos;
  e.komi = s.komi;
  return {
    engine: e,
    phase: s.phase,
    dead: new Set<number>(s.dead),
    result: s.result,
    meta: s.meta,
  };
}

function handicapPoints(size: number, n: number): number[] {
  const edge = size >= 13 ? 3 : 2;
  const far = size - 1 - edge;
  const mid = Math.floor((size - 1) / 2);
  const pts: [number, number][] = [
    [edge, edge], [far, far], [far, edge], [edge, far],
    [edge, mid], [far, mid], [mid, edge], [mid, far], [mid, mid],
  ];
  const count = Math.max(0, Math.min(9, n)) - 1;
  return pts.slice(0, count).map(([x, y]) => y * size + x);
}

function isTrueEye(b: number[], size: number, pos: number, color: number): boolean {
  const x = pos % size, y = Math.floor(pos / size);
  const nb = (xx: number, yy: number) => b[yy * size + xx];
  if (x > 0 && nb(x - 1, y) !== color) return false;
  if (x + 1 < size && nb(x + 1, y) !== color) return false;
  if (y > 0 && nb(x, y - 1) !== color) return false;
  if (y + 1 < size && nb(x, y + 1) !== color) return false;
  let off = 0, opp = 0;
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= size || ny >= size) { off++; continue; }
    const v = nb(nx, ny);
    if (v === color) off++;
    else if (v !== 0) opp++;
  }
  return off >= 3 || (off >= 2 && opp === 0);
}

function localCandidates(g: LocalGame, side: number): number[] {
  const e = g.engine;
  const v: number[] = [];
  for (let i = 0; i < e.size * e.size; i++) {
    if (e.board[i] !== 0 || e.ko === i) continue;
    if (isTrueEye(e.board, e.size, i, side)) continue;
    if (e.tryMove(i, side as 1 | 2).ok) v.push(i);
  }
  return v;
}

/** 浏览器模式的简化 AI（启发式） */
function localAiMove(g: LocalGame, level: number): number | null {
  const e = g.engine;
  const side = e.turn as 1 | 2;
  const opp = (side === BLACK ? WHITE : BLACK) as 1 | 2;
  const stones = e.board.filter((c) => c !== 0).length;
  if (stones === 0) {
    const edge = e.size >= 13 ? 3 : 2;
    const far = e.size - 1 - edge;
    const opts = [[edge, edge], [far, far], [far, edge], [edge, far], [edge, Math.floor((e.size - 1) / 2)], [far, Math.floor((e.size - 1) / 2)]];
    const [x, y] = opts[Math.floor(Math.random() * opts.length)];
    return y * e.size + x;
  }
  const cands = localCandidates(g, side);
  if (!cands.length) return null;
  const scored = cands.map((pos) => {
    let s = Math.random() * 1.5;
    const r = e.tryMove(pos, side);
    s += r.captured.length * 30;
    const b = e.board.slice();
    b[pos] = side;
    for (const c of r.captured) b[c] = 0;
    for (const nb of neighbors(e.size, pos)) {
      if (e.board[nb] === side) {
        const { stones: gs, libs } = groupOn(e.board, e.size, nb);
        if (libs.size === 1 && libs.has(pos) && gs.length >= 2) s += gs.length * 18;
      }
      if (e.board[nb] === opp) {
        const { stones: gs, libs } = groupOn(b, e.size, nb);
        if (libs.size === 1 && gs.length >= 2) s += gs.length * 9;
        else if (libs.size === 2 && gs.length >= 3) s += gs.length * 3;
      }
    }
    const x = pos % e.size, y = Math.floor(pos / e.size);
    const line = Math.min(x, e.size - 1 - x, y, e.size - 1 - y);
    const opening = Math.max(0, 1 - e.history.length / (e.size * 1.5));
    if (line === 0) s -= 12 * (0.3 + opening);
    else if (line === 1) s -= 7 * (0.3 + opening);
    else if (line === 2 || line === 3) s += 4 * opening;
    if (e.history.length) {
      const lm = [...e.history].reverse().find((m) => m.pos !== null)!.pos!;
      const lx = lm % e.size, ly = Math.floor(lm / e.size);
      s += Math.max(0, 10 - (Math.abs(x - lx) + Math.abs(y - ly))) * 0.8;
    }
    return { pos, s };
  });
  scored.sort((a, b) => b.s - a.s);
  const blunderP = [0.45, 0.3, 0.18, 0.1, 0.05, 0.02, 0, 0][Math.max(1, Math.min(8, level)) - 1];
  if (Math.random() < blunderP) {
    const k = Math.min(scored.length, 2 + Math.floor(Math.random() * 4));
    return scored[Math.floor(Math.random() * k)].pos;
  }
  return scored[0].pos;
}

function neighbors(size: number, i: number): number[] {
  const x = i % size, y = Math.floor(i / size);
  const v: number[] = [];
  if (x > 0) v.push(i - 1);
  if (x + 1 < size) v.push(i + 1);
  if (y > 0) v.push(i - size);
  if (y + 1 < size) v.push(i + size);
  return v;
}

function endLocalGame(g: LocalGame, reason: string, bs: number | null, ws: number | null) {
  g.phase = "ended";
  if (g.result === null) {
    const diff = Math.abs((bs ?? 0) - (ws ?? 0));
    const winner = (bs ?? 0) > (ws ?? 0) ? "黑" : "白";
    g.result = reason === "中盘" ? (winner === "黑" ? "黑中盘胜" : "白中盘胜") : `${winner}胜${diff.toFixed(1)}目`;
  }
  saveRecordLocal(g, reason, bs, ws);
  // 更新等级分
  if (g.meta.rated && g.meta.mode === "ai") {
    const prof = lsGet<Profile>(LS_PROFILE) ?? defaultProfile();
    const oppRating = content.aiLevels[Math.max(1, Math.min(8, g.meta.aiLevel)) - 1].rating;
    const playerIsBlack = g.meta.playerColor === "black";
    let playerWon: boolean;
    if (g.result.includes("中盘")) {
      const winnerBlack = g.result.startsWith("黑");
      playerWon = winnerBlack === playerIsBlack;
    } else {
      const blackWon = (bs ?? 0) > (ws ?? 0);
      playerWon = blackWon === playerIsBlack;
    }
    const expected = 1 / (1 + Math.pow(10, (oppRating - prof.rating) / 400));
    const delta = playerWon ? Math.max(3, Math.round(32 * (1 - expected))) : -Math.max(3, Math.round(32 * expected));
    prof.rating = Math.max(100, prof.rating + Math.max(-60, Math.min(60, delta)));
    if (playerWon) prof.wins++;
    else prof.losses++;
    lsSet(LS_PROFILE, prof);
  }
  persistLocal();
}

function saveRecordLocal(g: LocalGame, reason: string, bs: number | null, ws: number | null) {
  const records = lsGet<RecordData[]>(LS_RECORDS) ?? [];
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const meta: RecordMeta = {
    id: Date.now().toString(16) + Math.floor(Math.random() * 0xffffffff).toString(16),
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
    size: g.meta.size,
    komi: g.meta.komi,
    result: g.result ?? "",
    black_name: g.meta.blackName,
    white_name: g.meta.whiteName,
    moves: g.engine.history.length,
    reason,
  };
  records.unshift({
    meta,
    handicap_pos: g.engine.handicapPos,
    handicap: g.meta.handicap,
    history: g.engine.history,
    black_is_ai: g.meta.blackIsAi,
    white_is_ai: g.meta.whiteIsAi,
    ai_level: g.meta.aiLevel,
    black_rank: g.meta.blackRank,
    white_rank: g.meta.whiteRank,
    black_score: bs,
    white_score: ws,
  });
  lsSet(LS_RECORDS, records);
}

function newId(): string {
  return Date.now().toString(16) + Math.floor(Math.random() * 0xffffffff).toString(16);
}

async function local(cmd: string, args: any): Promise<any> {
  switch (cmd) {
    case "get_profile":
      return lsGet<Profile>(LS_PROFILE) ?? defaultProfile();
    case "update_profile":
      lsSet(LS_PROFILE, args.profile);
      return args.profile;

    case "new_game": {
      const req = args.req as NewGameReq;
      const prof = lsGet<Profile>(LS_PROFILE) ?? defaultProfile();
      const e = new TsEngine(Math.max(5, Math.min(19, req.size)));
      const komi = req.handicap >= 2 ? 0.5 : req.komi;
      const rated = req.rated && req.mode === "ai" && req.handicap < 2;
      const aiL = content.aiLevels[Math.max(1, Math.min(8, req.ai_level)) - 1];
      const playerIsWhite = req.player_color === "white";
      let handicapPos: number[] = [];
      if (req.handicap >= 2) {
        handicapPos = handicapPoints(e.size, req.handicap);
        for (const p of handicapPos) e.board[p] = BLACK;
        e.turn = WHITE;
        e.handicapPos = handicapPos;
      }
      localGame = {
        engine: e,
        phase: "playing",
        dead: new Set(),
        result: null,
        meta: {
          size: e.size,
          komi,
          handicap: req.handicap,
          aiLevel: req.ai_level,
          mode: req.mode,
          playerColor: req.player_color,
          rated,
          blackName: req.mode === "ai" && playerIsWhite ? aiL.name : req.mode === "ai" ? prof.name : "黑方",
          whiteName: req.mode === "ai" && playerIsWhite ? prof.name : req.mode === "ai" ? aiL.name : "白方",
          blackIsAi: req.mode === "ai" && playerIsWhite,
          whiteIsAi: req.mode === "ai" && !playerIsWhite,
          blackRank: req.mode === "ai" && playerIsWhite ? aiL.label : req.mode === "ai" ? rankLabel(prof.rating) : "对弈",
          whiteRank: req.mode === "ai" && playerIsWhite ? rankLabel(prof.rating) : req.mode === "ai" ? aiL.label : "对弈",
        },
      };
      persistLocal();
      return localDto();
    }

    case "get_state":
      if (!localGame) throw new Error("没有进行中的对局");
      return localDto();

    case "play_move": {
      if (!localGame || localGame.phase !== "playing") throw new Error("对局不可用");
      const r = localGame.engine.play(args.pos);
      if (!r.ok) throw new Error(r.error);
      persistLocal();
      return localDto();
    }

    case "pass_turn": {
      if (!localGame || localGame.phase !== "playing") throw new Error("对局不可用");
      localGame.engine.pass();
      if (countConsecutivePasses(localGame.engine.history) >= 2) {
        localGame.phase = "scoring";
      }
      persistLocal();
      return localDto();
    }

    case "undo_move": {
      if (!localGame || !localGame.engine.history.length || localGame.phase === "ended") throw new Error("没有可以悔的棋");
      const g = localGame;
      const playerSide = g.meta.mode === "ai" ? (g.meta.playerColor === "white" ? WHITE : BLACK) : null;
      g.engine.history.pop();
      rebuildEngine(g);
      if (playerSide !== null) {
        while (g.engine.turn !== playerSide && g.engine.history.length) {
          g.engine.history.pop();
          rebuildEngine(g);
        }
      }
      g.phase = "playing";
      g.dead.clear();
      g.result = null;
      persistLocal();
      return localDto();
    }

    case "resign": {
      if (!localGame || localGame.phase === "ended") throw new Error("对局不可用");
      const g = localGame;
      const resignBlack = args.side === "black";
      g.result = resignBlack ? "白中盘胜" : "黑中盘胜";
      endLocalGame(g, "中盘", null, null);
      return localDto();
    }

    case "ai_move": {
      if (!localGame || localGame.phase !== "playing") throw new Error("对局已结束");
      const g = localGame;
      const isAiTurn = (g.engine.turn === BLACK && g.meta.blackIsAi) || (g.engine.turn === WHITE && g.meta.whiteIsAi);
      if (!isAiTurn) throw new Error("当前轮到人类棋手");
      await new Promise((r) => setTimeout(r, 150));
      const mv = localAiMove(g, g.meta.aiLevel);
      if (mv === null) g.engine.pass();
      else g.engine.play(mv);
      if (countConsecutivePasses(g.engine.history) >= 2) g.phase = "scoring";
      persistLocal();
      return localDto();
    }

    case "hint": {
      if (!localGame || localGame.phase !== "playing") return null;
      return localAiMove(localGame, 8);
    }

    case "enter_scoring": {
      if (!localGame || localGame.phase !== "playing") throw new Error("当前不处于对局阶段");
      localGame.phase = "scoring";
      persistLocal();
      return localDto();
    }

    case "toggle_dead": {
      if (!localGame || localGame.phase !== "scoring") throw new Error("当前不处于数子阶段");
      const g = localGame;
      if (g.engine.board[args.pos] === 0) return localDto();
      const { stones } = groupOn(g.engine.board, g.meta.size, args.pos);
      if (g.dead.has(args.pos)) stones.forEach((s) => g.dead.delete(s));
      else stones.forEach((s) => g.dead.add(s));
      persistLocal();
      return localDto();
    }

    case "resume_scoring": {
      if (!localGame || localGame.phase !== "scoring") return localDto();
      localGame.phase = "playing";
      localGame.dead.clear();
      persistLocal();
      return localDto();
    }

    case "confirm_result": {
      if (!localGame || localGame.phase !== "scoring") throw new Error("当前不处于数子阶段");
      const g = localGame;
      const { black, white } = scoreWithDead(g);
      endLocalGame(g, "数子", black, white);
      const dto = localDto();
      dto.black_score = black;
      dto.white_score = white;
      return dto;
    }

    case "get_autosave": {
      const g = restoreLocal();
      if (!g) return null;
      localGame = g;
      return localDto();
    }

    case "continue_autosave": {
      const g = restoreLocal();
      if (!g) throw new Error("没有可继续的对局");
      localGame = g;
      return localDto();
    }

    case "discard_autosave_cmd":
      localStorage.removeItem(LS_AUTOSAVE);
      if (localGame) localGame = null;
      return null;

    case "list_records":
      return (lsGet<RecordData[]>(LS_RECORDS) ?? []).map((r) => r.meta);

    case "get_record":
      return (lsGet<RecordData[]>(LS_RECORDS) ?? []).find((r) => r.meta.id === args.id) ?? (() => { throw new Error("棋谱不存在"); })();

    case "delete_record": {
      const records = (lsGet<RecordData[]>(LS_RECORDS) ?? []).filter((r) => r.meta.id !== args.id);
      lsSet(LS_RECORDS, records);
      return null;
    }

    case "export_record_sgf": {
      const rec = (lsGet<RecordData[]>(LS_RECORDS) ?? []).find((r) => r.meta.id === args.id);
      if (!rec) throw new Error("棋谱不存在");
      const sgf = buildSgfLocal(rec);
      const blob = new Blob([sgf], { type: "application/x-go-sgf" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `yitugo-${rec.meta.id}.sgf`;
      a.click();
      URL.revokeObjectURL(a.href);
      return null;
    }

    case "import_sgf":
      throw new Error("浏览器演示模式不支持导入，请使用桌面应用");

    default:
      throw new Error(`本地模式未实现: ${cmd}`);
  }
}

function countConsecutivePasses(history: { pos: number | null }[]): number {
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].pos === null) n++;
    else break;
  }
  return n;
}

function rebuildEngine(g: LocalGame) {
  const e = g.engine;
  e.board = new Array(e.size * e.size).fill(0);
  e.captures = [0, 0];
  e.ko = null;
  e.turn = g.meta.handicap >= 2 ? WHITE : BLACK;
  for (const p of e.handicapPos) e.board[p] = BLACK;
  const hist = e.history;
  e.history = [];
  for (const rec of hist) {
    if (rec.pos === null) {
      e.turn = (rec.side === BLACK ? WHITE : BLACK) as 1 | 2;
    } else {
      e.turn = rec.side as 1 | 2;
      e.play(rec.pos);
    }
  }
}

// ---------- 本地 SGF 导出/解析 ----------
export function buildSgfLocal(rec: RecordData): string {
  const c = (p: number) => posToCoord(rec.meta.size, p);
  let s = `(;GM[1]FF[4]CA[UTF-8]AP[YiTuGo:1.0]SZ[${rec.meta.size}]KM[${rec.meta.komi}]DT[${rec.meta.date}]RE[${rec.meta.result}]PB[${rec.meta.black_name}]PW[${rec.meta.white_name}]`;
  if (rec.handicap >= 2) {
    s += `HA[${rec.handicap}]`;
    for (const p of rec.handicap_pos) s += `AB[${c(p)}]`;
  }
  for (const m of rec.history) {
    const tag = m.side === BLACK ? "B" : "W";
    s += m.pos === null ? `;${tag}[]` : `;${tag}[${c(m.pos)}]`;
  }
  return s + ")";
}

/** 极简 SGF 解析（浏览器模式导入备用） */
export function parseSgfLocal(text: string, fallbackSize = 19): { size: number; komi: number; handicap: number; handicap_pos: number[]; moves: { side: number; pos: number | null }[]; pb: string; pw: string; re: string; dt: string } | null {
  const chars = [...text];
  const n = chars.length;
  let i = 0;
  let size = fallbackSize, komi = 7.5, handicap = 0;
  let pb = "黑方", pw = "白方", re = "", dt = "";
  const ab: number[] = [];
  const moves: { side: number; pos: number | null }[] = [];
  const readVals = (): string[] => {
    const vals: string[] = [];
    while (i < n && chars[i] !== "[") {
      if (!/[A-Za-z\s]/.test(chars[i])) return vals;
      i++;
    }
    while (i < n && chars[i] === "[") {
      i++;
      let v = "";
      while (i < n && chars[i] !== "]") {
        if (chars[i] === "\\" && i + 1 < n) i++;
        v += chars[i];
        i++;
      }
      i++;
      vals.push(v);
    }
    return vals;
  };
  while (i < n) {
    const ch = chars[i];
    if (ch === "(" || ch === ")" || ch === ";") { i++; continue; }
    if (ch === "[") { i++; while (i < n && chars[i] !== "]") i++; i++; continue; }
    if (/[A-Z]/.test(ch)) {
      let key = "";
      while (i < n && /[A-Za-z]/.test(chars[i])) key += chars[i++];
      const vals = readVals();
      switch (key) {
        case "SZ": size = Math.max(5, Math.min(25, parseInt(vals[0]) || 19)); break;
        case "KM": komi = parseFloat(vals[0]) || 7.5; break;
        case "HA": handicap = parseInt(vals[0]) || 0; break;
        case "PB": pb = vals[0] ?? pb; break;
        case "PW": pw = vals[0] ?? pw; break;
        case "RE": re = vals[0] ?? ""; break;
        case "DT": dt = vals[0] ?? ""; break;
        case "AB":
          for (const v of vals) {
            const x = v.charCodeAt(0) - 97, y = v.charCodeAt(1) - 97;
            if (x >= 0 && y >= 0 && x < size && y < size) ab.push(y * size + x);
          }
          break;
        case "B":
        case "W": {
          const v = vals[0] ?? "";
          const x = v.charCodeAt(0) - 97, y = v.charCodeAt(1) - 97;
          const pos = v.length >= 2 && x >= 0 && y >= 0 && x < size && y < size ? y * size + x : null;
          moves.push({ side: key === "B" ? BLACK : WHITE, pos });
          break;
        }
      }
      continue;
    }
    i++;
  }
  if (!moves.length && !ab.length) return null;
  if (!handicap && ab.length >= 2) handicap = ab.length;
  return { size, komi, handicap, handicap_pos: ab, moves, pb, pw, re, dt };
}

export { coordToPos, posToCoord };
