// ── Settings: keys, AI, feed prefs, filters, data, disclosures ──────

import { useRef, useState } from "react";
import {
  AlertTriangle, Check, Download, KeyRound, Moon, Plus, RefreshCw, ShieldAlert, Sparkles, Sun, Trash2, Upload, X,
} from "lucide-react";
import { useApp } from "../state/store";
import { Page } from "../components/chrome";
import { getUsage } from "../lib/youtube";
import { budgetState } from "../lib/aiService";
import { clearApiCaches, pruneExpired, removeKey, KEYS } from "../lib/storage";
import { CATEGORIES } from "../lib/categories";
import { CAT_ICONS } from "./Categories";
import type { PublishWindow } from "../types";

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-[15px] font-bold tracking-tight">{title}</h2>
      {note && <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-dim)]">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Toggle({ on, onChange, label, desc }: { on: boolean; onChange: (v: boolean) => void; label: string; desc?: string }) {
  return (
    <button
      role="switch" aria-checked={on}
      className="flex w-full items-center justify-between gap-4 py-2 text-left"
      onClick={() => onChange(!on)}
    >
      <span>
        <span className="block text-[13.5px] font-semibold">{label}</span>
        {desc && <span className="mt-0.5 block text-[11.5px] leading-snug text-[var(--text-dim)]">{desc}</span>}
      </span>
      <span
        className="relative h-[24px] w-[42px] shrink-0 rounded-full transition-colors"
        style={{ background: on ? "var(--accent)" : "var(--border-strong)" }}
      >
        <span
          className="absolute top-[2px] h-[20px] w-[20px] rounded-full bg-[var(--accent-inv)] shadow transition-all"
          style={{ left: on ? 20 : 2 }}
        />
      </span>
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-[13.5px] font-semibold">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

export default function Settings() {
  const app = useApp();
  const { settings } = app.state;
  const usage = getUsage();
  const aiBudget = budgetState(settings);
  const [ytDraft, setYtDraft] = useState("");
  const [gmDraft, setGmDraft] = useState("");
  const [chDraft, setChDraft] = useState("");
  const [kwDraft, setKwDraft] = useState("");
  const [importText, setImportText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const dark = settings.theme !== "light";

  const doExport = () => {
    const blob = new Blob([app.exportData()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leverage-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    app.toast("Exported (API keys are never included)", "success");
  };

  const doImport = (text: string) => {
    const res = app.importData(text);
    if (res.ok) { app.toast("Import complete", "success"); setImportText(""); }
    else app.toast(`Import failed: ${res.error}`, "error");
  };

  return (
    <Page>
      <h1 className="text-[21px] font-bold tracking-tight">Settings</h1>
      <p className="mt-1 text-[12.5px] text-[var(--text-dim)]">
        Everything lives in this browser&apos;s localStorage. No account, no server, no database.
      </p>

      {/* ── Theme ──────────────────────────────────────────── */}
      <Section title="Appearance">
        <div className="surface rounded-[14px] px-4">
          <Toggle
            on={dark} onChange={(v) => app.patchSettings({ theme: v ? "dark" : "light" })}
            label={dark ? "Dark theme (OLED)" : "Light theme"}
            desc="Pure black surfaces, minimal power draw on OLED screens."
          />
        </div>
      </Section>

      {/* ── YouTube API ────────────────────────────────────── */}
      <Section
        title="YouTube Data API"
        note="Required for discovery. Your browser calls googleapis.com directly — the key is stored only on this device. Restrict it to 'YouTube Data API v3' in Google Cloud Console, and add an HTTP-referrer restriction for your deployment domain."
      >
        <div className="surface rounded-[14px] p-4">
          <div className="flex items-center gap-2.5">
            <KeyRound size={16} className="text-[var(--text-dim)]" />
            <span className="text-[13.5px] font-semibold">
              {settings.ytKey ? `Key set · ends …${settings.ytKey.slice(-5)}` : "No key configured"}
            </span>
            {settings.ytKey && <Check size={14} className="text-[var(--good)]" />}
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              className="input flex-1" placeholder={settings.ytKey ? "Paste a new key to replace…" : "AIza…"}
              value={ytDraft} onChange={(e) => setYtDraft(e.target.value)}
              autoComplete="off" spellCheck={false} aria-label="YouTube API key"
            />
            <button className="btn shrink-0" disabled={ytDraft.trim().length < 20}
              onClick={() => { app.patchSettings({ ytKey: ytDraft.trim(), onboardingDone: true }); setYtDraft(""); app.toast("YouTube key saved", "success"); }}>
              Save
            </button>
            {settings.ytKey && (
              <button className="btn btn-ghost shrink-0"
                onClick={() => { app.patchSettings({ ytKey: "" }); app.toast("YouTube key removed"); }}>
                Remove
              </button>
            )}
          </div>
        </div>
      </Section>

      {/* ── Gemini ─────────────────────────────────────────── */}
      <Section
        title="Gemini AI analysis (optional)"
        note="AI classifies educational value, summarizes, and builds viewing guides from title + description only — transcripts aren't available to a backend-free app, so confidence is always marked 'limited'. AI is OFF by default."
      >
        <div className="surface space-y-1 rounded-[14px] p-4">
          <Toggle on={settings.aiEnabled} onChange={(v) => app.patchSettings({ aiEnabled: v && Boolean(settings.geminiKey) })}
            label="Enable AI analysis"
            desc={settings.geminiKey ? "Adds provisional AI badges and per-video learning guides." : "Add your own Gemini key below to enable."} />
          {settings.aiEnabled && (
            <Toggle on={settings.aiAutoAnalyze} onChange={(v) => app.patchSettings({ aiAutoAnalyze: v })}
              label="Auto-analyze ambiguous finds"
              desc="After a refresh, analyzes up to 4 borderline videos in ONE batch (within budget)." />
          )}
          <Row label="Daily AI budget">
            {[5, 10, 20, 50].map((n) => (
              <button key={n} className="chip" data-on={settings.aiDailyBudget === n}
                onClick={() => app.patchSettings({ aiDailyBudget: n })}>
                {n} videos
              </button>
            ))}
          </Row>
          {settings.aiEnabled && (
            <div className="rounded-[10px] border border-[var(--border)] bg-[var(--bg-sunk)] p-3">
              <div className="flex items-center justify-between text-[11.5px] font-semibold">
                <span>Today&apos;s analyses</span>
                <span className="tnum">{aiBudget.used} / {aiBudget.limit} used</span>
              </div>
              <div className="mt-2 h-[4px] overflow-hidden rounded-full bg-[var(--border)]">
                <div
                  className="h-full transition-all"
                  style={{
                    width: `${aiBudget.limit ? Math.min(100, (aiBudget.used / aiBudget.limit) * 100) : 0}%`,
                    background: aiBudget.remaining > 0 ? "var(--good)" : "var(--warn)",
                  }}
                />
              </div>
              <p className="mt-2 text-[10.5px] leading-snug text-[var(--text-faint)]">
                {aiBudget.remaining > 0
                  ? `${aiBudget.remaining} analyses remaining today. Only successful analyses are counted; failures cost nothing.`
                  : "Budget spent for today. Cached analyses stay readable and are reused everywhere."}
                {" "}Each analysis is cached for 14 days and reused across every category.
              </p>
            </div>
          )}
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              className="input flex-1" placeholder={settings.geminiKey ? "Replace Gemini key…" : "Your Gemini API key (stays on-device)"}
              value={gmDraft} onChange={(e) => setGmDraft(e.target.value)}
              autoComplete="off" spellCheck={false} aria-label="Gemini API key"
            />
            <button className="btn shrink-0" disabled={gmDraft.trim().length < 20}
              onClick={() => { app.patchSettings({ geminiKey: gmDraft.trim(), aiEnabled: true }); setGmDraft(""); app.toast("Gemini key saved — AI enabled", "success"); }}>
              Save & enable
            </button>
            {settings.geminiKey && (
              <button className="btn btn-ghost shrink-0"
                onClick={() => { app.patchSettings({ geminiKey: "", aiEnabled: false, aiAutoAnalyze: false }); app.toast("Gemini key removed — AI disabled"); }}>
                Remove
              </button>
            )}
          </div>
          <div className="mt-3 flex gap-2.5 rounded-[10px] border border-[var(--border)] bg-[var(--bg-sunk)] p-3">
            <ShieldAlert size={15} className="mt-0.5 shrink-0 text-[var(--warn)]" />
            <p className="text-[11.5px] leading-relaxed text-[var(--text-dim)]">
              A key in a browser app is visible to anyone using this device and could be extracted
              from network traffic — use a <em>your-own</em> key, keep a spend cap on it, and remove
              it here when done. It is never sent anywhere except Google&apos;s Gemini endpoint.
              A shared production key would require a backend, which this app deliberately does not have.
            </p>
          </div>
        </div>
      </Section>

      {/* ── Feed preferences ───────────────────────────────── */}
      <Section
        title="Feed preferences"
        note="Shorts are ALWAYS excluded (duration + hashtag heuristics, plus the API's long-form search filter)."
      >
        <div className="surface divide-y divide-[var(--border)] rounded-[14px] px-4">
          <Row label="Minimum video length">
            {[240, 600, 1200, 2400].map((s) => (
              <button key={s} className="chip" data-on={settings.minDurationSec === s}
                onClick={() => app.patchSettings({ minDurationSec: s })}>
                {s / 60}m+
              </button>
            ))}
          </Row>
          <Row label="Default period">
            {(["24h", "7d", "30d", "any"] as PublishWindow[]).map((w) => (
              <button key={w} className="chip" data-on={settings.window === w}
                onClick={() => app.patchSettings({ window: w })}>
                {w === "any" ? "All time" : w}
              </button>
            ))}
          </Row>
          <Row label="Language preference">
            {(["en", "any", "es", "pt", "de", "hi"] as const).map((l) => (
              <button key={l} className="chip" data-on={settings.language === l}
                onClick={() => app.patchSettings({ language: l })}>
                {l === "any" ? "Any" : l.toUpperCase()}
              </button>
            ))}
          </Row>
          <Row label="Region (popular chart)">
            {["US", "GB", "CA", "AU", "IN", "DE", "BR", "JP"].map((r) => (
              <button key={r} className="chip" data-on={settings.region === r}
                onClick={() => app.patchSettings({ region: r })}>
                {r}
              </button>
            ))}
          </Row>
        </div>
      </Section>

      {/* ── Interests ──────────────────────────────────────── */}
      <Section title="Your interests" note="Used by Home discovery. The first three drive the initial pool to cap quota use.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {CATEGORIES.map((c) => {
            const Icon = CAT_ICONS[c.id];
            const on = settings.cats.includes(c.id);
            return (
              <button key={c.id} aria-pressed={on}
                className="card flex items-center gap-2.5 p-3 text-left transition-colors"
                style={on ? { borderColor: "var(--border-strong)", background: "var(--bg-elev)" } : { opacity: 0.55 }}
                onClick={() => {
                  const cats = on ? settings.cats.filter((x) => x !== c.id) : [...settings.cats, c.id];
                  if (cats.length === 0) return app.toast("Keep at least one interest", "error");
                  app.patchSettings({ cats });
                }}>
                <Icon size={16} />
                <span className="text-[12.5px] font-semibold">{c.label}</span>
              </button>
            );
          })}
        </div>
      </Section>

      {/* ── Exclusions ─────────────────────────────────────── */}
      <Section title="Exclusions" note="Applied locally to every feed — channels and keywords never appear.">
        <div className="surface rounded-[14px] p-4">
          <div className="label mb-2">Blocked channels</div>
          <div className="flex gap-2">
            <input className="input flex-1" placeholder="Channel name…" value={chDraft}
              onChange={(e) => setChDraft(e.target.value)} aria-label="Block a channel"
              onKeyDown={(e) => { if (e.key === "Enter" && chDraft.trim()) { app.patchSettings({ blockedChannels: [...settings.blockedChannels, chDraft.trim().toLowerCase()] }); setChDraft(""); } }} />
            <button className="btn btn-ghost shrink-0" aria-label="Add blocked channel"
              onClick={() => { if (chDraft.trim()) { app.patchSettings({ blockedChannels: [...settings.blockedChannels, chDraft.trim().toLowerCase()] }); setChDraft(""); } }}>
              <Plus size={14} />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {settings.blockedChannels.map((c) => (
              <span key={c} className="chip !pr-1">
                {c}
                <button
                  type="button"
                  className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-[var(--bg-sunk)]"
                  aria-label={`Unblock channel ${c}`}
                  onClick={() => app.patchSettings({ blockedChannels: settings.blockedChannels.filter((x) => x !== c) })}
                >
                  <X size={12} aria-hidden />
                </button>
              </span>
            ))}
            {settings.blockedChannels.length === 0 && <span className="text-[12px] text-[var(--text-faint)]">None</span>}
          </div>

          <div className="label mb-2 mt-5">Blocked keywords</div>
          <div className="flex gap-2">
            <input className="input flex-1" placeholder="e.g. “ giveaway ”…" value={kwDraft}
              onChange={(e) => setKwDraft(e.target.value)} aria-label="Block a keyword"
              onKeyDown={(e) => { if (e.key === "Enter" && kwDraft.trim()) { app.patchSettings({ blockedKeywords: [...settings.blockedKeywords, kwDraft.trim().toLowerCase()] }); setKwDraft(""); } }} />
            <button className="btn btn-ghost shrink-0" aria-label="Add blocked keyword"
              onClick={() => { if (kwDraft.trim()) { app.patchSettings({ blockedKeywords: [...settings.blockedKeywords, kwDraft.trim().toLowerCase()] }); setKwDraft(""); } }}>
              <Plus size={14} />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {settings.blockedKeywords.map((k) => (
              <span key={k} className="chip !pr-1">
                {k}
                <button
                  type="button"
                  className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-[var(--bg-sunk)]"
                  aria-label={`Remove blocked keyword ${k}`}
                  onClick={() => app.patchSettings({ blockedKeywords: settings.blockedKeywords.filter((x) => x !== k) })}
                >
                  <X size={12} aria-hidden />
                </button>
              </span>
            ))}
            {settings.blockedKeywords.length === 0 && <span className="text-[12px] text-[var(--text-faint)]">None</span>}
          </div>
        </div>
      </Section>

      {/* ── Data & cache ───────────────────────────────────── */}
      <Section
        title="Data, cache & quota"
        note="API caches TTL out in ≤45 min; AI analyses in 14 days; your library never expires. Stale stats are never presented as live — every feed shows its snapshot time."
      >
        <div className="surface rounded-[14px] p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { k: "API units today", v: `~${usage.units.toLocaleString()}` },
              { k: "Search calls", v: usage.searchCalls },
              { k: "Detail calls", v: usage.videoCalls },
              { k: "AI analyses", v: `${aiBudget.used}/${aiBudget.limit}` },
            ].map((s) => (
              <div key={s.k} className="rounded-[10px] border border-[var(--border)] bg-[var(--bg-sunk)] p-3">
                <div className="tnum text-[16px] font-bold">{s.v}</div>
                <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-faint)]">{s.k}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn btn-ghost" onClick={() => app.toast(`Cleared ${clearApiCaches()} cached entries`)}>
              <Trash2 size={14} /> Clear API caches
            </button>
            <button className="btn btn-ghost" onClick={() => app.toast(`Pruned ${pruneExpired()} expired entries`)}>
              <RefreshCw size={14} /> Prune expired
            </button>
            <button className="btn btn-ghost" onClick={doExport}><Download size={14} /> Export JSON</button>
            <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}><Upload size={14} /> Import file</button>
            <input ref={fileRef} type="file" accept="application/json" className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) doImport(await f.text());
                e.target.value = "";
              }} />
          </div>
          <textarea
            className="input mt-3 h-[72px] w-full resize-none !py-2 text-[12px]"
            placeholder="…or paste exported JSON here to import"
            value={importText} onChange={(e) => setImportText(e.target.value)}
            aria-label="Paste import JSON"
          />
          {importText.trim() && (
            <button className="btn mt-2" onClick={() => doImport(importText)}>Import pasted data</button>
          )}
          <button
            className="mt-4 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--bad)]"
            onClick={() => {
              if (window.confirm("Delete ALL local data (settings, library, caches)? This cannot be undone.")) {
                localStorage.clear();
                location.reload();
              }
            }}
          >
            <AlertTriangle size={13} /> Reset everything on this device
          </button>
          <div className="mt-2">
            <button className="text-[12px] font-semibold text-[var(--text-dim)] underline underline-offset-2"
              onClick={() => { removeKey(KEYS.library); location.reload(); }}>
              Reset library only
            </button>
          </div>
        </div>
      </Section>

      {/* ── About / disclosures ────────────────────────────── */}
      <Section title="About & disclosures">
        <div className="surface space-y-3 rounded-[14px] p-4 text-[12.5px] leading-relaxed text-[var(--text-dim)]">
          <p>
            <strong className="text-[var(--text)]">Architecture.</strong> Static PWA. No backend,
            no serverless functions, no database, no auth. Your browser talks directly to the
            official YouTube Data API v3 — and to Gemini only if you enable it with your own key.
          </p>
          <p>
            <strong className="text-[var(--text)]">Honest metrics.</strong> View, like, and comment
            counts are raw snapshot values. This app does not compute engagement ratios or “velocity”,
            and labels the official “Most popular — Education” chart as a snapshot, not real-time trending.
          </p>
          <p>
            <strong className="text-[var(--text)]">Quality badges.</strong> “High value”, “Verify”,
            etc. come from a transparent local heuristic filter or optional Gemini analysis. They are
            editorial signals — not verified facts. Verify health and financial claims independently.
          </p>
          <p>
            <strong className="text-[var(--text)]">Offline.</strong> The app shell and your library
            work offline via the service worker. Fresh discovery, playback, and AI need connectivity —
            offline video is not (and cannot be) provided.
          </p>
          <p className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
            <a className="font-semibold underline underline-offset-2" href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">YouTube ToS</a>
            <a className="font-semibold underline underline-offset-2" href="https://developers.google.com/youtube/terms/api-services-terms-of-service" target="_blank" rel="noreferrer">API Services ToS</a>
            <a className="font-semibold underline underline-offset-2" href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Google Privacy Policy</a>
            <a className="font-semibold underline underline-offset-2" href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noreferrer">Gemini API Terms</a>
          </p>
          <p className="flex items-center gap-1.5 pt-1 text-[11.5px]">
            <Sun size={11} className="hidden" />
            <Moon size={11} className="hidden" />
            <Sparkles size={11} /> Leverage v1.0 · Install via browser menu → “Add to Home screen”.
          </p>
        </div>
      </Section>
    </Page>
  );
}
