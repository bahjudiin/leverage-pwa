import { describe, expect, it } from "vitest";
import { compactDescription, formatTimestamp, parseChapters, tsToSeconds } from "../parse";

describe("parseChapters", () => {
  it("extracts chapters in order with cleaned labels", () => {
    const desc = [
      "Learn everything in this video!",
      "0:00 Intro",
      "2:35 - The core concept",
      "18:04 Advanced tactics",
      "1:02:10 Wrap up",
    ].join("\n");
    const ch = parseChapters(desc);
    expect(ch.map((c) => c.seconds)).toEqual([0, 155, 1084, 3730]);
    expect(ch[1].label).toBe("The core concept");
    expect(ch[3].label).toBe("Wrap up");
  });

  it("returns [] when fewer than 2 chapters exist", () => {
    expect(parseChapters("see 4:20 for details")).toEqual([]);
  });

  it("dedupes identical timestamps", () => {
    const ch = parseChapters("0:00 A\n0:00 A again\n5:00 B");
    expect(ch.map((c) => c.seconds)).toEqual([0, 300]);
  });

  it("drops timestamps beyond the video duration", () => {
    const ch = parseChapters("0:00 Intro\n9:00 Real\n99:00 Out of range", 600);
    expect(ch.map((c) => c.seconds)).toEqual([0, 540]);
  });

  it("handles bullet prefixes", () => {
    const ch = parseChapters("• 0:00 Intro\n- 3:30 Body");
    expect(ch).toHaveLength(2);
    expect(ch[1].label).toBe("Body");
  });
});

describe("timestamp helpers", () => {
  it("tsToSeconds", () => {
    expect(tsToSeconds(undefined, "2", "35")).toBe(155);
    expect(tsToSeconds("1", "02", "10")).toBe(3730);
  });
  it("formatTimestamp", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(155)).toBe("2:35");
    expect(formatTimestamp(3730)).toBe("1:02:10");
  });
});

describe("compactDescription", () => {
  it("strips URLs and clamps length", () => {
    const out = compactDescription("Check https://example.com/x for more.\nReal content here.\n\n\n", 1000);
    expect(out).not.toMatch(/https?:/);
    expect(out).toContain("Real content here.");
  });
});
