// 棋谱库：历史对局列表 + 复盘 + SGF 导入导出
import { useEffect, useMemo, useRef, useState } from "react";
import { Board } from "../components/Board";
import { Icon, Modal } from "../components/ui";
import { api, IS_TAURI, buildSgfLocal, parseSgfLocal, type RecordData, type RecordMeta, type MoveAnalysis, type AiStatus } from "../api";
import { WinrateChart } from "../components/WinrateChart";
import { TsEngine, BLACK } from "../engine";
import { coordName } from "../content";
import { useStore } from "../store";

export function RecordsView() {
  const { records, loadRecords, showToast, setView } = useStore();
  const [detail, setDetail] = useState<RecordData | null>(null);
  const [confirmDel, setConfirmDel] = useState<RecordMeta | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadRecords();
  }, []);

  const onExport = async (rec: RecordData) => {
    try {
      if (IS_TAURI) {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const path = await save({
          defaultPath: `弈途围棋_${rec.meta.date.slice(0, 10)}_${rec.meta.black_name}vs${rec.meta.white_name}.sgf`,
          filters: [{ name: "SGF 棋谱", extensions: ["sgf"] }],
        });
        if (!path) return;
        await api.exportRecordSgf(rec.meta.id, path);
        showToast("已导出 SGF", "success");
      } else {
        await api.exportRecordSgf(rec.meta.id, "");
      }
    } catch (e: any) {
      showToast(String(e?.message ?? e), "error");
    }
  };

  const onImport = async (path: string) => {
    try {
      await api.importSgf(path);
      await loadRecords();
      showToast("导入成功", "success");
    } catch (e: any) {
      showToast(String(e?.message ?? e), "error");
    }
  };

  const onImportClick = async () => {
    if (IS_TAURI) {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const path = await open({
          multiple: false,
          filters: [{ name: "SGF 棋谱", extensions: ["sgf"] }],
        });
        if (typeof path === "string") await onImport(path);
      } catch (e: any) {
        showToast(String(e?.message ?? e), "error");
      }
    } else {
      fileInput.current?.click();
    }
  };

  const onLocalFile = async (f: File) => {
    try {
      const text = await f.text();
      const parsed = parseSgfLocal(text);
      if (!parsed) {
        showToast("无法解析该 SGF 文件", "error");
        return;
      }
      // 借助本地记录存储（浏览器模式）
      const { buildSgfLocal } = await import("../api");
      void buildSgfLocal;
      // 直接构造记录加入 localStorage
      const key = "yitu_records";
      const records = JSON.parse(localStorage.getItem(key) ?? "[]");
      const id = Date.now().toString(16) + Math.floor(Math.random() * 0xffffff).toString(16);
      const pad = (n: number) => String(n).padStart(2, "0");
      const now = new Date();
      records.unshift({
        meta: {
          id,
          date: parsed.dt || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
          size: parsed.size,
          komi: parsed.komi,
          result: parsed.re || "未知",
          black_name: parsed.pb,
          white_name: parsed.pw,
          moves: parsed.moves.length,
          reason: "导入",
        },
        handicap_pos: parsed.handicap_pos,
        handicap: parsed.handicap,
        history: parsed.moves,
        black_is_ai: false,
        white_is_ai: false,
        ai_level: 0,
        black_rank: "",
        white_rank: "",
        black_score: null,
        white_score: null,
      });
      localStorage.setItem(key, JSON.stringify(records));
      await loadRecords();
      showToast("导入成功", "success");
    } catch (e: any) {
      showToast(String(e?.message ?? e), "error");
    }
  };

  const onDelete = async (m: RecordMeta) => {
    setConfirmDel(null);
    try {
      await api.deleteRecord(m.id);
      await loadRecords();
      setDetail(null);
      showToast("已删除", "info");
    } catch (e: any) {
      showToast(String(e?.message ?? e), "error");
    }
  };

  if (detail) {
    return <RecordReplay rec={detail} onBack={() => setDetail(null)} onExport={() => void onExport(detail)} onDelete={() => setConfirmDel(detail.meta)} />;
  }

  return (
    <div className="records">
      <div className="records-head">
        <h2><Icon name="records" size={20} /> 棋谱库</h2>
        <div className="row gap">
          <button className="btn" onClick={onImportClick}><Icon name="import" size={16} /> 导入 SGF</button>
          <button className="btn primary" onClick={() => setView("play")}><Icon name="plus" size={16} /> 去对弈</button>
        </div>
      </div>

      {records.length === 0 ? (
        <div className="card empty-state">
          <Icon name="records" size={40} />
          <p>还没有棋谱。完成一局对弈后，棋局会自动保存到这里。</p>
          <button className="btn primary" onClick={() => setView("play")}>开始第一局</button>
        </div>
      ) : (
        <div className="record-list">
          {records.map((m) => (
            <div key={m.id} className="card record-row" onClick={() => void api.getRecord(m.id).then(setDetail)}>
              <div className="rr-main">
                <div className="rr-players">
                  <span className="stone-dot black small" /> {m.black_name}
                  <span className="vs">对</span>
                  <span className="stone-dot white small" /> {m.white_name}
                </div>
                <div className="rr-sub muted small">
                  {m.date} · {m.size}路 · {m.moves}手 · {m.reason === "中盘" ? "中盘胜" : m.reason === "数子" ? "数子" : m.reason}
                </div>
              </div>
              <span className="rr-result">{m.result}</span>
              <div className="row gap-sm" onClick={(e) => e.stopPropagation()}>
                <button className="icon-btn" title="导出 SGF" onClick={() => void api.getRecord(m.id).then(onExport)}><Icon name="export" size={16} /></button>
                <button className="icon-btn" title="删除" onClick={() => setConfirmDel(m)}><Icon name="trash" size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept=".sgf"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onLocalFile(f);
          e.target.value = "";
        }}
      />

      <Modal open={!!confirmDel} title="删除棋谱" onClose={() => setConfirmDel(null)} width={380}>
        <p style={{ marginBottom: 16 }}>确定删除这盘棋的记录吗？此操作不可恢复。</p>
        <div className="row gap">
          <button className="btn danger" onClick={() => confirmDel && void onDelete(confirmDel)}>删除</button>
          <button className="btn" onClick={() => setConfirmDel(null)}>取消</button>
        </div>
      </Modal>
    </div>
  );
}

function RecordReplay({ rec, onBack, onExport, onDelete }: { rec: RecordData; onBack: () => void; onExport: () => void; onDelete: () => void }) {
  const { profile, showToast } = useStore();
  const [cursor, setCursor] = useState(rec.history.length);
  const [playing, setPlaying] = useState(false);
  const [analysis, setAnalysis] = useState<MoveAnalysis[] | null>(null);
  const [analyzing, setAnalyzing] = useState<{ done: number; total: number } | null>(null);
  const [aiCap, setAiCap] = useState<AiStatus | null>(null);

  useEffect(() => {
    void api.aiStatus().then(setAiCap);
  }, []);

  const state = useMemo(() => {
    const e = new TsEngine(rec.meta.size);
    for (const p of rec.handicap_pos) e.board[p] = BLACK;
    if (rec.handicap >= 2) e.turn = 2 as 1 | 2;
    let last: number | null = null;
    const capHistory: [number, number][] = [[0, 0]];
    for (let i = 0; i < cursor && i < rec.history.length; i++) {
      const m = rec.history[i];
      if (m.pos === null) {
        e.turn = (m.side === BLACK ? 2 : 1) as 1 | 2;
      } else {
        e.turn = m.side as 1 | 2;
        e.play(m.pos);
        last = m.pos;
      }
      capHistory.push([e.captures[0], e.captures[1]]);
    }
    return { engine: e, last, caps: capHistory[Math.min(cursor, capHistory.length - 1)] ?? [0, 0] };
  }, [rec, cursor]);

  const total = rec.history.length;

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
    }, 700);
    return () => clearInterval(t);
  }, [playing, total]);

  const step = (d: number) => {
    setPlaying(false);
    setCursor((c) => Math.max(0, Math.min(total, c + d)));
  };

  // AI 逐批分析整局（需要 KataGo）
  const runAnalysis = async () => {
    if (analyzing) return;
    setAnalysis(null);
    const batch = 12;
    const visits = 24;
    const collected: MoveAnalysis[] = [];
    setAnalyzing({ done: 0, total });
    try {
      for (let from = 0; from < total; from += batch) {
        const to = Math.min(total, from + batch);
        const part = await api.analyzeMoves({
          size: rec.meta.size,
          komi: rec.meta.komi,
          handicap: rec.handicap,
          handicap_pos: rec.handicap_pos,
          moves: rec.history.map((m) => ({ side: m.side, pos: m.pos })),
          from,
          to,
          visits,
        });
        collected.push(...part);
        setAnalysis([...collected]);
        setAnalyzing({ done: to, total });
      }
      showToast("AI 分析完成", "success");
    } catch (e: any) {
      showToast(String(e?.message ?? e), "error");
      if (collected.length === 0) setAnalyzing(null);
      else setAnalyzing(null);
    }
  };

  const engineName = aiCap?.engine ?? null;

  const currentMove = cursor > 0 && cursor <= total ? rec.history[cursor - 1] : null;
  const lastPos = currentMove?.pos ?? null;

  return (
    <div className="replay">
      <div className="records-head">
        <button className="btn" onClick={onBack}><Icon name="chevronLeft" size={16} /> 返回列表</button>
        <div className="row gap">
          <button className="btn" onClick={onExport}><Icon name="export" size={16} /> 导出 SGF</button>
          <button className="btn danger" onClick={onDelete}><Icon name="trash" size={16} /> 删除</button>
        </div>
      </div>

      <div className="replay-body">
        <div className="replay-board">
          <Board
            size={rec.meta.size}
            board={state.engine.board}
            lastMove={profile?.settings.show_last_move === false ? null : lastPos}
            showCoords={profile?.settings.show_coords !== false}
            interactive={false}
          />
        </div>

        <aside className="play-side">
          <div className="card">
            <div className="rr-players" style={{ marginBottom: 6 }}>
              <span className="stone-dot black small" /> {rec.meta.black_name}
              <span className="vs">对</span>
              <span className="stone-dot white small" /> {rec.meta.white_name}
            </div>
            <div className="muted small">{rec.meta.date} · {rec.meta.size}路 · 贴 {rec.meta.komi} 目</div>
            <div className="replay-caps">
              <span>黑提 {state.caps[0]}</span>
              <span>白提 {state.caps[1]}</span>
            </div>
            {rec.meta.result && <div className="replay-result">{rec.meta.result}</div>}
          </div>

          <div className="card replay-controls">
            <div className="row gap">
              <button className="icon-btn" onClick={() => step(-cursor)} title="回到开局"><Icon name="chevronFirst" /></button>
              <button className="icon-btn" onClick={() => step(-1)} title="上一手"><Icon name="chevronLeft" /></button>
              <button className="icon-btn" onClick={() => (cursor >= total ? null : setPlaying(!playing))} title="自动播放">
                <Icon name={playing ? "pause" : "playSolid"} />
              </button>
              <button className="icon-btn" onClick={() => step(1)} title="下一手"><Icon name="chevronRight" /></button>
              <button className="icon-btn" onClick={() => step(total - cursor)} title="跳到终局"><Icon name="chevronLast" /></button>
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
              第 {cursor} / {total} 手
              {lastPos !== null && <> · {currentMove?.side === BLACK ? "黑" : "白"} {coordName(rec.meta.size, lastPos)}</>}
            </div>
          </div>

          <div className="card">
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <b style={{ fontSize: 13.5 }}>AI 分析</b>
              {aiCap?.engine === "katago" ? (
                <span className="badge badge-green">KataGo</span>
              ) : (
                <span className="badge">需 KataGo</span>
              )}
            </div>
            {analyzing ? (
              <>
                <div className="rank-bar" style={{ marginBottom: 6 }}>
                  <div style={{ width: `${(analyzing.done / Math.max(1, analyzing.total)) * 100}%` }} />
                </div>
                <div className="muted small">分析中… {analyzing.done}/{analyzing.total} 手</div>
              </>
            ) : analysis ? (
              <WinrateChart
                analysis={analysis.map((a) => ({ n: a.move_number, wr: a.winrate_black, side: a.side }))}
                cursor={cursor}
                onSeek={(n) => { setPlaying(false); setCursor(n); }}
                height={130}
              />
            ) : (
              <>
                <p className="muted small" style={{ marginBottom: 8 }}>
                  {aiCap?.engine === "katago"
                    ? "用 KataGo 逐手评估整局，生成黑方胜率曲线并标出双方失误。"
                    : "需要 KataGo 引擎（设置页查看部署方式）。内置引擎不支持复盘分析。"}
                </p>
                <button className="btn primary small" style={{ width: "100%", justifyContent: "center" }} disabled={total === 0} onClick={() => void runAnalysis()}>
                  <Icon name="bulb" size={14} /> 开始 AI 分析
                </button>
              </>
            )}
          </div>

          <div className="card movelist">
            <div className="movelist-head">手数记录</div>
            <div className="movelist-body">
              {rec.history.map((m, i) => (
                <div key={i} className={`movelist-row${cursor === i + 1 ? " on" : ""}`} onClick={() => { setPlaying(false); setCursor(i + 1); }}>
                  <span className="m-no">{i + 1}</span>
                  <span className="m-b">{m.side === BLACK ? (m.pos !== null ? coordName(rec.meta.size, m.pos) : "停") : ""}</span>
                  <span className="m-w">{m.side !== BLACK ? (m.pos !== null ? coordName(rec.meta.size, m.pos) : "停") : ""}</span>
                </div>
              ))}
              {total === 0 && <div className="muted small">无落子记录</div>}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
