// Bradford ruling (Jo 3 Nov 2026): the warranty attached for a Bradford job is chosen by the job's building class, read
// from existing fields only — the Ready Check answer (building_class, else property_type) and then the owner's declared
// property type. Unknown → no Bradford attachment and the class hold reason.
import { beforeEach, expect, mock, test } from "bun:test";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
function from(t: string) {
  const f: ((r: Row) => boolean)[] = [];
  let one = false;
  const b: Record<string, unknown> = {
    select: () => b, limit: () => b, order: () => b,
    eq: (c: string, v: unknown) => { f.push((r) => r[c] === v); return b; },
    maybeSingle: () => { one = true; return b; },
    then: (res: (v: unknown) => unknown) => { const out = (tables[t] ?? []).filter((r) => f.every((x) => x(r))); return Promise.resolve({ data: one ? out[0] ?? null : out, error: null }).then(res); },
  };
  return b;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
mock.module("../src/lib/workflow.server", () => ({ logEvent: async () => undefined }));
let products: string[] = [];
mock.module("../src/lib/install-evidence.server", () => ({ latestInstallEvidence: async () => ({ zoneProducts: products.map((product) => ({ product })) }) }));
mock.module("../src/lib/insulation-product.server", () => ({ productForHivQuote: async () => ({ product: null }) }));
mock.module("../src/lib/piisa-products.server", () => ({ verifiedInstalledProductAnswers: async () => null }));

const { warrantyBuildingClassFor, warrantyDecisionFor, warrantyGapFactsFor } = await import("../src/lib/product-warranty.server");
const { BRADFORD_CLASS_HOLD } = await import("../src/lib/product-warranty.core");

const job = (declared: string | null, snapshot: Row | null = null) => {
  tables = {
    jobs: [{ id: "j1", properties: { enrichment: declared == null ? {} : { base44: { declared: { property_type: declared } } } } }],
    ceiling_measurements: snapshot ? [{ job_id: "j1", is_current: true, raw_snapshot: snapshot }] : [],
  };
};
beforeEach(() => { products = ["Bradford Gold R6"]; });

test("building class: Ready Check answer first, then the owner's declared property type", async () => {
  job("house"); expect(await warrantyBuildingClassFor("j1")).toBe("Class 1");
  job("townhouse"); expect(await warrantyBuildingClassFor("j1")).toBe("Class 1");
  job("apartment"); expect(await warrantyBuildingClassFor("j1")).toBe("Class 2 sole-occupancy unit"); // the website stores "apartment"
  job("unit"); expect(await warrantyBuildingClassFor("j1")).toBe("Class 2 sole-occupancy unit");
  job("house", { property_type: "Unit or apartment" }); expect(await warrantyBuildingClassFor("j1")).toBe("Class 2 sole-occupancy unit");
  job("unit", { building_class: "Class 1" }); expect(await warrantyBuildingClassFor("j1")).toBe("Class 1");
  job(null); expect(await warrantyBuildingClassFor("j1")).toBeNull();
  job("commercial premises"); expect(await warrantyBuildingClassFor("j1")).toBeNull();
});

test("house → Class 1 certificate attached", async () => {
  job("house");
  const d = await warrantyDecisionFor("j1");
  expect(d.attach.map((w) => w.pdfPath)).toEqual(["docs/product-warranties/bradford-glasswool-warranty-class-1.pdf"]);
  expect(d.recordProvided).toBe(true);
});

test("unit → Class 2 to 10 certificate attached", async () => {
  job("apartment");
  const d = await warrantyDecisionFor("j1");
  expect(d.attach.map((w) => w.pdfPath)).toEqual(["docs/product-warranties/bradford-glasswool-warranty-class-2-10.pdf"]);
  expect(d.recordProvided).toBe(true);
});

test("class unknown → nothing attached, held with the class reason; the AP gap facts carry the class", async () => {
  job(null);
  const d = await warrantyDecisionFor("j1");
  expect(d.attach).toEqual([]);
  expect(d.recordProvided).toBe(false);
  expect(d.missing).toEqual([{ product: "Bradford Gold R6", reason: BRADFORD_CLASS_HOLD }]);
  expect(await warrantyGapFactsFor("j1")).toEqual({ products: ["Bradford Gold R6"], buildingClass: null });
});

test("Pink Batts ignores the class", async () => {
  products = ["Fletchers Pink Batts R5"];
  job(null);
  expect((await warrantyDecisionFor("j1")).recordProvided).toBe(true);
});
