// ── Shared domain types ─────────────────────────────────────────────

export type CategoryId =
  | "wealth" | "business" | "ai" | "markets" | "health" | "focus" | "knowledge";

export type QualityTier =
  | "high" // high educational value
  | "promotional" // useful but promotional
  | "verify" // needs verification
  | "low" // low educational value
  | "unsafe" // misleading or unsafe
  | "unrated";

export type SortKey = "relevance" | "views" | "likes" | "comments" | "date" | "duration";
export type PublishWindow = "24h" | "7d" | "30d" | "any";

export interface VideoItem {
  id: string;
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string; // ISO 8601
  durationSec: number;
  thumbnails: { default?: string; medium?: string; high?: string };
  /** Raw stats straight from the YouTube API snapshot. null when unavailable. */
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  defaultLanguage: string | null;
  /** Local app categories this video surfaced under. */
  categoryIds: CategoryId[];
  /** Search queries that surfaced this video (transparent sourcing). */
  matchedQueries: string[];
  /** Epoch ms of when this record was retrieved from the API. */
  fetchedAt: number;
}

/** Deterministic, local, explainable pre-filter verdict. */
export interface HeuristicVerdict {
  tier: QualityTier;
  flags: string[]; // things that downgrade
  positives: string[]; // things that upgrade
  score: number; // internal ordering aid only — never displayed as a metric
}

export interface Chapter {
  seconds: number;
  label: string;
}

export type SegmentKind = "essential" | "peak" | "skip";

export interface AiSegment {
  seconds: number;
  label: string;
  reason: string;
  kind: SegmentKind;
  /** Where the timestamp came from — never fabricated. */
  source: "description";
}

/** Bump to invalidate every cached analysis (shape or prompt change). */
export const AI_SCHEMA = 3;

export interface AiAnalysis {
  schema: number;
  videoId: string;
  summary: string;
  topic: string;
  audience: string;
  keyLessons: string[];
  takeaways: string[];
  prerequisites: string;
  difficulty: "beginner" | "intermediate" | "advanced" | "mixed";
  tier: QualityTier;
  tierReason: string;
  promoWarning: string | null;
  claimsToVerify: string[];
  /** Only populated when real description timestamps exist. */
  segments: AiSegment[];
  /** How many verified chapters were supplied as grounding (0 = none). */
  sourceChapterCount: number;
  viewingPlan: string;
  questions: string[];
  /** "limited" = title+description only, no transcript was available. */
  confidence: "limited";
  analyzedAt: number;
  model: string;
}

export interface AiBudgetState {
  day: string;
  used: number;
  limit: number;
  remaining: number;
}

export interface Settings {
  theme: "dark" | "light";
  ytKey: string; // developer-supplied via env, or user-supplied, stored locally
  geminiKey: string;
  aiEnabled: boolean;
  aiAutoAnalyze: boolean;
  aiDailyBudget: number; // max Gemini video analyses per day
  minDurationSec: number; // long-form floor
  window: PublishWindow;
  region: string; // for the official "most popular" chart
  language: "any" | "en" | "es" | "pt" | "de" | "fr" | "hi";
  cats: CategoryId[]; // selected interests
  blockedChannels: string[]; // channel titles, lowercase
  blockedKeywords: string[];
  onboardingDone: boolean;
}

export interface WatchEntry {
  id: string;
  /** 0..1 playback progress reported by the official IFrame player. */
  progress: number;
  completed: boolean;
  saved: boolean;
  hidden: boolean;
  updatedAt: number;
  /** Compact snapshot so Saved/Continue Learning render offline. */
  title: string;
  channelTitle: string;
  thumb: string;
  durationSec: number;
  categoryIds: CategoryId[];
}

export interface LibraryState {
  entries: Record<string, WatchEntry>;
}

export type Route =
  | { view: "home" }
  | { view: "explore" }
  | { view: "categories" }
  | { view: "category"; id: CategoryId }
  | { view: "saved" }
  | { view: "settings" }
  | { view: "video"; id: string };

export type LoadState = "idle" | "loading" | "success" | "error" | "quota";

export interface FeedResult {
  videos: VideoItem[];
  fetchedAt: number;
  fromCache: boolean;
}
