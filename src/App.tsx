// ── App shell: routing + chrome ─────────────────────────────────────

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { AppProvider, useApp } from "./state/store";
import { BottomNav, SideNav, Toasts, TopBar } from "./components/chrome";
import Home from "./views/Home";
import Explore from "./views/Explore";
import { CategoriesHome, CategoryView } from "./views/Categories";
import Saved from "./views/Saved";
import Settings from "./views/Settings";
import VideoDetails from "./views/VideoDetails";
import type { Route } from "./types";

// Dev-only request inspector. Guarded by the DEV constant so the chunk
// is never requested — and the import is eliminated — in production.
const DevInspector = import.meta.env.DEV
  ? lazy(() => import("./components/DevRequestInspector"))
  : null;

function routeKey(r: Route): string {
  return r.view + ("id" in r ? `:${r.id}` : "");
}

const VIEW_TITLES: Record<Route["view"], string> = {
  home: "Leverage — Signal Learning Feed",
  explore: "Explore — Leverage",
  categories: "Categories — Leverage",
  category: "Category — Leverage",
  saved: "Saved — Leverage",
  settings: "Settings — Leverage",
  video: "Video — Leverage",
};

function Shell() {
  const app = useApp();
  const { state } = app;
  const r = state.route;
  const [updateReady, setUpdateReady] = useState(false);
  const poppedRef = useRef(false);

  useEffect(() => {
    const onUpdate = () => setUpdateReady(true);
    window.addEventListener("lv:sw-update", onUpdate);
    return () => window.removeEventListener("lv:sw-update", onUpdate);
  }, []);

  // Per-view document title.
  useEffect(() => {
    document.title = VIEW_TITLES[r.view] ?? "Leverage";
  }, [r.view]);

  // Android/browser hardware-back support: keep a history entry per
  // in-app navigation; a consumer popping it routes back in-app.
  useEffect(() => {
    const onPop = () => {
      poppedRef.current = true;
      app.goBack();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (poppedRef.current) {
      poppedRef.current = false;
      return;
    }
    try {
      window.history.pushState({ lv: routeKey(r) }, "");
    } catch {
      /* sandboxed environments — ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.route]);

  return (
    <div className="flex min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <SideNav />
      <div className="min-w-0 flex-1">
        <TopBar />
        <div key={routeKey(r)} className="fadein">
          {r.view === "home" && <Home />}
          {r.view === "explore" && <Explore />}
          {r.view === "categories" && <CategoriesHome />}
          {r.view === "category" && <CategoryView id={r.id} />}
          {r.view === "saved" && <Saved />}
          {r.view === "settings" && <Settings />}
          {r.view === "video" && <VideoDetails id={r.id} />}
        </div>
      </div>
      <BottomNav />
      <Toasts />
      {DevInspector && (
        <Suspense fallback={null}>
          <DevInspector />
        </Suspense>
      )}
      {updateReady && (
        <button
          className="btn toast-in fixed bottom-[78px] left-1/2 z-50 -translate-x-1/2 shadow-[var(--shadow)] lg:bottom-8"
          onClick={() => {
            navigator.serviceWorker?.getRegistration().then((reg) => {
              reg?.waiting?.postMessage({ type: "SKIP_WAITING" });
            });
            let reloaded = false;
            navigator.serviceWorker?.addEventListener("controllerchange", () => {
              if (reloaded) return;
              reloaded = true;
              location.reload();
            });
          }}
        >
          New version available — tap to update
        </button>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
