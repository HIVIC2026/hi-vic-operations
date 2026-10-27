// Actual save → persisted snapshot → canonical email builder, sealed in-memory records only.
import { beforeEach, expect, mock, test } from "bun:test";
import { renderSpotSavedEmail } from "../src/lib/spot-saved-messages.core";
import { REMOVAL_BUDGET_EMAIL_NOTE } from "../src/lib/estimate-removal.core";

const token = "a".repeat(64), estimateToken = "b".repeat(64);
let response: Record<string, any> | null = null;
let removal: Record<string, any> = { removal: 1500, removal_m2: 100 };
let preparations = 0, sends = 0;
let estimateReady = true;
let builtEmails: ReturnType<typeof renderSpotSavedEmail>[] = [];
let removalEstimateIds: unknown[] = [];
const job = { id: "job", source: "base44", stage: "ready_check_ready_to_schedule", owners: { full_name: "Victor Test", email: "victor@example.org.au", phone: null }, properties: { address_line: "1 Test St", suburb: "Ballarat", postcode: "3350" } };
const estimate = () => ({ id: "saved-estimate", area_m2: 100, insulation_declared: "unknown", scenarios: [{ ...removal, by_access: { standard: { estimated_customer_total: 4098, applied_discount: 1400, pre_discount_total: 5498 } } }] });
const events: string[] = [];
mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: { from(table: string) {
  let op = "select", payload: Record<string, any> = {}, columns = "";
  const filters: Record<string, unknown> = {};
  const q: any = {
    select(c: string) { columns = c; return q; }, eq(k: string, v: unknown) { filters[k] = v; return q; },
    is() { return q; }, in() { return q; }, order() { return q; }, limit() { return q; },
    upsert(p: Record<string, any>) { op = "upsert"; payload = p; return q; },
    update(p: Record<string, any>) { op = "update"; payload = p; return q; },
    insert(p: Record<string, any>) { op = "insert"; payload = p; return q; },
    maybeSingle() { return Promise.resolve(result()); }, single() { return Promise.resolve(result()); },
    then(resolve: any, reject: any) { return Promise.resolve(result()).then(resolve, reject); },
  };
  function result(): { data: any; error: null; count?: number } {
    if (table === "customer_estimate_links") return { data: { id: filters.purpose === "preliminary_save_spot" ? "preliminary-link" : "estimate-link", token: filters.purpose === "preliminary_save_spot" ? token : estimateToken, job_id: "job", status: "active", expires_at: "2099-01-01T00:00:00Z" }, error: null };
    if (table === "jobs") return { data: job, error: null };
    if (table === "lead_campaign_responses") {
      if (op === "upsert" && !response) { response = payload; return { data: [{ id: "response" }], error: null }; }
      if (op === "update" && !response?.spot_saved_at) { response = { ...response, ...payload }; return { data: [{ id: "response" }], error: null }; }
      return { data: op === "select" ? response : [], error: null };
    }
    if (table === "indicative_estimates") {
      if (columns === "scenarios") removalEstimateIds.push(filters.id);
      return { data: estimateReady ? estimate() : null, error: null };
    }
    if (table === "workflow_settings") return { data: { customer_comms_enabled: true, sms_message_switches: { spot_saved_email: false, spot_saved: true } }, error: null };
    if (table === "workflow_events") return { data: events.includes(String(filters.event_type)) ? { id: "event" } : null, error: null };
    if (table === "job_communications" && op === "insert") {
      builtEmails.push({ subject: payload.subject, html: "", text: payload.body });
    }
    return { data: null, count: 0, error: null };
  }
  return q;
}, async rpc(name: string, args: Record<string, any>) {
  if (name === 'save_campaign_spot_atomic') {
    if (!response?.spot_saved_at) response = { ...response, ...args.p_snapshot, estimate_link_id: args.p_link, spot_saved_at: '2026-10-27T05:16:00Z' };
    if (!events.includes('campaign_spot_saved')) events.push('campaign_spot_saved');
    job.stage = 'ready_check_ready_to_schedule';
  }
  return { data: true, error: null };
} } }));
mock.module("../src/lib/workflow.server", () => ({ logEvent: async (_j: string, _a: unknown, e: string) => { events.push(e); }, transition: async () => {} }));
mock.module("../src/lib/job-live.server", () => ({ jobDeletedBlocker: async () => null }));
mock.module("../src/lib/comms.server", () => ({ hasCurrentOwnerContactConsent: async () => true }));
mock.module("../src/lib/estimatelink.server", () => ({ syncStep3: async () => { preparations++; } }));
mock.module("../src/lib/emailsafety.server", () => ({ unsubscribeUrlForJob: async () => "https://estimate.homeinsulationvictoria.com.au/remove/test" }));
mock.module("../src/lib/referral.server", () => ({ referralUrlForJob: async () => null }));
mock.module("../src/lib/hot-leads-send.server", () => ({ resendSend: async () => { sends++; throw new Error("No sends allowed"); } }));
mock.module("../src/lib/sms.server", () => ({ sendRealSms: async () => { sends++; throw new Error("No sends allowed"); } }));
const { savePreliminarySpot } = await import("../src/lib/email-preliminary-offer.server");
const { buildSpotSavedMessages } = await import("../src/lib/spot-saved-send.server");

