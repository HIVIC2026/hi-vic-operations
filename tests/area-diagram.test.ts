// Decision 211: the portal draws the Activity Guide Table 4 area diagram from the measured Ready Check areas.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  AREA_DIAGRAM_KIND, DIAGRAM_NOTE, FINAL_AREA_DIAGRAM_KIND, applyInstallZones, areaDiagramHash, areaDiagramLayout, areaDiagramSummary, areaDiagramSvg,
  areasFromReadyCheckEntries, areasFromRecordAreas, singleAreaFallback, totalAreaM2, type DiagramInput,
} from "../src/lib/area-diagram.core";
import { areaDiagramPdf } from "../src/lib/area-diagram-pdf.server";
import { a3EvidenceRequired, generatedPlanSatisfiesFinalPlan } from "../src/lib/piisa-a3.core";
import { currentPostworkMedia } from "../src/lib/piisa-postwork.core";
import { FORMS, mittiAiPrompt, validateTemplate } from "../src/lib/mitti-forms.core";
import { categoriseDocument } from "../src/lib/jobfile.core";

const e = (label: string, value: unknown) => ({ label, value });
/** A2 (our lead) answers in form order: names + length × width per area, one job-level product. */
const A2 = [
  e("Insulation product", "Bradford Gold R5"),
  e("How many separate ceiling areas are there?", "2"),
  e("Where is this area?", "Main house"), e("Length (m)", "12"), e("Width (m)", "8.5"), e("Is there existing insulation?", "Yes"), e("What needs to happen to it?", "Remove"), e("Area to remove (m2)", "40"),
  e("Where is this area?", "Rear extension"), e("Length (m)", "6"), e("Width (m)", "4"), e("Is there existing insulation?", "No"),
  e("Was the ceiling or roof built or replaced in the last 5 years?", "No"),
];
/** A1 (installer's own customer) answers: headings, help text after a line break, measured m² directly. */
const A1 = [
  e("What insulation product will you be using on this job?", "Fletchers Pink Batts R6"),
  e("── Ceiling Area 1 ──", null), e("Which part of the home does this ceiling area cover?\ne.g. Main house – bedrooms and hallway", "Main house – bedrooms"), e("Enter the measured ceiling area (m²)", "95.5"), e("Is there existing insulation in this ceiling area?", "Yes"), e("What is required for the existing insulation?", "Top up"),
  e("── Ceiling Area 2 ──", null), e("Which part of the home does this ceiling area cover?\ne.g. Main house – bedrooms and hallway", "Garage"), e("Enter the measured ceiling area (m²)", "30"), e("Is there existing insulation in this ceiling area?", "No"),
];
const input = (areas = areasFromReadyCheckEntries(A2), over: Partial<DiagramInput> = {}): DiagramInput => ({ kind: "ready_check", jobNumber: "HV-00123", address: "12 Smith & Sons Rd, Frankston VIC 3199", generatedAt: "2026-10-24T03:00:00.000Z", areas, ...over });

describe("areas from Ready Check answers", () => {
  test("A2: name, length × width → m², job-level product and R-value, existing notes", () => {
    const a = areasFromReadyCheckEntries(A2);
    expect(a.map((x) => [x.name, x.lengthM, x.widthM, x.areaM2])).toEqual([["Main house", 12, 8.5, 102], ["Rear extension", 6, 4, 24]]);
    expect(a.every((x) => x.productOption === "Bradford Gold R5" && x.rValue === "R5.0")).toBe(true);
    expect(a[0]!.existingNote).toBe("Existing insulation: remove 40 m²");
    expect(a[1]!.existingNote).toBe("No existing insulation");
    expect(totalAreaM2(a)).toBe(126);
  });
  test("A1: headings and help text, measured m² only, top up note", () => {
    const a = areasFromReadyCheckEntries(A1);
    expect(a.map((x) => [x.name, x.areaM2, x.lengthM])).toEqual([["Main house – bedrooms", 95.5, null], ["Garage", 30, null]]);
    expect(a[0]!.existingNote).toBe("Existing insulation: top up");
    expect(a[0]!.rValue).toBe("R6.0");
  });
  test("unfilled template placeholders are dropped; a single nameless area is the main ceiling", () => {
    const tpl = [e("Which part of the home does this ceiling area cover?", null), e("Enter the measured ceiling area (m²)", null), e("── Ceiling Area 1 ──", null), e("Enter the measured ceiling area (m²)", "48")];
    const a = areasFromReadyCheckEntries(tpl);
    expect(a).toHaveLength(1);
    expect(a[0]!.name).toBe("Main ceiling");
    expect(a[0]!.productOption).toBeNull();
    expect(areasFromReadyCheckEntries([])).toEqual([]);
  });
  test("office areas record and whole-job fallback", () => {
    const rec = areasFromRecordAreas([{ label: "Front", areaM2: 50, product: "Earthwool R5", rValue: null, existing: "present", removal: "yes", removalM2: 10 }, { label: "", areaM2: 20, product: null, rValue: null, existing: "none", removal: null, removalM2: null }], "ECOWOOL R5");
    expect(rec.map((a) => [a.name, a.productOption, a.rValue, a.existingNote])).toEqual([["Front", "Earthwool R5", "R5.0", "Existing insulation: remove 10 m²"], ["Area 2", "ECOWOOL R5", "R5.0", "No existing insulation"]]);
    expect(singleAreaFallback(88, "Bradford Gold R7", true, false, null)).toEqual([{ name: "Main ceiling", lengthM: null, widthM: null, areaM2: 88, productOption: "Bradford Gold R7", rValue: "R7.0", existingNote: "Existing insulation: top up" }]);
    expect(singleAreaFallback(null, null, null, null, null)).toEqual([]);
  });
});

