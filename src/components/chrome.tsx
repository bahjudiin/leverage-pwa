// ── App chrome: header, desktop sidebar, mobile bottom nav, toasts ──

import {
  Bookmark, Compass, Home, LayoutGrid, Moon, SlidersHorizontal, Sun, TrendingUp, WifiOff,
} from "lucide-react";
import type { ReactNode } from "react";
import { useApp } from "../state/store";
import type { Route } from "../types";
import { getUsage } from "../lib/youtube";

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-[9px] border border-[var(--border-strong)] bg-[var(--accent)] text-[var(--accent-inv)]"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <TrendingUp size={size * 0.58} strokeWidth={2.6} />
    </span>
  );
}

const NAV: { view: Route["view"]; label: string; icon: typeof Home }[] = [
  { view: "home", label: "Home", icon: Home },
  { view: "explore", label: "Explore", icon: Compass },
  { view: "categories", label: "Categories", icon: LayoutGrid },
  { view: "saved", label: "Saved", icon: Bookmark },
  { view: "settings", label: "Settings", icon: SlidersHorizontal },
];

function isActive(current: Route, view: Route["view"]): boolean {
  if (view === "categories") return current.view === "categories" || current.view === "category";
  return current.view === view;
}

export function TopBar() {
  const { state, patchSettings } = useApp();
  const dark = state.settings.theme !== "light";
  return (
    <header className="pt-safe sticky top-0 z-40 hairline-b bar-blur lg:hidden">
      <div className="flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-2.5">
          <Logo />
          <div className="leading-none">
            <div className="text-[15px] font-bold tracking-tight">Leverage</div>
            <div className="mt-0.5 text-[10px] font-medium tracking-wide text-[var(--text-faint)]">
              SIGNAL LEARNING FEED
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {!state.online && <OfflinePill />}
          <button
            className="iconbtn"
            aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
            onClick={() => patchSettings({ theme: dark ? "light" : "dark" })}
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </div>
    </header>
  );
}

export function OfflinePill() {
  return (
    <span className="badge mr-1 !h-[24px] px-2 text-[var(--warn)]" role="status">
      <WifiOff size={11} />
      Offline
    </span>
  );
}

export function BottomNav() {
  const { state, navigate } = useApp();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 hairline-t bar-blur-strong lg:hidden"
      aria-label="Primary"
    >
      <div className="pb-safe mx-auto flex h-[60px] max-w-md items-stretch">
        {NAV.map(({ view, label, icon: Icon }) => {
          const active = isActive(state.route, view);
          return (
            <button
              key={view}
              onClick={() => navigate({ view } as Route)}
              aria-current={active ? "page" : undefined}
              className="flex flex-1 flex-col items-center justify-center gap-[3px] transition-colors"
              style={{ color: active ? "var(--text)" : "var(--text-faint)" }}
            >
              <Icon size={20} strokeWidth={active ? 2.4 : 1.9} />
              <span className="text-[9.5px] font-semibold tracking-wide">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function SideNav() {
  const { state, navigate, patchSettings } = useApp();
  const dark = state.settings.theme !== "light";
  const usage = getUsage();
  return (
    <aside className="sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col border-r border-[var(--border)] lg:flex">
      <div className="flex items-center gap-2.5 px-5 pt-6">
        <Logo size={30} />
        <div className="leading-none">
          <div className="text-[16px] font-bold tracking-tight">Leverage</div>
          <div className="mt-1 text-[10px] font-medium tracking-wider text-[var(--text-faint)]">
            SIGNAL LEARNING FEED
          </div>
        </div>
      </div>

      <nav className="mt-8 flex flex-col gap-1 px-3" aria-label="Primary">
        {NAV.map(({ view, label, icon: Icon }) => {
          const active = isActive(state.route, view);
          return (
            <button
              key={view}
              onClick={() => navigate({ view } as Route)}
              aria-current={active ? "page" : undefined}
              className="flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[13.5px] font-semibold transition-colors"
              style={{
                color: active ? "var(--text)" : "var(--text-dim)",
                background: active ? "var(--bg-sunk)" : "transparent",
              }}
            >
              <Icon size={17} strokeWidth={active ? 2.4 : 2} />
              {label}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto space-y-3 px-5 pb-6">
        <div className="surface rounded-[10px] p-3">
          <div className="label mb-1.5">API quota today</div>
          <div className="tnum text-[12.5px] font-semibold">
            ~{usage.units.toLocaleString()} units
          </div>
          <div className="mt-1 text-[10.5px] leading-snug text-[var(--text-faint)]">
            Local estimate · resets midnight PT. Cached data never re-costs.
          </div>
        </div>
        {!state.online && <OfflinePill />}
        <button className="iconbtn" aria-label="Toggle theme"
          onClick={() => patchSettings({ theme: dark ? "light" : "dark" })}>
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </aside>
  );
}

export function Toasts() {
  const { state, dispatch } = useApp();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[76px] z-50 flex flex-col items-center gap-2 px-4 lg:bottom-8" role="status">
      {state.toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dispatch({ type: "toast/dismiss", id: t.id })}
          className="toast-in pointer-events-auto max-w-sm rounded-[10px] border border-[var(--border-strong)] bg-[var(--bg-elev)] px-4 py-2.5 text-[13px] font-medium shadow-[var(--shadow)]"
        >
          {t.msg}
        </button>
      ))}
    </div>
  );
}

export function Page({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <main className={`mx-auto w-full px-4 pb-28 pt-5 sm:px-6 lg:pb-16 lg:pt-8 ${wide ? "max-w-6xl" : "max-w-3xl"}`}>
      {children}
    </main>
  );
}
