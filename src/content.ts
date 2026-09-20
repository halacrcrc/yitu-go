// 内容类型与共享工具（段位换算、坐标）
import contentJson from "./content.json";

export const APP_VERSION = "1.6.1";

export interface AiLevel {
  level: number;
  name: string;
  rating: number;
  label: string;
}

export interface TaskStep {
  type: "task";
  title: string;
  body: string;
  size?: number;
  stones?: { black: string[]; white: string[] };
  toMove?: "b" | "w";
  kind: "moveto" | "any" | "forbidden" | "capture" | "escape" | "eyes" | "seq" | "connect";
  pos?: string[];
  targets?: string[];
  seed?: string;
  seeds?: string[];
  minLibs?: number;
  minEyes?: number;
  forbidden?: { pos: string; message: string }[];
  moves?: string[];
  replies?: string[];
  solution?: string[];
  message?: string;
  success: string;
  hint?: string;
}

export interface TextStep {
  type: "text";
  title: string;
  body: string;
}

export interface DemoStep {
  type: "demo";
  title: string;
  body: string;
  size: number;
  /** 着法列表，带颜色前缀：如 "bdd" = 黑下 dd，"wfc" = 白下 fc */
  moves: string[];
  captions: string[];
}

export type Step = TextStep | TaskStep | DemoStep;

export interface Chapter {
  id: string;
  title: string;
  desc: string;
  steps: Step[];
}

export interface Puzzle {
  id: string;
  tier: 1 | 2 | 3 | 4;
  title: string;
  prompt: string;
  kind: "exact" | "seq" | "escape" | "eyes";
  stones: { black: string[]; white: string[] };
  toMove: "b" | "w";
  solution: string[];
  replies?: string[];
  targets?: string[];
  seed?: string;
  minLibs?: number;
  minEyes?: number;
  explain: string;
}

export interface OpeningEntry {
  id: string;
  category: "layout" | "joseki";
  name: string;
  size: number;
  /** 着法，带颜色前缀："bdd" = 黑 dd */
  moves: string[];
  intro: string;
  detail: string;
}

export const content = contentJson as unknown as {
  aiLevels: AiLevel[];
  tutorials: Chapter[];
  puzzles: Puzzle[];
  openings: OpeningEntry[];
};

export const TIER_NAMES: Record<number, string> = { 1: "吃子入门", 2: "战术进阶", 3: "死活手筋", 4: "段位冲刺" };

/** 解析带颜色前缀的着法："bdd" → { side: BLACK, coord: "dd" } */
export function parsePrefixedMove(mv: string): { side: number; coord: string } {
  const s = mv[0] === "w" ? 2 : 1;
  return { side: s, coord: mv.slice(1) };
}

/** SGF 风格坐标 → 序号（a=0，列在前） */
export function coordToPos(size: number, c: string): number {
  const x = c.charCodeAt(0) - 97;
  const y = c.charCodeAt(1) - 97;
  return y * size + x;
}

export function posToCoord(size: number, pos: number): string {
  const x = pos % size;
  const y = Math.floor(pos / size);
  return String.fromCharCode(97 + x) + String.fromCharCode(97 + y);
}

/** 对局用坐标名（跳过 I，如 D4），行号从下往上 */
const COLS = "ABCDEFGHJKLMNOPQRST";
export function coordName(size: number, pos: number): string {
  const x = pos % size;
  const y = Math.floor(pos / size);
  return `${COLS[x]}${size - y}`;
}

/** 段位换算（与 Rust 端 rank_label 保持一致） */
export function rankFromRating(rating: number): string {
  if (rating < 2500) return `${30 - Math.min(29, Math.max(0, Math.floor((rating - 100) / 80)))}级`;
  if (rating < 3800) return `业余${Math.min(9, Math.floor((rating - 2500) / 150) + 1)}段`;
  return `职业${Math.min(9, Math.floor((rating - 3800) / 100) + 1)}段`;
}

/** 生成所有段位分界线 */
export function rankThresholds(): number[] {
  const t: number[] = [];
  for (let k = 0; k < 30; k++) t.push(100 + k * 80); // 30级..1级
  for (let d = 1; d <= 9; d++) t.push(2500 + (d - 1) * 150); // 业余1-9段
  for (let d = 1; d <= 9; d++) t.push(3800 + (d - 1) * 100); // 职业1-9段
  return t;
}

/** 当前段位与下一级进度 */
export function rankProgress(rating: number): { rank: string; next: string | null; pct: number; nextAt: number | null } {
  const th = rankThresholds();
  const rank = rankFromRating(rating);
  let idx = 0;
  for (let i = th.length - 1; i >= 0; i--) {
    if (rating >= th[i]) { idx = i; break; }
  }
  if (idx >= th.length - 1) return { rank, next: null, pct: 1, nextAt: null };
  const lo = th[idx];
  const hi = th[idx + 1];
  return {
    rank,
    next: rankFromRating(hi),
    pct: Math.min(1, Math.max(0, (rating - lo) / (hi - lo))),
    nextAt: hi,
  };
}
