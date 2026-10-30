import { describe, expect, test } from "bun:test";
import { median, maxOf, serverFnName, summariseRuns, formatTable, parseArgs, reportFileName } from "../scripts/installer-speed.core";

describe("median / max", () => {
  test("median of odd, even, unsorted and empty lists", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
  test("max", () => {
    expect(maxOf([5, 9, 2])).toBe(9);
    expect(maxOf([])).toBeNull();
  });
});

describe("serverFnName", () => {
  test("keeps the readable tail of a server function URL and drops the query", () => {
    expect(serverFnName("https://x.test/_serverFn/src_lib_trade-view_functions_ts--getTradeDayView_createServerFn_handler?payload=abc")).toBe("getTradeDayView");
    expect(serverFnName("https://x.test/_serverFn/eyJmaWxlIjoiYWJjIn0")).toBe("eyJmaWxlIjoiYWJjIn0");
  });
});

describe("summariseRuns", () => {
  const run = (ms: number, calls: [string, number][]) => ({ ms, calls: calls.map(([name, ms]) => ({ name, ms })) });
  test("median/slowest ms, median call count, slowest single call", () => {
    const r = summariseRuns("home", "owner", [run(900, [["a", 100], ["b", 300]]), run(1200, [["a", 150]]), run(1000, [["a", 90], ["b", 700], ["c", 10]])]);
    expect(r).toEqual({ screen: "home", role: "owner", medianMs: 1000, slowestMs: 1200, calls: 2, slowest: { name: "b", ms: 700 }, note: null });
  });
  test("refused runs are recorded as expected refusal, not a failure", () => {
    const r = summariseRuns("money", "staff", [{ ms: 400, calls: [], refused: true }, { ms: 500, calls: [], refused: true }]);
    expect(r.note).toBe("refused (expected)");
    expect(r.medianMs).toBe(450);
  });
  test("a failed run is shown as a failure", () => {
    const r = summariseRuns("day", "owner", [{ ms: 0, calls: [], error: "timeout" }]);
    expect(r.note).toBe("FAILED: timeout");
    expect(r.medianMs).toBeNull();
  });
});

describe("formatTable", () => {
  test("markdown table with the six columns", () => {
    const md = formatTable([
      { screen: "home", role: "owner", medianMs: 1000, slowestMs: 1200, calls: 2, slowest: { name: "b", ms: 700 }, note: null },
      { screen: "money", role: "staff", medianMs: 450, slowestMs: 500, calls: 0, slowest: null, note: "refused (expected)" },
    ]);
    expect(md.split("\n")).toEqual([
      "| screen | role | median ms | slowest ms | server calls | slowest call (name, ms) |",
      "|---|---|---|---|---|---|",
      "| home | owner | 1000 | 1200 | 2 | b, 700 |",
      "| money | staff | 450 | 500 | 0 | refused (expected) |",
    ]);
  });
});

describe("parseArgs / reportFileName", () => {
  test("defaults to all screens and rejects unknown ones", () => {
    expect(parseArgs(["--base", "https://p.test/", "--label", "before"])).toEqual({ base: "https://p.test", label: "before", screens: ["home", "job", "day", "business", "money"] });
    expect(parseArgs(["--base", "https://p.test", "--label", "after-job", "--screens", "job,day"]).screens).toEqual(["job", "day"]);
    expect(() => parseArgs(["--base", "https://p.test", "--label", "before", "--screens", "nope"])).toThrow(/unknown screen/i);
    expect(() => parseArgs(["--label", "before"])).toThrow(/--base/);
    expect(() => parseArgs(["--base", "https://p.test", "--label", "bad label!"])).toThrow(/--label/);
  });
  test("report file name", () => {
    expect(reportFileName("2026-10-30", "after-job")).toBe("qa/installer-speed/2026-10-30-after-job.md");
  });
});
