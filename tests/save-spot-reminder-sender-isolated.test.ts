import { expect, mock, test, setSystemTime } from "bun:test";
import { BLAST_KEY, blastClaimId } from "../src/lib/save-spot-reminder-blast.core";

// Environment: these texts honour the 8pm–7am Melbourne quiet hours (Jo 22 Oct 2026). Pin the clock to 1pm Melbourne on
// today's date so the result never depends on when the suite runs.
{ const midday = new Date(); midday.setUTCHours(2, 0, 0, 0); setSystemTime(midday); }

let providerCalls = 0, claimed: Record<string, unknown> | null = null, optedOut = false, reminderOn = false;
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (table: string) => {
  let payload: Record<string, unknown> | null = null;
  const result = () => {
    if (table === "sms_messages" && payload) {
      if (claimed) return { data: null, error: { code: "23505" } };
      claimed = payload; return { data: { id: payload.id }, error: null };
    }
    return { data: table === "jobs" ? { source: "base44" } : table === "workflow_settings" ? { sms_message_switches: { save_spot_reminder:reminderOn } } : table === "sms_optouts" ? (optedOut ? [{ phone: "+61491234567" }] : []) : null, error: null };
  };
  const q = { select: () => q, eq: () => q, not: () => q, insert: (v: Record<string, unknown>) => { payload = v; return q; }, update: () => q, maybeSingle: async () => result(), then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve) }; return q;
} } }));
mock.module("../src/lib/comms.server", () => ({ customerCommsEnabled: async () => true, hasCurrentOwnerContactConsent: async () => true }));
mock.module("../src/lib/job-live.server", () => ({ jobDeletedBlocker: async () => null }));
mock.module("../src/lib/twilio-au1.server", () => ({ au1Configured: () => true, au1SendMessage: async () => { providerCalls++; return { ok: true, status: 201, text: '{"sid":"isolated-provider"}' }; } }));
const { sendRealSms } = await import("../src/lib/sms.server");
test("actual sender claims once, uses existing provider/logging while type switch off and never repeats", async () => {
  process.env.TWILIO_FROM_NUMBER = "+61491567890";
  const input = { type: "save_spot_reminder" as const, idempotencyKey: BLAST_KEY + "job", jobId: "job", to: "0491234567", body: "Home Insulation Victoria: Hi Jane" };
  const authority = { claimId: await blastClaimId(input.to), adminSpotReminderBlast: true as const };
  expect((await sendRealSms(input, authority)).status).toBe("sent");
  expect(claimed?.message_type).toBe("save_spot_reminder"); expect(claimed?.idempotency_key).toBe(BLAST_KEY + "job");
  expect((await sendRealSms(input, authority)).status).toBe("already"); expect(providerCalls).toBe(1);
  claimed = null; optedOut = true;
  expect((await sendRealSms(input, authority)).status).toBe("blocked"); expect(providerCalls).toBe(1);
});
test("actual scheduled sender cannot bypass OFF but sends once with only reminder ON",async()=>{
  claimed=null;optedOut=false;const before=providerCalls;
  const input={type:"save_spot_reminder" as const,idempotencyKey:BLAST_KEY+"scheduled-job",jobId:"scheduled-job",to:"0491234567",body:"Home Insulation Victoria: Hi Jane"};
  const auth={claimId:await blastClaimId(input.to),scheduledSpotReminder:true as const};
  expect((await sendRealSms(input,auth)).status).toBe("blocked");expect(providerCalls).toBe(before);
  claimed=null;reminderOn=true;expect((await sendRealSms(input,auth)).status).toBe("sent");expect(providerCalls).toBe(before+1);
  expect((await sendRealSms(input,auth)).status).toBe("already");expect(providerCalls).toBe(before+1);
});