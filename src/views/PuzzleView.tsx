// 死活题训练
import { useEffect, useMemo, useState } from "react";
import { Board } from "../components/Board";
import { Icon } from "../components/ui";
import { content, TIER_NAMES, type Puzzle } from "../content";
import { makeBoard, handlePuzzleClick, replaySolution, sideOf } from "../goal";
import { TsEngine } from "../engine";
import { useStore } from "../store";
import { playError, playSuccess, playStone, playCapture } from "../sound";

export function PuzzleView() {
  const { profile } = useStore();
  const [tier, setTier] = useState<1 | 2 | 3 | 4>(1);
  const list = useMemo(() => content.puzzles.filter((p) => p.tier === tier), [tier]);
  const [idx, setIdx] = useState(0);
  const puzzle: Puzzle = list[Math.min(idx, list.length - 1)];

  useEffect(() => {
    setIdx(0);
  }, [tier]);

  if (!puzzle) return <div className="puzzle" />;

  const solvedSet = new Set(profile?.puzzles_solved ?? []);
  const tierSolved = list.filter((p) => solvedSet.has(p.id)).length;

  return (
    <div className="puzzle">
      <aside className="puzzle-list">
        <h2><Icon name="puzzle" size={20} /> 死活题</h2>
        <div className="tier-tabs">
          {([1, 2, 3, 4] as const).map((t) => (
            <button key={t} className={tier === t ? "on" : ""} onClick={() => setTier(t)}>
              {TIER_NAMES[t]}
            </button>
          ))}
        </div>
        <div className="muted small" style={{ padding: "0 4px 8px" }}>
          已解开 {tierSolved}/{list.length}
        </div>
        <div className="puzzle-grid">
          {list.map((p, i) => (
            <button
              key={p.id}
              className={`puzzle-item${i === idx ? " on" : ""}${solvedSet.has(p.id) ? " solved" : ""}`}
              onClick={() => setIdx(i)}
            >
              <span className="p-no">{i + 1}</span>
              <span className="p-title">{p.title}</span>
              {solvedSet.has(p.id) && <Icon name="check" size={14} className="p-check" />}
            </button>
          ))}
        </div>
      </aside>

      <PuzzleBoard key={puzzle.id} puzzle={puzzle} indexInTier={idx} tierCount={list.length} onNav={setIdx} />
    </div>
  );
}

function PuzzleBoard({ puzzle, indexInTier, tierCount, onNav }: { puzzle: Puzzle; indexInTier: number; tierCount: number; onNav: (i: number) => void }) {
  const { profile, markPuzzleSolved } = useStore();
  const [engine, setEngine] = useState<TsEngine>(() => makeBoard(9, puzzle.stones, puzzle.toMove));
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const side = sideOf(puzzle.toMove);
  const solved = profile?.puzzles_solved.includes(puzzle.id) ?? false;

  const onClick = (pos: number) => {
    if (done) return;
    const res = handlePuzzleClick(engine, puzzle, progress, pos);
    if (res.applied) {
      if (profile?.settings.sound) {
        if (res.captured > 0) playCapture();
        else playStone();
      }
      setProgress((p) => p + 1);
      setEngine(engine.shallowCopy());
      setFeedback(null);
      if (res.done) {
        setDone(true);
        if (profile?.settings.sound) playSuccess();
        void markPuzzleSolved(puzzle.id);
      }
    } else {
      if (profile?.settings.sound) playError();
      setFeedback(res.message ?? "这手不对，再想想。");
    }
  };

  const retry = () => {
    setEngine(makeBoard(9, puzzle.stones, puzzle.toMove));
    setProgress(0);
    setDone(false);
    setFailed(false);
    setFeedback(null);
  };

  const showSolution = () => {
    setFailed(true);
    setDone(true);
    replaySolution(engine, puzzle);
    setEngine(engine.shallowCopy());
    setFeedback("已自动演示正解。");
  };

  return (
    <section className="puzzle-main card">
      <div className="puzzle-head">
        <div>
          <h3>
            {puzzle.title}
            {solved && !failed && <span className="badge badge-green">已解开</span>}
            {failed && <span className="badge">已看答案</span>}
          </h3>
          <p className="muted">{puzzle.prompt}（执{side === 1 ? "黑" : "白"}）</p>
        </div>
        <span className="muted small">{indexInTier + 1} / {tierCount}</span>
      </div>

      <div className="puzzle-body">
        <div className="puzzle-board">
          <Board size={9} board={engine.board} showCoords={false} interactive={!done} playSide={side} onPosClick={onClick} />
        </div>
        <div className="puzzle-side">
          <div className={`task-msg${done ? (failed ? "" : " ok") : feedback ? " err" : ""}`}>
            {done
              ? failed
                ? "看过答案了，试着独立再做一遍吧！"
                : `✔ 正解！${puzzle.explain}`
              : feedback ?? "点击棋盘落子。答对会自动进入下一阶段。"}
          </div>

          {!done && (
            <div className="row gap wrap">
              <button className="btn small" onClick={retry}><Icon name="undo" size={14} /> 重来</button>
              <button className="btn ghost small" onClick={showSolution}><Icon name="eye" size={14} /> 看答案</button>
            </div>
          )}

          {done && (
            <div className="row gap wrap">
              <button className="btn small" onClick={retry}><Icon name="undo" size={14} /> 再做一遍</button>
              {indexInTier + 1 < tierCount && (
                <button className="btn primary small" onClick={() => onNav(indexInTier + 1)}>
                  下一题 <Icon name="chevronRight" size={14} />
                </button>
              )}
            </div>
          )}

          <div className="card hint-card">
            <b><Icon name="bulb" size={14} /> 提示</b>
            <p className="small muted">
              {puzzle.kind === "exact" && "一步定胜负：先数清目标棋块的气。"}
              {puzzle.kind === "escape" && "让被围的棋子获得更多呼吸空间。"}
              {puzzle.kind === "eyes" && "找到能同时照顾两边空间的那一个点。"}
              {puzzle.kind === "seq" && "多手题：跟着对方的最强应手，一步步达成目标。"}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
