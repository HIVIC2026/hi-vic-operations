import { expect, mock, test } from "bun:test";
let reads = 0;
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => { reads++; throw new Error("must skip before confirmation reads"); } } }));
mock.module("../src/lib/firm-quote.server", () => ({ skipSpotMessage: async () => ({ status: "skipped", reason: "firm_quote_job" }) }));
const { buildSpotSavedMessages, sendSpotSavedConfirmation } = await import("../src/lib/spot-saved-send.server");
test("firm quote saved response cannot build a spot email/text or reach delivery claims", async () => {
  expect(await buildSpotSavedMessages("job", "token")).toBeNull();
  expect(await sendSpotSavedConfirmation("job")).toEqual({ jobId: "job", email: { status: "skipped", detail: "firm_quote_job" }, sms: { status: "skipped", detail: "firm_quote_job" } });
  expect(reads).toBe(0);
});