describe("diagram output", () => {
  test("deterministic SVG with every Table 4 element", () => {
    const svg = areaDiagramSvg(input());
    expect(areaDiagramSvg(input())).toBe(svg);
    for (const s of ["Main house", "Rear extension", "12 × 8.5 m", "6 × 4 m", "102 m²", "24 m²", "Bradford Gold · R5.0", "Total area to insulate: 126 m² across 2 upgrade areas", "Job HV-00123", "Smith &amp; Sons", "Generated 2026-10-24", DIAGRAM_NOTE, "Existing insulation: remove 40 m²"]) expect(svg).toContain(s);
    expect(svg.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\"")).toBe(true);
    expect(svg).not.toContain("Smith & Sons"); // escaped
  });
  test("boxes are scaled proportionally to the measured edges", () => {
    const l = areaDiagramLayout(input());
    expect(l.boxes).toHaveLength(2);
    const [a, b] = l.boxes;
    expect(a!.w / b!.w).toBeCloseTo(12 / 6, 5);
    expect(a!.h / b!.h).toBeCloseTo(8.5 / 4, 5);
    expect(l.boxes.every((x) => x.x + x.w <= l.width)).toBe(true);
    expect(l.footer[0]).toContain("126 m²");
  });
  test("many areas wrap onto new rows without overlapping", () => {
    const areas = Array.from({ length: 6 }, (_, i) => ({ name: `Area ${i + 1}`, lengthM: 8, widthM: 5, areaM2: 40, productOption: "Earthwool R5", rValue: "R5.0", existingNote: null }));
    const l = areaDiagramLayout(input(areas));
    const rows = new Set(l.boxes.map((b) => b.y));
    expect(rows.size).toBeGreaterThan(1);
    for (const p of l.boxes) for (const q of l.boxes) if (p !== q) expect(p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y).toBe(true);
    expect(l.height).toBeGreaterThan(Math.max(...l.boxes.map((b) => b.y + b.h)));
  });
  test("no areas still renders a page that says so", () => {
    const svg = areaDiagramSvg(input([]));
    expect(svg).toContain("No ceiling areas recorded");
    expect(svg).toContain("Total area to insulate: —");
  });
  test("final plan title and basis", () => {
    const svg = areaDiagramSvg(input(undefined, { kind: "final" }));
    expect(svg).toContain("Final installation plan");
    expect(svg).toContain("as confirmed by the installer on install day");
  });
  test("content hash ignores the generated time and changes with the facts", () => {
    const h = areaDiagramHash(input());
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(areaDiagramHash(input(undefined, { generatedAt: "2027-01-01T00:00:00Z" }))).toBe(h);
    expect(areaDiagramHash(input(areasFromReadyCheckEntries(A1)))).not.toBe(h);
    expect(areaDiagramHash(input(undefined, { kind: "final" }))).not.toBe(h);
  });
  test("PDF renders from the same layout", async () => {
    const pdf = await areaDiagramPdf(input());
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });
  test("office summary line", () => {
    expect(areaDiagramSummary(areasFromReadyCheckEntries(A2))).toBe("2 areas · 126 m² · Bradford Gold R5");
  });
});

describe("install-day confirmations (decision 210 d/e) feed the final plan", () => {
  test("matched zones keep the measured dimensions and take the installed m² and product; new zones are added", () => {
    const rc = areasFromReadyCheckEntries(A2);
    const out = applyInstallZones(rc, [{ name: "main house", areaM2: 98, productOption: "Bradford Gold R6" }, { name: "Carport", areaM2: 10, productOption: null }]);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ name: "Main house", lengthM: 12, widthM: 8.5, areaM2: 98, productOption: "Bradford Gold R6", rValue: "R6.0", existingNote: "Existing insulation: remove 40 m²" });
    expect(out[1]).toMatchObject({ name: "Rear extension", areaM2: 24, productOption: "Bradford Gold R5" });
    expect(out[2]).toMatchObject({ name: "Carport", areaM2: 10, productOption: null, rValue: null });
    expect(rc[0]!.areaM2).toBe(102); // input untouched
  });
});

