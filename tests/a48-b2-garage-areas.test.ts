// A48 batch 2, Task 5: garage / carport / shed areas never count toward eligible m² (quote, VEEC, claim facts),
// are recorded once per area per job as an `excluded_area` event, and the previous-upgrade answer is always stored "no".
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { parseAudit } from "../src/lib/mitti.core";
import { areaProblems, totals, type RcArea } from "../src/lib/ready-check-areas.core";
import { totalAreaM2 } from "../src/lib/area-diagram.core";
import { weightedDepthMm } from "../src/lib/piisa-a3.core";
import { EXCLUDED_AREA_EVENT, newExcludedAreas, splitEligibleAreas } from "../src/lib/excluded-areas.core";
import { buildBase44Evidence } from "../src/lib/enquiry.core";
import { LEAN_Q } from "../src/lib/ready-check-lean.core";
import { readyCheckRemovalRequired, removalTotalM2 } from "../src/lib/ready-check-answers.core";
import { areaDiagramSummary } from "../src/lib/area-diagram.core";
import { evaluateGate1, resolveGate1Facts } from "../src/lib/eligibility.core";

type Row = Record<string, unknown>;
const events: Row[] = [];
const fakeAdmin = () => ({
  from(table: string) {
    const preds: ((r: Row) => boolean)[] = [];
    let op: "select" | "insert" = "select"; let payload: Row | null = null;
    const b: Record<string, unknown> & PromiseLike<unknown> = {
      select() { return b; },
      eq(c: string, v: unknown) { preds.push((r) => r[c] === v); return b; },
      insert(p: Row) { op = "insert"; payload = p; return b; },
      update() { return { eq: async () => ({ error: null }) } as never; },
      then(res, rej) {
        let out: { data: unknown; error: null };
        if (table !== "workflow_events") out = { data: null, error: null };
        else if (op === "insert") { events.push(payload!); out = { data: null, error: null }; }
        else out = { data: events.filter((r) => preds.every((p) => p(r))), error: null };
        return Promise.resolve(out).then(res, rej);
      },
    };
    return b;
  },
});
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeAdmin() }));
const S = await import("../src/lib/excluded-areas.server");

const rc = (label: string, areaM2: number | null, removalM2: number | null = null): RcArea => ({ key: label.toLowerCase().replace(/\W+/g, "-"), label, areaM2, existing: null, rValue: null, removal: null, removalM2, product: null, scope: null, sources: {} });

describe("eligible m² leaves garage-type areas out", () => {
  test("Ready Check areas Lounge 60 + Garage 30 total 60 and the sum check accepts 60", () => {
    const areas = [rc("Lounge", 60), rc("Garage", 30)];
    expect(totals(areas).areaM2).toBe(60);
    expect(areaProblems(areas, 60)).toEqual([]);
    expect(areaProblems(areas, 90).length).toBe(1);
  });
  test("no garage: totals and the sum check are unchanged", () => {
    const areas = [rc("Lounge", 60), rc("Kitchen", 30)];
    expect(totals(areas).areaM2).toBe(90);
    expect(areaProblems(areas, 90)).toEqual([]);
  });
  test("garage removal m² is left out of the removal total", () => {
    expect(totals([rc("Lounge", 60, 10), rc("Shed", 30, 5)]).removalM2).toBe(10);
  });
  test("whole-word names only: Shedding room and Garaged still count", () => {
    expect(totals([rc("Shedding room", 20), rc("Garaged", 10)]).areaM2).toBe(30);
  });
  test("diagram 'total area to insulate' leaves the garage out", () => {
    const a = (name: string, areaM2: number) => ({ name, lengthM: null, widthM: null, areaM2, productOption: null, rValue: null, existingNote: null });
    expect(totalAreaM2([a("Lounge", 60), a("Car port", 30)])).toBe(60);
    expect(totalAreaM2([a("Lounge", 60), a("Kitchen", 30)])).toBe(90);
  });
  test("split + once-per-area list", () => {
    const s = splitEligibleAreas([{ n: "Lounge", m: 60 }, { n: "Garage", m: 30 }], (x) => x.n);
    expect(s.eligible.map((x) => x.n)).toEqual(["Lounge"]);
    expect(s.excluded.map((x) => x.n)).toEqual(["Garage"]);
    expect(newExcludedAreas([{ name: "Garage", m2: 30 }, { name: "garage ", m2: 30 }], ["shed"])).toEqual([{ name: "Garage", m2: 30 }]);
    expect(newExcludedAreas([{ name: "Garage", m2: 30 }], ["GARAGE"])).toEqual([]);
  });
  test("PIISA weighted depth is worked from eligible areas only", async () => {
    const { readyCheckPart6Answers } = await import("../src/lib/piisa-a3.core");
    const mk = (name: string, depthMm: number, areaM2: number) => ({ name, present: true, depthMm, areaM2, rValue: null, removal: "no" as const });
    const r = readyCheckPart6Answers([mk("Lounge", 100, 60), mk("Garage", 200, 30)] as never);
    expect(r.answers["p6.height"]).toBe("100");
    expect(weightedDepthMm([{ depthMm: 100, areaM2: 60 }, { depthMm: 200, areaM2: 60 }])).toBe(150);
  });
});

