// ── Category taxonomy, curated query packs, relevance filters ───────
//
// Three distinct mechanisms, deliberately separated:
//
//  1. `queries`   — curated discovery queries sent to search.list.
//                   Phrased for instruction ("explained", "full course",
//                   "case study") so the API's own relevance ranking
//                   leans toward long-form teaching, not hype.
//  2. `relevance` — deterministic include/exclude patterns applied
//                   LOCALLY to returned titles/descriptions. Search is
//                   fuzzy; this is how we keep a crypto-pump video out
//                   of Health and a music video out of Focus.
//  3. `editorial` — signals that mark a video as a curated pick. This is
//                   our judgement, never a YouTube popularity statistic.

import type { CategoryId } from "../types";

export interface SubTopic {
  label: string;
  query: string;
}

export interface RelevanceRule {
  /** At least one must match title+description for the video to belong. */
  include: RegExp;
  /** Any match disqualifies the video from this category. */
  exclude: RegExp;
  /** Matches that strongly confirm topical fit (used for editorial picks). */
  strong: RegExp;
}

export interface CategoryDef {
  id: CategoryId;
  label: string;
  short: string;
  blurb: string;
  /** Rotating discovery queries — a pair is consumed per refresh. */
  queries: string[];
  topics: SubTopic[];
  relevance: RelevanceRule;
}

