// Part 7 Task 2: the SWMS PDF in the website look (docs/approved-samples/2026-11-02/swms-web.html) with the "Changes during
// the job" box. The pure HTML (swmsPdfHtml) carries the approved structure and CSS; the filed PDF is the same model drawn
// through Part 1's pdf-lib kit (renderPdf), behind PDF_LOOK_APPROVED.swms so the filed PDF is byte-for-byte the old
// WorkSafe layout until Jo approves the sample. Wording comes from swms.core (never retyped).
import { describe, expect, test } from "bun:test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument } from "pdf-lib";
import { LOGO_PNG } from "../src/lib/email-hero-assets";
import { PDF_LOOK_APPROVED } from "../src/lib/pdf-approvals.core";
import { PDF_PAGE } from "../src/lib/pdf-look.core";
import { buildSwms, swmsComplianceLines, swmsWordingFor, type SwmsChange, type SwmsFacts, type SwmsSignature } from "../src/lib/swms.core";
import { SWMS_HOUSE_STEPS, swmsHouseStepTexts } from "../src/lib/swms-house.core";
import { SWMS_CHANGES_HEADS, SWMS_CHANGES_LINE, SWMS_PDF_SUB, SWMS_PDF_TITLE, swmsPdfBlocks, swmsPdfHtml, swmsPdfModel } from "../src/lib/swms-pdf-html.core";
import { SWMS_PAGE, buildSwmsPdf } from "../src/lib/swms-pdf.server";

/** The approved sample's job. */
const facts: SwmsFacts = {
  jobNumber: "HV-1234", address: "12 Example St, Box Hill VIC 3128", businessName: "Rapid Insulation", installDate: "2026-11-13",
  lead: { name: "John Smith", workerId: "w1" }, crew: [{ name: "Sam Lee", workerId: "w2" }, { name: "Ali Khan", workerId: "w3" }],
  yearBuilt: 1995, hazardNote: null, siteNote: null,
  houseLines: ["Roof: Tile", "Ceiling access: Easy", "Main house: 4 recessed downlights", "PIESA: passed"],
  houseSteps: [swmsHouseStepTexts(true).downlights],
};
const plan = buildSwms(facts, { nov2: true });
const sigs: SwmsSignature[] = [
  { key: "w:w1", name: "John Smith", typedName: "John Smith", signedAt: "2026-11-12T07:42:00Z" },
  { key: "w:w2", name: "Sam Lee", typedName: "Sam Lee", signedAt: "2026-11-12T08:05:00Z" },
  { key: "w:w3", name: "Ali Khan", typedName: "Ali Khan", signedAt: "2026-11-12T19:58:00Z" },
];
const CHANGE: SwmsChange = { what: "Wasp nest in the back ceiling", control: "Area closed off, nest removed by owner's pest controller", by: "John Smith", at: "2026-11-13T02:10:00Z" };
const pdfText = async (b: Uint8Array) => { const d = await getDocument({ data: b.slice() }).promise; const out: string[] = []; for (let i = 1; i <= d.numPages; i++) out.push((await (await d.getPage(i)).getTextContent()).items.map((x: any) => x.str).join(" ").replace(/\s+/g, " ")); return out; };
/** Every needle appears, each after the one before it. */
function inOrder(hay: string, needles: string[]) {
  let at = 0;
  for (const n of needles) { const i = hay.indexOf(n, at); expect(i, `"${n}" after position ${at}`).toBeGreaterThanOrEqual(0); at = i + n.length; }
}

