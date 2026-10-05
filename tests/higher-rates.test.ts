import { expect, test } from "bun:test";
import { approvedRateItems } from "../src/lib/partner-activation.core";
import { stepErrors } from "../src/lib/installer-onboarding.core";
const base = { gst_registered: true, r5_rate: 22, batts_removal_rate: 8, loose_fill_removal_rate: 12, extra_rates: {} };
const codes = (d: object) => (approvedRateItems("installer", d as never) as { code: string; r_value: number | null }[]).map((i) => i.code);
test("R6/R7 blank → no rows; existing installers keep only R5", () => { expect(codes(base)).not.toContain("R6_BATTS"); expect(codes(base)).toContain("R5_BATTS"); });
test("R6/R7 supplied → rows with r_value 6/7", () => {
  const items = approvedRateItems("installer", { ...base, r6_rate: 25, r7_rate: 28 } as never) as { code: string; r_value: number | null; unit_price_ex_gst: number }[];
  expect(items.find((i) => i.code === "R6_BATTS")).toMatchObject({ r_value: 6, unit_price_ex_gst: 22.73 });
  expect(items.find((i) => i.code === "R7_BATTS")?.r_value).toBe(7);
});
test("validation: blank ok, zero/negative/fraction-of-cent refused", () => {
  const e = (x: object) => stepErrors("install_pricing", { ...base, ...x } as never).map((i: { key?: string; field?: string }) => i.key ?? i.field);
  expect(e({})).toEqual([]);
  for (const v of [0, -5, 25.555]) expect(e({ r6_rate: v }).length).toBeGreaterThan(0);
  expect(e({ r7_rate: 30.5 })).toEqual([]);
});
test("top-up rate: blank → no row; supplied → TOPUP_R5 row at r_value 5, ex GST", () => {
  expect(codes(base)).not.toContain("TOPUP_R5");
  const items = approvedRateItems("installer", { ...base, topup_r5_rate: 16.5 } as never) as { code: string; r_value: number | null; unit_price_ex_gst: number }[];
  expect(items.find((i) => i.code === "TOPUP_R5")).toMatchObject({ r_value: 5, unit_price_ex_gst: 15 });
});
test("top-up validation: blank ok, zero/negative refused", () => {
  const e = (x: object) => stepErrors("install_pricing", { ...base, ...x } as never).map((i: { key?: string; field?: string }) => i.key ?? i.field);
  expect(e({})).toEqual([]);
  for (const v of [0, -1, 10.555]) expect(e({ topup_r5_rate: v }).length).toBeGreaterThan(0);
  expect(e({ topup_r5_rate: 16.5 })).toEqual([]);
});