beforeEach(() => { response = null; events.length = 0; preparations = 0; sends = 0; builtEmails = []; removalEstimateIds = []; estimateReady = true; removal = { removal: 1500, removal_m2: 100 }; });
test("first save freezes entered size and primary estimate; canonical confirmation uses saved prices and removal", async () => {
  await savePreliminarySpot(token);
  expect(response?.saved_area_m2).toBe(100);
  expect(response?.saved_total).toBe(4098);
  expect(response?.saved_gross_total).toBe(5498);
  expect(response?.saved_veu_discount).toBe(1400);
  expect(response?.saved_estimate_id).toBe("saved-estimate");
  expect(response?.estimate_link_id).toBe("estimate-link");
  expect(preparations).toBe(1);
  const messages = await buildSpotSavedMessages("job", estimateToken);
  expect(messages?.email.text).toContain("You pay about: $4,098");
  expect(messages?.email.text).toContain("Removal of existing insulation: $1,500 inc GST (100 m²");
  expect(messages?.email.text).toContain("Not included: if the electrical safety check");
  expect(messages?.email.html).toContain("100 m² included in this estimate");
  expect(removalEstimateIds.every(id => id === "saved-estimate")).toBe(true);
  expect(builtEmails).toHaveLength(1);
  expect(sends).toBe(0); // SMS switch on still does not introduce texts on the preliminary path.
  const snapshot = JSON.stringify(response);
  await savePreliminarySpot(token);
  expect(JSON.stringify(response)).toBe(snapshot);
  expect(preparations).toBe(1);
  expect(builtEmails).toHaveLength(1);
});
test("unknown removal uses budget note in normal confirmation", async () => {
  removal = {};
  await savePreliminarySpot(token);
  const messages = await buildSpotSavedMessages("job", estimateToken);
  expect(messages?.email.text).toContain(REMOVAL_BUDGET_EMAIL_NOTE);
  expect(messages?.email.html).toContain("Please budget $15 per m²");
  expect(sends).toBe(0);
});
test("excluded removal adds no removal note", async () => {
  removal = { removal: 0, removal_m2: 0 };
  await savePreliminarySpot(token);
  const messages = await buildSpotSavedMessages("job", estimateToken);
  expect(messages?.email.text).not.toMatch(/removal|removed/i);
  expect(messages?.email.text).toContain("Not included: if the electrical safety check");
});
test("missing estimate cannot save a price-free snapshot or send", async () => {
  estimateReady = false;
  await expect(savePreliminarySpot(token)).rejects.toThrow("Your estimate is not ready");
  expect(response).toBeNull();
  expect(sends).toBe(0);
});
test('retry finishes the stage and confirmation even when the original save was interrupted', async () => {
  response = { saved_total: 4098, saved_gross_total: 5498, saved_veu_discount: 1400, saved_area_m2: 100, saved_estimate_id: 'saved-estimate', estimate_link_id: 'estimate-link', spot_saved_at: '2026-10-22T00:00:00Z' };
  job.stage = 'preliminary_estimate_ready';
  events.push('campaign_spot_saved');
  estimateReady = false; // retry uses the frozen save, not a new estimate
  await savePreliminarySpot(token);
  expect(job.stage).toBe('ready_check_ready_to_schedule');
  expect(builtEmails).toHaveLength(1);
  expect(preparations).toBe(0);
  expect(events.filter(e => e === 'campaign_spot_saved')).toHaveLength(1);
  await savePreliminarySpot(token);
  expect(builtEmails).toHaveLength(1);
  expect(sends).toBe(0);
});
test('retry resumes a prepared but unfinished confirmation through existing send guards', async () => {
  response = { saved_total: 4098, saved_gross_total: 5498, saved_veu_discount: 1400, saved_area_m2: 100, saved_estimate_id: 'saved-estimate', estimate_link_id: 'estimate-link', spot_saved_at: '2026-10-22T00:00:00Z' };
  events.push('campaign_spot_saved', 'spot_saved_confirmation_queued');
  await savePreliminarySpot(token);
  expect(events.filter(e => e === 'spot_saved_confirmation_queued')).toHaveLength(1);
  expect(events.filter(e => e === 'spot_saved_confirmation_completed')).toHaveLength(1);
  expect(builtEmails).toHaveLength(1);
  await savePreliminarySpot(token);
  expect(builtEmails).toHaveLength(1);
  expect(sends).toBe(0);
});