describe("the generated final plan satisfies the A5 final_plan evidence", () => {
  const base = { crewCount: 1, electricianRequiredAtStart: false, existingPlanMatchesInstall: false, lifeSupportConsentOnFile: true };
  test("pure rule", () => {
    expect(generatedPlanSatisfiesFinalPlan({ generatedFinalPlan: true, existingPlanMatchesInstall: false, mandatoryCurrentPostwork: true })).toBe(true);
    expect(generatedPlanSatisfiesFinalPlan({ existingPlanMatchesInstall: true, mandatoryCurrentPostwork: false })).toBe(true); // old job's uploaded plan
    expect(generatedPlanSatisfiesFinalPlan({ existingPlanMatchesInstall: true, mandatoryCurrentPostwork: true })).toBe(false);
    expect(generatedPlanSatisfiesFinalPlan({ existingPlanMatchesInstall: false })).toBe(false);
  });
  test("a3EvidenceRequired drops final_plan only when generated (or legacy accepted plan)", () => {
    const keys = (ctx: Record<string, unknown>) => a3EvidenceRequired({}, { ...base, ...ctx } as never).map((r) => r.key);
    expect(keys({ mandatoryCurrentPostwork: true })).toContain("final_plan");
    expect(keys({ mandatoryCurrentPostwork: true, generatedFinalPlan: true })).not.toContain("final_plan");
    expect(keys({ existingPlanMatchesInstall: true })).not.toContain("final_plan");
  });
  test("PIISA after-work attachments: the plan upload is waived when generated; the video never is", () => {
    expect(currentPostworkMedia({ items: [] }).blockers).toHaveLength(2);
    const r = currentPostworkMedia({ items: [] }, { generatedFinalPlan: true });
    expect(r.blockers).toHaveLength(1);
    expect(r.blockers[0]).toContain("Completed-work video");
  });
});

describe("Ready Check form: the diagram upload is retired (decision 211)", () => {
  const items = (key: "ready_check" | "ready_check_priced", drop: (l: string) => boolean) => FORMS[key].fields.filter((f) => !drop(f.label)).map((f) => ({ label: f.label, type: f.type === "choice" ? "question" : f.type === "multichoice" ? "checkbox" : f.type === "yesno" ? "question" : f.type === "media" ? "media" : f.type === "tick" ? "checkbox" : f.type }));
  test("gone from the lean build sheet (decision 222); old forms that still carry the upload pass; the prompt forbids it", () => {
    for (const key of ["ready_check", "ready_check_priced"] as const) {
      expect(FORMS[key].fields.some((x) => /diagram|sketch|floor plan/i.test(x.label))).toBe(false);
      expect(validateTemplate(key, items(key, () => false)).ok).toBe(true);
      // Old forms with the retired upload (either live wording) are not failed for carrying it.
      expect(validateTemplate(key, [...items(key, () => false), { label: "Upload your area sketch or floor plan.", type: "media" }, { label: "Upload your area sketch or floor plan. Rough is fine. Mark this ceiling area and show the measurements used.", type: "media" }]).ok).toBe(true);
      expect(mittiAiPrompt(key)).not.toContain('"Upgrade area diagram or floor plan"');
      expect(mittiAiPrompt(key)).toContain("Do NOT add a diagram, sketch or floor plan question");
    }
  });
  test("PIISA supplemental final floor plan upload is optional", () => {
    const f = FORMS.piisa.fields.find((x) => x.label.startsWith("Final floor plan"));
    expect(f?.required).toBe(false);
  });
});

describe("job file filing", () => {
  test("generated diagrams land in the Ready Check / Installation folders and the ESC pack", () => {
    const a = categoriseDocument(AREA_DIAGRAM_KIND, "Upgrade area diagram (generated) — 2 areas");
    expect(a.category).toBe("Ready Check");
    expect(a.alsoIn).toEqual(["Installation", "ESC / VEEC"]);
    const f = categoriseDocument(FINAL_AREA_DIAGRAM_KIND, "Final installation plan (generated)");
    expect(f.category).toBe("Installation");
    expect(f.alsoIn).toContain("ESC / VEEC");
    expect(f.status).toBe("final");
  });
});

describe("declared product: the boss's pick wins (final review, Jo 31 Oct 2026)", () => {
  test("declaredProduct reads the boss's product_option first, failing safe to the form / Mitti product", () => {
    const src = readFileSync("src/lib/area-diagram.server.ts", "utf8");
    const fn = src.slice(src.indexOf("async function declaredProduct"), src.indexOf("/** The Ready Check areas for this job"));
    expect(fn).toContain("readInstallerPrice(jobId)");
    expect(fn).toContain("product_option");
    expect(fn).toContain("catch");
    expect(fn.indexOf("readInstallerPrice(jobId)")).toBeLessThan(fn.indexOf("const fromForm"));
    expect(fn.indexOf("readInstallerPrice(jobId)")).toBeLessThan(fn.indexOf("productForHivQuote"));
  });
});
