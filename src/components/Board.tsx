// SVG 围棋盘组件
import { useMemo, useState } from "react";

export interface BoardMark {
  pos: number;
  kind: "hint" | "pending" | "target" | "forbidden";
}

interface BoardProps {
  size: number;
  board: number[];
  lastMove?: number | null;
  territory?: number[] | null;
  dead?: number[];
  marks?: BoardMark[];
  showCoords?: boolean;
  interactive?: boolean;
  playSide?: number; // 悬停幽灵子的颜色（1黑 2白）
  onPosClick?: (pos: number) => void;
  compact?: boolean;
}

const COLS = "ABCDEFGHJKLMNOPQRST";

export function Board({
  size,
  board,
  lastMove,
  territory,
  dead,
  marks,
  showCoords = true,
  interactive = false,
  playSide = 1,
  onPosClick,
  compact = false,
}: BoardProps) {
  const [hover, setHover] = useState<number | null>(null);
  const cell = compact ? 40 : 40;
  const margin = showCoords ? 30 : 16;
  const span = (size - 1) * cell;
  const dim = span + margin * 2;
  const r = cell * 0.47;

  const deadSet = useMemo(() => new Set(dead ?? []), [dead]);
  const marksMap = useMemo(() => {
    const m = new Map<number, BoardMark>();
    for (const mk of marks ?? []) m.set(mk.pos, mk);
    return m;
  }, [marks]);

  const starPoints = useMemo(() => {
    if (size < 7) return [];
    const edge = size >= 13 ? 3 : 2;
    const far = size - 1 - edge;
    const mid = Math.floor((size - 1) / 2);
    if (size === 9) return [[2, 2], [6, 2], [2, 6], [6, 6], [4, 4]];
    if (size === 13) return [[3, 3], [9, 3], [3, 9], [9, 9], [6, 6], [3, 6], [9, 6], [6, 3], [6, 9]];
    const pts = [[edge, edge], [far, far], [far, edge], [edge, far], [edge, mid], [far, mid], [mid, edge], [mid, far], [mid, mid]];
    return pts as number[][];
  }, [size]);

  const xy = (pos: number) => {
    const x = pos % size;
    const y = Math.floor(pos / size);
    return [margin + x * cell, margin + y * cell] as const;
  };

  const handleClick = (pos: number) => {
    if (interactive && onPosClick) onPosClick(pos);
  };

  return (
    <div className={`board-wrap${interactive ? " board-interactive" : ""}`}>
      <svg
        viewBox={`0 0 ${dim} ${dim}`}
        className="board-svg"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <radialGradient id="stoneB" cx="0.34" cy="0.28" r="0.95">
            <stop offset="0" stopColor="#9aa1a8" />
            <stop offset="0.18" stopColor="#5a6067" />
            <stop offset="0.45" stopColor="#2c2f34" />
            <stop offset="0.8" stopColor="#131417" />
            <stop offset="1" stopColor="#060708" />
          </radialGradient>
          <radialGradient id="stoneW" cx="0.34" cy="0.28" r="1">
            <stop offset="0" stopColor="#fffef9" />
            <stop offset="0.4" stopColor="#f5f1e4" />
            <stop offset="0.75" stopColor="#ded7c2" />
            <stop offset="0.94" stopColor="#b8ae93" />
            <stop offset="1" stopColor="#9c9176" />
          </radialGradient>
          <radialGradient id="stoneShine" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.85" />
            <stop offset="0.55" stopColor="#ffffff" stopOpacity="0.25" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="stoneShadow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#000000" stopOpacity="0.4" />
            <stop offset="0.7" stopColor="#000000" stopOpacity="0.22" />
            <stop offset="1" stopColor="#000000" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#e2b56b" />
            <stop offset="0.5" stopColor="#d9a95f" />
            <stop offset="1" stopColor="#cd9c52" />
          </linearGradient>
        </defs>

        {/* 棋盘木底 */}
        <rect
          x={margin - cell * 0.62}
          y={margin - cell * 0.62}
          width={span + cell * 1.24}
          height={span + cell * 1.24}
          rx={6}
          fill="url(#wood)"
          stroke="#a97f3f"
          strokeWidth="1.5"
        />
        {/* 网格线 */}
        {Array.from({ length: size }, (_, i) => {
          const p = margin + i * cell;
          return (
            <g key={i} stroke="#5e4318" strokeWidth={i === 0 || i === size - 1 ? 1.6 : 0.9}>
              <line x1={margin} y1={p} x2={margin + span} y2={p} />
              <line x1={p} y1={margin} x2={p} y2={margin + span} />
            </g>
          );
        })}
        {/* 星位 */}
        {starPoints.map(([sx, sy], i) => (
          <circle key={i} cx={margin + sx * cell} cy={margin + sy * cell} r={cell * 0.09} fill="#5e4318" />
        ))}

        {/* 领地显示 */}
        {territory?.map((t, pos) => {
          if (t === 0 || board[pos] !== 0) return null;
          const [cx, cy] = xy(pos);
          return (
            <rect
              key={pos}
              x={cx - cell * 0.16}
              y={cy - cell * 0.16}
              width={cell * 0.32}
              height={cell * 0.32}
              rx={2}
              fill={t === 1 ? "#111" : "#f5f2e8"}
              stroke="#00000022"
              strokeWidth="0.5"
            />
          );
        })}

        {/* 棋子（多层渐变 + 高光 + 接触阴影，模拟蛤碁石/黑曜石质感） */}
        {board.map((c, pos) => {
          if (!c) return null;
          const [cx, cy] = xy(pos);
          const isLast = lastMove === pos;
          const isDead = deadSet.has(pos);
          const rShineX = cx - r * 0.34;
          const rShineY = cy - r * 0.42;
          return (
            <g key={pos} className={isLast ? "stone-last" : undefined} opacity={isDead ? 0.42 : 1}>
              <ellipse cx={cx + r * 0.09} cy={cy + r * 0.16} rx={r * 1.02} ry={r * 0.92} fill="url(#stoneShadow)" />
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill={c === 1 ? "url(#stoneB)" : "url(#stoneW)"}
                stroke={c === 1 ? "#000000cc" : "#00000066"}
                strokeWidth="0.9"
              />
              {/* 主高光 */}
              <ellipse
                cx={rShineX}
                cy={rShineY}
                rx={c === 1 ? r * 0.5 : r * 0.62}
                ry={c === 1 ? r * 0.36 : r * 0.46}
                fill="url(#stoneShine)"
                opacity={c === 1 ? 0.5 : 0.9}
                transform={`rotate(-28 ${rShineX} ${rShineY})`}
              />
              {/* 底部反光 */}
              <ellipse
                cx={cx + r * 0.22}
                cy={cy + r * 0.52}
                rx={r * 0.42}
                ry={r * 0.16}
                fill="#ffffff"
                opacity={c === 1 ? 0.08 : 0.3}
              />
              {isLast && (
                <circle cx={cx} cy={cy} r={r * 0.38} fill="none" stroke={c === 1 ? "#e8e4d8" : "#2b2b2b"} strokeWidth="2" />
              )}
              {isDead && (
                <g stroke="#d05555" strokeWidth="2.4" strokeLinecap="round">
                  <line x1={cx - r * 0.45} y1={cy - r * 0.45} x2={cx + r * 0.45} y2={cy + r * 0.45} />
                  <line x1={cx + r * 0.45} y1={cy - r * 0.45} x2={cx - r * 0.45} y2={cy + r * 0.45} />
                </g>
              )}
            </g>
          );
        })}

        {/* 标记 */}
        {[...marksMap.entries()].map(([pos, mk]) => {
          const [cx, cy] = xy(pos);
          if (mk.kind === "hint") {
            return <circle key={`m${pos}`} className="mark-hint" cx={cx} cy={cy} r={r * 0.9} fill="none" stroke="#ffd54d" strokeWidth="3" />;
          }
          if (mk.kind === "pending") {
            return <circle key={`m${pos}`} cx={cx} cy={cy} r={r * 0.92} fill="none" stroke="#4cc38a" strokeWidth="2.5" strokeDasharray="4 3" />;
          }
          if (mk.kind === "forbidden") {
            return <circle key={`m${pos}`} cx={cx} cy={cy} r={r * 0.9} fill="none" stroke="#e06c6c" strokeWidth="3" />;
          }
          return (
            <circle key={`m${pos}`} cx={cx} cy={cy} r={r * 0.5} fill="none" stroke="#4cc38a" strokeWidth="2.5" />
          );
        })}

        {/* 悬停幽灵子 */}
        {interactive && hover !== null && board[hover] === 0 && (
          (() => {
            const [cx, cy] = xy(hover);
            return <circle cx={cx} cy={cy} r={r} fill={playSide === 1 ? "#1a1c1e" : "#f7f5ee"} opacity={0.42} />;
          })()
        )}

        {/* 坐标（置于棋盘边距带内，与网格线对齐） */}
        {showCoords && (
          <g fill="#8d7a52" fontSize={Math.max(9.5, cell * 0.28)} textAnchor="middle" fontFamily="inherit">
            {Array.from({ length: size }, (_, i) => (
              <text key={`cl${i}`} x={margin + i * cell} y={margin * 0.58} dominantBaseline="central">
                {COLS[i]}
              </text>
            ))}
            {Array.from({ length: size }, (_, i) => (
              <text key={`rn${i}`} x={margin * 0.58} y={margin + i * cell} dominantBaseline="central">
                {size - i}
              </text>
            ))}
          </g>
        )}

        {/* 点击热区 */}
        {Array.from({ length: size * size }, (_, pos) => {
          const [cx, cy] = xy(pos);
          return (
            <rect
              key={`h${pos}`}
              x={cx - cell / 2}
              y={cy - cell / 2}
              width={cell}
              height={cell}
              fill="transparent"
              onMouseEnter={() => setHover(pos)}
              onClick={() => handleClick(pos)}
              style={{ cursor: interactive && board[pos] === 0 ? "pointer" : "default" }}
            />
          );
        })}
      </svg>
    </div>
  );
}