export const CATEGORIES: CategoryDef[] = [
  // ── WEALTH ────────────────────────────────────────────────────────
  {
    id: "wealth",
    label: "Wealth",
    short: "Wealth",
    blurb: "Personal finance, investing fundamentals, and how wealth is actually built.",
    queries: [
      "personal finance fundamentals explained full guide",
      "index fund investing explained long term",
      "how compound interest actually works explained",
      "tax efficient investing explained for beginners",
      "financial independence realistic breakdown",
      "millionaire biography documentary how they built it",
      "wealth building case study real numbers",
      "retirement planning explained step by step",
    ],
    topics: [
      { label: "Personal finance", query: "personal finance fundamentals explained full guide" },
      { label: "Investing basics", query: "index fund investing explained for beginners" },
      { label: "Budgeting", query: "budgeting system that actually works tutorial" },
      { label: "Tax strategy", query: "tax efficient investing explained" },
      { label: "Financial independence", query: "financial independence realistic case study" },
      { label: "Biographies", query: "billionaire biography documentary business" },
      { label: "Debt payoff", query: "paying off debt strategy explained math" },
      { label: "Case studies", query: "wealth building case study real numbers" },
    ],
    relevance: {
      include: /financ|money|invest|wealth|budget|saving|retire|portfolio|net worth|income|tax|millionaire|billionaire|frugal|debt/i,
      exclude: /\b(pump|moon|airdrop|signal group|telegram)\b|guaranteed (profit|return)|forex robot/i,
      strong: /explained|fundamentals|case study|documentary|full (guide|course)|how (it|they) (work|built)|breakdown/i,
    },
  },

  // ── BUSINESS ──────────────────────────────────────────────────────
  {
    id: "business",
    label: "Business",
    short: "Biz",
    blurb: "Entrepreneurship, business models, sales, marketing, and operating a company.",
    queries: [
      "how to start a business step by step full guide",
      "business model breakdown case study",
      "sales fundamentals training full course",
      "marketing strategy explained for small business",
      "how i built my company documentary interview",
      "pricing strategy explained business",
      "small business operations systems tutorial",
      "startup failure post mortem lessons learned",
    ],
    topics: [
      { label: "Starting up", query: "how to start a business step by step guide" },
      { label: "Business models", query: "business model breakdown case study" },
      { label: "Sales", query: "sales fundamentals training full course" },
      { label: "Marketing", query: "marketing strategy explained small business" },
      { label: "Side hustles", query: "side hustle realistic case study honest numbers" },
      { label: "Digital products", query: "digital product business full tutorial" },
      { label: "Operations", query: "business operations systems and processes tutorial" },
      { label: "Founder stories", query: "founder interview how they built the company" },
    ],
    relevance: {
      include: /business|entrepreneur|startup|founder|company|sales|marketing|customer|revenue|profit|client|agency|ecommerce|side ?hustle|freelanc|product|brand/i,
      exclude: /\b(mlm|pyramid|network marketing)\b|guaranteed (income|profit)|\bget rich\b/i,
      strong: /case study|breakdown|step by step|full (course|guide|tutorial)|lessons learned|post ?mortem|how i built|interview/i,
    },
  },

  // ── AI & SaaS ─────────────────────────────────────────────────────
  {
    id: "ai",
    label: "AI & SaaS",
    short: "AI",
    blurb: "AI tools, agents, SaaS engineering, automation, and shipping real software.",
    queries: [
      "AI agents explained build step by step tutorial",
      "build a SaaS from scratch full course",
      "LLM fundamentals explained how it works",
      "n8n automation workflow full tutorial",
      "software engineering system design explained",
      "RAG retrieval augmented generation tutorial",
      "no-code app build full walkthrough",
      "AI coding workflow real project tutorial",
    ],
    topics: [
      { label: "AI tools", query: "AI tools workflow full tutorial" },
      { label: "AI agents", query: "AI agents explained build step by step" },
      { label: "SaaS build", query: "build a SaaS from scratch full course" },
      { label: "LLM internals", query: "how large language models work explained" },
      { label: "Automation", query: "workflow automation tutorial real project" },
      { label: "No-code", query: "no-code app build full walkthrough" },
      { label: "Engineering", query: "software engineering system design explained" },
      { label: "Dev tooling", query: "developer productivity tooling tutorial" },
    ],
    relevance: {
      include: /\bai\b|artificial intelligence|machine learning|\bllm\b|chatgpt|claude|gemini|openai|agent|automation|saas|software|coding|programm|developer|no-?code|api|python|javascript|typescript|database|deploy/i,
      exclude: /\bai\b.{0,30}(get rich|passive income overnight)|guaranteed \$|\bnsfw\b/i,
      strong: /tutorial|explained|full course|build|from scratch|walkthrough|system design|deep ?dive|how it works/i,
    },
  },

  // ── CRYPTO & TRADING ──────────────────────────────────────────────
  {
    id: "markets",
    label: "Crypto & Trading",
    short: "Markets",
    blurb: "Trading education, crypto fundamentals, quant methods — risk management first.",
    queries: [
      "risk management for traders explained position sizing",
      "quantitative trading for beginners full course",
      "how blockchain actually works explained",
      "backtesting a trading strategy python tutorial",
      "market structure trading education explained",
      "options trading explained fundamentals",
      "build a trading bot tutorial python",
      "macroeconomics explained markets documentary",
    ],
    topics: [
      { label: "Risk management", query: "risk management position sizing explained trading" },
      { label: "Trading education", query: "trading fundamentals full course beginner" },
      { label: "Quant strategies", query: "quantitative trading strategy explained" },
      { label: "Trading bots", query: "build a trading bot python full tutorial" },
      { label: "Crypto fundamentals", query: "how blockchain works explained fundamentals" },
      { label: "Backtesting", query: "backtesting trading strategy tutorial" },
      { label: "Derivatives", query: "options and futures explained fundamentals" },
      { label: "Macro analysis", query: "macroeconomics markets explained documentary" },
    ],
    relevance: {
      include: /trad(e|ing|er)|crypto|bitcoin|ethereum|blockchain|stock|equit|forex|quant|portfolio|option|future|hedge|market|backtest|volatil|macro|invest/i,
      // Evidence-based exclusions: signal-selling and guaranteed-return pitches.
      exclude: /signal(s)? group|telegram (group|channel)|\bpump\b|guaranteed (profit|return|win)|\b\d{2,}% (per|a) (day|week|month)\b|copy my trades|never lose/i,
      strong: /risk|explained|fundamentals|full course|backtest|tutorial|documentary|how it works|deep ?dive/i,
    },
  },

  // ── HEALTH ────────────────────────────────────────────────────────
  {
    id: "health",
    label: "Health",
    short: "Health",
    blurb: "Evidence-based weight loss, nutrition, training, sleep, and metabolic health.",
    queries: [
      "weight loss science explained evidence based",
      "nutrition fundamentals science lecture",
      "strength training for beginners full guide",
      "sleep science explained how to sleep better",
      "metabolic health explained doctor",
      "protein intake science explained research",
      "exercise physiology explained lecture",
      "longevity research explained evidence based",
    ],
    topics: [
      { label: "Weight loss", query: "weight loss science explained evidence based" },
      { label: "Nutrition", query: "nutrition science fundamentals lecture" },
      { label: "Strength training", query: "strength training fundamentals full guide" },
      { label: "Cardio & VO2", query: "cardiovascular fitness science explained" },
      { label: "Sleep", query: "sleep science explained circadian rhythm" },
      { label: "Metabolic health", query: "metabolic health insulin explained doctor" },
      { label: "Longevity", query: "longevity research explained evidence" },
      { label: "Habits", query: "health habit formation science explained" },
    ],
    relevance: {
      include: /health|nutrition|diet|weight|fat ?loss|calorie|protein|fitness|workout|training|muscle|exercise|sleep|metabol|longev|insulin|cardio|doctor|medical|physiolog/i,
      // Evidence-supported exclusions: cure claims and crash-diet promises.
      exclude: /miracle (cure|pill|food)|\bcures?\b.{0,20}(cancer|diabetes|disease)|lose \d+ ?(lbs|pounds|kg) in \d+ ?(days?|week)|detox tea|doctors hate|melt fat/i,
      strong: /science|evidence|research|stud(y|ies)|explained|lecture|peer.?reviewed|meta.?analysis|full guide|physiolog/i,
    },
  },

  // ── FOCUS ─────────────────────────────────────────────────────────
  {
    id: "focus",
    label: "Focus",
    short: "Focus",
    blurb: "Deep work, learning systems, discipline, and attention management.",
    queries: [
      "deep work techniques explained focus",
      "science of learning how to study effectively",
      "attention span and focus neuroscience explained",
      "building a second brain note taking tutorial",
      "spaced repetition learning explained",
      "habit formation science explained behaviour change",
      "productivity system full walkthrough realistic",
      "procrastination psychology explained research",
    ],
    topics: [
      { label: "Deep work", query: "deep work techniques explained focus" },
      { label: "Learning systems", query: "science of learning how to study effectively" },
      { label: "Note taking", query: "note taking system second brain tutorial" },
      { label: "Attention", query: "attention span focus neuroscience explained" },
      { label: "Discipline", query: "discipline systems not motivation explained" },
      { label: "Procrastination", query: "procrastination psychology explained research" },
      { label: "Time management", query: "time management system walkthrough realistic" },
      { label: "Memory", query: "memory techniques spaced repetition explained" },
    ],
    relevance: {
      include: /focus|deep work|productiv|attention|concentrat|discipline|habit|learn|study|memory|note.?taking|procrastinat|time management|routine|neuroscience|psycholog|dopamine/i,
      exclude: /subliminal|binaural beats?|study (music|with me)|lofi|\b(asmr|sleep music)\b|manifest/i,
      strong: /science|explained|research|system|technique|tutorial|how to|evidence|neuroscience|full guide/i,
    },
  },

  // ── PAID KNOWLEDGE ────────────────────────────────────────────────
  {
    id: "knowledge",
    label: "Paid Knowledge",
    short: "Courses",
    blurb: "Whop, Skool, Udemy, Coursera and the creator-education economy — reviewed honestly.",
    queries: [
      "skool community business model explained",
      "whop marketplace business breakdown",
      "how to create an online course full tutorial",
      "coursera professional certificate honest review",
      "udemy instructor business explained realistic",
      "online course launch case study real numbers",
      "creator economy education business documentary",
      "cohort based course business explained",
    ],
    topics: [
      { label: "Whop", query: "whop business model breakdown explained" },
      { label: "Skool", query: "skool community business case study" },
      { label: "Udemy", query: "udemy instructor business explained realistic" },
      { label: "Coursera", query: "coursera certificate honest review worth it" },
      { label: "Course creation", query: "how to create an online course full tutorial" },
      { label: "Communities", query: "paid community business model explained" },
      { label: "Launch case studies", query: "course launch case study real numbers" },
      { label: "Creator economy", query: "creator economy education business documentary" },
    ],
    relevance: {
      include: /course|skool|whop|udemy|coursera|teachable|kajabi|community|cohort|mastermind|membership|creator economy|digital product|curriculum|bootcamp|certificat/i,
      exclude: /free download|cracked|torrent|coupon code only|\bnulled\b/i,
      strong: /explained|review|case study|breakdown|honest|worth it|tutorial|business model|real numbers/i,
    },
  },
];

