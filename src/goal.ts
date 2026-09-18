// 教程/死活题共用的目标判定逻辑（与 scripts/verify-content.mjs 保持一致）
import { BLACK, WHITE, TsEngine, groupOn, type Side } from "./engine";
import { coordToPos, posToCoord, type Puzzle, type TaskStep } from "./content";

export function makeBoard(size: number, stones: { black: string[]; white: string[] }, toMove: "b" | "w"): TsEngine {
  const e = new TsEngine(size);
  for (const c of stones.black) e.board[coordToPos(size, c)] = BLACK;
  for (const c of stones.white) e.board[coordToPos(size, c)] = WHITE;
  e.turn = (toMove === "w" ? WHITE : BLACK) as Side;
  return e;
}

export function sideOf(toMove: "b" | "w"): Side {
  return (toMove === "w" ? WHITE : BLACK) as Side;
}

/** 统计某块棋的真眼数（空点四邻全为本块颜色） */
export function countEyes(e: TsEngine, seed: number): number {
  const color = e.board[seed];
  if (!color) return 0;
  const { stones } = groupOn(e.board, e.size, seed);
  const stoneSet = new Set(stones);
  const seen = new Set<number>();
  let eyes = 0;
  for (const s of stones) {
    for (const nb of neighbors(e.size, s)) {
      if (e.board[nb] === 0 && !seen.has(nb)) {
        seen.add(nb);
        const nbs = neighbors(e.size, nb);
        if (nbs.length && nbs.every((x) => e.board[x] === color || stoneSet.has(x))) eyes++;
      }
    }
  }
  return eyes;
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

export interface GoalCheck {
  kind: string;
  pos?: string[];
  targets?: string[];
  seed?: string;
  minLibs?: number;
  minEyes?: number;
  moves?: string[];
  replies?: string[];
  solution?: string[];
  forbidden?: { pos: string; message: string }[];
}

export interface ClickOutcome {
  applied: boolean;
  done: boolean;
  message?: string;   // 反馈信息（不合法/位置不对/提示等）
  captured: number;
}

/**
 * 任务点击处理：在引擎上尝试执行用户落子并按目标判定。
 * 引擎状态只在 applied=true 时被修改。
 */
export function handleTaskClick(e: TsEngine, spec: TaskStep, progress: number, pos: number): ClickOutcome {
  const size = e.size;
  const side = e.turn;

  const forbiddenHit = spec.forbidden?.find((f) => coordToPos(size, f.pos) === pos);
  if (forbiddenHit) {
    return { applied: false, done: false, message: forbiddenHit.message, captured: 0 };
  }

  // 先试合法性
  const tryRes = e.tryMove(pos, side);

  switch (spec.kind) {
    case "moveto": {
      const ok = (spec.pos ?? []).some((c) => coordToPos(size, c) === pos);
      if (!ok) return { applied: false, done: false, message: "不是这个位置，再想一想。", captured: 0 };
      if (!tryRes.ok) return { applied: false, done: false, message: tryRes.error, captured: 0 };
      e.play(pos);
      return { applied: true, done: true, captured: tryRes.captured.length };
    }
    case "any": {
      if (!tryRes.ok) return { applied: false, done: false, message: tryRes.error, captured: 0 };
      e.play(pos);
      return { applied: true, done: true, captured: tryRes.captured.length };
    }
    case "forbidden": {
      const ok = (spec.pos ?? []).some((c) => coordToPos(size, c) === pos);
      if (ok) return { applied: false, done: true, message: spec.message, captured: 0 };
      return { applied: false, done: false, message: "请点击题目指的那个空点。", captured: 0 };
    }
    case "capture": {
      if (!tryRes.ok) return { applied: false, done: false, message: tryRes.error, captured: 0 };
      e.play(pos);
      const remaining = (spec.targets ?? []).filter((c) => e.board[coordToPos(size, c)] !== 0);
      if (remaining.length === 0) return { applied: true, done: true, captured: tryRes.captured.length };
      return { applied: true, done: false, captured: tryRes.captured.length };
    }
    case "escape": {
      if (!tryRes.ok) return { applied: false, done: false, message: tryRes.error, captured: 0 };
      e.play(pos);
      const seed = coordToPos(size, spec.seed!);
      if (e.board[seed] !== side) return { applied: true, done: false, message: "这手没能保住棋子，重新想想。", captured: tryRes.captured.length };
      const { libs } = groupOn(e.board, size, seed);
      if (libs.size >= (spec.minLibs ?? 3)) return { applied: true, done: true, captured: tryRes.captured.length };
      return { applied: true, done: false, message: "气还不够多，试着向宽阔的中腹长出。", captured: tryRes.captured.length };
    }
    case "eyes": {
      if (!tryRes.ok) return { applied: false, done: false, message: tryRes.error, captured: 0 };
      e.play(pos);
      const seed = coordToPos(size, spec.seed!);
      if (e.board[seed] !== side) return { applied: true, done: false, message: "黑子被提掉了？重新试试。", captured: tryRes.captured.length };
      const eyes = countEyes(e, seed);
      if (eyes >= (spec.minEyes ?? 2)) return { applied: true, done: true, captured: tryRes.captured.length };
      return { applied: true, done: false, message: "眼还不够，换个位置试试（提示：找「眼形」的中心点）。", captured: tryRes.captured.length };
    }
    case "seq": {
      const moves = spec.moves ?? [];
      const expected = moves[progress];
      if (!expected) return { applied: false, done: true, captured: 0 };
      if (coordToPos(size, expected) !== pos) {
        if (!tryRes.ok) return { applied: false, done: false, message: tryRes.error, captured: 0 };
        return {
          applied: false,
          done: false,
          message: spec.hint ? `这手不对。${spec.hint}` : "这手不对，再想想。",
          captured: 0,
        };
      }
      if (!tryRes.ok) return { applied: false, done: false, message: tryRes.error, captured: 0 };
      e.play(pos);
      let captured = tryRes.captured.length;
      const reply = spec.replies?.[progress];
      if (reply) {
        if (reply === "pass") e.pass();
        else {
          const rp = coordToPos(size, reply);
          const rr = e.tryMove(rp, e.turn);
          if (rr.ok) {
            e.play(rp);
            captured += rr.captured.length;
          }
        }
      }
      const done = progress + 1 >= moves.length;
      return { applied: true, done, captured, message: done ? undefined : undefined };
    }
    default:
      return { applied: false, done: false, message: "未知任务类型", captured: 0 };
  }
}

/** 死活题点击处理 */
export function handlePuzzleClick(e: TsEngine, p: Puzzle, progress: number, pos: number): ClickOutcome {
  const step: TaskStep = {
    type: "task",
    title: p.title,
    body: p.prompt,
    kind: p.kind === "exact" ? "seq" : (p.kind as any),
    moves: p.solution,
    replies: p.replies,
    targets: p.targets,
    seed: p.seed,
    minLibs: p.minLibs,
    minEyes: p.minEyes,
    success: "",
  };
  return handleTaskClick(e, step, progress, pos);
}

/** 展示正解：按解法自动走完 */
export function replaySolution(e: TsEngine, p: Puzzle) {
  const size = e.size;
  let replyIdx = 0;
  for (let i = 0; i < p.solution.length; i++) {
    const pos = coordToPos(size, p.solution[i]);
    if (e.tryMove(pos, e.turn).ok) e.play(pos);
    const reply = p.replies?.[replyIdx++];
    if (reply) {
      if (reply === "pass") e.pass();
      else {
        const rp = coordToPos(size, reply);
        if (e.tryMove(rp, e.turn).ok) e.play(rp);
      }
    }
  }
}

export { coordToPos, posToCoord };
