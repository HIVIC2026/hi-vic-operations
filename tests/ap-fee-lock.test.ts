import { describe, expect, test } from "bun:test";
import {
  AP_FEE_LOCKED_MESSAGE, HIVIC_OWNER_USER_ID, applyApFeeChange, apFeeEditorView, apFeeLockedByQuotes,
  type ApFeeJobState, type ApFeeRepo, type QuoteLockRow,
} from "../src/lib/ap-fee.core";
import { readFileSync } from "node:fs";

const JOB = "00000000-0000-0000-0000-000000000001";
const OTHER = "11111111-1111-1111-1111-111111111111";
const ALLOWED = [HIVIC_OWNER_USER_ID];

function fakeRepo(quotes: QuoteLockRow[], opts: { acceptDuringWrite?: boolean } = {}) {
  const state = {
    quotes: [...quotes],
    job: { ap_fee_override_inc_gst: null, ap_fee_override_reason: null, ap_fee_override_by: null, ap_fee_override_at: null } as ApFeeJobState,
    acceptedQuoteTotal: 2698, invoice: { total: 2698 }, payout: { amount: 1500 },
    audits: [] as { type: string; summary: string; details: Record<string, unknown>; actor: string }[],
    writes: 0,
  };
  const repo: ApFeeRepo = {
    loadInstallationQuotes: async () => state.quotes.map((q) => ({ ...q })),
    loadJob: async () => ({ ...state.job }),
    writeJob: async (_j, next) => {
      state.writes++; state.job = { ...next };
      if (opts.acceptDuringWrite) state.quotes = state.quotes.map((q) => ({ ...q, status: "accepted", accepted_at: "2026-10-02T00:00:01Z" }));
    },
    audit: async (_j, actor, type, summary, details) => { state.audits.push({ type, summary, details, actor }); },
    now: () => "2026-10-02T00:00:00.000Z",
  };
  return { repo, state };
}
const issued: QuoteLockRow = { id: "q1", status: "issued", accepted_at: null };
const accepted: QuoteLockRow = { id: "q1", status: "accepted", accepted_at: "2026-10-02T00:00:00Z" };
const run = (repo: ApFeeRepo, actorId: string, reason: string, amount: number | null = 299) =>
  applyApFeeChange(repo, { actorId, allowedUserIds: ALLOWED, jobId: JOB, amount, reason });

describe("C04 before acceptance", () => {
  test("owner can change the fee with a reason; old/new amount, reason, actor and time are recorded", async () => {
    const { repo, state } = fakeRepo([issued]);
    state.job.ap_fee_override_inc_gst = 349;
    await run(repo, HIVIC_OWNER_USER_ID, "Repeat customer discount");
    expect(state.job.ap_fee_override_inc_gst).toBe(299);
    const a = state.audits.find((x) => x.type === "ap_fee_override")!;
    expect(a.details).toEqual({ old_amount: 349, new_amount: 299, reason: "Repeat customer discount", actor: HIVIC_OWNER_USER_ID, at: "2026-10-02T00:00:00.000Z" });
  });
  test("blank or whitespace-only reason is refused", async () => {
    for (const r of ["", "   ", "\t\n"]) {
      const { repo, state } = fakeRepo([issued]);
      await expect(run(repo, HIVIC_OWNER_USER_ID, r)).rejects.toThrow("A reason is required");
      expect(state.writes).toBe(0);
    }
  });
});

describe("C04 wrong account", () => {
  test("every other account is refused before acceptance, even with a reason", async () => {
    for (const id of [OTHER, "admin-test", ""]) {
      const { repo, state } = fakeRepo([issued]);
      await expect(run(repo, id, "Good reason")).rejects.toThrow("Only the Home Insulation Victoria owner");
      expect(state.writes).toBe(0);
    }
  });
  test("server uses the signed-in identity, not browser input, and does not rely on the UI", () => {
    const src = readFileSync("src/lib/installer-invoice.functions.ts", "utf8");
    const fn = src.slice(src.indexOf("export const setApFeeOverride"));
    expect(fn).toContain("requireSupabaseAuth");
    expect(fn).toContain("actorId: context.userId");
    expect(fn).toContain("applyApFeeChange(");
    const validator = fn.slice(fn.indexOf("inputValidator"), fn.indexOf(".handler"));
    expect(validator).not.toMatch(/email|actor|userId/i);
  });
});

