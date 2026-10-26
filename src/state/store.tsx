// ── Global app state ────────────────────────────────────────────────
// localStorage is the ONLY persistence layer (no backend, no database).
// Slices: settings / library are user data; pools + AI results are
// policy-bound caches with TTLs handled by src/lib/storage.ts.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useReducer,
} from "react";
import type { ReactNode } from "react";
import type {
  AiAnalysis, LibraryState, LoadState, Route, Settings, VideoItem, WatchEntry,
} from "../types";
import { KEYS, readJSON, writeJSON } from "../lib/storage";
import { isQuotaBlocked } from "../lib/youtube";
import { getCachedAnalysis, putAnalysis } from "../lib/aiService";

// ── Defaults ────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  ytKey: import.meta.env.VITE_YOUTUBE_API_KEY ?? "",
  geminiKey: "",
  aiEnabled: false,
  aiAutoAnalyze: false,
  aiDailyBudget: 20,
  minDurationSec: 600, // 10 minutes: long-form by default
  window: "30d",
  region: "US",
  language: "en",
  cats: ["wealth", "business", "ai", "markets", "health", "focus", "knowledge"],
  blockedChannels: [],
  blockedKeywords: [],
  onboardingDone: false,
};

export interface PoolSlice {
  state: LoadState;
  videos: VideoItem[];
  fetchedAt: number;
  fromCache: boolean;
  error?: string;
}

const EMPTY_POOL: PoolSlice = { state: "idle", videos: [], fetchedAt: 0, fromCache: false };

export interface Toast {
  id: number;
  msg: string;
  kind: "info" | "success" | "error";
}

interface AppState {
  settings: Settings;
  library: LibraryState;
  route: Route;
  history: Route[];
  pools: Record<string, PoolSlice>;
  ai: Record<string, AiAnalysis>;
  toasts: Toast[];
  online: boolean;
  quotaBlocked: boolean;
}

type Action =
  | { type: "settings/patch"; patch: Partial<Settings> }
  | { type: "nav"; route: Route }
  | { type: "nav/back" }
  | { type: "pool/loading"; scope: string }
  | { type: "pool/set"; scope: string; slice: PoolSlice }
  | { type: "pool/merge"; scope: string; videos: VideoItem[]; fetchedAt: number; fromCache: boolean }
  | { type: "ai/set"; analysis: AiAnalysis }
  | { type: "lib/upsert"; entry: WatchEntry }
  | { type: "lib/remove"; id: string }
  | { type: "lib/replace"; library: LibraryState }
  | { type: "toast"; toast: Toast }
  | { type: "toast/dismiss"; id: number }
  | { type: "online"; online: boolean }
  | { type: "quota"; blocked: boolean };

