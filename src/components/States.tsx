// ── Loading, empty, error, quota, and API-key states ────────────────
// Honest states only — no mock data, no fake demos.

import { AlertTriangle, BatteryLow, BookMarked, KeyRound, RefreshCw, SearchX, Sparkles, Timer } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { useApp } from "../state/store";
import { getUsage } from "../lib/youtube";

export function SkeletonRows({ n = 6 }: { n?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <div className="skeleton h-[74px] w-[124px] shrink-0 rounded-[10px]" />
          <div className="flex-1 space-y-2 py-1">
            <div className="skeleton h-3.5 w-[92%]" />
            <div className="skeleton h-3.5 w-[70%]" />
            <div className="skeleton h-3 w-[45%]" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ n = 4 }: { n?: number }) {
  return (
    <div className="snaprow no-scrollbar" aria-busy="true">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="w-[240px] shrink-0">
          <div className="skeleton aspect-video w-full rounded-[12px]" />
          <div className="mt-2 space-y-2">
            <div className="skeleton h-3.5 w-[95%]" />
            <div className="skeleton h-3 w-[60%]" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon, title, body, action,
}: { icon?: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rise flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-[14px] border border-[var(--border)] bg-[var(--bg-elev)] text-[var(--text-dim)]">
        {icon ?? <SearchX size={22} />}
      </div>
      <h3 className="text-[15px] font-bold tracking-tight">{title}</h3>
      <p className="mt-1.5 max-w-[300px] text-[13px] leading-relaxed text-[var(--text-dim)]">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <EmptyState
      icon={<AlertTriangle size={22} />}
      title="Something went wrong"
      body={message}
      action={onRetry ? (
        <button className="btn btn-ghost" onClick={onRetry}>
          <RefreshCw size={14} /> Try again
        </button>
      ) : undefined}
    />
  );
}

/** Hours remaining until the YouTube quota resets (midnight Pacific). */
function hoursToQuotaReset(): number {
  const now = new Date();
  const pt = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const next = new Date(pt);
  next.setHours(24, 0, 0, 0);
  return Math.max(1, Math.round((next.getTime() - pt.getTime()) / 3_600_000));
}

export function QuotaState() {
  const usage = getUsage();
  return (
    <div className="rise surface mx-auto max-w-lg rounded-[14px] p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-[var(--warn)]"><BatteryLow size={20} /></div>
        <div>
          <h3 className="text-[14.5px] font-bold">Daily YouTube API quota exhausted</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-dim)]">
            This key&apos;s daily quota is spent (~{usage.units.toLocaleString()} units estimated
            locally). Quotas reset at midnight Pacific Time — about {hoursToQuotaReset()}h from now.
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-faint)]">
            Further discovery requests are <strong>blocked locally</strong> rather than retried, so
            no doomed calls are sent. Cached feeds, your saved library, notes, and progress all
            remain available.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Local burst ceiling tripped — nothing was sent to YouTube. */
export function RateGuardState({ onRetry }: { onRetry?: () => void }) {
  return (
    <EmptyState
      icon={<Timer size={22} />}
      title="Slow down for a moment"
      body="You've triggered a lot of discovery requests in the last minute. We paused them locally to protect your quota — nothing was sent to YouTube. Try again shortly."
      action={onRetry ? <button className="btn btn-ghost" onClick={onRetry}>Try again</button> : undefined}
    />
  );
}

/** First-run / missing-key gate. Stores the key locally only. */
export function KeyGate({ onDone }: { onDone?: () => void }) {
  const { patchSettings, toast } = useApp();
  const [value, setValue] = useState("");
  const valid = value.trim().length >= 20;

  return (
    <div className="rise mx-auto max-w-lg px-1 py-8">
      <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-[14px] border border-[var(--border-strong)] bg-[var(--bg-elev)]">
        <KeyRound size={22} />
      </div>
      <h1 className="text-[22px] font-bold tracking-tight">Connect the YouTube Data API</h1>
      <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--text-dim)]">
        Leverage has no backend and no database — your browser talks to the official
        YouTube Data API v3 directly. To do that it needs an API key, which is stored
        only in this device&apos;s localStorage and never sent anywhere except
        googleapis.com. We never show fabricated videos, so discovery stays locked
        until a real key is available.
      </p>

      <ol className="mt-5 space-y-2.5 text-[13px] leading-relaxed text-[var(--text-dim)]">
        {[
          "Open console.cloud.google.com and create a free project.",
          "Enable “YouTube Data API v3” under APIs & Services → Library.",
          "Create credentials → API key.",
          "Restrict it: API restriction = YouTube Data API v3 only. Add application restrictions when deploying.",
        ].map((s, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="tnum mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--border-strong)] text-[10.5px] font-bold">
              {i + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>

      <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
        <input
          className="input flex-1"
          placeholder="Paste your YouTube API key (AIza…)"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-label="YouTube API key"
        />
        <button
          className="btn shrink-0"
          disabled={!valid}
          onClick={() => {
            patchSettings({ ytKey: value.trim(), onboardingDone: true });
            toast("API key saved locally on this device", "success");
            onDone?.();
          }}
        >
          Save key & continue
        </button>
      </div>
      <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--text-faint)]">
        Developers can also set <code className="rounded bg-[var(--bg-sunk)] px-1 py-0.5">VITE_YOUTUBE_API_KEY</code> at
        build time. Note: bundled env vars are public in the client — restrict the key by HTTP referrer on your domain.
      </p>
    </div>
  );
}

export function SavedEmpty() {
  const { navigate } = useApp();
  return (
    <EmptyState
      icon={<BookMarked size={22} />}
      title="Nothing saved yet"
      body="Bookmark videos from any feed and they live here — stored only on this device, available offline."
      action={<button className="btn btn-ghost" onClick={() => navigate({ view: "home" })}>
        <Sparkles size={14} /> Discover videos
      </button>}
    />
  );
}
