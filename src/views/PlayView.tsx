// 对局页：新对局配置 + 对弈界面
import { useCallback, useEffect, useMemo, useState } from "react";
import { Board, type BoardMark } from "../components/Board";
import { Icon, Modal } from "../components/ui";
import { api, IS_TAURI, type AiCapability, type GameStateDto, type NewGameReq } from "../api";
import { content, coordName } from "../content";
import { doPlayMove, useStore } from "../store";

const KOMI: Record<number, number> = { 9: 5.5, 13: 6.5, 19: 7.5 };

export function PlayView() {
  const { game, setGame, profile, thinking, setThinking, showToast, loadProfile, setView, loadRecords, checkAutosave } = useStore();
  const [showNewGame, setShowNewGame] = useState(false);
  const [pending, setPending] = useState<number | null>(null);
  const [hintPos, setHintPos] = useState<number | null>(null);
  const [confirmResign, setConfirmResign] = useState(false);
  const [scoringModalOpen, setScoringModalOpen] = useState(false);
  const [aiCap, setAiCap] = useState<AiCapability | null>(null);

  useEffect(() => {
    void api.aiStatus().then(setAiCap);
  }, []);

  // 无对局时打开新对局弹窗
  useEffect(() => {
    if (!game) setShowNewGame(true);
  }, [game]);

  // 进入数子阶段时自动弹出数子弹窗
  useEffect(() => {
    if (game?.phase === "scoring") setScoringModalOpen(true);
    else setScoringModalOpen(false);
  }, [game?.phase]);

  // AI 行棋触发
  useEffect(() => {
    if (!game || game.phase !== "playing" || thinking) return;
    const aiToMove = game.turn === 1 ? game.black.is_ai : game.white.is_ai;
    if (!aiToMove) return;
    let cancelled = false;
    (async () => {
      setThinking(true);
      try {
        const g = await api.aiMove();
        if (!cancelled) setGame(g);
      } catch (e: any) {
        if (!cancelled) showToast(String(e?.message ?? e), "error");
      } finally {
        if (!cancelled) setThinking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [game?.move_number, game?.phase, game?.turn]);

  const onEnd = useCallback(() => {
    void loadProfile();
    void loadRecords();
    void checkAutosave();
  }, [game?.phase]);

  useEffect(() => {
    if (game?.phase === "ended") onEnd();
  }, [game?.phase]);

  const humanTurn = useMemo(() => {
    if (!game || game.phase !== "playing") return false;
    return !(game.turn === 1 ? game.black.is_ai : game.white.is_ai);
  }, [game]);

  const clickPos = async (pos: number) => {
    if (!game) return;
    if (game.phase === "scoring") {
      try {
        setGame(await api.toggleDead(pos));
      } catch (e: any) {
        showToast(String(e?.message ?? e), "error");
      }
      return;
    }
    if (game.phase !== "playing" || !humanTurn) return;
    if (profile?.settings.confirm_move && pending !== pos) {
      setPending(pos);
      return;
    }
    setPending(null);
    await doPlayMove(pos);
  };

  const onPass = async () => {
    try {
      const g = await api.passTurn();
      setGame(g);
      if (g.phase === "scoring") showToast("双方连续停一手，进入数子阶段：点击棋子可标记死子", "success");
      else showToast("已停一手，等待对方", "info");
    } catch (e: any) {
      showToast(String(e?.message ?? e), "error");
    }
  };

  const onUndo = async () => {
    try {
      setGame(await api.undoMove());
      setPending(null);
    } catch (e: any) {
      showToast(String(e?.message ?? e), "error");
    }
  };

  const onHint = async () => {
    try {
      const p = await api.hint();
      if (p === null || p === undefined) {
        showToast("没有可用的提示", "info");
        return;
      }
      setHintPos(p);
      setTimeout(() => setHintPos(null), 2600);
    } catch (e: any) {
      showToast(String(e?.message ?? e), "error");
    }
  };

  const onScoring = async () => {
    try {
      const g = await api.enterScoring();
      setGame(g);
    } catch (e: any) {
      showToast(String(e?.message ?? e), "error");
    }
  };

  const onResume = async () => {
    try {
      setGame(await api.resumeScoring());
    } catch (e: any) {
      showToast(String(e?.message ?? e), "error");
    }
  };

  const onConfirmScore = async () => {
    try {
      const g = await api.confirmResult();
      setGame(g);
      if (g.result) showToast(`终局：${g.result}`, "success");
    } catch (e: any) {
      showToast(String(e?.message ?? e), "error");
    }
  };

  const onResign = async () => {
    setConfirmResign(false);
    if (!game) return;
    const side: "black" | "white" =
      game.black.is_ai && !game.white.is_ai ? "white" : game.white.is_ai && !game.black.is_ai ? "black" : game.turn === 1 ? "black" : "white";
    try {
      setGame(await api.resign(side));
      showToast("已认输", "info");
    } catch (e: any) {
      showToast(String(e?.message ?? e), "error");
    }
  };

  const marks: BoardMark[] = [];
  if (pending !== null) marks.push({ pos: pending, kind: "pending" });
  if (hintPos !== null) marks.push({ pos: hintPos, kind: "hint" });

  // 数子阶段实时比分预览（中国规则：活子 + 归属空点，死子点归对方地）
  const liveScore = useMemo(() => {
    if (!game || game.phase !== "scoring") return null;
    const deadSet = new Set(game.dead);
    let b = 0;
    let w = game.komi;
    for (let i = 0; i < game.board.length; i++) {
      const stone = game.board[i];
      if (deadSet.has(i)) {
        const t = game.territory?.[i] ?? 0;
        if (t === 1) b++;
        else if (t === 2) w++;
      } else if (stone === 1) b++;
      else if (stone === 2) w++;
      else {
        const t = game.territory?.[i] ?? 0;
        if (t === 1) b++;
        else if (t === 2) w++;
      }
    }
    return { b, w };
  }, [game]);

  if (!game) {
    return (
      <div className="play-empty">
        <NewGameModal open={showNewGame} onClose={() => setShowNewGame(false)} canClose />
        <div className="card empty-state play-empty-card">
          <div className="empty-stones">
            <span className="hs hs-b" />
            <span className="hs hs-w" />
          </div>
          <h3>开始一局棋</h3>
          <p className="muted">
            与 8 级 AI 对战或双人同屏对弈，9/13/19 路棋盘任选。
            <br />
            对局进度自动保存，随时可以继续。
          </p>
          <button className="btn primary lg" onClick={() => setShowNewGame(true)}>
            <Icon name="playSolid" size={18} /> 开始新对局
          </button>
        </div>
      </div>
    );
  }

  const showTerritory = game.phase !== "playing" || profile?.settings.show_territory;
  const blackToMove = game.turn === 1;

  return (
    <div className="play">
      <div className="play-board">
        {game.phase === "scoring" && (
          <div className="scoring-banner">
            <Icon name="target" size={16} /> 数子阶段 · 点击棋子标记死子
          </div>
        )}
        <Board
          size={game.size}
          board={game.board}
          lastMove={profile?.settings.show_last_move === false ? null : game.last_move}
          territory={showTerritory ? game.territory : null}
          dead={game.dead}
          marks={marks}
          showCoords={profile?.settings.show_coords !== false}
          interactive={game.phase !== "ended"}
          playSide={game.turn}
          onPosClick={clickPos}
        />
      </div>

      <aside className="play-side">
        <PlayerCard
          name={game.white.name}
          rank={game.white.rank}
          color="white"
          captures={game.captures[1]}
          active={blackToMove === false && game.phase === "playing"}
          thinking={thinking && !blackToMove && game.phase === "playing" && game.white.is_ai}
        />
        <PlayerCard
          name={game.black.name}
          rank={game.black.rank}
          color="black"
          captures={game.captures[0]}
          active={blackToMove && game.phase === "playing"}
          thinking={thinking && blackToMove && game.phase === "playing" && game.black.is_ai}
        />

        <div className="card game-meta">
          <span>第 {game.move_number} 手</span>
          <span>·</span>
          <span>{game.size}路</span>
          <span>·</span>
          <span>贴 {game.komi} 目</span>
          {game.handicap >= 2 && <span className="badge">让{game.handicap}子</span>}
          {game.rated && <span className="badge badge-green">计入段位</span>}
          {aiCap && (
            <span className="badge" title={aiCap.human_sl ? "已加载人类风格模型" : ""}>
              {aiCap.name === "katago" ? `KataGo·${aiCap.backend}` : "内置 AI"}
            </span>
          )}
        </div>

        {game.phase === "ended" ? (
          <div className="card result-card">
            <div className="result-title">
              <Icon name="trophy" size={20} /> 对局结束
            </div>
            <div className="result-text">{game.result ?? "—"}</div>
            {game.black_score !== null && (
              <div className="result-detail">
                黑 {game.black_score} — 白 {game.white_score}（含贴目）
              </div>
            )}
            <div className="row gap">
              <button className="btn primary" onClick={() => setShowNewGame(true)}>再来一局</button>
              <button className="btn" onClick={() => { void loadRecords(); setView("records"); }}>查看棋谱</button>
            </div>
          </div>
        ) : game.phase === "scoring" ? (
          <div className="card scoring-side">
            <div className="score-preview">
              <div className="sp-side">
                <span className="stone-dot black small" />
                <b>{liveScore ? liveScore.b.toFixed(1) : "—"}</b>
              </div>
              <span className="sp-vs">:</span>
              <div className="sp-side">
                <b>{liveScore ? liveScore.w.toFixed(1) : "—"}</b>
                <span className="stone-dot white small" />
              </div>
            </div>
            <p className="muted small" style={{ textAlign: "center" }}>黑 : 白（白含贴 {game.komi} 目）</p>
            <button className="btn primary pill" style={{ width: "100%", justifyContent: "center" }} onClick={() => setScoringModalOpen(true)}>
              <Icon name="check" size={16} /> 完成数子
            </button>
          </div>
        ) : (
          <div className="card controls">
            <div className="row gap wrap">
              <button className="btn" onClick={onPass} disabled={!humanTurn || thinking}><Icon name="pass" size={16} /> 停一手</button>
              <button className="btn" onClick={onUndo} disabled={!game.can_undo || thinking}><Icon name="undo" size={16} /> 悔棋</button>
              <button className="btn" onClick={onHint} disabled={!humanTurn || thinking}><Icon name="bulb" size={16} /> 提示</button>
            </div>
            <div className="row gap wrap">
              <button className="btn" onClick={onScoring} disabled={!humanTurn || thinking}><Icon name="target" size={16} /> 申请数子</button>
              <button className="btn danger" onClick={() => setConfirmResign(true)} disabled={thinking}><Icon name="flag" size={16} /> 认输</button>
            </div>
            {profile?.settings.confirm_move && pending !== null && (
              <p className="pending-tip">已选 {coordName(game.size, pending)}，再点一次确认落子</p>
            )}
            {game.ko !== null && <p className="ko-tip">打劫中：{coordName(game.size, game.ko)} 处暂不能立即回提</p>}
          </div>
        )}

        <MoveList game={game} />
      </aside>

      <Modal open={confirmResign} title="确认认输？" onClose={() => setConfirmResign(false)} width={380}>
        <p style={{ marginBottom: 16 }}>认输后本局结束并计入战绩，确定吗？</p>
        <div className="row gap">
          <button className="btn danger" onClick={onResign}>确定认输</button>
          <button className="btn" onClick={() => setConfirmResign(false)}>再想想</button>
        </div>
      </Modal>

      <Modal open={scoringModalOpen && game.phase === "scoring"} title="数子 · 终局确认" onClose={() => setScoringModalOpen(false)} width={430}>
        <div className="scoring-modal">
          <div className="score-preview lg">
            <div className="sp-side">
              <span className="stone-dot black" />
              <div>
                <b>{liveScore ? liveScore.b.toFixed(1) : "—"}</b>
                <small>黑（子+地）</small>
              </div>
            </div>
            <span className="sp-vs">:</span>
            <div className="sp-side">
              <div>
                <b>{liveScore ? liveScore.w.toFixed(1) : "—"}</b>
                <small>白（含贴 {game.komi} 目）</small>
              </div>
              <span className="stone-dot white" />
            </div>
          </div>
          {liveScore && (
            <div className={`score-lead ${liveScore.b > liveScore.w ? "b" : "w"}`}>
              {liveScore.b === liveScore.w
                ? "双方持平（极罕见）"
                : `${liveScore.b > liveScore.w ? "黑" : "白"}领先 ${Math.abs(liveScore.b - liveScore.w).toFixed(1)} 目`}
            </div>
          )}
          <p className="muted small">
            点击棋盘上的棋子可切换整块「死子」标记（红叉为死子，其地归对方）。标记完成后确认终局；
            若还想继续下，可返回对局。
          </p>
          <div className="scoring-actions">
            <button className="btn primary pill" onClick={onConfirmScore}>
              <Icon name="check" size={16} /> 确认数子
            </button>
            <button className="btn pill" onClick={onResume}>返回对局</button>
            <button className="btn ghost pill" onClick={() => setScoringModalOpen(false)}>
              继续标记死子
            </button>
          </div>
        </div>
      </Modal>

      {game.phase === "scoring" && !scoringModalOpen && (
        <button className="scoring-fab" onClick={() => setScoringModalOpen(true)}>
          <Icon name="target" size={17} /> 完成数子{liveScore ? `（黑 ${liveScore.b.toFixed(0)} : 白 ${liveScore.w.toFixed(0)}）` : ""}
        </button>
      )}

      <NewGameModal open={showNewGame} onClose={() => setShowNewGame(false)} canClose />
    </div>
  );
}

function PlayerCard({ name, rank, color, captures, active, thinking }: { name: string; rank: string; color: "black" | "white"; captures: number; active: boolean; thinking: boolean }) {
  return (
    <div className={`card player-card${active ? " player-active" : ""}`}>
      <span className={`stone-dot ${color}`} />
      <div className="player-info">
        <div className="player-name">
          {name}
          {thinking && <span className="thinking-dots">思考中</span>}
        </div>
        <div className="player-rank">{rank} · 提子 {captures}</div>
      </div>
      {active && <span className="turn-dot" />}
    </div>
  );
}

function MoveList({ game }: { game: GameStateDto }) {
  const rows = useMemo(() => {
    const out: { no: number; b?: string; w?: string }[] = [];
    let no = 1;
    for (let i = 0; i < game.moves.length; i += 2) {
      const b = game.moves[i];
      const w = game.moves[i + 1];
      out.push({
        no,
        b: b?.pos !== null && b?.pos !== undefined ? coordName(game.size, b.pos) : "停",
        w: w ? (w.pos !== null ? coordName(game.size, w.pos) : "停") : "",
      });
      no++;
    }
    return out;
  }, [game.moves, game.size]);

  const listRef = useCallback((el: HTMLDivElement | null) => {
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  return (
    <div className="card movelist">
      <div className="movelist-head">手数记录（Sgf 风格坐标自下而上）</div>
      <div className="movelist-body" ref={listRef}>
        {rows.length === 0 && <div className="muted small">尚未落子</div>}
        {rows.map((r) => (
          <div key={r.no} className="movelist-row">
            <span className="m-no">{r.no}</span>
            <span className="m-b">{r.b}</span>
            <span className="m-w">{r.w}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function NewGameModal({ open, onClose, canClose }: { open: boolean; onClose: () => void; canClose: boolean }) {
  const { setGame, profile, showToast, clearAutosaveInfo } = useStore();
  const [mode, setMode] = useState<"ai" | "human">("ai");
  const [size, setSize] = useState(9);
  const [level, setLevel] = useState(2);
  const [color, setColor] = useState<"black" | "white">("black");
  const [handicap, setHandicap] = useState(0);
  const [rated, setRated] = useState(true);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      const req: NewGameReq = {
        size,
        komi: KOMI[size] ?? 7.5,
        handicap,
        ai_level: level,
        mode,
        player_color: color,
        rated: rated && mode === "ai" && handicap < 2,
      };
      clearAutosaveInfo();
      setGame(await api.newGame(req));
      showToast(mode === "ai" ? `对局开始：对手「${content.aiLevels[level - 1].name}」` : "双人对局开始", "success");
      onClose();
    } catch (e: any) {
      showToast(String(e?.message ?? e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="新对局" onClose={canClose ? onClose : () => {}} width={560}>
      <div className="form">
        <div className="form-row">
          <label>对局模式</label>
          <div className="seg">
            <button className={mode === "ai" ? "on" : ""} onClick={() => setMode("ai")}>对弈 AI</button>
            <button className={mode === "human" ? "on" : ""} onClick={() => setMode("human")}>双人对弈</button>
          </div>
        </div>

        {mode === "ai" && (
          <>
            <div className="form-row">
              <label>AI 棋力</label>
              <div className="level-grid">
                {content.aiLevels.map((l) => (
                  <button key={l.level} className={`level-card${level === l.level ? " on" : ""}`} onClick={() => setLevel(l.level)}>
                    <b>{l.name}</b>
                    <span>{l.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="form-row">
              <label>你的执子</label>
              <div className="seg">
                <button className={color === "black" ? "on" : ""} onClick={() => setColor("black")}>执黑先行</button>
                <button className={color === "white" ? "on" : ""} onClick={() => setColor("white")}>执白后行</button>
              </div>
            </div>
            <div className="form-row">
              <label>让子</label>
              <div className="seg seg-small">
                {[0, 2, 3, 4, 5, 6, 7, 8, 9].map((h) => (
                  <button key={h} className={handicap === h ? "on" : ""} onClick={() => setHandicap(h)}>
                    {h === 0 ? "无" : `让${h}`}
                  </button>
                ))}
              </div>
            </div>
            <div className="form-row">
              <label>计入段位</label>
              <label className="switch">
                <input type="checkbox" checked={rated && handicap < 2} disabled={handicap >= 2} onChange={(e) => setRated(e.target.checked)} />
                <span />
                <em>{rated && handicap < 2 ? "胜负将影响等级分" : handicap >= 2 ? "让子局不计入段位" : "不计入段位（练习局）"}</em>
              </label>
            </div>
          </>
        )}

        <div className="form-row">
          <label>棋盘</label>
          <div className="seg">
            {[9, 13, 19].map((s) => (
              <button key={s} className={size === s ? "on" : ""} onClick={() => setSize(s)}>
                {s}路{s === 9 ? "（新手推荐）" : s === 19 ? "（正式）" : ""}
              </button>
            ))}
          </div>
        </div>

        <div className="form-row muted small">
          贴目：{handicap >= 2 ? "0.5（让子局）" : `${KOMI[size]} 目`} · 规则：中国规则·数子法{IS_TAURI ? "" : " · 浏览器演示模式使用简化 AI"}
        </div>

        <div className="row gap end">
          {canClose && <button className="btn" onClick={onClose}>取消</button>}
          <button className="btn primary" disabled={busy} onClick={start}>
            {busy ? "开盘中…" : "开始对局"}
          </button>
        </div>
        {!profile && <p className="muted small">（档案加载中…）</p>}
      </div>
    </Modal>
  );
}
