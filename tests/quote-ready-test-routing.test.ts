import { expect, mock, test } from "bun:test";
let source = "qa_test", marked = true, allowed = true;
let linkAvailable = true, quoteAvailable = true;
const sent: string[] = [];
mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: { from(table: string) {
  const q: any = { select() { return q; }, eq() { return q; }, maybeSingle() {
    return Promise.resolve({ error: null, data: table === "jobs" ? { source,owner_id:"o",job_number:"HV-TEST",stage:"ready_check_scheduled" } : table === "quotes" ? (quoteAvailable ? {customer_total_inc_gst:3830.25} : null) : table === "customer_estimate_links" ? (linkAvailable ? {token:"test-token",status:"active",expires_at:"2099-01-01"} : null) : table === "owners" ? {email:"jolowexo@hotmail.com",phone:"0477511901"} : table === "job_assignments" ? { business_id:"b" } : table === "businesses" ? {onboarding_notes:marked?"[TEST PARTNER]":null} : null });
  }};return q;
}}}));
mock.module("../src/lib/comms.server", () => ({ assertCustomerDeliveryAllowed: async () => { if(!allowed)throw Error("No contact permission"); } }));
mock.module("../src/lib/workflow.server", () => ({ logEvent: async()=>{} }));
mock.module("../src/lib/test-send.server", () => ({
  sendTestEmail: async(ctx:any,to:string) => { const {testSendBlocker}=await import("../src/lib/test-send.core");const block=testSendBlocker({channel:"email",to,jobSource:ctx.jobSource,partnerIsTest:ctx.partnerIsTest});if(!block)sent.push("email");return {status:block?"blocked":"sent",detail:block??"TEST accepted"}; },
  sendTestSms: async(ctx:any,to:string) => { const {testSendBlocker}=await import("../src/lib/test-send.core");const block=testSendBlocker({channel:"sms",to,jobSource:ctx.jobSource,partnerIsTest:ctx.partnerIsTest});if(!block)sent.push("sms");return {status:block?"blocked":"sent",detail:block??"TEST accepted"}; }
}));
mock.module("../src/lib/sms.server",()=>({sendRealSms:async()=>{throw Error("Real sender must not be entered");}}));
const {notifyOwnerQuoteReady}=await import("../src/lib/quote-ready-notify.server");
test("qa_test quote uses TEST email and SMS only",async()=>{sent.length=0;marked=true;allowed=true;expect(await notifyOwnerQuoteReady("j","q","installation")).toEqual({email:"sent: TEST accepted",sms:"sent: TEST accepted"});expect(sent).toEqual(["email","sms"]);});
test("unmarked business fails both TEST recipient guards",async()=>{sent.length=0;marked=false;allowed=true;const r=await notifyOwnerQuoteReady("j","q","installation");expect(r.email).toContain("blocked");expect(r.sms).toContain("blocked");expect(sent).toEqual([]);});
test("no permission cannot enter either TEST provider",async()=>{sent.length=0;marked=true;allowed=false;await expect(notifyOwnerQuoteReady("j","q","installation")).rejects.toThrow("No contact permission");expect(sent).toEqual([]);});
test("missing owner link blocks both TEST providers",async()=>{sent.length=0;marked=true;allowed=true;linkAvailable=false;try {await expect(notifyOwnerQuoteReady("j","q","installation")).rejects.toThrow("TEST quote total or owner link is unavailable");expect(sent).toEqual([]);} finally {linkAvailable=true;}});
test("missing quote total blocks both TEST providers",async()=>{sent.length=0;marked=true;allowed=true;quoteAvailable=false;try {await expect(notifyOwnerQuoteReady("j","q","installation")).rejects.toThrow("TEST quote total or owner link is unavailable");expect(sent).toEqual([]);} finally {quoteAvailable=true;}});