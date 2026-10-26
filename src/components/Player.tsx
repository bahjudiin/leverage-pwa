// ── Official YouTube IFrame Player wrapper ──────────────────────────
// Playback is always user-initiated (facade → click → player mounts).
// Progress comes from the official player's own currentTime API.
// No downloads, no circumvention, no third-party proxies.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytPromise: Promise<any> | null = null;

function loadYouTubeApi(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!ytPromise) {
    ytPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve(window.YT);
      };
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      tag.onerror = () => reject(new Error("Failed to load YouTube player"));
      document.head.appendChild(tag);
    });
  }
  return ytPromise;
}

export interface PlayerHandle {
  seekTo: (seconds: number) => void;
  pause: () => void;
}

interface Props {
  videoId: string;
  startAt?: number; // seconds
  autoplay?: boolean;
  onProgress?: (fraction: number) => void;
  onEnded?: () => void;
}

export const YTPlayer = forwardRef<PlayerHandle, Props>(function YTPlayer(
  { videoId, startAt = 0, autoplay = true, onProgress, onEnded },
  ref
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const timerRef = useRef<number | null>(null);
  const [failed, setFailed] = useState(false);
  const progressRef = useRef(onProgress);
  const endedRef = useRef(onEnded);
  progressRef.current = onProgress;
  endedRef.current = onEnded;

  useImperativeHandle(ref, () => ({
    seekTo: (seconds: number) => {
      try { playerRef.current?.seekTo?.(seconds, true); } catch { /* noop */ }
    },
    pause: () => {
      try { playerRef.current?.pauseVideo?.(); } catch { /* noop */ }
    },
  }), []);

  useEffect(() => {
    let alive = true;
    let player: any = null;

    const report = () => {
      try {
        const d = player?.getDuration?.() ?? 0;
        const t = player?.getCurrentTime?.() ?? 0;
        if (d > 0) progressRef.current?.(Math.min(1, t / d));
      } catch { /* noop */ }
    };
    const stopTimer = () => {
      if (timerRef.current !== null) { window.clearInterval(timerRef.current); timerRef.current = null; }
    };
    const startTimer = () => {
      stopTimer();
      timerRef.current = window.setInterval(report, 4000);
    };

    loadYouTubeApi()
      .then((YT) => {
        if (!alive || !hostRef.current) return;
        const el = document.createElement("div");
        el.className = "h-full w-full";
        hostRef.current.replaceChildren(el);
        player = new YT.Player(el, {
          videoId,
          playerVars: {
            autoplay: autoplay ? 1 : 0,
            start: Math.max(0, Math.floor(startAt)),
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
          },
          events: {
            onStateChange: (e: any) => {
              const S = YT.PlayerState;
              if (e.data === S.PLAYING) startTimer();
              if (e.data === S.PAUSED || e.data === S.BUFFERING) { stopTimer(); report(); }
              if (e.data === S.ENDED) { stopTimer(); report(); endedRef.current?.(); }
            },
          },
        });
        playerRef.current = player;
      })
      .catch(() => alive && setFailed(true));

    return () => {
      alive = false;
      stopTimer();
      try { player?.destroy?.(); } catch { /* noop */ }
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  if (failed) {
    return (
      <a
        className="flex aspect-video w-full items-center justify-center rounded-[14px] border border-[var(--border)] bg-[var(--bg-sunk)] text-[13px] text-[var(--text-dim)]"
        href={`https://www.youtube.com/watch?v=${videoId}`}
        target="_blank"
        rel="noreferrer"
      >
        Player blocked — watch on YouTube instead
      </a>
    );
  }

  return (
    <div className="aspect-video w-full overflow-hidden rounded-[14px] border border-[var(--border)] bg-black">
      <div ref={hostRef} className="h-full w-full" />
    </div>
  );
});
