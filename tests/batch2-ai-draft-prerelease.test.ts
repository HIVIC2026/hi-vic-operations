// Batch 2 task 3: AI email drafts follow the spot-only rule (decision 388) for owners not yet released and confirmed.
import { describe, expect, mock, test } from "bun:test";
import { AI_BUSINESS_RULES, AI_BUSINESS_RULES_PRE_RELEASE, AI_REPLY_INSTRUCTIONS, aiReplyInstructions, aiReplyProblems, buildAiReplyInput, isPreRelease } from "../src/lib/ai-email-reply.core";
import { PRE_RELEASE_FORBIDDEN, SPOT_RELEASE_LINE, preReleaseViolations } from "../src/lib/spot-only-copy.core";

const ctx = { jobNumber: "HV-1", ownerFirstName: "Sam", stageLabel: "Ready Check ready to schedule", facts: ["Their spot is saved."], links: [], changeLink: null, history: [], email: { from: "sam@x.au", subject: "Hi", body: "When is my turn?" } };

describe("pre-release prompt", () => {
  test("has no forbidden phrase and carries the spot-only line", () => {
    const text = [aiReplyInstructions({ preRelease: true }), buildAiReplyInput(ctx, { preRelease: true })].join("\n");
    expect(preReleaseViolations(text)).toEqual([]);
    expect(PRE_RELEASE_FORBIDDEN.test(text)).toBe(false);
    expect(text).toContain(SPOT_RELEASE_LINE);
    expect(AI_BUSINESS_RULES_PRE_RELEASE.join(" ")).not.toMatch(/ready check/i);
  });
  test("released owners keep today's prompt unchanged", () => {
    expect(aiReplyInstructions({ preRelease: false })).toBe(AI_REPLY_INSTRUCTIONS);
    expect(aiReplyInstructions()).toBe(AI_REPLY_INSTRUCTIONS);
    expect(AI_REPLY_INSTRUCTIONS).toContain("free Ready Check");
    const out = buildAiReplyInput(ctx);
    expect(out).toContain("Current stage: Ready Check ready to schedule");
    for (const r of AI_BUSINESS_RULES) expect(out).toContain(r);
  });
  test("only a confirmed spot counts as released", () => {
    expect(isPreRelease({ state: "none" })).toBe(true);
    expect(isPreRelease(null)).toBe(true);
    expect(isPreRelease({ state: "pending" } as never)).toBe(true);
    expect(isPreRelease({ state: "declined" } as never)).toBe(true);
    expect(isPreRelease({ state: "confirmed" } as never)).toBe(false);
  });
});

describe("aiReplyProblems", () => {
  const bad = "Hi Sam,\n\nWe'll text you for your free Ready Check soon.";
  test("pre-release flags the Ready Check wording", () => expect(aiReplyProblems(bad, { preRelease: true }).length).toBeGreaterThan(0));
  test("released owner: same body has no pre-release problem", () => { expect(aiReplyProblems(bad, { preRelease: false })).toEqual([]); expect(aiReplyProblems(bad)).toEqual([]); });
  test("the spot-only line passes", () => expect(aiReplyProblems(`Hi Sam,\n\n${SPOT_RELEASE_LINE}`, { preRelease: true })).toEqual([]));
});

describe("sendAiDraft re-checks on Send", () => {
  const events: Record<string, unknown>[] = [];
  const draft = { id: "d1", job_id: "j1", event_type: "email_ai_draft", details: { to: "sam@x.au", subject: "Re: Hi", message_id: "m1" } };
  let releaseRows: unknown[] = [];
  const q = (table: string) => {
    const st: { table: string; ev?: string } = { table };
    const b: Record<string, unknown> = {};
    const self = () => b;
    for (const f of ["select", "eq", "in", "contains", "limit", "order"]) b[f] = (...a: unknown[]) => { if (f === "eq" && a[0] === "event_type") st.ev = String(a[1]); return self(); };
    b["maybeSingle"] = async () => ({ data: table === "workflow_events" ? draft : table === "jobs" ? { id: "j1", source: "qa_test", owner_id: "o1" } : { email: "sam@x.au" }, error: null });
    b["insert"] = async (r: Record<string, unknown>) => { events.push(r); return { error: null }; };
    b["then"] = (res: (v: unknown) => void) => res({ data: table === "workflow_events" && st.ev === undefined ? [] : [], error: null });
    return b;
  };
  mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: q } }));
  mock.module("../src/lib/spot-release.server", () => ({ spotReleaseStates: async (ids: string[]) => new Map(ids.map((i) => [i, releaseRows[0] ?? { state: "none" }])) }));
  test("a pre-release owner's draft with Ready Check wording is refused", async () => {
    releaseRows = [{ state: "none" }];
    const { sendAiDraft } = await import("../src/lib/ai-email-reply.server");
    await expect(sendAiDraft("d1", "Hi Sam,\n\nYour free Ready Check is coming.\n\nCheers, the Home Insulation Victoria team", "u1")).rejects.toThrow(/released/);
    expect(events).toEqual([]);
  });
});
