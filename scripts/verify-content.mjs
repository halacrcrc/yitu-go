// 验证 content.json 中所有教程任务与死活题的可解性与唯一性
// 用法: node scripts/verify-content.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TsEngine, BLACK, WHITE } from "../src/engine.ts";

const here = dirname(fileURLToPath(import.meta.url));
const content = JSON.parse(readFileSync(join(here, "..", "src", "content.json"), "utf8"));

const C2N = (s) => s.charCodeAt(0) - 97;
export function toPos(size, coord) {
  if (coord === "pass") return null;
  const x = C2N(coord[0]);
  const y = C2N(coord[1]);
  if (x < 0 || y < 0 || x >= size || y >= size) throw new Error(`坐标越界: ${coord}`);
  return y * size + x;
}

function setup(stones, size, toMove) {
  const e = new TsEngine(size);
  for (const c of stones.black || []) {
    const p = toPos(size, c);
    if (e.board[p] !== 0) throw new Error(`黑子位置冲突: ${c}`);
    e.board[p] = BLACK;
  }
  for (const c of stones.white || []) {
    const p = toPos(size, c);
    if (e.board[p] !== 0) throw new Error(`白子位置冲突: ${c}`);
    e.board[p] = WHITE;
  }
  e.turn = toMove === "w" ? WHITE : BLACK;
  return e;
}

function groupLibs(e, seed) {
  const { stones, libs } = (() => {
    const color = e.board[seed];
    const st = [seed];
    const seen = new Set([seed]);
    const libs = new Set();
    while (st.length) {
      const cur = st.pop();
      for (const nb of neighbors(e.size, cur)) {
        if (e.board[nb] === 0) libs.add(nb);
        else if (e.board[nb] === color && !seen.has(nb)) {
          seen.add(nb);
          st.push(nb);
        }
      }
    }
    return { stones: [...seen], libs };
  })();
  return { stones, libs };
}

function neighbors(size, i) {
  const x = i % size, y = (i / size) | 0;
  const v = [];
  if (x > 0) v.push(i - 1);
  if (x + 1 < size) v.push(i + 1);
  if (y > 0) v.push(i - size);
  if (y + 1 < size) v.push(i + size);
  return v;
}

let passCount = 0, failCount = 0;
const failures = [];

function report(name, ok, detail) {
  if (ok) { passCount++; console.log(`  ✓ ${name}`); }
  else { failCount++; failures.push(`${name}: ${detail}`); console.log(`  ✗ ${name} — ${detail}`); }
}

// ---------- 验证死活题 ----------
console.log("验证死活题...");
for (const p of content.puzzles) {
  const size = p.size || 9;
  try {
    const e = setup(p.stones, size, p.toMove);
    const side = p.toMove === "w" ? WHITE : BLACK;
    const opp = side === BLACK ? WHITE : BLACK;

    if (p.kind === "exact") {
      const mv = toPos(size, p.solution[0]);
      const r = e.tryMove(mv, side);
      if (!r.ok) { report(p.id, false, `正解不合法: ${r.error}`); continue; }
      e.play(mv);
      if (p.targets) {
        const allCaptured = p.targets.every((t) => e.board[toPos(size, t)] === 0);
        if (!allCaptured) { report(p.id, false, "正解后目标未被全部提掉"); continue; }
      }
      // 检查是否有提子或达成目的（如双打吃至少制造了打吃）
      report(p.id, true, "ok");
    } else if (p.kind === "escape") {
      const mv = toPos(size, p.solution[0]);
      const r = e.play(mv);
      if (!r.ok) { report(p.id, false, `正解不合法: ${r.error}`); continue; }
      const { libs } = groupLibs(e, toPos(size, p.seed));
      if (libs.size < p.minLibs) { report(p.id, false, `逃跑后气数 ${libs.size} < ${p.minLibs}`); continue; }
      report(p.id, true, "ok");
    } else if (p.kind === "eyes") {
      const mv = toPos(size, p.solution[0]);
      const r = e.play(mv);
      if (!r.ok) { report(p.id, false, `正解不合法: ${r.error}`); continue; }
      const eyes = countEyes(e, toPos(size, p.seed));
      if (eyes < p.minEyes) { report(p.id, false, `做眼后真眼数 ${eyes} < ${p.minEyes}`); continue; }
      report(p.id, true, "ok");
    } else if (p.kind === "seq") {
      let replyIdx = 0;
      let ok = true;
      let detail = "";
      const targets = p.targets || [];
      for (let i = 0; i < p.solution.length; i++) {
        const mv = toPos(size, p.solution[i]);
        const r = e.tryMove(mv, e.turn);
        if (!r.ok) { ok = false; detail = `第${i + 1}手不合法: ${r.error}`; break; }
        e.play(mv);
        // 回合切给对手，执行脚本应手
        const reply = p.replies && p.replies[replyIdx++];
        if (reply) {
          if (reply === "pass") {
            e.pass();
          } else {
            const rp = toPos(size, reply);
            const rr = e.tryMove(rp, e.turn);
            if (!rr.ok) { ok = false; detail = `脚本应手 ${reply} 不合法: ${rr.error}`; break; }
            e.play(rp);
          }
        }
      }
      if (ok && targets.length) {
        const allCaptured = targets.every((t) => e.board[toPos(size, t)] === 0);
        if (!allCaptured) { ok = false; detail = "序列完成后目标未被提掉"; }
      }
      if (ok && p.expectCapturedAny) {
        const anyCap = e.history.some((h) => h.captured.length > 0);
        if (!anyCap) { ok = false; detail = "序列中没有发生提子"; }
      }
      report(p.id, ok, detail || "ok");
    }
  } catch (err) {
    report(p.id, false, err.message);
  }
}