function reducer(state: AppState, a: Action): AppState {
  switch (a.type) {
    case "settings/patch":
      return { ...state, settings: { ...state.settings, ...a.patch } };
    case "nav": {
      if (a.route.view === state.route.view &&
          (a.route.view !== "video" && a.route.view !== "category")) return state;
      return { ...state, route: a.route, history: [...state.history.slice(-19), state.route] };
    }
    case "nav/back": {
      const prev = state.history[state.history.length - 1];
      if (!prev) return { ...state, route: { view: "home" }, history: [] };
      return { ...state, route: prev, history: state.history.slice(0, -1) };
    }
    case "pool/loading":
      return { ...state, pools: { ...state.pools, [a.scope]: { ...(state.pools[a.scope] ?? EMPTY_POOL), state: "loading", error: undefined } } };
    case "pool/set":
      return { ...state, pools: { ...state.pools, [a.scope]: a.slice } };
    case "pool/merge": {
      const cur = state.pools[a.scope] ?? EMPTY_POOL;
      const map = new Map(cur.videos.map((v) => [v.id, v]));
      for (const v of a.videos) map.set(v.id, v);
      return {
        ...state,
        pools: {
          ...state.pools,
          [a.scope]: { state: "success", videos: Array.from(map.values()), fetchedAt: a.fetchedAt, fromCache: a.fromCache },
        },
      };
    }
    case "ai/set":
      return { ...state, ai: { ...state.ai, [a.analysis.videoId]: a.analysis } };
    case "lib/upsert": {
      const prev = state.library.entries[a.entry.id];
      const merged: WatchEntry = prev
        ? { ...prev, ...a.entry, progress: Math.max(prev.progress, a.entry.progress), completed: prev.completed || a.entry.completed }
        : a.entry;
      return { ...state, library: { entries: { ...state.library.entries, [a.entry.id]: merged } } };
    }
    case "lib/remove": {
      const entries = { ...state.library.entries };
      delete entries[a.id];
      return { ...state, library: { entries } };
    }
    case "lib/replace":
      return { ...state, library: a.library };
    case "toast":
      return { ...state, toasts: [...state.toasts.slice(-2), a.toast] };
    case "toast/dismiss":
      return { ...state, toasts: state.toasts.filter((t) => t.id !== a.id) };
    case "online":
      return { ...state, online: a.online };
    case "quota":
      return { ...state, quotaBlocked: a.blocked };
    default:
      return state;
  }
}

// ── Context ─────────────────────────────────────────────────────────

interface AppApi {
  state: AppState;
  navigate: (r: Route) => void;
  goBack: () => void;
  patchSettings: (p: Partial<Settings>) => void;
  saveVideo: (v: VideoItem) => void;
  unsaveVideo: (id: string) => void;
  hideVideo: (v: VideoItem) => void;
  unhideVideo: (id: string) => void;
  setProgress: (v: VideoItem, fraction: number) => void;
  markCompleted: (v: VideoItem, completed: boolean) => void;
  blockChannel: (channelTitle: string) => void;
  pool: (scope: string) => PoolSlice;
  toast: (msg: string, kind?: Toast["kind"]) => void;
  getAi: (videoId: string) => AiAnalysis | null;
  setAi: (a: AiAnalysis) => void;
  exportData: () => string;
  importData: (json: string) => { ok: boolean; error?: string };
  dispatch: React.Dispatch<Action>;
}

