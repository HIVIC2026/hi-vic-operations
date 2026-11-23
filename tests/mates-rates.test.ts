import { expect, test } from "bun:test";
import { garageOnlyScopeChangeAfterQuote, isGarageOnlyRequoteRequest, installerGarageRequoteMessage, NO_GAP_MINIMUM_BILLABLE_M2, priceGarageMatesRates } from "../src/lib/mates-rates.core";
const base = { scope: "garage_only" as const, product: "R5" as const, actualInstallM2: 42, minimumBillableM2: NO_GAP_MINIMUM_BILLABLE_M2, ownerRateIncGstPerM2: 28, installerRateExGstPerM2: 21.99, gstRate: 0.1, removeM2: 0 };
test("Eric HV-2968: physical 42 m², minimum billed 100 m², rebate zero", () => {
 const q=priceGarageMatesRates(base);
 expect(q.actualInstallM2).toBe(42);
 expect(q.chargeableM2).toBe(100);
 expect(q.lines.map(x=>x.code)).toEqual(["INSTALL_ACTUAL","MINIMUM_JOB_CHARGE"]);
 expect(q.lines[0]?.totalIncGst).toBe(1176);
 expect(q.lines[1]?.quantity).toBe(58);
 expect(q.lines[1]?.totalIncGst).toBe(1624);
 expect(q.totalIncGst).toBe(2800);
 expect(q.installerCostIncGst).toBe(2418.9);
 expect(q.indicativeMarginBeforeOtherCostsIncGst).toBe(381.1);
 expect(q.veecCount).toBe(0);
 expect(q.requestEscNotification).toBe(false);
 expect(q.rebateCopyAllowed).toBe(false);
 expect(q.nonVeuSafetyReviewRequired).toBe(true);
});
test("Jobs larger than 100 m² have no minimum charge",()=>{
 const q=priceGarageMatesRates({...base,actualInstallM2:130});
 expect(q.chargeableM2).toBe(130);
 expect(q.lines).toHaveLength(1);
 expect(q.totalIncGst).toBe(3640);
});
test("R7 loses money with the current No Gap rate and must not auto-issue",()=>{
 const q=priceGarageMatesRates({...base,product:"R7",ownerRateIncGstPerM2:34,installerRateExGstPerM2:37.15});
 expect(q.requiresCommercialApproval).toBe(true);
});
test("invalid areas, missing installer pricing and surprise removal fail closed",()=>{
 expect(()=>priceGarageMatesRates({...base,actualInstallM2:0})).toThrow();
 expect(()=>priceGarageMatesRates({...base,installerRateExGstPerM2:NaN})).toThrow();
 expect(()=>priceGarageMatesRates({...base,removeM2:42})).toThrow();
});
test("recognises Eric's original garage-only email without confusing generic garage questions",()=>{
 expect(isGarageOnlyRequoteRequest("I don’t want the whole house insulated, just over the garage that was never insulated, total area is 42 sq metres")).toBe(true);
 expect(isGarageOnlyRequoteRequest("I only want the garage ceiling done, not the whole home")).toBe(true);
 expect(isGarageOnlyRequoteRequest("Is the garage included in the quote?")).toBe(false);
 expect(isGarageOnlyRequoteRequest("Please find attached the whole-house quote.")).toBe(false);
});
test("installer notice distinguishes work area from billing",()=>{
 const msg=installerGarageRequoteMessage({jobNumber:"HV-2968",actualInstallM2:42,product:"R5",minimumBillableM2:100});
 expect(msg).toContain("42 m²");
 expect(msg).toContain("100 m²");
 expect(msg).toContain("does NOT increase the area to install");
 expect(msg).toContain("no rebate or VEEC");
});

test("guard: genuine owner garage-only change after send holds stale quote, later YES reply irrelevant",()=>{
  const quoteSentAt="2026-11-22T23:47:04Z",ownerEmail="eric.stobbie@ausnetservices.com.au";
  const messages=[
    {sender_text:"Chris <info@homeinsulationvictoria.com.au>",body:"I only want the garage ceiling",received_at:"2026-11-22T23:55:00Z"},
    {sender_text:"Eric Stobbie <eric.stobbie@ausnetservices.com.au>",body:"Yes please re-quote",received_at:"2026-11-23T00:06:25Z"},
    {sender_text:"Eric Stobbie <eric.stobbie@ausnetservices.com.au>",body:"I don’t want the whole house insulated, just over the garage that was never insulated, total area is 42 sq metres",received_at:"2026-11-22T23:59:08Z"},
  ];
  expect(garageOnlyScopeChangeAfterQuote({quoteSentAt,ownerEmail,messages})).toBe(true);
  expect(garageOnlyScopeChangeAfterQuote({quoteSentAt:"2026-11-23T01:00:00Z",ownerEmail,messages})).toBe(false);
  expect(garageOnlyScopeChangeAfterQuote({quoteSentAt,ownerEmail:"another@example.com",messages})).toBe(false);
  expect(garageOnlyScopeChangeAfterQuote({quoteSentAt,ownerEmail,messages:[{sender_text:"Spoof <fake.eric.stobbie@ausnetservices.com.au.evil.com>",body:messages[2]!.body,received_at:messages[2]!.received_at}]})).toBe(false);
  expect(()=>garageOnlyScopeChangeAfterQuote({quoteSentAt:"invalid",ownerEmail,messages})).toThrow();
});
