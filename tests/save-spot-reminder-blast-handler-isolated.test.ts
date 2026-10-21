import { expect, mock, test } from "bun:test";
let writes = 0, sends = 0;
const token = "a".repeat(64), jobId = "isolated";
const tables: Record<string, unknown[]> = {
  office_enquiry_index: [{ id: jobId, job_number: "HV-QA", source: "base44", owner_name: "Jane Doe", owner_phone: "0491234567", created_at: "2026-10-21T04:08:00Z", spot_offered: true, spot_saved: false, deleted_at: null, removed: false, stage: "new_enquiry" }],
  indicative_estimates: [{ job_id: jobId, scenarios: [{ by_access: { standard: { estimated_customer_total: 3728, applied_discount: 1470 } } }] }],
  customer_estimate_links: [{ id: "link", job_id: jobId, token, status: "active", expires_at: "2099-01-01" }],
  owner_contact_consents: [{ job_id: jobId, consent_status: "granted" }],
  customer_email_sends: [{ job_id: jobId, sent_at: "2026-10-01T00:00:00Z", estimate_link_id: "link", purpose: "existing_leads_launch_v1", idempotency_key: "offer", communication_id: null, provider_message_id: "provider-one" }],
  job_communications: [{ id: "mail", job_id: jobId, provider_message_id: "provider-one", source_reference: "offer", delivery_status: "recorded", body: `Save my spot: https://estimate.homeinsulationvictoria.com.au/estimate/${token}/campaign` }],
  sms_optouts: [], sms_messages: [],
  lead_campaign_responses: [],
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (table: string) => {
  const q = { select: () => q, eq: () => q, not: () => q, like: () => q, order: () => q, in: () => q, maybeSingle: async () => ({ data: table === "customer_estimate_links" ? { expires_at:"2099-01-01" } : table === "indicative_estimates" ? { area_source:"owner_estimate",area_m2:150 } : null,error:null }), insert: () => { writes++; throw new Error("dry run wrote"); }, update: () => { writes++; throw new Error("dry run wrote"); }, range: async () => ({ data: tables[table] ?? [], error: null }) }; return q;
} } }));
mock.module("../src/lib/comms.server", () => ({ customerCommsEnabled: async () => true }));
mock.module("../src/lib/twilio-au1.server", () => ({ au1Configured: () => true }));
mock.module("../src/lib/sms.server", () => ({ sendingNumber: () => "+61491567890", sendRealSms: async () => { sends++; throw new Error("dry run sent"); } }));
mock.module("../src/lib/save-spot-reminder-settings.server", () => ({ reminderSettings: async () => ({ enabled:false,activatedAt:null }) }));
mock.module("../src/lib/launch-campaign.server", () => ({ campaignLink:async()=>({job:{id:jobId,estimated_area_m2:150}}),campaignPermission:()=>true }));
process.env.SAVE_SPOT_LINK_SECRET="isolated-test-secret-only-".repeat(3);
const { runSaveSpotReminderBlast } = await import("../src/lib/save-spot-reminder-blast.server");
test("actual dry-run handler reads provider-linked recorded offer without any writes/send", async () => {
  const result = await runSaveSpotReminderBlast(true);
  expect(result.recipientCount).toBe(1); expect(result.samples).toHaveLength(1);
  expect(result.samples[0]?.body).toContain("$3,728"); expect(result.samples[0]?.body).toContain("$1,470");
  expect(writes).toBe(0); expect(sends).toBe(0);
});
test("unlinked recorded copy cannot count as a sent offered URL", async () => {
  tables.job_communications = [{ ...(tables.job_communications[0] as object), provider_message_id: "different-provider" }];
  const result = await runSaveSpotReminderBlast(true);
  expect(result.recipientCount).toBe(0); expect(result.skipped[0]?.reason).toContain("URL");
  expect(writes).toBe(0); expect(sends).toBe(0);
});
test("automatic OFF returns before audience scan and creates no SMS claim",async()=>{
  const r=await runSaveSpotReminderBlast(false,true);
  expect(r.recipientCount).toBe(0);expect(r.results).toHaveLength(0);expect(writes).toBe(0);expect(sends).toBe(0);
});