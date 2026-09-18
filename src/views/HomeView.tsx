// 主页
import { useEffect } from "react";
import { useStore } from "../store";
import { Icon } from "../components/ui";
import { rankProgress, content } from "../content";
import { IS_TAURI } from "../api";

export function HomeView() {
  const { profile, autosaveInfo, setView, checkAutosave, clearAutosaveInfo, setGame } = useStore();

  useEffect(() => {
    void checkAutosave();
  }, []);

  const rp = profile ? rankProgress(profile.rating) : null;
  const tutorialsDone = profile?.tutorial_done.length ?? 0;
  const puzzlesSolved = profile?.puzzles_solved.length ?? 0;

  const onContinue = async () => {
    try {
      const g = await (await import("../api")).api.continueAutosave();
      setGame(g);
      clearAutosaveInfo();
      setView("play");
    } catch {
      void checkAutosave();
    }
  };

  return (
    <div className="home">
      <section className="hero card">
        <div className="hero-stones">
          <span className="hs hs-b" />
          <span className="hs hs-w" />
        </div>
        <div>
          <h1>
            弈途围棋 <span className="hero-sub">YiTu Go</span>
          </h1>
          <p className="hero-tag">从 30 级到职业段位，一步一步走上弈途</p>
          <div className="hero-actions">
            <button className="btn primary lg" onClick={() => setView("play")}>
              <Icon name="playSolid" size={18} /> 开始对弈
            </button>
            {autosaveInfo && (
              <button className="btn lg" onClick={onContinue}>
                <Icon name="play" size={18} /> 继续对局（{autosaveInfo.black} vs {autosaveInfo.white} · {autosaveInfo.moves}手）
              </button>
            )}
            <button className="btn lg" onClick={() => setView("tutorial")}>
              <Icon name="book" size={18} /> 新手教程
            </button>
          </div>
          {!IS_TAURI && <p className="browser-tip">浏览器演示模式：AI 与存档功能为简化版，完整体验请运行桌面版</p>}
        </div>
      </section>

      <div className="home-grid">
        <button className="entry card" onClick={() => setView("tutorial")}>
          <div className="entry-icon e-green"><Icon name="book" size={26} /></div>
          <div className="entry-info">
            <h3>新手教程</h3>
            <p>{tutorialsDone >= content.tutorials.length ? "已完成全部章节，可以开始实战了" : `互动式教学 · 已完成 ${tutorialsDone}/${content.tutorials.length} 章`}</p>
          </div>
          <div className="entry-bar">
            <div style={{ width: `${(tutorialsDone / content.tutorials.length) * 100}%` }} />
          </div>
        </button>

        <button className="entry card" onClick={() => setView("puzzle")}>
          <div className="entry-icon e-gold"><Icon name="puzzle" size={26} /></div>
          <div className="entry-info">
            <h3>死活题训练</h3>
            <p>吃子 · 手筋 · 死活 · 已解开 {puzzlesSolved}/{content.puzzles.length} 题</p>
          </div>
          <div className="entry-bar">
            <div style={{ width: `${(puzzlesSolved / content.puzzles.length) * 100}%` }} />
          </div>
        </button>

        <button className="entry card" onClick={() => setView("library")}>
          <div className="entry-icon e-blue"><Icon name="target" size={26} /></div>
          <div className="entry-info">
            <h3>定式库</h3>
            <p>布局流派与角部定式 · 逐步演示 {content.openings.length} 例</p>
          </div>
          <span className="entry-arrow"><Icon name="chevronRight" /></span>
        </button>

        <button className="entry card" onClick={() => setView("records")}>
          <div className="entry-icon e-blue"><Icon name="records" size={26} /></div>
          <div className="entry-info">
            <h3>棋谱库</h3>
            <p>回看历史对局 · 支持导入导出 SGF</p>
          </div>
          <span className="entry-arrow"><Icon name="chevronRight" /></span>
        </button>

        <button className="entry card" onClick={() => setView("profile")}>
          <div className="entry-icon e-purple"><Icon name="trophy" size={26} /></div>
          <div className="entry-info">
            <h3>我的段位</h3>
            <p>{rp ? `${rp.rank} · 等级分 ${profile!.rating}` : "—"} · 战绩 {profile?.wins ?? 0}胜 {profile?.losses ?? 0}负</p>
          </div>
          <span className="entry-arrow"><Icon name="chevronRight" /></span>
        </button>
      </div>

      <section className="card tips">
        <h3><Icon name="bulb" size={18} /> 新手小贴士</h3>
        <ul>
          <li>棋子在直线紧邻的空点上「呼吸」，这些空点叫<b>气</b>——气被堵光就被提走。</li>
          <li>一块棋做出<b>两只真眼</b>就能活；「直三」点中间可一手做眼/杀棋。</li>
          <li>布局记住六字诀：<b>金角、银边、草肚皮</b>。</li>
          <li>打劫提子后对方不能立刻回提，要先「寻劫材」。</li>
        </ul>
      </section>
    </div>
  );
}