const Ctx = createContext<AppApi | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, (): AppState => ({
    settings: { ...DEFAULT_SETTINGS, ...readJSON<Partial<Settings>>(KEYS.settings, {}) },
    library: readJSON<LibraryState>(KEYS.library, { entries: {} }),
    route: { view: "home" },
    history: [],
    pools: {},
    ai: {},
    toasts: [],
    online: typeof navigator === "undefined" ? true : navigator.onLine,
    quotaBlocked: false,
  }));

  // Persist user slices.
  useEffect(() => { writeJSON(KEYS.settings, state.settings); }, [state.settings]);
  useEffect(() => { writeJSON(KEYS.library, state.library); }, [state.library]);

  // Theme.
  useEffect(() => {
    const light = state.settings.theme === "light";
    document.documentElement.classList.toggle("dark", !light);
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", light ? "#fafafa" : "#000000");
  }, [state.settings.theme]);

  // Restore a persisted quota block on boot so we never fire doomed
  // requests after a reload. It self-expires at the Pacific-time reset.
  useEffect(() => {
    if (isQuotaBlocked()) dispatch({ type: "quota", blocked: true });
  }, []);

  // Online / offline.
  useEffect(() => {
    const on = () => dispatch({ type: "online", online: true });
    const off = () => dispatch({ type: "online", online: false });
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  const toast = useCallback((msg: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    dispatch({ type: "toast", toast: { id, msg, kind } });
    window.setTimeout(() => dispatch({ type: "toast/dismiss", id }), 3800);
  }, []);

  const entryOf = (v: VideoItem, patch: Partial<WatchEntry>): WatchEntry => ({
    id: v.id,
    progress: 0,
    completed: false,
    saved: false,
    hidden: false,
    updatedAt: Date.now(),
    title: v.title,
    channelTitle: v.channelTitle,
    thumb: v.thumbnails.medium ?? v.thumbnails.default ?? "",
    durationSec: v.durationSec,
    categoryIds: v.categoryIds,
    ...patch,
  });

  const api: AppApi = useMemo(() => ({
    state,
    dispatch,
    toast,
    navigate: (route) => {
      dispatch({ type: "nav", route });
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }));
    },
    goBack: () => dispatch({ type: "nav/back" }),
    patchSettings: (patch) => dispatch({ type: "settings/patch", patch }),
    pool: (scope) => state.pools[scope] ?? EMPTY_POOL,
    saveVideo: (v) => {
      dispatch({ type: "lib/upsert", entry: entryOf(v, { saved: true, hidden: false }) });
      toast("Saved to your library", "success");
    },
    unsaveVideo: (id) => {
      const e = state.library.entries[id];
      if (!e) return; // nothing saved — nothing to unset
      dispatch({ type: "lib/upsert", entry: { ...e, saved: false, updatedAt: Date.now() } });
      toast("Removed from saved");
    },
    hideVideo: (v) => {
      dispatch({ type: "lib/upsert", entry: entryOf(v, { hidden: true, saved: false }) });
      toast("Video hidden — undo in Saved → Hidden");
    },
    unhideVideo: (id) => {
      const e = state.library.entries[id];
      if (!e) return;
      dispatch({ type: "lib/upsert", entry: { ...e, hidden: false, updatedAt: Date.now() } });
    },
    setProgress: (v, fraction) => {
      const f = Math.min(1, Math.max(0, fraction));
      dispatch({
        type: "lib/upsert",
        entry: entryOf(v, { progress: f, completed: f >= 0.92 }),
      });
    },
    markCompleted: (v, completed) => {
      dispatch({ type: "lib/upsert", entry: entryOf(v, { completed, progress: completed ? 1 : 0 }) });
      toast(completed ? "Marked as completed" : "Marked as not started");
    },
    blockChannel: (channelTitle) => {
      const blockedChannels = Array.from(new Set([...state.settings.blockedChannels, channelTitle.toLowerCase()]));
      dispatch({ type: "settings/patch", patch: { blockedChannels } });
      toast(`Blocked channel “${channelTitle}”`);
    },
    // Cache-first, schema-validated, shared across every category.
    getAi: (videoId) => state.ai[videoId] ?? getCachedAnalysis(videoId),
    setAi: (analysis) => {
      putAnalysis(analysis);
      dispatch({ type: "ai/set", analysis });
    },
    exportData: () => {
      const { ytKey: _yt, geminiKey: _gm, ...safeSettings } = state.settings;
      return JSON.stringify(
        { app: "leverage", version: 1, exportedAt: new Date().toISOString(), settings: safeSettings, library: state.library },
        null, 2
      );
    },
    importData: (json) => {
      try {
        const data = JSON.parse(json);
        if (!data || typeof data !== "object") return { ok: false, error: "Not a JSON object" };
        if (data.settings && typeof data.settings === "object") {
          const s = data.settings as Partial<Settings>;
          const whitelist: (keyof Settings)[] = [
            "theme", "aiEnabled", "aiAutoAnalyze", "aiDailyBudget", "minDurationSec",
            "window", "region", "language", "cats", "blockedChannels", "blockedKeywords",
          ];
          const patch: Partial<Settings> = {};
          for (const k of whitelist) if (k in s) (patch as Record<string, unknown>)[k] = s[k];
          dispatch({ type: "settings/patch", patch });
        }
        if (data.library && typeof data.library === "object" && data.library.entries) {
          dispatch({ type: "lib/replace", library: data.library as LibraryState });
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Invalid JSON" };
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [state, toast]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useApp(): AppApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp outside provider");
  return ctx;
}
