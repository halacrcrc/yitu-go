// 战绩曲线图（纯 SVG 折线图，无第三方依赖）
import { useMemo, useState } from "react";
import type { RatingPoint } from "../api";
import { rankFromRating } from "../content";

export function RatingChart({ history }: { history: RatingPoint[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const chart = useMemo(() => {
    const pts = history.slice(-60); // 最多展示最近 60 个点
    const W = 640;
    const H = 220;
    const padL = 44;
    const padR = 14;
    const padT = 14;
    const padB = 26;
    if (pts.length === 0) return null;
    const ratings = pts.map((p) => p.rating);
    let min = Math.min(...ratings);
    let max = Math.max(...ratings);
    if (max - min < 80) {
      const mid = (max + min) / 2;
      min = mid - 40;
      max = mid + 40;
    }
    const pad = (max - min) * 0.08;
    min = Math.floor(min - pad);
    max = Math.ceil(max + pad);
    const x = (i: number) => padL + (pts.length === 1 ? (W - padL - padR) / 2 : (i / (pts.length - 1)) * (W - padL - padR));
    const y = (r: number) => padT + (1 - (r - min) / (max - min)) * (H - padT - padB);
    const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.rating).toFixed(1)}`).join(" ");
    const area = `${line} L${x(pts.length - 1).toFixed(1)},${H - padB} L${x(0).toFixed(1)},${H - padB} Z`;
    const gridRatings = [min, (min + max) / 2, max];
    return { pts, W, H, padL, padB, min, max, x, y, line, area, gridRatings };
  }, [history]);

  if (!chart) return <div className="muted small">暂无战绩数据</div>;
  const { pts, W, H, padL, padB, min, max, x, y, line, area, gridRatings } = chart;
  const up = pts.length > 1 && pts[pts.length - 1].rating >= pts[0].rating;

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg">
        <defs>
          <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={up ? "var(--accent)" : "var(--danger)"} stopOpacity="0.22" />
            <stop offset="1" stopColor={up ? "var(--accent)" : "var(--danger)"} stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridRatings.map((r) => (
          <g key={r}>
            <line x1={padL} y1={y(r)} x2={W - 14} y2={y(r)} stroke="var(--border)" strokeWidth="1" strokeDasharray="3 4" />
            <text x={padL - 8} y={y(r)} textAnchor="end" dominantBaseline="middle" fontSize="11" fill="var(--muted)">
              {r}
            </text>
          </g>
        ))}
        <path d={area} fill="url(#chartFill)" />
        <path d={line} fill="none" stroke={up ? "var(--accent)" : "var(--danger)"} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(p.rating)}
            r={hoverIdx === i ? 4.5 : i === pts.length - 1 ? 3.5 : 2.4}
            fill={p.won === true ? "var(--accent)" : p.won === false ? "var(--danger)" : "var(--muted)"}
            stroke="var(--bg)"
            strokeWidth="1.4"
          />
        ))}
        {/* 悬停热区 */}
        {pts.map((_, i) => (
          <rect
            key={`h${i}`}
            x={x(i) - (W - padL - 14) / Math.max(1, pts.length) / 2}
            y={0}
            width={(W - padL - 14) / Math.max(1, pts.length)}
            height={H - padB}
            fill="transparent"
            onMouseEnter={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx(null)}
          />
        ))}
        {hoverIdx !== null && (
          <g>
            <line x1={x(hoverIdx)} y1={10} x2={x(hoverIdx)} y2={H - padB} stroke="var(--muted)" strokeWidth="1" strokeDasharray="2 3" />
          </g>
        )}
      </svg>
      {hoverIdx !== null && pts[hoverIdx] && (
        <div className="chart-tip">
          <span>{pts[hoverIdx].date}</span>
          <b>{pts[hoverIdx].rating}</b>
          <em className={pts[hoverIdx].won === true ? "t-win" : pts[hoverIdx].won === false ? "t-lose" : ""}>
            {pts[hoverIdx].won === true ? "胜" : pts[hoverIdx].won === false ? "负" : "初始"} · {rankFromRating(pts[hoverIdx].rating)}
          </em>
        </div>
      )}
      <div className="chart-legend muted small">
        <span className="lg-dot" style={{ background: "var(--accent)" }} /> 胜
        <span className="lg-dot" style={{ background: "var(--danger)" }} /> 负
        <span className="lg-dot" style={{ background: "var(--muted)" }} /> 初始/其他
      </div>
    </div>
  );
}