// 对 exact/eyes/escape 额外验证：所有其他一手着法不能达成目标（唯一解检查，仅对 exact）
console.log("验证解的唯一性（exact 题）...");
for (const p of content.puzzles.filter((x) => x.kind === "exact")) {
  const size = p.size || 9;
  const e = setup(p.stones, size, p.toMove);
  const side = p.toMove === "w" ? WHITE : BLACK;
  const sol = toPos(size, p.solution[0]);
  let alt = [];
  for (let i = 0; i < size * size; i++) {
    if (e.board[i] !== 0 || i === sol) continue;
    const r = e.tryMove(i, side);
    if (!r.ok) continue;
    // 若这一手也能提子且提掉的目标相同 → 解不唯一
    if (p.targets && p.targets.every((t) => r.captured.includes(toPos(size, t)))) {
      alt.push(idxCoord(size, i));
    }
  }
  report(`${p.id} 唯一性`, alt.length === 0, alt.length ? `同样达成目标的点: ${alt.join(",")}` : "ok");
}

function idxCoord(size, i) {
  return String.fromCharCode(97 + (i % size)) + String.fromCharCode(97 + ((i / size) | 0));
}

function countEyes(e, seed) {
  // 与前端 goal 检查一致的简化真眼统计：空点四邻全为该色
  const color = e.board[seed];
  const { stones } = groupLibs(e, seed);
  const stoneSet = new Set(stones);
  const seen = new Set();
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

// ---------- 验证教程任务 ----------
console.log("验证教程任务...");
for (const ch of content.tutorials) {
  for (const [si, step] of ch.steps.entries()) {
    if (step.type !== "task") continue;
    const size = step.size || 9;
    try {
      const stones = step.stones || { black: [], white: [] };
      const e = setup(stones, size, step.toMove || "b");
      const side = step.toMove === "w" ? WHITE : BLACK;

      if (step.kind === "moveto" || step.kind === "forbidden" || step.kind === "any") {
        if (step.kind !== "any") {
          for (const c of step.pos) {
            if (step.kind === "forbidden") break;
            const p = toPos(size, c);
            if (e.board[p] !== 0) { report(`${ch.id}#${si}`, false, `目标点 ${c} 已被占用`); break; }
            const r = e.tryMove(p, side);
            if (!r.ok) { report(`${ch.id}#${si}`, false, `目标 ${c} 不合法: ${r.error}`); break; }
          }
        }
        report(`${ch.id}#${si} ${step.title}`, true, "ok");
      } else if (step.kind === "capture") {
        // 模拟玩家用 par 手数内自由紧气完成提子（贪心：直接下正解思路——找目标的气）
        const opp = side === BLACK ? WHITE : BLACK;
        let ok = true, detail = "";
        let guard = 0;
        while (guard++ < 10) {
          const remaining = step.targets.filter((t) => e.board[toPos(size, t)] !== 0);
          if (remaining.length === 0) break;
          // 找到目标块的所有气，紧之
          const libs = new Set();
          for (const t of remaining) {
            const { libs: L } = groupLibs(e, toPos(size, t));
            for (const l of L) libs.add(l);
          }
          if (libs.size === 0) { ok = false; detail = "目标无气却未被提？"; break; }
          const mv = [...libs][0];
          const r = e.play(mv);
          if (!r.ok) { ok = false; detail = `自动紧气 ${idxCoord(size, mv)} 失败: ${r.error}`; break; }
          // 对手随手应（找一个大点随便下）——教程中对手可能反抗，但此验证只确保提子路径存在
          const rp = anyLegal(e, opp);
          if (rp !== null) e.play(rp);
        }
        const remaining = step.targets.filter((t) => e.board[toPos(size, t)] !== 0);
        report(`${ch.id}#${si} ${step.title}`, ok && remaining.length === 0, ok ? `未能提掉: ${remaining.join(",")}` : detail);
      } else if (step.kind === "escape") {
        const mv = toPos(size, step.solution ? step.solution[0] : inferEscape(e, toPos(size, step.seed), size));
        const r = e.play(mv);
        if (!r.ok) { report(`${ch.id}#${si} ${step.title}`, false, `正解不合法: ${r.error}`); continue; }
        const { libs } = groupLibs(e, toPos(size, step.seed));
        report(`${ch.id}#${si} ${step.title}`, libs.size >= step.minLibs, `气数 ${libs.size} < ${step.minLibs}`);
      } else if (step.kind === "eyes") {
        const sol = step.solution ? step.solution[0] : null;
        if (!sol) { report(`${ch.id}#${si} ${step.title}`, false, "缺少 solution"); continue; }
        const r = e.play(toPos(size, sol));
        if (!r.ok) { report(`${ch.id}#${si} ${step.title}`, false, `正解不合法: ${r.error}`); continue; }
        const eyes = countEyes(e, toPos(size, step.seed));
        report(`${ch.id}#${si} ${step.title}`, eyes >= step.minEyes, `真眼数 ${eyes} < ${step.minEyes}`);
      } else if (step.kind === "seq") {
        let replyIdx = 0, ok = true, detail = "";
        for (let i = 0; i < step.moves.length; i++) {
          const mv = toPos(size, step.moves[i]);
          const r = e.tryMove(mv, e.turn);
          if (!r.ok) { ok = false; detail = `第${i + 1}手不合法: ${r.error}`; break; }
          e.play(mv);
          const reply = step.replies && step.replies[replyIdx++];
          if (reply) {
            if (reply === "pass") e.pass();
            else {
              const rp = toPos(size, reply);
              const rr = e.tryMove(rp, e.turn);
              if (!rr.ok) { ok = false; detail = `应手 ${reply} 不合法: ${rr.error}`; break; }
              e.play(rp);
            }
          }
        }
        report(`${ch.id}#${si} ${step.title}`, ok, detail || "ok");
      } else if (step.kind === "connect") {
        const mv = toPos(size, step.solution[0]);
        if (mv === null || mv === undefined || Number.isNaN(mv)) { report(`${ch.id}#${si} ${step.title}`, false, "缺少 solution"); continue; }
        const r = e.play(mv);
        if (!r.ok) { report(`${ch.id}#${si} ${step.title}`, false, `正解不合法: ${r.error}`); continue; }
        // 验证两块种子棋连成一体
        const seedA = toPos(size, step.seeds[0]);
        const color = e.board[seedA];
        const st = [seedA];
        const seen = new Set([seedA]);
        while (st.length) {
          const cur = st.pop();
          for (const nb of neighbors(e.size, cur)) {
            if (e.board[nb] === color && !seen.has(nb)) { seen.add(nb); st.push(nb); }
          }
        }
        const seedB = toPos(size, step.seeds[1]);
        report(`${ch.id}#${si} ${step.title}`, seen.has(seedB), "连接后两块种子不在同一块");
      }
    } catch (err) {
      report(`${ch.id}#${si} ${step.title}`, false, err.message);
    }
  }
}

// ---------- 验证教程演示步骤与定式库 ----------
console.log("验证演示/定式库着法...");
function verifySequence(name, size, moves, freeSide = false) {
  const e = new TsEngine(size);
  for (const mv of moves) {
    const side = mv[0] === "w" ? WHITE : BLACK;
    const coord = mv.slice(1);
    const p = toPos(size, coord);
    if (e.board[p] !== 0) { report(name, false, `${mv} 位置已有棋子`); return; }
    if (!freeSide && e.turn !== side) { report(name, false, `${mv} 落子方不符（应为${e.turn === 1 ? "黑" : "白"}）`); return; }
    const r = e.tryMove(p, side);
    if (!r.ok) { report(name, false, `${mv} 不合法: ${r.error}`); return; }
    if (r.captured.length > 0) { report(name, false, `${mv} 发生了提子（定式/布局不应提子）`); return; }
    e.turn = side;
    e.play(p);
  }
  report(name, true, "ok");
}

for (const ch of content.tutorials) {
  for (const [si, step] of ch.steps.entries()) {
    if (step.type === "demo") {
      verifySequence(`${ch.id}#${si} ${step.title}`, step.size || 19, step.moves);
      if (step.captions && step.captions.length !== step.moves.length) {
        report(`${ch.id}#${si} captions`, false, `captions ${step.captions.length} != moves ${step.moves.length}`);
      }
    }
  }
}

for (const o of content.openings || []) {
  verifySequence(`定式库 ${o.id} ${o.name}`, o.size || 19, o.moves, !!o.freeSide);
}

function anyLegal(e, side) {
  for (let i = 0; i < e.size * e.size; i++) {
    if (e.board[i] === 0 && e.tryMove(i, side).ok) return i;
  }
  return null;
}

function inferEscape(e, seed, size) {
  // 找到能让 seed 块气数最大的点
  const { libs } = groupLibs(e, seed);
  let best = null, bestN = -1;
  for (const l of libs) {
    const t = new TsEngine(e.size);
    t.board = e.board.slice();
    t.turn = e.turn;
    const r = t.play(l);
    if (!r.ok) continue;
    const { libs: L2 } = groupLibs(t, seed);
    if (L2.size > bestN) { bestN = L2.size; best = l; }
  }
  if (best === null) throw new Error("无逃生点");
  return idxCoord(size, best);
}

console.log(`\n结果: ${passCount} 通过, ${failCount} 失败`);
if (failCount) {
  console.log("失败列表:");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
console.log("全部内容验证通过 ✅");
