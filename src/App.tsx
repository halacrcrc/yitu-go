// 应用外壳：侧边导航（桌面可收缩 / 移动端 M3 抽屉）+ 视图切换 + 全局提示 + 主题
import { useEffect, useRef } from "react";
import { Icon } from "./components/ui";
import { useStore, type View } from "./store";
import { rankProgress } from "./content";
import { HomeView } from "./views/HomeView";
import { PlayView } from "./views/PlayView";
import { TutorialView } from "./views/TutorialView";
import { PuzzleView } from "./views/PuzzleView";
import { LibraryView } from "./views/LibraryView";
import { RecordsView } from "./views/RecordsView";
import { ProfileView } from "./views/ProfileView";

const NAV: { key: View; icon: string; label: string }[] = [
  { key: "home", icon: "home", label: "主页" },
  { key: "play", icon: "play", label: "对弈" },
  { key: "tutorial", icon: "book", label: "教程" },
  { key: "puzzle", icon: "puzzle", label: "死活题" },
  { key: "library", icon: "target", label: "定式库" },
  { key: "records", icon: "records", label: "棋谱库" },
  { key: "profile", icon: "user", label: "我的" },
];

function isMobile() {
  return window.matchMedia("(max-width: 860px)").matches;
}

export function App() {
  const {
    view,
    setView,
    loadProfile,
    profile,
    toast,
    game,
    collapsed,
    toggleCollapsed,
    drawerOpen,
    setDrawerOpen,
    toggleDrawer,
  } = useStore();

  // 启动时先应用缓存主题，避免闪烁
  useEffect(() => {
    const cached = localStorage.getItem("yitu_theme");
    if (cached) document.documentElement.dataset.theme = cached;
    void loadProfile();
  }, []);

  // 移动端：左边缘右滑打开抽屉、抽屉内左滑关闭
  const touch = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      touch.current = { x: t.clientX, y: t.clientY };
    };
    const onEnd = (e: TouchEvent) => {
      const start = touch.current;
      touch.current = null;
      if (!start) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = Math.abs(t.clientY - start.y);
      if (dy > 80) return;
      if (!drawerOpen && start.x <= 28 && dx >= 56) setDrawerOpen(true);
      else if (drawerOpen && start.x <= 280 && dx <= -56) setDrawerOpen(false);
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchend", onEnd);
    };
  }, [drawerOpen, setDrawerOpen]);

  const onNav = (v: View) => {
    setView(v);
    if (isMobile()) setDrawerOpen(false);
  };

  const drawerOpenCls = isMobile() && drawerOpen ? " drawer-open" : "";
  // collapsed 是桌面收缩概念，移动端始终忽略
  const collapsedCls = isMobile() ? "" : collapsed ? " collapsed" : "";

  return (
    <div className={`app${collapsedCls}${drawerOpenCls}`}>
      {isMobile() && drawerOpen && (
        <div className="drawer-mask" onClick={() => setDrawerOpen(false)} />
      )}

      <nav className="sidebar">
        <div className="sidebar-top">
          <button className="rail-toggle" onClick={toggleDrawer} title="菜单">
            <Icon name={drawerOpen ? "close" : "menu"} size={20} />
          </button>
          <div className="logo">
            <span className="logo-stone b" />
            <span className="logo-stone w" />
            <div>
              <b>弈途围棋</b>
              <small>YiTu Go</small>
            </div>
          </div>
          <button className="collapse-btn" onClick={toggleCollapsed} title={collapsed ? "展开侧边栏" : "收起侧边栏"}>
            <Icon name={collapsed ? "chevronRight" : "chevronLeft"} size={16} />
          </button>
        </div>

        {NAV.map((n) => (
          <button
            key={n.key}
            className={`nav-item${view === n.key ? " on" : ""}`}
            onClick={() => onNav(n.key)}
            title={!isMobile() && collapsed ? n.label : undefined}
          >
            <Icon name={n.icon} size={19} />
            <span>{n.label}</span>
            {n.key === "play" && game && game.phase === "playing" && <i className="nav-dot" />}
          </button>
        ))}

        <div className="sidebar-foot">
          {profile && (
            <button
              className="rank-chip"
              onClick={() => onNav("profile")}
              title={!isMobile() && collapsed ? `${rankProgress(profile.rating).rank} · ${profile.rating}` : undefined}
            >
              <Icon name="trophy" size={15} />
              <span>{rankProgress(profile.rating).rank}</span>
              <em>{profile.rating}</em>
            </button>
          )}
        </div>
      </nav>

      <main className="content">
        {view === "home" && <HomeView />}
        {view === "play" && <PlayView />}
        {view === "tutorial" && <TutorialView />}
        {view === "puzzle" && <PuzzleView />}
        {view === "library" && <LibraryView />}
        {view === "records" && <RecordsView />}
        {view === "profile" && <ProfileView />}
      </main>

      {toast && <div className={`toast toast-${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}