export const CATEGORY_MAP: Record<CategoryId, CategoryDef> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c])
) as Record<CategoryId, CategoryDef>;

export const ALL_CATEGORY_IDS = CATEGORIES.map((c) => c.id);

/** "Rising topics": user-tap-only curated queries. Nothing auto-loads. */
export const RISING_TOPICS: { label: string; query: string; cat: CategoryId }[] = [
  { label: "AI agents", query: "AI agents explained build step by step", cat: "ai" },
  { label: "Micro SaaS", query: "micro saas realistic breakdown case study", cat: "ai" },
  { label: "Index investing", query: "index fund investing explained long term", cat: "wealth" },
  { label: "Solopreneurs", query: "solopreneur business realistic case study", cat: "business" },
  { label: "Risk management", query: "risk management for traders explained", cat: "markets" },
  { label: "Quant basics", query: "quantitative finance for beginners lecture", cat: "markets" },
  { label: "Protein science", query: "protein intake science explained research", cat: "health" },
  { label: "Sleep science", query: "sleep science circadian rhythm explained", cat: "health" },
  { label: "Deep work", query: "deep work focus techniques explained", cat: "focus" },
  { label: "Skool economy", query: "skool community business model breakdown", cat: "knowledge" },
];

// ── Deterministic topical relevance ─────────────────────────────────

