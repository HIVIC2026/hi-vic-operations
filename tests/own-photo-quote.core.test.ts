// Photo-quote installers Part 2 (Task 10): the live quote on Add a job matches the issued quote, always.
import { expect, mock, test } from "bun:test";
import { ownPhotoDraftInput, ownPhotoQuotePreview, ownPhotoQuoteProblems } from "../src/lib/own-photo-quote.core";
import { buildOwnCustomerQuoteDraft } from "../src/lib/mitti-installer-quote.core";
import { wholeVeecDiscount } from "../src/lib/estimate.core";

const loc = { metropolitan_or_regional: "Metropolitan", climate_region: "Mild" } as never;
const veec = (m2: number) => wholeVeecDiscount(m2, loc, 40);

test("preview for price 2400, 80 m², PIESA 349: the four lines and owner pays = the builder's total", () => {
  const p = ownPhotoQuotePreview({ priceIncGst: 2400, installM2: 80, product: "Bradford Gold R5", piesaIncGst: 349, wholeVeec: veec(80), metropolitan: true, minCopay: 200 });
  if ("held" in p) throw new Error("held");
  expect(p.lines.map((l) => l.label)).toEqual(["Your price", "PIESA fee", "Home Insulation Victoria AP management fee", "Rebate"]);
  expect(p.lines.slice(0, 3).map((l) => l.amount)).toEqual([2400, 349, 349]);
  expect(p.lines[3]!.amount).toBeLessThanOrEqual(0);
  const d = buildOwnCustomerQuoteDraft(ownPhotoDraftInput({ priceIncGst: 2400, installM2: 80, product: "Bradford Gold R5", removeM2: 0, wholeVeec: veec(80), metropolitan: true, minCopay: 200 }), 349);
  expect(p.ownerPays).toBe(Math.round((d.subtotal - d.discount) * 100) / 100);
  expect(p.feesLine).toBe("We add our $349 AP management fee and the $349 PIESA fee to your price.");
});
// Review fix round IMPORTANT 3a: the LIVE Add a job box (ownPhotoQuotePreviewFor, as the screen calls it with the TYPED
// postcode) and the REAL issued-quote path (recordOwnPhotoQuote → draftInstallerQuoteFromReadyCheck, which reads the
// saved PROPERTY postcode) run on ONE in-memory database for 20 random inputs; the owner totals must be equal.
test("match: live preview vs the issued quote on one in-memory database — 20 random inputs, typed vs saved postcode", async () => {
  const { memoryPostgrest } = await import("./helpers/memory-postgrest");
  const t: Record<string, Record<string, unknown>[]> = {
    businesses: [{ id: "nogap", quote_method: "photos" }],
    veu_location_variables: [{ postcode: "3121", metropolitan_or_regional: "Metropolitan", climate_region: "Mild" }, { postcode: "3550", metropolitan_or_regional: "Regional", climate_region: "Cold" }],
    retail_estimator_settings: [{ is_current: true, indicative_veec_value: 40, minimum_customer_copayment_inc_gst: 200, ap_management_inc_gst: 349, piesa_assessment_inc_gst: 349 }],
    workflow_settings: [{ id: 1, auto_send_quote: false, customer_comms_enabled: false }],
    rate_cards: [{ id: "rc1", business_id: "nogap", is_active: true, version: 1, effective_from: "2026-01-01" }],
    rate_card_items: [{ rate_card_id: "rc1", code: "PIESA", unit_price_ex_gst: 317.27 }],
    jobs: [], properties: [], quotes: [], quote_items: [], workflow_events: [], ceiling_measurements: [],
  };
  const db = memoryPostgrest(t);
  mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: db }));
  mock.module("../src/lib/trade-view.server", () => ({ pricesOrThrow: async () => ({ biz: { id: "nogap", name: "No Gap" }, prices: true, boss: true }) }));
  mock.module("../src/lib/workflow.server", () => ({
    WorkflowError: class extends Error {},
    logEvent: async (job_id: string, actor_id: string | null, event_type: string, summary: string, details?: unknown) => { t.workflow_events!.push({ id: crypto.randomUUID(), job_id, actor_id, event_type, summary, details: details ?? {}, created_at: new Date().toISOString() }); },
    getStage: async () => "ready_check_complete", stageEntryBlockers: async () => [], transition: async () => undefined,
  }));
  const { ownPhotoQuotePreviewFor, recordOwnPhotoQuote } = await import("../src/lib/own-photo-quote.server");
  const { addInstallerJobPayload } = await import("../src/lib/add-installer-job.core");
  const products = ["Earthwool R5", "Bradford Gold R5"];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let n = 0; n < 20; n++) {
    const price = Math.round(500 + rnd() * 6000), m2 = Math.round((20 + rnd() * 200) * 10) / 10, remove = Math.round(rnd() * m2 * 10) / 10;
    const typed = n % 2 ? " 3550 " : "3121 ", product = products[n % 2]!;
    // The property row exactly as Add a job saves it from the same typed postcode.
    const saved = addInstallerJobPayload({ requestKey: crypto.randomUUID(), businessId: "nogap", userId: "boss", source: "installer_onsite", owner: { full_name: "Sam Lee", email: "s@x.test", phone: "0412345678" },
      property: { address_line: `${n} Main St`, suburb: "Town", postcode: typed }, consent: { key: "installer_confirmed", by: "installer", text: "t", sha256: "h", record: null }, electricianChoice: null as never, leadOrigin: "owner_contacted", visitRequested: false, flagEvent: null } as never).property;
    t.properties!.push({ id: `p${n}`, postcode: saved.postcode });
    t.jobs!.push({ id: `j${n}`, property_id: `p${n}`, channel: "installer_sourced", stage: "ready_check_complete", deleted_at: null, qa_archived_at: null, electrician_choice: "installer_own", originating_installer_business_id: "nogap", ap_fee_override_inc_gst: null });
    const preview = await ownPhotoQuotePreviewFor("boss", { businessId: "nogap", priceIncGst: price, installM2: m2, removeM2: remove, postcode: typed, product });
    if ("held" in preview) throw new Error(`preview held: ${preview.held}`);
    await recordOwnPhotoQuote(`j${n}`, "boss", "nogap", { underR2: true, removeM2: remove, installM2: m2, product, priceIncGst: price }, { autoSend: async () => ({ sent: false, reasons: [] }) });
    const issued = t.quotes!.filter((q) => q["job_id"] === `j${n}` && q["status"] === "draft");
    expect(issued).toHaveLength(1);
    expect({ n, owner: preview.ownerPays }).toEqual({ n, owner: Number(issued[0]!["customer_total_inc_gst"]) });
    const piesa = t.quote_items!.filter((i) => i["quote_id"] === issued[0]!["id"] && i["code"] === "PIESA").reduce((a, i) => a + Number(i["line_total_inc_gst"]), 0);
    expect(preview.lines.find((l) => l.label === "PIESA fee")!.amount).toBe(piesa);
  }
});
test("no PIESA price on file → held", () => {
  expect(ownPhotoQuotePreview({ priceIncGst: 2400, installM2: 80, product: "Bradford Gold R5", piesaIncGst: null, wholeVeec: veec(80), metropolitan: true, minCopay: 200 })).toEqual({ held: "Set this installer's PIESA price first" });
});
test("problems: under R2 No refused; price needed", () => {
  expect(ownPhotoQuoteProblems({ underR2: false, removeM2: 0, installM2: 80, product: "Bradford Gold R5", priceIncGst: 2400 })).toContain("Over R2 isn't eligible for the rebate.");
  expect(ownPhotoQuoteProblems({ underR2: true, removeM2: 0, installM2: 80, product: "Bradford Gold R5", priceIncGst: null })).toEqual(["Enter your price"]);
  expect(ownPhotoQuoteProblems({ underR2: true, removeM2: 0, installM2: 80, product: "Bradford Gold R5", priceIncGst: 2400 })).toEqual([]);
});
