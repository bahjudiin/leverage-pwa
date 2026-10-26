import { describe, expect, it } from "vitest";
import { capsRatio, hasChapters, heuristicAnalyze, isShort } from "../quality";

const META = (title: string, description = "", durationSec = 1500) => ({
  title, description, durationSec,
});

describe("heuristic quality filter", () => {
  it("flags income guarantees as misleading", () => {
    const v = heuristicAnalyze(META("Make $500 PER DAY with this one trick (guaranteed income!!)"));
    expect(v.tier).toBe("unsafe");
    expect(v.flags.join(" ")).toMatch(/income|Guarantee/i);
  });

  it("flags rapid weight-loss and cure claims as unsafe", () => {
    const v = heuristicAnalyze(META("Lose 30 pounds in 7 days!", "This miracle cure burns fat overnight."));
    expect(v.tier).toBe("unsafe");
  });

  it("flags implausible trading multipliers", () => {
    const v = heuristicAnalyze(META("This bot made 100x returns in a week"));
    expect(v.tier).toBe("unsafe");
  });

  it("does NOT treat legit trading education as a scam", () => {
    const v = heuristicAnalyze(META(
      "Risk Management for Traders — Full Course (Position Sizing, Backtesting, Drawdowns)",
      "A beginner's guide to risk. We cover mistakes, limitations, and realistic expectations over 40 minutes."
    ));
    expect(v.tier).not.toBe("unsafe");
    expect(v.tier).not.toBe("low");
  });

  it("rewards structured, evidence-based long-form content", () => {
    const v = heuristicAnalyze(META(
      "Sleep Science Explained: Evidence-Based Guide to Better Rest",
      "A full tutorial based on peer-reviewed studies, with sources linked below.",
      45 * 60
    ));
    expect(["high", "verify", "promotional"]).toContain(v.tier);
    expect(v.positives.length).toBeGreaterThan(1);
    expect(v.flags.length).toBe(0);
  });

  it("penalizes ALL-CAPS sensational titles", () => {
    const v = heuristicAnalyze(META("YOU WON'T BELIEVE THIS INSANE METHOD!!!"));
    expect(v.flags.join(" ")).toMatch(/caps|exclamation|sensational/i);
  });
});

describe("capsRatio", () => {
  it("computes uppercase fraction", () => {
    expect(capsRatio("HELLO WORLD")).toBeGreaterThan(0.9);
    expect(capsRatio("Hello world")).toBeLessThan(0.2);
    expect(capsRatio("Hi")).toBe(0);
  });
});

describe("isShort", () => {
  it("catches sub-3-minute videos and #shorts hashtags", () => {
    expect(isShort({ durationSec: 45, title: "Quick tip", description: "" })).toBe(true);
    expect(isShort({ durationSec: 400, title: "My day #shorts", description: "" })).toBe(true);
    expect(isShort({ durationSec: 900, title: "Deep lesson", description: "normal" })).toBe(false);
  });
});

describe("hasChapters", () => {
  it("requires at least two timestamp lines", () => {
    expect(hasChapters("0:00 Intro\n3:40 Main content\n9:12 Recap")).toBe(true);
    expect(hasChapters("Only one 2:30 mention")).toBe(false);
  });
});
