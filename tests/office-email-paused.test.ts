// Jo 24 Oct: partner / applicant / electrician emails pause with the master switch until the templates are reviewed.
import { expect, mock, test } from "bun:test";
let on = false; let fetched = 0; const logged: unknown[] = [];
mock.module("../src/lib/comms.server", () => ({ customerCommsEnabled: async () => on }));
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => ({ insert: async (r: unknown) => { logged.push(r); return { error: null }; }, update: () => ({ eq: async () => ({ error: null }) }) }) } }));
globalThis.fetch = (async () => { fetched++; return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
const { sendOfficeEmail, PARTNER_EMAILS_PAUSED } = await import("../src/lib/office-email.server");
test("master switch off: nothing is sent, the reason says why", async () => {
  const r = await sendOfficeEmail({ actorId: "a", recipient: "partner" as never, to: "x@example.com", contactName: "X", subject: "Hi", message: "Hello there", label: "t", record: {} });
  expect(r.status).toBe("blocked");
  expect(r.detail).toBe(PARTNER_EMAILS_PAUSED);
  expect(fetched).toBe(0);
});
