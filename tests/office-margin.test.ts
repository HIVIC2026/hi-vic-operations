import { expect, test } from "bun:test";
import { officeMargin } from "../src/lib/office-margin.core";

// Decision 230 worked example drawn on the approved O2 (HV-3104): $1,274 (23%).
const O2 = {
  ownerPriceInc: 5480, ownerGstInc: 498, installerPay: 3479, installerPayBasis: "142 m² × $24.50", piesaCost: 280,
  fixesPriceInc: null, veecCount: 20.13, veecPrice: 83, veecPriceBasis: "current setting" as const, veecIncentiveInc: 1620,
};

test("O2 example: margin and percentage match the approved mock-up", () => {
  const r = officeMargin({ ...O2, veecCount: 1, veecPrice: 1671 });
  expect(r.margin).toBe(1274);
  expect(r.pct).toBe(23);
  expect(r.missing).toEqual([]);
  expect(r.lines.map((l) => l.label)).toEqual([
    "Owner price before rebate", "GST", "Installer pay", "Electrician PIESA", "Fixes cost (fixes +$100 stays ours)", "VEEC value received", "VEEC incentive given",
  ]);
});

test("fixes: price counts as revenue, cost is the price less the $100 we keep", () => {
  const r = officeMargin({ ...O2, veecCount: 1, veecPrice: 1671, fixesPriceInc: 660 });
  // revenue +660, GST +60, cost 560 → +40 on top of 1,274
  expect(r.margin).toBe(1314);
  expect(r.lines.find((l) => l.key === "fixes_cost")!.amount).toBe(560);
});

test("owner-direct electrician: no PIESA cost line value and not missing", () => {
  const r = officeMargin({ ...O2, veecCount: 1, veecPrice: 1671, piesaCost: null, piesaOwnerDirect: true });
  expect(r.margin).toBe(1554);
  expect(r.missing).toEqual([]);
});

test("missing facts: no margin figure, says what is missing (never a made-up number)", () => {
  const r = officeMargin({ ...O2, installerPay: null, piesaCost: null, veecPrice: null });
  expect(r.margin).toBeNull();
  expect(r.pct).toBeNull();
  expect(r.missing).toEqual(["Installer pay not known yet", "Electrician PIESA rate to confirm", "VEEC count or price not known yet"]);
});

test("GST falls back to price ÷ 11 when the quote has no GST amount", () => {
  const r = officeMargin({ ...O2, ownerGstInc: null, veecCount: 1, veecPrice: 1671 });
  expect(r.lines.find((l) => l.key === "gst")!.amount).toBe(498.18);
});
