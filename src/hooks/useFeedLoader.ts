// ── Shared feed-loading hook ────────────────────────────────────────
// Contract:
//  • NEVER fetches during render — all work happens in an effect or an
//    explicit event handler.
//  • Aborts the previous request on every new load AND on unmount, so
//    rapid tab/category switching cannot leave orphan requests running.
//  • Runs at most once per distinct `reloadKey`; a category you have
//    already loaded does not re-request when you navigate back to it.
//  • Surfaces quota / auth / rate-guard states instead of retrying.

import { useCallback, useEffect, useRef } from "react";
import { useApp } from "../state/store";
import type { PoolSlice } from "../state/store";
import type { FeedResult } from "../types";
import { AuthError, QuotaError, RateGuardError, isQuotaBlocked } from "../lib/youtube";

export function successSlice(r: FeedResult): PoolSlice {
  return { state: "success", videos: r.videos, fetchedAt: r.fetchedAt, fromCache: r.fromCache };
}

export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

export interface FeedHandle {
  slice: PoolSlice;
  load: (force: boolean) => Promise<void>;
}

export function useFeedLoader(
  scope: string,
  fetcher: (signal: AbortSignal, force: boolean) => Promise<PoolSlice | null>,
  reloadKey: string
): FeedHandle {
  const app = useApp();
  const slice = app.pool(scope);
  const loadedRef = useRef("");
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  // Keep the fetcher in a ref so identity churn never retriggers loads.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  // Same for the app API — avoids `load` being recreated every render.
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // D4: cancel obsolete work when the view unmounts.
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const load = useCallback(
    async (force: boolean) => {
      const a = appRef.current;
      if (!a.state.settings.ytKey) return;

      // Don't spend a doomed request while the daily quota is known-spent.
      if (isQuotaBlocked() && !a.state.quotaBlocked) {
        a.dispatch({ type: "quota", blocked: true });
      }
      if (isQuotaBlocked()) {
        a.dispatch({
          type: "pool/set", scope,
          slice: { state: "quota", videos: [], fetchedAt: 0, fromCache: false, error: "quota" },
        });
        return;
      }

      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      a.dispatch({ type: "pool/loading", scope });

      try {
        const s = await fetcherRef.current(ctrl.signal, force);
        if (ctrl.signal.aborted || !mountedRef.current) return;
        if (s) {
          a.dispatch({ type: "pool/set", scope, slice: s });
          if (a.state.quotaBlocked) a.dispatch({ type: "quota", blocked: false });
        }
      } catch (e) {
        if (ctrl.signal.aborted || isAbort(e) || !mountedRef.current) return;

        if (e instanceof QuotaError) {
          a.dispatch({ type: "quota", blocked: true });
          a.dispatch({
            type: "pool/set", scope,
            slice: { state: "quota", videos: [], fetchedAt: 0, fromCache: false, error: "quota" },
          });
          return;
        }
        const message =
          e instanceof AuthError || e instanceof RateGuardError
            ? e.message
            : e instanceof Error
              ? e.message
              : "Unknown error";
        a.dispatch({
          type: "pool/set", scope,
          slice: { state: "error", videos: [], fetchedAt: 0, fromCache: false, error: message },
        });
      }
    },
    [scope]
  );

  // Load once per distinct reloadKey. Navigating back to a scope that
  // already holds data performs NO work at all (not even a cache read).
  useEffect(() => {
    if (!app.state.settings.ytKey) return;
    if (loadedRef.current === reloadKey) return;

    // Remount with data already in the store → adopt it, don't refetch.
    if (slice.state === "success" && slice.videos.length > 0) {
      loadedRef.current = reloadKey;
      return;
    }
    if (slice.state === "loading") return; // a load for this scope is in flight

    loadedRef.current = reloadKey;
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, app.state.settings.ytKey, load]);

  return { slice, load };
}