describe("swmsPdfHtml — the approved website look", () => {
  const html = swmsPdfHtml(plan, sigs, []);
  const w = swmsWordingFor(plan.rule);
  test("business block, eyebrow, title, facts, compliance, house, hazards, changes and sign-off in the sample's order", () => {
    inOrder(html, [
      "DC Construction Solutions Pty Ltd", "trading as Home Insulation Victoria", "ABN 44 671 613 979 · Accredited Person A003654",
      "SAFETY PLAN · JOB HV-1234", SWMS_PDF_TITLE, SWMS_PDF_SUB,
      "Direct employer", "Rapid Insulation", "Principal contractor", "Home Insulation Victoria (DC Construction Solutions Pty Ltd)",
      "Work supervisor", "John Smith", "Install date", "13/11/2026", "Site location/address", "12 Example St, Box Hill VIC 3128",
      "Work activity", plan.workActivity, "High-risk construction work", plan.highRiskWork.join("; "),
      "Compliance", ...swmsComplianceLines(plan).flat(),
      "Specific to this house", "Roof: Tile", "PIESA: passed", `Safety step: ${swmsHouseStepTexts(true).downlights}`,
      "Hazards and control measures", "Task:", plan.hazards.length ? "For every hazard below" : "", "How implemented:", w.howImplemented, "Responsible: John Smith (Lead Installer)",
      ...plan.hazards.flatMap((h, i) => [`${i + 1}`, h.name, `${h.control}.`]),
      "Changes during the job", SWMS_CHANGES_LINE, ...SWMS_CHANGES_HEADS, "None recorded",
      "Worker sign-off", "I have read the safety plan and will follow it.", "Name", "Signature", "Date",
      "John Smith (Lead Installer)", '✓ signed — typed "John Smith"', "12/11/2026 6:42pm",
      "Sam Lee (Crew)", '✓ signed — typed "Sam Lee"', "12/11/2026 7:05pm",
      "Ali Khan (Crew)", '✓ signed — typed "Ali Khan"', "13/11/2026 6:58am",
    ]);
    expect(SWMS_PDF_TITLE).toBe("Safe Work Method Statement");
    expect(SWMS_PDF_SUB).toBe("Ceiling insulation (VEU Activity 48)");
    expect(SWMS_CHANGES_HEADS).toEqual(["What changed", "New control", "Lead Installer, date and time"]);
    expect(SWMS_CHANGES_LINE).toBe("If anything on site changes, or a control isn't working, stop work. Record the change and the new control here before work starts again.");
  });
  test("each hazard name appears once in the hazards list; numbered 1–9", () => {
    const body = html.slice(html.indexOf("Hazards and control measures"), html.indexOf("Changes during the job"));
    for (const h of plan.hazards) expect(body.split(h.name).length - 1, h.name).toBe(1);
    for (let n = 1; n <= 9; n++) expect(body).toContain(`class="n">${n}<`);
    expect(body).not.toContain(w.hazards[0]!.short + ":");
  });
  test("website look: colours, Open Sans, page size, sections keep together, no risk ratings, no PPE list, no lowercase lead installer", () => {
    for (const c of ["#3c51c4", "#22376b", "#eef0fc"]) expect(html).toContain(c);
    expect(html).toContain("Open Sans");
    expect(html).toContain("@page{size:600px 849px;margin:0 40px 46px}");
    expect(html).not.toMatch(/lead installer/);
    expect(html).not.toMatch(/Risk rating|>Risk<|<th>Risk/); // no risk-rating column (the high-risk work line keeps its official words)
    expect(html).not.toMatch(/\bPPE\b/);
    expect(html).not.toContain("HIV ");
    // Every section box carries break-inside: avoid (the .hz hazards and the .keep boxes).
    const sections = html.match(/<(?:div|section) class="(?:hz|keep)"/g) ?? [];
    expect(sections.length).toBeGreaterThanOrEqual(11);
    expect(html).toMatch(/\.hz\{[^}]*break-inside:avoid/);
    expect(html).toMatch(/\.keep\{[^}]*break-inside:avoid/);
  });
  test("the logo is the bundled PNG as an inlined data URL", () => {
    const m = /<img class="logoimg" src="data:image\/png;base64,([A-Za-z0-9+/=]+)"/.exec(html);
    expect(m).not.toBeNull();
    expect(m![1]).toBe(LOGO_PNG);
    expect(Buffer.from(m![1]!, "base64").subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });
  test("a recorded change fills the box: what, new control, Lead Installer + Melbourne time; no None recorded", () => {
    const h = swmsPdfHtml(plan, sigs, [CHANGE]);
    inOrder(h, ["Changes during the job", "Wasp nest in the back ceiling", "Area closed off, nest removed by owner's pest controller", "John Smith, 13/11/2026 1:10pm"]);
    expect(h).not.toContain("None recorded");
  });
  test("an unsigned person shows NOT SIGNED; no house facts prints None recorded; dynamic text is escaped", () => {
    const h = swmsPdfHtml(buildSwms({ ...facts, houseLines: [], houseSteps: [], siteNote: "<b>Dog</b> & cat" }, { nov2: true }), sigs.slice(0, 1), []);
    expect(h).toContain("Sam Lee (Crew)");
    expect(h).toContain("NOT SIGNED");
    expect(h).toContain("&lt;b&gt;Dog&lt;/b&gt; &amp; cat");
    const none = swmsPdfHtml(buildSwms({ ...facts, houseLines: [], houseSteps: [], siteNote: null }, { nov2: true }), sigs, []);
    expect(none.slice(none.indexOf("Specific to this house"), none.indexOf("Hazards and control measures"))).toContain("None recorded");
  });
  test("a plan on the 24 Oct rule prints its own (signed) words", () => {
    const old = buildSwms({ ...facts, houseSteps: [SWMS_HOUSE_STEPS.downlights] });
    const h = swmsPdfHtml(old, sigs, []);
    expect(h).toContain(swmsWordingFor(old.rule).complianceMeasures);
    expect(h).toContain(`John Smith (${swmsWordingFor(old.rule).roleLabel.lead})`);
  });
});

describe("the same model drawn through Part 1's kit (renderPdf)", () => {
  test("blocks follow the model: header, title, facts, Compliance, house, hazards (flowing), changes and sign-off (kept together)", () => {
    const m = swmsPdfModel(plan, sigs, [CHANGE]);
    expect(m.eyebrow).toBe("SAFETY PLAN · JOB HV-1234");
    expect(m.hazards.map((h) => h.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(m.changes).toEqual([{ what: CHANGE.what, control: CHANGE.control, who: "John Smith, 13/11/2026 1:10pm" }]);
    expect(m.signoff.map((s) => s.name)).toEqual(["John Smith (Lead Installer)", "Sam Lee (Crew)", "Ali Khan (Crew)"]);
    const blocks = swmsPdfBlocks(m);
    expect(blocks.map((b) => b.kind).slice(0, 3)).toEqual(["header", "title", "facts"]);
    const titles = blocks.flatMap((b) => (b.kind === "section" ? [b.title] : []));
    expect(titles).toEqual(["Compliance", "Specific to this house", "Hazards and control measures", "Changes during the job", "Worker sign-off"]);
    const hazards = blocks.find((b) => b.kind === "section" && b.title === "Hazards and control measures")!;
    expect(hazards.keepTogether).toBe(false);
    for (const t of ["Changes during the job", "Worker sign-off"]) expect(blocks.find((b) => b.kind === "section" && b.title === t)!.keepTogether).not.toBe(false);
  });
  test("the website-look PDF: portrait kit page, every word of the sample, Page N of M, no lowercase lead installer", async () => {
    const { bytes, layout } = await buildSwmsPdf(plan, sigs, { changes: [CHANGE], look: "website" });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(layout.pages);
    const { width, height } = doc.getPage(0).getSize();
    expect([Math.round(width), Math.round(height)]).toEqual([Math.round(PDF_PAGE.width), Math.round(PDF_PAGE.height)]);
    const pages = await pdfText(bytes);
    const all = pages.join(" ");
    expect(all.replace(/\s+/g, "")).toContain("SAFETYPLAN·JOBHV-1234"); // the eyebrow is letter-spaced
    for (const s of ["Safe Work Method Statement", "Rapid Insulation", "Compliance", "Specific to this house", "Hazards and control measures",
      "Changes during the job", "Wasp nest in the back ceiling", "John Smith, 13/11/2026 1:10pm", "Worker sign-off", "John Smith (Lead Installer)", "Sam Lee (Crew)", "12/11/2026 7:05pm"]) expect(all, s).toContain(s);
    for (const h of plan.hazards) expect(all).toContain(h.name);
    expect(all).not.toMatch(/lead installer/);
    expect(all).not.toContain("None recorded");
    pages.forEach((p, i) => expect(p).toContain(`Page ${i + 1} of ${pages.length}`));
    // The kept-together sections start and end on one page.
    const signPage = pages.findIndex((p) => p.includes("Worker sign-off"));
    expect(pages[signPage]).toContain("Ali Khan (Crew)");
    const chPage = pages.findIndex((p) => p.includes("Changes during the job"));
    expect(pages[chPage]).toContain("John Smith, 13/11/2026 1:10pm");
  });
  test("no changes → None recorded in the box", async () => {
    const { bytes } = await buildSwmsPdf(plan, sigs, { look: "website" });
    expect((await pdfText(bytes)).join(" ")).toContain("None recorded");
  });
});

describe("behind PDF_LOOK_APPROVED.swms", () => {
  test("the flag is false: buildSwmsPdf still draws the WorkSafe landscape layout, byte-for-byte the old builder", async () => {
    expect(PDF_LOOK_APPROVED.swms).toBe(false);
    const a = await buildSwmsPdf(plan, sigs, { recordRef: "swms:test" });
    const b = await buildSwmsPdf(plan, sigs, { recordRef: "swms:test", look: "worksafe" });
    const doc = await PDFDocument.load(a.bytes);
    expect(doc.getPage(0).getSize()).toEqual({ width: SWMS_PAGE.width, height: SWMS_PAGE.height });
    expect(a.layout.mainHeaderPages.length).toBeGreaterThan(0);
    // pdf-lib stamps a creation time; compare everything but the two date strings.
    const strip = (x: Uint8Array) => Buffer.from(x).toString("latin1").replace(/D:\d{14}[^)]*/g, "D:");
    expect(strip(a.bytes)).toBe(strip(b.bytes));
  });
  test("with the flag on (overridden) the website look is used", async () => {
    PDF_LOOK_APPROVED.swms = true;
    try {
      const { bytes } = await buildSwmsPdf(plan, sigs, {});
      const { width } = (await PDFDocument.load(bytes)).getPage(0).getSize();
      expect(Math.round(width)).toBe(Math.round(PDF_PAGE.width));
    } finally { PDF_LOOK_APPROVED.swms = false; }
  });
});
