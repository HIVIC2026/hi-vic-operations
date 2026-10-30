import { describe, expect, test } from "bun:test";
import { normaliseForParity, firstDifference, errorCaptures, SCREENS, missingKeyMessage } from "../scripts/installer-speed-capture";

const now = new Date("2026-10-30T10:00:00.000Z");

describe("normaliseForParity", () => {
  test("replaces week, expiresAt and goneIn values with <time>", () => {
    const out = normaliseForParity({ week: "2026-W44", expiresAt: "2027-01-01T00:00:00Z", goneIn: 5, keep: "x" }, now);
    expect(out).toEqual({ week: "<time>", expiresAt: "<time>", goneIn: "<time>", keep: "x" });
  });
  test("replaces ISO timestamps within the last 2 minutes, keeps older and future ones", () => {
    const out = normaliseForParity({ a: "2026-10-30T09:58:30.000Z", b: "2026-10-30T09:57:00.000Z", c: "2026-10-30T10:00:00Z", d: "2026-11-01T00:00:00Z", e: "not a time" }, now);
    expect(out).toEqual({ a: "<time>", b: "2026-10-30T09:57:00.000Z", c: "<time>", d: "2026-11-01T00:00:00Z", e: "not a time" });
  });
  test("sorts arrays of objects with jobId by jobId, at any depth", () => {
    const out = normaliseForParity({ rows: [{ jobId: "b", n: 1 }, { jobId: "a", n: 2 }], deep: { list: [{ jobId: "z" }, { jobId: "m" }] } }, now);
    expect(out).toEqual({ rows: [{ jobId: "a", n: 2 }, { jobId: "b", n: 1 }], deep: { list: [{ jobId: "m" }, { jobId: "z" }] } });
  });
  test("leaves other arrays in their order and everything else identical", () => {
    const input = { list: ["c", "a", "b"], objs: [{ id: 2 }, { id: 1 }], n: 3, f: false, z: null, s: "hello" };
    expect(JSON.stringify(normaliseForParity(input, now))).toBe(JSON.stringify(input));
  });
  test("replaces signed storage URLs with <signed-url>", () => {
    const out = normaliseForParity({ photo: "https://x.supabase.co/storage/v1/object/sign/evidence/a.jpg?token=abc.def.ghi", plain: "https://x.supabase.co/storage/v1/object/public/a.jpg", list: ["https://x.supabase.co/storage/v1/object/sign/b/c.jpg?token=t"] }, now);
    expect(out).toEqual({ photo: "https://x.supabase.co/storage/v1/object/sign/evidence/a.jpg?<signed-token>", plain: "https://x.supabase.co/storage/v1/object/public/a.jpg", list: ["https://x.supabase.co/storage/v1/object/sign/b/c.jpg?<signed-token>"] });
  });
  test("two different signed paths stay different, same path with different tokens match", () => {
    const u = (p: string, t: string) => `https://x.supabase.co/storage/v1/object/sign/${p}?token=${t}`;
    expect(normaliseForParity(u("evidence/a.jpg", "1"), now)).not.toEqual(normaliseForParity(u("evidence/b.jpg", "1"), now));
    expect(normaliseForParity(u("evidence/a.jpg", "1"), now)).toEqual(normaliseForParity(u("evidence/a.jpg", "2"), now));
  });
  test("a timestamp a few seconds after now (made by the loader) is normalised, a minute later is not", () => {
    expect(normaliseForParity({ a: "2026-10-30T10:00:04.000Z", b: "2026-10-30T10:01:00.000Z" }, now)).toEqual({ a: "<time>", b: "2026-10-30T10:01:00.000Z" });
  });
  test("does not change its input", () => {
    const input = { week: "w", rows: [{ jobId: "b" }, { jobId: "a" }] };
    normaliseForParity(input, now);
    expect(input.rows[0]!.jobId).toBe("b");
    expect(input.week).toBe("w");
  });
});

describe("firstDifference", () => {
  test("null when equal, otherwise the first differing path", () => {
    expect(firstDifference({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBeNull();
    expect(firstDifference({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe("a[1].b");
    expect(firstDifference({ a: 1 }, { a: 1, extra: 2 })).toBe("extra");
  });
});

describe("screens and key message", () => {
  test("screen names", () => { expect(SCREENS).toEqual(["home", "job", "day", "business", "money"]); });
  test("missing key message names the variable", () => {
    expect(missingKeyMessage({})).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(missingKeyMessage({ SUPABASE_URL: "u", SUPABASE_SERVICE_ROLE_KEY: "k", SUPABASE_PUBLISHABLE_KEY: "p" })).toBeNull();
  });
});

describe("errorCaptures", () => {
  test("lists loaders that returned only an error record", () => {
    expect(errorCaptures({ a: { error: "nope" }, b: { error: "x", other: 1 }, c: { rows: [] }, d: null })).toEqual(["a"]);
  });
});