describe("Mitti Ready Check reading", () => {
  const entry = (item_id: string, label: string, v: string, parent_id: string | null = null) => ({ item_id, label, parent_id, responses: { text: v } });
  const audit = (second: string) => ({
    audit_id: "a1", template_id: "t",
    header_items: [entry("h1", LEAN_Q.jobNumber, "HV-1")],
    items: [
      { item_id: "A", label: "", type: "dynamicfield" }, entry("a1", LEAN_Q.areaName, "Lounge", "A"), entry("a2", LEAN_Q.lengthM, "10", "A"), entry("a3", LEAN_Q.widthM, "6", "A"),
      { item_id: "B", label: "", type: "dynamicfield" }, entry("b1", LEAN_Q.areaName, second, "B"), entry("b2", LEAN_Q.lengthM, "6", "B"), entry("b3", LEAN_Q.widthM, "5", "B"),
    ],
  });
  test("Lounge 60 + Garage 30: measured area is 60 and the garage is reported", () => {
    const p = parseAudit(audit("Garage"));
    expect(p.patch.measured_area_m2).toBe(60);
    expect(p.excludedAreas).toEqual([{ name: "Garage", m2: 30 }]);
    expect(p.areas.length).toBe(2); // the per-area record keeps every area
  });
  test("no garage: both areas count and nothing is reported", () => {
    const p = parseAudit(audit("Kitchen"));
    expect(p.patch.measured_area_m2).toBe(90);
    expect(p.excludedAreas).toEqual([]);
  });
});

describe("excluded_area event", () => {
  beforeEach(() => { events.length = 0; });
  test("recorded once per area per job, however many times the same Ready Check is read", async () => {
    await S.recordExcludedAreas("job-1", null, [{ name: "Garage", m2: 30 }]);
    await S.recordExcludedAreas("job-1", null, [{ name: "Garage", m2: 30 }]);
    const ev = events.filter((e) => e["event_type"] === EXCLUDED_AREA_EVENT);
    expect(ev.length).toBe(1);
    expect(ev[0]!["details"]).toEqual({ name: "Garage", m2: 30 });
    expect(ev[0]!["internal"]).toBe(true);
  });
  test("another area on the same job and the same name on another job are separate", async () => {
    await S.recordExcludedAreas("job-1", null, [{ name: "Garage", m2: 30 }, { name: "Shed", m2: 8 }]);
    await S.recordExcludedAreas("job-2", null, [{ name: "Garage", m2: 25 }]);
    expect(events.length).toBe(3);
  });
  test("nothing to record writes nothing", async () => {
    await S.recordExcludedAreas("job-1", null, []);
    expect(events.length).toBe(0);
  });
});

describe("previous upgrade is always stored as no", () => {
  test.each(["unknown", "yes", "no", null, undefined] as const)("%s arrives, no is stored", (v) => {
    const e = buildBase44Evidence({ declared_property_type: "house", declared_previous_upgrade: v });
    expect(e.declared.previous_upgrade).toBe("no");
  });
});

describe("fix round 1", () => {
  const e = (label: string, value: string) => ({ label, value });
  test("a garage marked for removal is not charged and does not switch removal on", () => {
    const entries = [e(LEAN_Q.areaName, "Lounge"), e(LEAN_Q.removeM2, "10"), e(LEAN_Q.areaName, "Garage\ne.g. help"), e(LEAN_Q.removeM2, "20")];
    expect(removalTotalM2(entries)).toBe(10);
    const g = [e(LEAN_Q.areaName, "Lounge"), e(LEAN_Q.areaName, "Garage"), e(LEAN_Q.removeM2, "20")];
    expect(removalTotalM2(g)).toBeNull();
    expect(readyCheckRemovalRequired(g, { removal_required: false })).toBe(false);
    expect(removalTotalM2([e(LEAN_Q.removeM2, "7")])).toBe(7); // no area name: unchanged
  });
  test("insulation only in the garage: Part 6 says not present", async () => {
    const { readyCheckPart6Answers } = await import("../src/lib/piisa-a3.core");
    const r = readyCheckPart6Answers([{ name: "Lounge", present: false }, { name: "Garage", present: true, depthMm: 100, areaM2: 30, removal: false }] as never);
    expect(r.answers["p6.present"]).toBe("No");
    expect(JSON.stringify(r.answers)).not.toContain("NaN");
  });
  test("diagram summary leaves the garage's product out", () => {
    const a = (name: string, productOption: string) => ({ name, lengthM: null, widthM: null, areaM2: 10, productOption, rValue: null, existingNote: null });
    expect(areaDiagramSummary([a("Lounge", "Bradford R5"), a("Garage", "Other R3")])).toBe("1 area · 10 m² · Bradford R5");
  });
  test("previous upgrade never fails or flags, even for old rows that say yes or confirmed", () => {
    const prop = (declared: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
      state: "VIC", postcode: "3058", occupancy: "owner_occupied", is_residential: null, year_built: null,
      enrichment: { ...extra, base44: { declared: { basis: "owner_declaration", property_type: "house", over_five_years: "yes", ...declared }, research: null, raw: { answers: { insulation: "none" } } } },
    });
    const job = { lifeSupportStatus: "no", preliminaryOutcome: null, referenceDate: "2026-10-05" };
    const intel = [{ fact_key: "address_verified", value: true }, { fact_key: "in_victoria", value: true }, { fact_key: "previous_activity_48_confirmed", value: true }].map((f) => ({ ...f, evidence_kind: "direct", confidence: "high", source_type: "public_gis", source_name: "V", source_url: null, is_current: true, is_stale: false }));
    for (const x of [prop({ previous_upgrade: "yes" }), prop({ previous_upgrade: "yes" }, { previous_activity_48_confirmed: true, previous_ceiling_insulation_upgrade: true })]) {
      const d = evaluateGate1(resolveGate1Facts(x as never, job as never, 5, 2026, intel as never));
      expect(d.rules.find((r) => r.key === "previous_activity")!.result).toBe("pass");
      expect(d.outcome).not.toBe("does_not_appear_eligible");
    }
  });
});
