// Jo 25 Oct 2026: the A1/A2 Ready Check templates after the ONE prompt (docs/MITTI_READY_CHECK_ONE_PROMPT.md items 1–9)
// were published in Mitti. These are the real published definitions (read-only GET, stored as mitti_template_dumps
// "A1/A2 published 2026-10-25 00:25") plus a synthetic three-area audit in the NEW shape, proven through the real
// parsers: total m², removal m², diagram boxes, basics and the quote inputs. Pure, deterministic, no network.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { flatten, parseAudit, splitPatch } from "../src/lib/mitti.core";
import { flattenDefinition, validateTemplate } from "../src/lib/mitti-forms.core";
import { validateSavedDefinition } from "../src/lib/mitti-form-schema.core";
import { areasFromReadyCheckEntries, areaDiagramLayout, totalAreaM2 } from "../src/lib/area-diagram.core";
import { removalTotalM2, readyCheckStopReasons } from "../src/lib/ready-check-answers.core";
import { readyCheckBasics } from "../src/lib/ready-check-basics.core";
import { readAreas, totals } from "../src/lib/ready-check-areas.core";
import { planMeasurementUpdate, quoteInputsFromMeasurement } from "../src/lib/scope.core";
import { buildInstallerQuoteDraft } from "../src/lib/installer-led.core";
import { applyMittiRemoval } from "../src/lib/mitti-installer-quote.core";
import { A1_QUOTE_PAGE, A1_QUOTE_QUESTIONS, AREA_GROUP_BUTTON, LEAN_Q } from "../src/lib/ready-check-lean.core";

const load = (f: string) => JSON.parse(readFileSync(`tests/fixtures/mitti-ready-check/${f}`, "utf8"));
const A1 = load("a1-published-2026-10-25.json");
const A2 = load("a2-published-2026-10-25.json");
const TEMPLATES = [["A1", "ready_check_priced", A1], ["A2", "ready_check", A2]] as const;
const LENGTH_HELP = "Longest length of this ceiling area. Split an L-shaped ceiling into two areas.";

type Raw = Record<string, unknown> & { label?: string; children?: Raw[] };
const TYPE_KEYS = ["section", "question", "media", "instruction", "logicfield", "textsingle", "signature", "dynamicfield", "list", "datetime", "checkbox", "textmulti"];
/** Every item with its Mitti type key and config (calculation_data lives on the type config). */
function rawItems(def: { template?: { header_items?: Raw[]; items?: Raw[] } }): { label: string; first: string; type: string; cfg: Record<string, unknown> }[] {
  const out: { label: string; first: string; type: string; cfg: Record<string, unknown> }[] = [];
  const walk = (it: Raw) => {
    const type = TYPE_KEYS.find((k) => it[k] != null) ?? "";
    out.push({ label: String(it.label ?? ""), first: String(it.label ?? "").split("\n")[0]!.trim(), type, cfg: (it[type] as Record<string, unknown>) ?? {} });
    for (const c of it.children ?? []) walk(c);
  };
  for (const it of [...(def.template?.header_items ?? []), ...(def.template?.items ?? [])]) walk(it);
  return out;
}
const byFirst = (def: unknown, first: string) => rawItems(def as never).filter((i) => i.first === first);
const formula = (i: { cfg: Record<string, unknown> }) => (i.cfg.calculation_data as { formula?: string } | null)?.formula ?? null;
const idOf = (def: unknown, first: string): string[] => {
  const ids: string[] = [];
  const walk = (it: Raw) => { if (String(it.label ?? "").split("\n")[0]!.trim() === first) ids.push(String(it.id)); for (const c of it.children ?? []) walk(c); };
  const t = (def as { template: { header_items?: Raw[]; items?: Raw[] } }).template;
  for (const it of [...(t.header_items ?? []), ...(t.items ?? [])]) walk(it);
  return ids;
};