function haystack(title: string, description: string): string {
  // Descriptions are long and link-heavy; the opening is the informative part.
  return `${title}\n${description.slice(0, 700)}`;
}

/**
 * Does this video genuinely belong in this category?
 * Pure, deterministic, and based only on real API text fields.
 */
export function matchesCategory(cat: CategoryId, title: string, description: string): boolean {
  const rule = CATEGORY_MAP[cat]?.relevance;
  if (!rule) return false;
  const text = haystack(title, description);
  if (rule.exclude.test(text)) return false;
  return rule.include.test(text);
}

/** Every category a video legitimately belongs to (may be empty). */
export function matchCategories(title: string, description: string): CategoryId[] {
  return CATEGORIES.filter((c) => matchesCategory(c.id, title, description)).map((c) => c.id);
}

/** Topical confidence used to order editorial picks — never a popularity metric. */
export function topicalStrength(cat: CategoryId, title: string, description: string): number {
  const rule = CATEGORY_MAP[cat]?.relevance;
  if (!rule) return 0;
  const text = haystack(title, description);
  if (rule.exclude.test(text)) return -1;
  let s = 0;
  if (rule.include.test(text)) s += 1;
  if (rule.strong.test(text)) s += 2;
  if (rule.strong.test(title)) s += 1; // signal in the title is stronger
  return s;
}

/** Back-compat keyword map (used by the popular-chart bucketing). */
export const TOPIC_KEYWORDS: Record<CategoryId, RegExp> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.relevance.include])
) as Record<CategoryId, RegExp>;
