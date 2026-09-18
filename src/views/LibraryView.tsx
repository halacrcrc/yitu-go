// 定式库：布局与定式的逐步演示
import { useEffect, useMemo, useState } from "react";
import { Board } from "../components/Board";
import { Icon } from "../components/ui";
import { content, parsePrefixedMove, coordToPos, type OpeningEntry } from "../content";
import { TsEngine, BLACK } from "../engine";
import { coordName } from "../content";
import { useStore } from "../store";

export function LibraryView() {
  const [cat, setCat] = useState<"layout" | "joseki">("layout");
  const list = useMemo(() => content.openings.filter((o) => o.category === cat), [cat]);
  const [sel, setSel] = useState(0);
  const entry: OpeningEntry | undefined = list[Math.min(sel, list.length - 1)];

  useEffect(() => {
    setSel(0);
  }, [cat]);

  if (!entry) return null;
  return (
    <div className="library">
      <aside className="library-list">
        <h2><Icon name="target" size={20} /> 定式库</h2>
        <div className="tier-tabs">
          <button className={cat === "layout" ? "on" : ""} onClick={() => setCat("layout")}>布局</button>
          <button className={cat === "joseki" ? "on" : ""} onClick={() => setCat("joseki")}>定式</button>
        </div>
        <div className="muted small" style={{ padding: "0 4px 8px" }}>
          {cat === "layout" ? "全局骨架：占角、连片、大模样" : "角部标准手顺：理解每手的目的"}
        </div>
        <div className="puzzle-grid">
          {list.map((o, i) => (
            <button key={o.id} className={`puzzle-item${i === sel ? " on" : ""}`} onClick={() => setSel(i)}>
              <span className="p-title">{o.name}</span>
              <Icon name="chevronRight" size={14} className="p-check" />
            </button>
          ))}
        </div>
      </aside>

      {entry && <OpeningBoard key={entry.id} entry={entry} />}
    </div>
  );
}

function OpeningBoard({ entry }: { entry: OpeningEntry }) {
  const { profile } = useStore();
  const size = entry.size || 19;
  const total = entry.moves.length;
  const [cursor, setCursor] = useState(total);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setCursor(total);
    setPlaying(false);
  }, [entry.id]);

  const state = useMemo(() => {
    const e = new TsEngine(size);
    let last: number | null = null;
    const applied: { pos: number; side: number }[] = [];
    for (let i = 0; i < cursor && i < total; i++) {
      const { side, coord } = parsePrefixedMove(entry.moves[i]);
      const p = coordToPos(size, coord);
      e.turn = (side === 1 ? 1 : 2) as 1 | 2;
      e.play(p);
      applied.push({ pos: p, side });
      last = p;
    }
    return { engine: e, last, applied };
  }, [entry, cursor, size]);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setCursor((c) => {
        if (c >= total) {
          setPlaying(false);
          return c;
        }
        return c + 1;
      });
    }, 900);
    return () => clearInterval(t);
  }, [playing, total]);

  const step = (d: number) => {
    setPlaying(false);
    setCursor((c) => Math.max(0, Math.min(total, c + d)));
  };

  const curIdx = cursor - 1;
  const caption =
    cursor === 0
      ? "点击按钮逐步演示，或拖动进度条查看任意阶段。"
      : cursor >= total
        ? `演示完成 —— 这就是「${entry.name}」的完整形状。试着记住手顺与每一手的目的。`
        : `正在演示第 ${cursor} / ${total} 手……`;

  return (
    <section className="puzzle-main card">
      <div className="puzzle-head">
        <div>
          <h3>
            {entry.name}
            <span className="badge">{entry.category === "layout" ? "布局" : "定式"}</span>
          </h3>
          <p className="muted">{entry.intro}</p>
        </div>
        <span className="muted small">{cursor} / {total} 手</span>
      </div>

      <div className="puzzle-body">
        <div className="puzzle-board">
          <Board
            size={size}
            board={state.engine.board}
            lastMove={profile?.settings.show_last_move === false ? null : state.last}
            showCoords={profile?.settings.show_coords !== false}
            interactive={false}
          />
        </div>
        <div className="puzzle-side">
          <div className="task-msg ok">{caption || "点击按钮逐步演示，或拖动进度条查看任意阶段。"}</div>

          <div className="card replay-controls">
            <div className="row gap">
              <button className="icon-btn" onClick={() => step(-cursor)} title="回到开局"><Icon name="chevronFirst" /></button>
              <button className="icon-btn" onClick={() => step(-1)} title="上一手"><Icon name="chevronLeft" /></button>
              <button className="icon-btn" onClick={() => (cursor >= total ? null : setPlaying(!playing))} title="自动演示">
                <Icon name={playing ? "pause" : "playSolid"} />
              </button>
              <button className="icon-btn" onClick={() => step(1)} title="下一手"><Icon name="chevronRight" /></button>
              <button className="icon-btn" onClick={() => step(total - cursor)} title="跳到终形"><Icon name="chevronLast" /></button>
            </div>
            <input
              type="range"
              min={0}
              max={total}
              value={cursor}
              onChange={(e) => {
                setPlaying(false);
                setCursor(Number(e.target.value));
              }}
            />
            <div className="replay-pos muted small">
              {curIdx >= 0 && state.applied[curIdx]
                ? `第 ${cursor} 手 · ${state.applied[curIdx].side === BLACK ? "黑" : "白"} ${coordName(size, state.applied[curIdx].pos)}`
                : "开局"}
            </div>
          </div>

          <div className="card">
            <b style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, color: "var(--gold)" }}>
              <Icon name="bulb" size={15} /> 详解
            </b>
            {entry.detail.split("\n\n").map((p, i) => (
              <p key={i} className="text-body" style={{ fontSize: 13.5 }}>{p}</p>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
