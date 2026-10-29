// Batch 2 task 3: sendAiDraft re-checks the spot-only rule against the CURRENT release state. Own file because it mocks modules.
import { afterAll, describe, expect, mock, test } from "bun:test";

const realClient = { ...(await import("../src/integrations/supabase/client.server")) };
const realRelease = { ...(await import("../src/lib/spot-release.server")) };
const realTestSend = { ...(await import("../src/lib/test-send.server")) };
const realOutlook = { ...(await import("../src/lib/outlook-sync.server")) };
const realOwnerSend = { ...(await import("../src/lib/owner-email-send.server")) };

const world = { channel: "hivic_sourced", stage: "preliminary_estimate_ready", state: "none" as string, inserts: [] as Record<string, unknown>[], sent: 0, jobReads: 0, failLaterJobReads: false };
const draft = { id: "d1", job_id: "j1", event_type: "email_ai_draft", details: { to: "sam@x.au", subject: "Re: Hi", message_id: "m1" } };
const q = (table: string) => {
  const b: Record<string, unknown> = {};
  for (const f of ["select", "eq", "in", "contains", "limit", "order"]) b[f] = () => b;
  b["maybeSingle"] = async () => {
    if (table === "jobs" && ++world.jobReads > 1 && world.failLaterJobReads) return { error: { message: "read failed" }, data: null };
    return { error: null, data: table === "workflow_events" ? draft : table === "jobs" ? { id: "j1", source: "qa_test", owner_id: "o1", channel: world.channel, stage: world.stage } : { email: "sam@x.au" } };
  };
  b["insert"] = (r: Record<string, unknown>) => { world.inserts.push(r); const done = { error: null, data: { id: "h1" } }; return Object.assign(Promise.resolve({ error: null }), { then: (f: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(f), select: () => ({ single: () => Promise.resolve(done) }) }); };
  b["then"] = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  return b;
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: q } }));
mock.module("../src/lib/spot-release.server", () => ({ spotReleaseStates: async (ids: string[]) => new Map(ids.map((i) => [i, { state: world.state }])) }));
mock.module("../src/lib/test-send.server", () => ({ sendTestEmail: async () => { world.sent++; return { status: "sent", detail: "" }; } }));
mock.module("../src/lib/outlook-sync.server", () => ({ archiveOutlookMessage: async () => undefined }));
// Emails-tab replies now go through Outlook via sendGuardedOwnerEmail (email-sent-visibility); count sends there too.
mock.module("../src/lib/owner-email-send.server", () => ({ sendGuardedOwnerEmail: async () => { world.sent++; return "sent"; } }));
afterAll(() => {
  mock.module("@/integrations/supabase/client.server", () => realClient);
  mock.module("../src/lib/spot-release.server", () => realRelease);
  mock.module("../src/lib/test-send.server", () => realTestSend);
  mock.module("../src/lib/outlook-sync.server", () => realOutlook);
  mock.module("../src/lib/owner-email-send.server", () => realOwnerSend);
});

const BAD = "Hi Sam,\n\nYour free Ready Check is coming this week.\n\nCheers, the Home Insulation Victoria team";
const reset = (o: Partial<typeof world>) => { Object.assign(world, { channel: "hivic_sourced", stage: "preliminary_estimate_ready", state: "none", inserts: [], sent: 0, jobReads: 0, failLaterJobReads: false }, o); };

describe("sendAiDraft and the spot-only rule", () => {
  test("pre-release owner: Ready Check wording is refused, nothing sent", async () => {
    reset({});
    const { sendAiDraft } = await import("../src/lib/ai-email-reply.server");
    const r = await sendAiDraft("d1", BAD, "u1");
    expect(r.status).toBe("rewritten");
    if (r.status !== "rewritten") throw new Error("expected rewritten");
    expect(r.problems.join(" ")).toMatch(/released/);
    expect(world.sent).toBe(0);
    expect(world.inserts.some((i) => i["event_type"] === "email_ai_draft_edited")).toBe(true);
    expect(world.inserts.some((i) => i["event_type"] === "email_ai_draft_sent")).toBe(false);
  });
  test("confirmed owner: the same reply goes", async () => {
    reset({ state: "confirmed" });
    const { sendAiDraft } = await import("../src/lib/ai-email-reply.server");
    expect((await sendAiDraft("d1", BAD, "u1")).status).toBe("sent");
    expect(world.sent).toBe(1);
  });
  test("job past the Ready Check with no release event: the same reply goes", async () => {
    reset({ stage: "ready_check_scheduled" });
    const { sendAiDraft } = await import("../src/lib/ai-email-reply.server");
    expect((await sendAiDraft("d1", BAD, "u1")).status).toBe("sent");
  });
  test("final fix: does not fail open — the job already read at Send decides, a failing second read can't let it through", async () => {
    reset({ failLaterJobReads: true });
    const { sendAiDraft } = await import("../src/lib/ai-email-reply.server");
    expect((await sendAiDraft("d1", BAD, "u1")).status).toBe("rewritten");
    expect(world.sent).toBe(0);
  });
  test("F1: owner already offered times (awaiting acceptance) is not pre-release at Send", async () => {
    reset({ stage: "ready_check_awaiting_acceptance" });
    const { sendAiDraft } = await import("../src/lib/ai-email-reply.server");
    expect((await sendAiDraft("d1", BAD, "u1")).status).toBe("sent");
  });
  test("uses the CURRENT state at Send, not the state at draft time", async () => {
    const { sendAiDraft } = await import("../src/lib/ai-email-reply.server");
    reset({ state: "none" });
    expect((await sendAiDraft("d1", BAD, "u1")).status).toBe("rewritten");
    world.state = "confirmed"; // owner confirms between drafting and Send
    expect((await sendAiDraft("d1", BAD, "u1")).status).toBe("sent");
    world.state = "none"; // back to unconfirmed (new release) -> refused again
    expect((await sendAiDraft("d1", BAD, "u1")).status).toBe("rewritten");
  });
});

// AI replies step 2 task 4, fix round 1: a sign-off-only reply or one with an AI office note is never sent.
describe("sendAiDraft refuses empty and marker replies", () => {
  test("sign-off only: rewritten, nothing sent", async () => {
    reset({ state: "confirmed" });
    const { sendAiDraft } = await import("../src/lib/ai-email-reply.server");
    const r = await sendAiDraft("d1", "\n\nCheers, the Home Insulation Victoria team", "u1");
    expect(r.status).toBe("rewritten");
    if (r.status !== "rewritten") throw new Error("expected rewritten");
    expect(r.problems).toContain("The reply is empty.");
    expect(world.sent).toBe(0);
    expect(world.inserts.some((i) => i["event_type"] === "email_ai_draft_sent")).toBe(false);
  });
  test("NEEDS_JO left in (the fix call can't remove it): rewritten, nothing sent", async () => {
    reset({ state: "confirmed" });
    const { sendAiDraft } = await import("../src/lib/ai-email-reply.server");
    const r = await sendAiDraft("d1", "Hi Sam,\n\nThanks.\nNEEDS_JO: solar?\n\nCheers, the Home Insulation Victoria team", "u1");
    expect(r.status).toBe("rewritten");
    if (r.status !== "rewritten") throw new Error("expected rewritten");
    expect(r.problems.join(" ")).toContain("NEEDS_JO");
    expect(world.sent).toBe(0);
  });
});