describe("published 25 Oct templates: the one-prompt items 1–9 (both A1 and A2)", () => {
  for (const [name, , def] of TEMPLATES) {
    const items = rawItems(def);
    const firsts = items.map((i) => i.first);
    it(`${name} item 1: no "Upload your area sketch or floor plan" question`, () => {
      expect(firsts.filter((f) => /sketch|floor plan/i.test(f))).toEqual([]);
    });
    it(`${name} item 2: Length (m) carries the new sentence (as help text or the instruction right under it); the old "portal works out" sentence is gone`, () => {
      const lens = byFirst(def, LEAN_Q.lengthM);
      expect(lens).toHaveLength(1);
      const i = items.findIndex((x) => x.first === LEAN_Q.lengthM);
      const asHelp = lens[0]!.label === `Length (m)\n${LENGTH_HELP}`;
      const asInstruction = lens[0]!.label === "Length (m)" && items[i + 1]?.type === "instruction" && items[i + 1]?.first === LENGTH_HELP;
      expect(asHelp || asInstruction, "Mitti put the sentence in a separate instruction item under Length (m), not in the label's help text").toBe(true);
      expect(items.filter((x) => /portal works out the m/i.test(x.label))).toEqual([]);
    });
    it(`${name} item 3: per-area m² is calculated as Length × Width (or absent)`, () => {
      const m2 = byFirst(def, LEAN_Q.measuredM2);
      const [len] = idOf(def, LEAN_Q.lengthM), [wid] = idOf(def, LEAN_Q.widthM);
      for (const x of m2) {
        const f = formula(x);
        expect(f, "calculated").toBeTruthy();
        expect(f!.includes(len!) && f!.includes(wid!) && /\*|×/.test(f!)).toBe(true);
      }
    });
    it(`${name} item 4: a calculated "Total ceiling area (m²)" exists and sums the per-area m²`, () => {
      const tot = byFirst(def, "Total ceiling area (m²)");
      expect(tot).toHaveLength(1);
      const f = formula(tot[0]!);
      expect(f).toBeTruthy();
      const m2Ids = idOf(def, LEAN_Q.measuredM2);
      expect(m2Ids.some((id) => f!.includes(id))).toBe(true);
    });
    it(`${name} item 7: only the repeating "Add a ceiling area" block — no "how many", no fixed Ceiling Area 1–6, no CLICK ON ME`, () => {
      expect(firsts.filter((f) => /how many ceiling areas/i.test(f))).toEqual([]);
      expect(firsts.filter((f) => /^[\s─\-–—]*ceiling area \d/i.test(f))).toEqual([]);
      expect(firsts.filter((f) => /click on me/i.test(f))).toEqual([]);
      const rep = items.filter((i) => i.type === "dynamicfield");
      expect(rep.map((r) => r.first)).toEqual([AREA_GROUP_BUTTON]);
      // every per-area question is inside the repeating block exactly once
      for (const q of [LEAN_Q.areaName, LEAN_Q.lengthM, LEAN_Q.widthM, LEAN_Q.measuredHow, LEAN_Q.existing, LEAN_Q.existingType, LEAN_Q.rValue, LEAN_Q.existingAction, LEAN_Q.removeM2, LEAN_Q.downlights, LEAN_Q.issues])
        expect(byFirst(def, q).length, q).toBe(1);
    });
    it(`${name} item 8: Remove / Top up / Not sure are neutral (no red/green)`, () => {
      const t = (def as { template: { response_sets: { id: string; responses: { label: string; color: string }[] }[] } }).template;
      const q = byFirst(def, LEAN_Q.existingAction)[0] ?? byFirst(def, "What needs to happen to it?")[0];
      expect(q).toBeTruthy();
      const rsId = String((q!.cfg as { response_set_id?: string }).response_set_id);
      const rs = t.response_sets.find((r) => r.id === rsId)!;
      expect(rs.responses.map((r) => r.label)).toEqual(["Remove", "Top up", "Not sure"]);
      expect(rs.responses.map((r) => r.color)).toEqual(["102,102,102", "102,102,102", "102,102,102"]); // grey, grey, grey
      const types = t.response_sets.find((r) => r.id === String((byFirst(def, LEAN_Q.existingType)[0]!.cfg as { response_set_id?: string }).response_set_id))!;
      expect(types.responses.map((r) => r.color)).toEqual(["112,112,112", "112,112,112", "112,112,112"]);
      for (const r of rs.responses) {
        const [R, G, B] = r.color.split(",").map(Number) as [number, number, number];
        const red = R > 150 && G < 100 && B < 100, green = G > 120 && R < 100 && B < 100;
        expect(red || green, `${r.label} colour ${r.colour}`).toBe(false);
      }
    });
    it(`${name} item 9: no difficult access charge / fee questions`, () => {
      expect(firsts.filter((f) => /difficult access (charge|fee)/i.test(f))).toEqual([]);
    });
  }
  it("A1 item 5: no quote page or quote questions", () => {
    const firsts = rawItems(A1).map((i) => i.first);
    expect(firsts).not.toContain(A1_QUOTE_PAGE);
    for (const q of A1_QUOTE_QUESTIONS) expect(firsts, q).not.toContain(q);
    expect(firsts.filter((f) => /what's included in your quote|what’s included in your quote/i.test(f))).toEqual([]);
  });
});

describe("portal validators on the published definitions", () => {
  it("both definitions are readable (the repeating 'Add a ceiling area' block is a container, not an unsupported question)", () => {
    for (const [name, key, def] of TEMPLATES) {
      const saved = validateSavedDefinition(key, def);
      expect(saved.unreadable, name).toBeFalsy();
      expect(saved.issues, name).toEqual(validateTemplate(key, flattenDefinition(def)).issues);
      // the calculated items are ordinary number answers to the reader; the instruction and the repeating block are not questions
      const flat = flattenDefinition(def);
      expect(flat.filter((i) => i.label.split("\n")[0]!.trim() === "Total ceiling area (m²)").map((i) => i.type)).toEqual(["textsingle"]);
      expect(flat.some((i) => i.label === AREA_GROUP_BUTTON || /Longest length of this ceiling area/.test(i.label))).toBe(false);
    }
  });
  it("validateTemplate: the ONLY issues are questions the live forms never had", () => {
    // "Who lives at the property?" (decision 222 premises type) was never built on either live template; the difficult-access
    // pair left the contract with decision 290.
    expect(validateTemplate("ready_check_priced", flattenDefinition(A1)).issues).toEqual([`Missing: ${LEAN_Q.premisesType}`]);
    // A2 (our lead): phone/email/permission/life support/5-year come from the website answers and were never on the live A2.
    expect(validateTemplate("ready_check", flattenDefinition(A2)).issues).toEqual([
      `Missing: ${LEAN_Q.ownerPhone}`, `Missing: ${LEAN_Q.ownerEmail}`, `Missing: ${LEAN_Q.contactPermission}`, `Missing: ${LEAN_Q.lifeSupport}`, `Missing: ${LEAN_Q.builtLast5}`,
      `Missing: ${LEAN_Q.premisesType}`,
    ]);
  });
});

// ---------- synthetic three-area audit in the NEW shape ----------
let n = 0;
const sel = (...labels: string[]) => ({ selected: labels.map((label) => ({ label })) });
const it_ = (label: string, v: string | string[] | null, parent: string | null = null) =>
  ({ item_id: `i${n++}`, label, parent_id: parent, responses: v == null ? {} : Array.isArray(v) ? sel(...v) : { text: v } });
const media = (label: string, parent: string | null) => ({ item_id: `m${n++}`, label, parent_id: parent, media: [{ media_id: `p${n}` }] });
/** In the audit Mitti reports the item label as built: "Length (m)" with the sentence as the next instruction item. */
const LENGTH_LABEL = "Length (m)";
type Area = { name: string; l: number; w: number; existing: boolean; action?: "Remove" | "Top up" | "Not sure"; removeM2?: number };
const AREAS: Area[] = [
  { name: "Main house", l: 6, w: 5, existing: false },
  { name: "Rear extension", l: 4, w: 3.5, existing: true, action: "Remove", removeM2: 12 },
  { name: "Garage", l: 3, w: 2, existing: true, action: "Top up" },
];
/** `calculated`: the per-area "Enter the measured ceiling area (m²)" and "Total ceiling area (m²)" values Mitti stores in the audit. */
function audit(opts: { calculated: boolean; areas?: Area[] } = { calculated: true }) {
  n = 0;
  const areas = opts.areas ?? AREAS;
  const items: unknown[] = [
    it_(LEAN_Q.ownerPhone, "0400000000"), it_(LEAN_Q.ownerEmail, "jolowexo@hotmail.com"), it_(LEAN_Q.contactPermission, ["Yes"]),
    it_(LEAN_Q.lifeSupport, ["No"]), it_(LEAN_Q.builtLast5, ["No"]),
    it_(LEAN_Q.roofType, ["Tiles"]), it_(LEAN_Q.access, ["Standard"]), media(LEAN_Q.accessPhoto, null),
    { item_id: "ceiling", label: "Ceiling Assessment", type: "section" },
  ];
  areas.forEach((a, i) => {
    const p = `area${i}`;
    items.push({ item_id: p, label: AREA_GROUP_BUTTON, parent_id: "ceiling", type: "dynamicfield" });
    items.push(it_(LEAN_Q.areaName, a.name, p), it_(LENGTH_LABEL, String(a.l), p), { item_id: `n${n++}`, label: LENGTH_HELP, parent_id: p, type: "instruction" }, it_(LEAN_Q.widthM, String(a.w), p));
    if (opts.calculated) items.push(it_(LEAN_Q.measuredM2, String(Math.round(a.l * a.w * 100) / 100), p));
    items.push(it_(LEAN_Q.measuredHow, ["Laser measure"], p), it_(LEAN_Q.existing, [a.existing ? "Yes" : "No"], p));
    if (a.existing) {
      items.push(it_(LEAN_Q.existingType, ["Batts"], p), it_(LEAN_Q.rValue, ["Below R2.0"], p), media(LEAN_Q.depthPhoto, p), it_(LEAN_Q.existingAction, [a.action!], p));
      if (a.removeM2 != null) items.push(it_(LEAN_Q.removeM2, String(a.removeM2), p));
    }
    items.push(media(LEAN_Q.beforeVideo, p), it_(LEAN_Q.downlights, ["No"], p), it_(LEAN_Q.issues, ["No"], p));
  });
  if (opts.calculated) items.push(it_("Total ceiling area (m²)", String(areas.reduce((s, a) => s + a.l * a.w, 0)), "ceiling"));
  items.push(it_(LEAN_Q.product, ["Bradford Gold R6"]), it_(LEAN_Q.outcome, ["Yes - Ready Check passed"]));
  return { audit_id: "audit_new", template_id: "01ee0428-be6d-4435-b34d-8b738935f099", header_items: [it_(LEAN_Q.jobNumber, "HV-9001"), it_(LEAN_Q.siteAddress, "1 Test St, Testville VIC 3000")], items };
}

describe("three areas in the new shape: 6×5, 4×3.5 (Remove 12 m²), 3×2 (Top up)", () => {
  it("the synthetic audit uses only labels the published templates carry", () => {
    const labels = new Set(rawItems(A1).map((i) => i.first));
    const used = flatten(audit({ calculated: true })).map((e) => e.label.split("\n")[0]!.trim()).filter((l) => l && l !== "Ceiling Assessment");
    for (const l of used) expect(labels.has(l), l).toBe(true);
  });
  for (const calculated of [true, false]) {
    describe(`calculated per-area m² ${calculated ? "present" : "absent"}`, () => {
      const p = parseAudit(audit({ calculated }));
      it("total m² = 50, removal m² = 12, three areas", () => {
        expect(p.patch.measured_area_m2).toBe(50);
        expect(p.patch.removal_required).toBe(true);
        expect(p.patch.removal_m2).toBe(12);
        expect(p.areas.map((a) => [a.label, a.lengthM, a.widthM, a.areaM2, a.removal, a.removalM2])).toEqual([
          ["Main house", 6, 5, 30, null, null], ["Rear extension", 4, 3.5, 14, "yes", 12], ["Garage", 3, 2, 6, "no", null],
        ]);
        expect(p.issues.filter((i) => /area|removal/i.test(i))).toEqual([]);
        expect(readyCheckStopReasons(p.snapshot)).toEqual([]);
      });
      it("the Total ceiling area (m²) item is never read as a fourth area", () => {
        expect(p.areas).toHaveLength(3);
        expect(readAreas({ areas: p.areas })).toHaveLength(3);
        expect(totals(readAreas({ areas: p.areas }))).toEqual({ areaM2: 50, removalM2: null }); // removalM2 null: Main house has no removal answer (no existing insulation)
      });
      it("three diagram boxes, 50 m² total", () => {
        const areas = areasFromReadyCheckEntries(p.snapshot);
        expect(areas.map((a) => [a.name, a.lengthM, a.widthM, a.areaM2, a.existingNote])).toEqual([
          ["Main house", 6, 5, 30, "No existing insulation"], ["Rear extension", 4, 3.5, 14, "Existing insulation: remove 12 m²"], ["Garage", 3, 2, 6, "Existing insulation: top up"],
        ]);
        expect(totalAreaM2(areas)).toBe(50);
        const layout = areaDiagramLayout({ kind: "ready_check", jobNumber: "HV-9001", address: "1 Test St", generatedAt: "2026-10-25T00:00:00Z", areas });
        expect(layout.boxes).toHaveLength(3);
        expect(layout.footer[0]).toBe("Total area to insulate: 50 m² across 3 upgrade areas");
      });
      it("basics complete (area from the summed patch) and the quote inputs carry 50 m² + 12 m² removal", () => {
        const { measure } = splitPatch(p.patch);
        const plan = planMeasurementUpdate({ scope: "SPLIT", current: null, incoming: measure as never, source: "installer", external: { source: "mitti", id: p.auditId } });
        expect(plan.action).toBe("create");
        const row = { ...(plan as { values: Record<string, unknown> }).values, id: "m1", status: "complete", source_role: "installer" };
        expect(quoteInputsFromMeasurement(row as never)).toMatchObject({ areaM2: 50, removalM2: 12 });
        const basics = readyCheckBasics({ installerSourced: true, areaM2: Number(row.measured_area_m2), productReady: true, installerPriceIncGst: 3200, ownerMobile: "0400000000", ownerEmail: "jolowexo@hotmail.com", contactPermission: true, stops: readyCheckStopReasons(p.snapshot), formCompleted: false });
        expect(basics.ready).toBe(true);
        expect(basics.missing).toEqual([]);
        // The A1 quote line (installer-quote.server): measured m² from the measurement row, removal total from the form answers.
        expect(removalTotalM2(p.snapshot)).toBe(12);
        const draft = buildInstallerQuoteDraft({
          price: { ok: true, issues: [], price: { included: ["R5.0 supply and install"], otherDescription: "", totalIncGst: 3200, agreedWithOwner: false } },
          measuredM2: Number(row.measured_area_m2), wholeVeec: { veecs: 10, raw: 500 }, piesaIncGst: 349, apFeeIncGst: 200, caps: { metropolitan: true, minCopay: 200 },
        });
        applyMittiRemoval(draft, removalTotalM2(p.snapshot));
        expect(draft.blockers).toEqual([]);
        expect(draft.lines[0]!.description).toContain("Removal of existing insulation – 12 m²");
      });
    });
  }
  it("a calculated m² that disagrees with Length × Width is taken as stored (Mitti's number wins, no silent override) and a Remove area with no removal m² falls back to its own m²", () => {
    const p = parseAudit(audit({ calculated: false, areas: [{ name: "Only", l: 5, w: 4, existing: true, action: "Remove" }] }));
    expect(p.patch.measured_area_m2).toBe(20);
    expect(p.patch.removal_m2).toBe(20);
  });
});
