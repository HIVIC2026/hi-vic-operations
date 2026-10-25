// Actual router, isolated reads and stubbed senders only. No hosted writes or delivery.
import { beforeEach, expect, mock, test } from "bun:test";
let desk: string | null, outcome: string | null, media: boolean, readError: boolean, insulation: string;
let manualOnly = false;
let calls: string[], reviewOrders: unknown[], senderResult: { outcome: string; detail: string };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from(table: string) {
  let fields = "";
  const answer = () => {
    if (table === "jobs" && fields === "created_at, job_number") return { data: { created_at: "2026-10-19T00:00:00Z" }, error: null };
    if (table === "customer_email_sends" || table === "job_communications") return { data: null, error: null, count: 0 };
    if (table === "lead_campaign_responses") return { data: { desk_check_status: desk }, error: readError ? {} : null };
    if (table === "customer_engagement_events") return { data: outcome ? [{ metadata: { outcome, manualOnly } }] : [], error: null };
    if (table === "post_intake_work") return { data: null, error: null };
    if (table === "jobs" && fields === "job_number") return { data: { job_number: "HV-ORDINARY" }, error: null };
    return { data: { source: "base44", channel: "hivic_sourced", eligibility_outcome: "needs_onsite_confirmation", eligibility_decision_source: "system", eligibility_review_required: false, estimated_area_m2: 150, estimated_area_unknown: false, properties: { enrichment: { base44: { raw: { answers: { existing_insulation: insulation } } } } } }, error: null };
  };
  const q = { select(s: string) { fields = s; return q; }, eq() { return q; }, in() { return q; }, or() { return q; }, neq() { return q; }, // or/neq: the history check (Jo 21 Oct) — counts are answered as 0 above
    order(key: string, options: unknown) { reviewOrders.push([key, options]); return q; }, limit() { return q; },
    maybeSingle: async () => answer(), then(resolve: (v: unknown) => unknown) { return Promise.resolve(answer()).then(resolve); } };
  return q;
} } }));
mock.module("../src/lib/save-spot-rules.server", () => ({ readAutomaticRules: async () => ({ state: "ok", config: { enabled: true, activatedAt: "2026-10-18T00:00:00Z" } }) }));
mock.module("../src/lib/group-b-media.server", () => ({ groupBMediaForJob: async () => ({ received: media, uncertain: false, excluded: media, count: media ? 1 : 0, pendingSync: false }) }));
mock.module("../src/lib/estimatelink.server", () => ({ syncStep3: async () => { calls.push("sync"); } }));
mock.module("../src/lib/hot-leads-send.server", () => ({
  sendExistingInsulationSaveSpot: async (id: string, actor: string | null, preview: boolean) => { expect([id, actor, preview]).toEqual(["job", null, false]); calls.push("T3/T4"); return senderResult; },
  sendAutomaticInsulationDetails: async () => { calls.push("T5/T6"); return { outcome: "sent", detail: "stub" }; },
}));
const { maybeAutoRouteLeadEmail } = await import("../src/lib/lead-email-routing.server");
beforeEach(() => { manualOnly = false; desk = null; outcome = null; media = false; readError = false; insulation = "present"; calls = []; reviewOrders = []; senderResult = { outcome: "sent", detail: "stub" }; });
test("both approved facts choose guarded T3/T4, never a repeat request", async () => {
  desk = "looks_eligible"; outcome = "below_r2"; media = true;
  expect(await maybeAutoRouteLeadEmail("job")).toEqual({ route: "offer_spot", sent: true, reason: "stub" });
  expect(calls).toEqual(["T3/T4"]);
  // Selector + T3/T4 re-check each read the LATEST review only.
  expect(reviewOrders).toEqual([["occurred_at", { ascending: false }], ["occurred_at", { ascending: false }], ["occurred_at", { ascending: false }]]);
});
test("latest no_insulation review routes the actual router to T1/T2 (offer_spot), never T5/T6", async () => {
  outcome = "no_insulation"; media = true;
  const { selectLeadEmailRoute } = await import("../src/lib/lead-email-routing.server");
  const r = await selectLeadEmailRoute("job");
  expect(r?.email).toBe("none"); // still needs the admin likely_eligible decision recorded by the review action
  expect(calls).not.toContain("T5/T6");
});
test("the T3/T4 sender's blocked outcome is preserved, not replaced by T5/T6", async () => {
  desk = "looks_eligible"; outcome = "below_r2"; senderResult = { outcome: "blocked", detail: "Consent blocked" };
  expect(await maybeAutoRouteLeadEmail("job")).toEqual({ route: "offer_spot", sent: false, reason: "Consent blocked" });
  expect(calls).toEqual(["T3/T4"]);
});
test("unreviewed received media reaches the approved acknowledgement sender", async () => {
  media = true;
  expect(await maybeAutoRouteLeadEmail('job')).toMatchObject({ route: 'request_insulation', sent: true });
  expect(calls).toEqual(['sync', 'T5/T6']); // real acknowledgement rendering is in the actual-chain test
});
test("an Office manual-only review still holds automatic sending", async () => {
  media = true; manualOnly = true;
  for (const value of ['below_r2', 'over_r2', 'unclear', 'no_insulation']) {
    outcome = value;
    expect(await maybeAutoRouteLeadEmail('job')).toMatchObject({ sent: false, reason: 'Office review recorded; manual next action only.' });
  }
  expect(calls).toEqual([]);
});
test("ordinary no-media request keeps T5/T6", async () => {
  for (const value of ["present", "unknown"]) {
    insulation = value; calls = [];
    expect((await maybeAutoRouteLeadEmail("job")).route).toBe("request_insulation");
    expect(calls).toEqual(["sync", "T5/T6"]);
  }
});
test("failed review reads hold without any sender call", async () => {
  readError = true;
  expect((await maybeAutoRouteLeadEmail("job")).sent).toBe(false);
  expect(calls).toEqual([]);
});