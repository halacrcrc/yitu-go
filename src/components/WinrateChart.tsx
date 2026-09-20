// AI 胜率曲线（黑方视角，0~100%），点击可跳转手数
interface Point {
  n: number; // 手数（1-based）
  wr: number; // 黑胜率 0..1
  side?: number; // 落子方
}

export function WinrateChart({
  analysis,
  cursor,
  onSeek,
  height = 150,
}: {
  analysis: Point[];
  cursor: number;
  onSeek?: (n: number) => void;
  height?: number;
}) {
  if (analysis.length === 0) return null;
  const W = 620;
  const H = height;
  const padL = 38;
  const padR = 10;
  const padT = 10;
  const padB = 20;
  const maxN = analysis[analysis.length - 1].n;
  const x = (n: number) => padL + ((n - 1) / Math.max(1, maxN - 1)) * (W - padL - padR);
  const y = (wr: number) => padT + (1 - wr) * (H - padT - padB);
  const line = analysis.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.n).toFixed(1)},${y(p.wr).toFixed(1)}`).join(" ");

  const cur = analysis.find((p) => p.n === cursor) ?? analysis[analysis.length - 1];
  // 失误标记：落子方胜率（自身视角）跌幅 ≥10%
  const marks: { n: number; side: number; bad: boolean }[] = [];
  for (let i = 1; i < analysis.length; i++) {
    const a = analysis[i - 1];
    const b = analysis[i];
    const side = analysis[i].side ?? 1;
    const delta = side === 1 ? b.wr - a.wr : a.wr - b.wr; // 落子方自身视角的变化
    if (delta <= -0.1) marks.push({ n: b.n, side, bad: delta <= -0.2 });
  }

  return (
    <div className="wr-chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="wr-svg" onClick={undefined}>
        <defs>
          <linearGradient id="wrFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.25" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="var(--border)" strokeDasharray="3 4" />
            <text x={padL - 6} y={y(v)} textAnchor="end" dominantBaseline="middle" fontSize="10" fill="var(--muted)">
              {Math.round(v * 100)}
            </text>
          </g>
        ))}
        {/* 黑胜率区域（y 上 = 黑 100%） */}
        <path d={`${line} L${x(maxN).toFixed(1)},${y(0.5)} L${x(analysis[0].n).toFixed(1)},${y(0.5)} Z`} fill="url(#wrFill)" opacity="0.5" />
        <line x1={padL} y1={y(0.5)} x2={W - padR} y2={y(0.5)} stroke="var(--muted)" strokeWidth="1" opacity="0.6" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" />
        {marks.map((m) => (
          <circle
            key={m.n}
            cx={x(m.n)}
            cy={y(analysis.find((p) => p.n === m.n)!.wr)}
            r={m.bad ? 4 : 2.8}
            fill={m.side === 1 ? "#111" : "#f5f2e8"}
            stroke={m.bad ? "#e06c6c" : "var(--gold)"}
            strokeWidth="1.6"
          />
        ))}
        {cursor > 0 && (
          <g>
            <line x1={x(cursor)} y1={padT} x2={x(cursor)} y2={H - padB} stroke="var(--gold)" strokeWidth="1.5" />
          </g>
        )}
        <text x={padL} y={H - 6} fontSize="10" fill="var(--muted)">1</text>
        <text x={W - padR} y={H - 6} textAnchor="end" fontSize="10" fill="var(--muted)">{maxN}</text>
        {/* 点击跳转热区 */}
        {analysis.map((p) => (
          <rect
            key={`h${p.n}`}
            x={x(p.n) - (W - padL - padR) / Math.max(1, maxN) / 2}
            y={0}
            width={(W - padL - padR) / Math.max(1, maxN)}
            height={H - padB}
            fill="transparent"
            style={{ cursor: "pointer" }}
            onClick={() => onSeek?.(p.n)}
          />
        ))}
      </svg>
      <div className="wr-cursor muted small">
        第 {cur.n} 手 · 黑胜率 {Math.round(cur.wr * 100)}% · 目差 {cur.wr >= 0.5 ? "+" : ""}
        {((cur.wr - 0.5) * 2 * 30).toFixed(1)}（约）
      </div>
      <div className="wr-legend muted small">
        <span className="lg-dot" style={{ background: "#111", borderColor: "#e06c6c" }} /> 黑方失误
        <span className="lg-dot" style={{ background: "#f5f2e8", borderColor: "var(--gold)" }} /> 白方失误
        （跌 ≥10% 即标记，≥20% 为大失误）
      </div>
    </div>
  );
}
