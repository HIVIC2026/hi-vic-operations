// Review fix: an own (installer_sourced) job is a photo job from its claim / failed save, before the 15-minute tick has
// written the measurement. The job page must never show "Do it in Mitti" or the Mitti/portal choice in that gap.
import { expect, mock, test } from "bun:test";
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => { throw new Error("live database used"); } } }));
const { installerJobPageParts } = await import("../src/lib/trade-view.server");
const { hasOwnPhotoSignal } = await import("../src/lib/photo-quote.core");

const parts = (ownPhotoSignal?: boolean, priceEntered = true) => installerJobPageParts({
  c: { biz: { id: "reins", name: "Reinsulate" }, prices: true, money: true, boss: true } as never,
  j: { job_number: "HV-9002", stage: "preliminary_estimate_ready", channel: "installer_sourced", installation_completed_at: null, electrician_choice: null, originating_installer_business_id: "reins", life_support_status: null, owners: { full_name: "Sam Lee", phone: "0400000000", email: "s@x.test" } },
  rcBook: null, inBook: null, piesaBook: null, a: null, m: null,
  form: { auditId: null, complete: false }, clearance: { cleared: false },
  quote: {}, qq: null, pay: null, elecName: null, piesaRec: null, accessPerson: null, mineBk: [], released: false,
  sentRows: [], ledger: [], depositPaid: false, deadline: null, givenAt: null, consentSigned: false, paidEv: [], piesaPayRead: null, swmsRead: null,
  quoteItems: [], priceEntered, notes: [], product: null, payRow: null, mittiCompleted: false, needsFinishingItems: [], mittiMissing: [],
  whoBooks: "installer" as never, coesOnFile: false,
  ...(ownPhotoSignal === undefined ? {} : { ownPhotoSignal }),
});

test("own job with a photo-quote claim and no measurement: waiting state, never Do it in Mitti, no Mitti/portal choice", () => {
  const p = parts(true);
  expect(p.nextStep.kind).toBe("waiting_quote");
  expect(JSON.stringify(p.nextStep)).not.toContain("Do it in Mitti");
  expect(p.photoQuote).toBe(true); // field.$jobId.tsx hides the Mitti/portal choice on this flag
});
test("control: no claim and no measurement is the Enter your price step", () => {
  const p = parts(undefined, false);
  expect(p.nextStep.kind).toBe("enter_price");
  expect(p.photoQuote).toBe(false);
});
test("signals: claim (own_customer) or failed event; an HIV-lead claim or other events are not", () => {
  expect(hasOwnPhotoSignal([{ event_type: "photo_quote_submitted", details: { own_customer: true } }])).toBe(true);
  expect(hasOwnPhotoSignal([{ event_type: "own_photo_quote_failed", details: {} }])).toBe(true);
  expect(hasOwnPhotoSignal([{ event_type: "photo_quote_submitted", details: {} }])).toBe(false);
  expect(hasOwnPhotoSignal([{ event_type: "visit_allocated" }])).toBe(false);
});