describe("C04 after acceptance", () => {
  for (const [label, actor] of [["owner", HIVIC_OWNER_USER_ID], ["other account", OTHER]] as const) {
    test(`${label} is refused; nothing changes; refusal audited`, async () => {
      const { repo, state } = fakeRepo([accepted]);
      state.job.ap_fee_override_inc_gst = 349;
      await expect(run(repo, actor, "Late change")).rejects.toThrow(AP_FEE_LOCKED_MESSAGE);
      expect(state.writes).toBe(0);
      expect(state.job.ap_fee_override_inc_gst).toBe(349);
      expect(state.acceptedQuoteTotal).toBe(2698);
      expect(state.invoice).toEqual({ total: 2698 });
      expect(state.payout).toEqual({ amount: 1500 });
      expect(state.audits.map((a) => a.type)).toEqual(["ap_fee_override_refused"]);
    });
  }
  test("direct call / stale or replayed pre-acceptance request is refused (state read at call time)", async () => {
    const { repo, state } = fakeRepo([issued]);
    const replay = { actorId: HIVIC_OWNER_USER_ID, allowedUserIds: ALLOWED, jobId: JOB, amount: 199, reason: "Prepared before acceptance" };
    state.quotes = [accepted]; // customer accepts after the browser built the request
    await expect(applyApFeeChange(repo, replay)).rejects.toThrow(AP_FEE_LOCKED_MESSAGE);
    expect(state.writes).toBe(0);
  });
  test("reset to standard (amount null) is also refused", async () => {
    const { repo } = fakeRepo([accepted]);
    await expect(run(repo, HIVIC_OWNER_USER_ID, "Reset", null)).rejects.toThrow(AP_FEE_LOCKED_MESSAGE);
  });
});

describe("C04 state boundaries", () => {
  test("immediately before acceptance (issued) is allowed", async () => {
    const { repo } = fakeRepo([issued]);
    await expect(run(repo, HIVIC_OWNER_USER_ID, "Before")).resolves.toEqual({ ok: true });
  });
  test("acceptance landing during the change undoes the write", async () => {
    const { repo, state } = fakeRepo([issued], { acceptDuringWrite: true });
    state.job.ap_fee_override_inc_gst = 349;
    await expect(run(repo, HIVIC_OWNER_USER_ID, "Racing")).rejects.toThrow(AP_FEE_LOCKED_MESSAGE);
    expect(state.job.ap_fee_override_inc_gst).toBe(349);
    expect(state.audits.some((a) => a.type === "ap_fee_override")).toBe(false);
  });
  test("with the database safeguard, a change that committed before acceptance stands and is audited", async () => {
    const { repo, state } = fakeRepo([issued], { acceptDuringWrite: true });
    let n = 0; const write = repo.writeJob;
    repo.writeJob = async (j, next) => { if (++n > 1) throw new Error(AP_FEE_LOCKED_MESSAGE); return write(j, next); };
    await expect(run(repo, HIVIC_OWNER_USER_ID, "Just before")).resolves.toEqual({ ok: true });
    expect(state.job.ap_fee_override_inc_gst).toBe(299);
    expect(state.audits.map((a) => a.type)).toEqual(["ap_fee_override"]);
  });
  test("after acceptance is locked", () => expect(apFeeLockedByQuotes([accepted])).toBe(true));
  test("cancelled/declined/superseded quotes never accepted do not lock", () => {
    expect(apFeeLockedByQuotes([{ id: "a", status: "declined", accepted_at: null }, { id: "b", status: "superseded", accepted_at: null }, { id: "c", status: "draft", accepted_at: null }])).toBe(false);
  });
  test("an accepted quote later superseded or replaced keeps the fee locked", () => {
    expect(apFeeLockedByQuotes([{ id: "old", status: "superseded", accepted_at: "2026-10-01T00:00:00Z" }, { id: "new", status: "draft", accepted_at: null }])).toBe(true);
  });
});

describe("C04 screen", () => {
  test("before acceptance only the owner sees the editor", () => {
    expect(apFeeEditorView({ canChange: true, locked: false })).toBe("editor");
    expect(apFeeEditorView({ canChange: false, locked: false })).toBe("not_allowed");
  });
  test("after acceptance nobody sees the editor", () => {
    expect(apFeeEditorView({ canChange: true, locked: true })).toBe("locked");
    expect(apFeeEditorView({ canChange: false, locked: true })).toBe("locked");
  });
  test("locked message and no reconfirmation action (the co-branded invoice panel left the O2 Job page)", () => {
    expect(AP_FEE_LOCKED_MESSAGE).toBe("AP fee locked after customer acceptance");
    const fn = readFileSync("src/lib/installer-invoice.functions.ts", "utf8");
    expect(fn).toContain("canChangeApFee: !apFeeLocked &&");
  });
});
