// 围棋规则引擎（TypeScript 实现）
// 用途：教程/死活题的本地互动、棋谱回放、以及浏览器演示模式下的对局
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

export type Side = 1 | 2;

export interface MoveRec {
  side: Side;
  pos: number | null; // null = 停一手
  captured: number[];
}

export function neighborsOf(size: number, i: number): number[] {
  const x = i % size;
  const y = (i - x) / size;
  const v: number[] = [];
  if (x > 0) v.push(i - 1);
  if (x + 1 < size) v.push(i + 1);
  if (y > 0) v.push(i - size);
  if (y + 1 < size) v.push(i + size);
  return v;
}

export function groupOn(board: number[], size: number, i: number): { stones: number[]; libs: Set<number> } {
  const color = board[i];
  const stones: number[] = [i];
  const seen = new Set<number>([i]);
  const libs = new Set<number>();
  while (stones.length) {
    const cur = stones.pop()!;
    for (const nb of neighborsOf(size, cur)) {
      if (board[nb] === EMPTY) libs.add(nb);
      else if (board[nb] === color && !seen.has(nb)) {
        seen.add(nb);
        stones.push(nb);
      }
    }
  }
  return { stones: [...seen], libs };
}

export interface TryResult {
  ok: boolean;
  error?: string;
  captured: number[];
}

export class TsEngine {
  size: number;
  board: number[];
  turn: Side;
  captures: [number, number] = [0, 0];
  ko: number | null = null;
  history: MoveRec[] = [];
  handicapPos: number[] = [];
  komi = 7.5;

  constructor(size: number) {
    this.size = size;
    this.board = new Array(size * size).fill(EMPTY);
    this.turn = BLACK;
  }

  static fromSetup(size: number, stones: { black: number[]; white: number[] }, turn: Side): TsEngine {
    const e = new TsEngine(size);
    for (const p of stones.black) e.board[p] = BLACK;
    for (const p of stones.white) e.board[p] = WHITE;
    e.turn = turn;
    return e;
  }

  tryMove(pos: number, side: Side): TryResult {
    if (this.board[pos] !== EMPTY) return { ok: false, error: "此处已有棋子", captured: [] };
    if (this.ko === pos) return { ok: false, error: "打劫：需先在别处落子（寻劫材）", captured: [] };
    const b = this.board.slice();
    b[pos] = side;
    const captured: number[] = [];
    for (const nb of neighborsOf(this.size, pos)) {
      if (b[nb] !== EMPTY && b[nb] !== side) {
        const { stones, libs } = groupOn(b, this.size, nb);
        if (libs.size === 0) {
          for (const s of stones) {
            b[s] = EMPTY;
            captured.push(s);
          }
        }
      }
    }
    const { libs } = groupOn(b, this.size, pos);
    if (libs.size === 0) return { ok: false, error: "禁入点：此处落子无气（不能自杀）", captured: [] };
    return { ok: true, captured };
  }

  play(pos: number): TryResult {
    const side = this.turn;
    const r = this.tryMove(pos, side);
    if (!r.ok) return r;
    this.board[pos] = side;
    for (const c of r.captured) this.board[c] = EMPTY;
    if (side === BLACK) this.captures[0] += r.captured.length;
    else this.captures[1] += r.captured.length;
    const { stones, libs } = groupOn(this.board, this.size, pos);
    this.ko = r.captured.length === 1 && stones.length === 1 && libs.size === 1 ? r.captured[0] : null;
    this.history.push({ side, pos, captured: r.captured });
    this.turn = (side === BLACK ? WHITE : BLACK) as Side;
    return r;
  }

  pass() {
    const side = this.turn;
    this.history.push({ side, pos: null, captured: [] });
    this.ko = null;
    this.turn = (side === BLACK ? WHITE : BLACK) as Side;
  }

  /** 按给定死子集数子（中国规则） */
  score(dead: Set<number>): { black: number; white: number; terr: number[] } {
    const b = this.board.slice();
    for (const d of dead) b[d] = EMPTY;
    const n = this.size * this.size;
    const terr = new Array(n).fill(0);
    const visited = new Array(n).fill(false);
    for (let i = 0; i < n; i++) {
      if (b[i] !== EMPTY || visited[i]) continue;
      const region: number[] = [i];
      visited[i] = true;
      let bb = false, ww = false;
      for (let k = 0; k < region.length; k++) {
        for (const nb of neighborsOf(this.size, region[k])) {
          if (b[nb] === EMPTY) {
            if (!visited[nb]) { visited[nb] = true; region.push(nb); }
          } else if (b[nb] === BLACK) bb = true;
          else ww = true;
        }
      }
      const owner = bb && !ww ? BLACK : ww && !bb ? WHITE : 0;
      for (const r of region) terr[r] = owner;
    }
    let black = 0, white = this.komi;
    for (let i = 0; i < n; i++) {
      if (b[i] === BLACK) black++;
      else if (b[i] === WHITE) white++;
      else if (terr[i] === BLACK) black++;
      else if (terr[i] === WHITE) white++;
    }
    return { black, white, terr };
  }

  /** 势力范围估算（BFS 距离法） */
  influenceTerritory(): number[] {
    const n = this.size * this.size;
    const dist = (color: number): number[] => {
      const d = new Array(n).fill(Infinity);
      const q: number[] = [];
      for (let i = 0; i < n; i++)
        if (this.board[i] === color) { d[i] = 0; q.push(i); }
      for (let k = 0; k < q.length; k++) {
        const cur = q[k];
        for (const nb of neighborsOf(this.size, cur)) {
          if (this.board[nb] !== color && d[nb] > d[cur] + 1) {
            d[nb] = d[cur] + 1;
            q.push(nb);
          }
        }
      }
      return d;
    };
    const db = dist(BLACK), dw = dist(WHITE);
    const terr = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      if (this.board[i] === BLACK) terr[i] = BLACK;
      else if (this.board[i] === WHITE) terr[i] = WHITE;
      else if (db[i] + 2 < dw[i]) terr[i] = BLACK;
      else if (dw[i] + 2 < db[i]) terr[i] = WHITE;
    }
    return terr;
  }

  /** 复制当前状态（用于触发 React 重渲染） */
  shallowCopy(): TsEngine {
    const e = new TsEngine(this.size);
    e.board = this.board.slice();
    e.turn = this.turn;
    e.captures = [this.captures[0], this.captures[1]];
    e.ko = this.ko;
    e.history = this.history.slice();
    e.handicapPos = this.handicapPos.slice();
    e.komi = this.komi;
    return e;
  }

  /** 数某组棋子的真眼数（空点四邻全为己方即视为眼） */
  countTrueEyes(seed: number): number {
    const color = this.board[seed];
    if (!color) return 0;
    const { stones } = groupOn(this.board, this.size, seed);
    const stoneSet = new Set(stones);
    const n = this.size * this.size;
    const checked = new Set<number>();
    let eyes = 0;
    for (const s of stones) {
      for (const nb of neighborsOf(this.size, s)) {
        if (this.board[nb] === EMPTY && !checked.has(nb)) {
          checked.add(nb);
          const nbs = neighborsOf(this.size, nb);
          if (nbs.length && nbs.every((x) => this.board[x] === color || stoneSet.has(x))) {
            // 该空点四邻全属本方 → 眼（简化判断）
            eyes++;
          }
        }
      }
    }
    return eyes;
  }
}
