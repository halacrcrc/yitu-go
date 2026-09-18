// 全局状态（zustand）
import { create } from "zustand";
import { api, type GameStateDto, type Profile, type RecordMeta } from "./api";
import { playCapture, playError, playStone } from "./sound";

export type View = "home" | "play" | "tutorial" | "puzzle" | "library" | "records" | "profile";

const LS_SIDEBAR = "yitu_sidebar_collapsed";
const LS_THEME = "yitu_theme";

interface AppState {
  view: View;
  setView: (v: View) => void;

  collapsed: boolean;
  toggleCollapsed: () => void;

  profile: Profile | null;
  loadProfile: () => Promise<void>;
  saveProfile: (p: Profile) => Promise<void>;
  markTutorialDone: (chapterId: string) => Promise<void>;
  markPuzzleSolved: (puzzleId: string) => Promise<void>;

  game: GameStateDto | null;
  setGame: (g: GameStateDto | null) => void;
  refreshGame: () => Promise<void>;

  thinking: boolean;
  setThinking: (b: boolean) => void;

  records: RecordMeta[];
  loadRecords: () => Promise<void>;

  toast: { msg: string; kind: "info" | "error" | "success" } | null;
  showToast: (msg: string, kind?: "info" | "error" | "success") => void;

  autosaveInfo: { black: string; white: string; moves: number; size: number } | null;
  checkAutosave: () => Promise<void>;
  clearAutosaveInfo: () => void;
}

function applyTheme(theme: string | undefined) {
  const t = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = t;
  localStorage.setItem(LS_THEME, t);
}

export const useStore = create<AppState>((set, get) => ({
  view: "home",
  setView: (v) => set({ view: v }),

  collapsed: localStorage.getItem(LS_SIDEBAR) === "1",
  toggleCollapsed: () => {
    const next = !get().collapsed;
    localStorage.setItem(LS_SIDEBAR, next ? "1" : "0");
    set({ collapsed: next });
  },

  profile: null,
  loadProfile: async () => {
    try {
      const p = await api.getProfile();
      set({ profile: p });
      applyTheme(p.settings.theme);
    } catch (e) {
      console.error(e);
    }
  },
  saveProfile: async (p) => {
    set({ profile: p });
    applyTheme(p.settings.theme);
    try {
      await api.updateProfile(p);
    } catch (e) {
      console.error(e);
    }
  },
  markTutorialDone: async (chapterId) => {
    const p = get().profile;
    if (!p || p.tutorial_done.includes(chapterId)) return;
    const np = { ...p, tutorial_done: [...p.tutorial_done, chapterId] };
    await get().saveProfile(np);
  },
  markPuzzleSolved: async (puzzleId) => {
    const p = get().profile;
    if (!p || p.puzzles_solved.includes(puzzleId)) return;
    const np = { ...p, puzzles_solved: [...p.puzzles_solved, puzzleId] };
    await get().saveProfile(np);
  },

  game: null,
  setGame: (g) => set({ game: g }),
  refreshGame: async () => {
    try {
      const g = await api.getState();
      set({ game: g });
    } catch {
      /* 无对局 */
    }
  },

  thinking: false,
  setThinking: (b) => set({ thinking: b }),

  records: [],
  loadRecords: async () => {
    try {
      set({ records: await api.listRecords() });
    } catch (e) {
      console.error(e);
    }
  },

  toast: null,
  showToast: (msg, kind = "info") => {
    set({ toast: { msg, kind } });
    setTimeout(() => {
      if (get().toast?.msg === msg) set({ toast: null });
    }, 2600);
  },

  autosaveInfo: null,
  checkAutosave: async () => {
    try {
      const g = await api.getAutosave();
      set({
        autosaveInfo: g ? { black: g.black.name, white: g.white.name, moves: g.move_number, size: g.size } : null,
      });
    } catch {
      set({ autosaveInfo: null });
    }
  },
  clearAutosaveInfo: () => set({ autosaveInfo: null }),
}));

/** 落子（带错误提示与音效）；返回是否成功 */
export async function doPlayMove(pos: number): Promise<GameStateDto | null> {
  const s = useStore.getState();
  try {
    const g = await api.playMove(pos);
    const prev = s.game;
    if (prev) {
      const capDelta = g.captures[0] + g.captures[1] - (prev.captures[0] + prev.captures[1]);
      if (s.profile?.settings.sound) {
        if (capDelta > 0) playCapture();
        else playStone();
      }
    }
    s.setGame(g);
    return g;
  } catch (e: any) {
    if (s.profile?.settings.sound) playError();
    s.showToast(String(e).replace(/^.*error.*?:\s*/i, "").replace(/"/g, "") || "落子失败", "error");
    return null;
  }
}
