// Jo 4 Nov 2026 16:10 (ESC letter on Activity 48 R-value): the approved "Your old insulation stays." notice — when it shows
// (Ready Check: not removed + good enough to lay over, recorded per area), its exact words, and where it goes: the quote
// email (both lead kinds, the other variants byte-identical), the Customer Agreement section 1 (replacing the removal
// bullet at render time; the stored body untouched), the signed acceptance PDF, the quote page and My job.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { keptInsulationNotice, oldInsulationKept } from "../src/lib/kept-insulation.core";
import { AGREEMENT_REMOVAL_LINE, CUSTOMER_AGREEMENT_V1_3, applyKeptInsulation, fillAgreement, parseAgreement, type AgreementFacts } from "../src/lib/customer-agreement.core";
import { agreementBlocks } from "../src/lib/customer-agreement-pdf.server";
import { renderOwnerQuoteEmail, type OwnerQuoteEmailInput } from "../src/lib/owner-quote-email.core";

const NOTICE = "Your old insulation stays. Rapid Insulation checked it and found it's in good enough condition for new insulation to go over it. The new insulation will be laid on top to the Australian Standard (AS 3999) and the manufacturer's instructions.";

describe("the approved words", () => {
  test("verbatim, with the installer's name; unknown name → \"Your installer\"", () => {
    expect(keptInsulationNotice("Rapid Insulation")).toBe(NOTICE);
    expect(keptInsulationNotice(null)).toBe(NOTICE.replace("Rapid Insulation", "Your installer"));
    expect(keptInsulationNotice("  ")).toContain("Your installer checked it");
  });
});

describe("oldInsulationKept — only when the Ready Check RECORDS it (fails closed)", () => {
  const zone = (o: Record<string, unknown>) => ({ key: "mitti-1", name: "Main", present: true, removal: "no", suitable: true, ...o });
  test("kept: present, not removed, every area with old insulation suitable to lay over", () => {
    expect(oldInsulationKept({ insulation_present: true, removal_required: false, zones: [zone({})] })).toBe(true);
    expect(oldInsulationKept({ insulation_present: true, removal_required: false, zones: [zone({}), zone({ key: "mitti-2", present: false, suitable: null, removal: null })] })).toBe(true);
  });
  test("not kept: removal anywhere, a 'No'/blank condition, no old insulation, no areas, nothing read", () => {
    expect(oldInsulationKept({ insulation_present: true, removal_required: true, zones: [zone({})] })).toBe(false);
    expect(oldInsulationKept({ insulation_present: true, removal_required: false, zones: [zone({ removal: "yes" })] })).toBe(false);
    expect(oldInsulationKept({ insulation_present: true, removal_required: false, zones: [zone({ suitable: false })] })).toBe(false);
    expect(oldInsulationKept({ insulation_present: true, removal_required: false, zones: [zone({ suitable: null })] })).toBe(false);
    expect(oldInsulationKept({ insulation_present: true, removal_required: false, zones: [zone({}), zone({ key: "mitti-2", suitable: false })] })).toBe(false);
    expect(oldInsulationKept({ insulation_present: false, removal_required: false, zones: [] })).toBe(false);
    expect(oldInsulationKept({ insulation_present: true, removal_required: false, zones: [] })).toBe(false); // older forms: no per-area answer
    expect(oldInsulationKept({ insulation_present: true, removal_required: null, zones: [zone({ removal: null })] })).toBe(false);
    expect(oldInsulationKept(null)).toBe(false);
    expect(oldInsulationKept({ insulation_present: true, removal_required: false, zones: "junk" })).toBe(false);
  });
});

const FACTS: AgreementFacts = {
  owner_name: "Sarah Brown", address: "12 Example St, Box Hill VIC 3128", job_number: "HV-1234",
  installer_name: "Rapid Insulation", installer_phone: "03 9000 0000", installer_email: "office@rapid.example",
  product: "Bradford Gold R5.0", area_m2: "120", price_before_rebate: "$3,000", rebate: "$1,200",
  your_price: "$1,800", valid_until: "2 Dec 2026", safety_check: "$349", deposit: "$180", rest: "$1,271",
};
describe("Customer Agreement section 1", () => {
  test("the stored v1.3 body is untouched; the kept variant swaps the removal bullet for the notice at render time", () => {
    expect(CUSTOMER_AGREEMENT_V1_3).toContain(`- ${AGREEMENT_REMOVAL_LINE}`);
    const kept = applyKeptInsulation(CUSTOMER_AGREEMENT_V1_3);
    expect(kept).not.toContain(AGREEMENT_REMOVAL_LINE);
    expect(kept).toContain("- Your old insulation stays. {installer_name} checked it");
    const filled = fillAgreement(kept, FACTS, "1.3");
    expect(filled).toContain(`- ${NOTICE}`);
    expect(filled).toContain("- Take away all removed insulation and rubbish."); // the rest of section 1 as approved
    // Section 1's bullets, in order: install, kept notice, take away, PIESA, rebate.
    const s1 = parseAgreement(filled).find((b) => b.kind === "section" && b.number === "1") as { children: { kind: string; items?: string[] }[] };
    const bullets = s1.children.find((c) => c.kind === "bullets")!.items!;
    expect(bullets[1]).toBe(NOTICE);
    expect(bullets).toHaveLength(5);
    expect(() => applyKeptInsulation("no removal line here")).toThrow(/removal line is missing/);
  });
  test("agreementBlocks: off/absent = the approved body; on = the notice in section 1 and nothing else changes", () => {
    const t = { version: "1.3", body: CUSTOMER_AGREEMENT_V1_3 };
    const plain = JSON.stringify(agreementBlocks(t, FACTS));
    expect(JSON.stringify(agreementBlocks(t, FACTS, {}))).toBe(plain);
    expect(JSON.stringify(agreementBlocks(t, FACTS, { keptInsulation: false }))).toBe(plain);
    expect(plain).toContain(AGREEMENT_REMOVAL_LINE);
    const kept = JSON.stringify(agreementBlocks(t, FACTS, { keptInsulation: true }));
    expect(kept).toContain(NOTICE.replace(/'/g, "'"));
    expect(kept).not.toContain(AGREEMENT_REMOVAL_LINE);
    expect(kept.replace(JSON.stringify(NOTICE).slice(1, -1), JSON.stringify(AGREEMENT_REMOVAL_LINE).slice(1, -1))).toBe(plain);
  });
  test("the senders pass the fact through (quote documents + signed acceptance)", () => {
    const src = (f: string) => readFileSync(f, "utf8");
    expect(src("src/lib/quote-ready-notify.server.ts")).toContain("customerAgreementPdf(tpl, facts, { keptInsulation: input.keptInsulation === true })");
    expect(src("src/lib/quote-ready-notify.server.ts")).toContain("oldInsulationKept(m)");
    expect(src("src/lib/signed-pdf.server.ts")).toContain("{ keptInsulation: i.agreement.keptInsulation === true }");
    expect(src("src/lib/assignment.server.ts")).toContain("oldInsulationKept(m)");
    expect(src("src/lib/assignment.server.ts")).toContain("keptInsulation,\n      },");
  });
});

const url = "https://estimate.homeinsulationvictoria.com.au/my-job/TOKEN?screen=quote";
const base: OwnerQuoteEmailInput = {
  firstName: "Helen", address: "824 High Street Road, Glen Waverley VIC 3150", totalIncGst: 2200, rebateIncGst: 1850, subtotalIncGst: 4050,
  lines: [{ code: "INSTALLER_PRICE", description: "Bradford Gold R5.0 ceiling batts, supplied and installed", lineTotalIncGst: 3352 }, { code: "PIESA", description: "Electrical safety check (PIESA)", lineTotalIncGst: 349 }, { code: "AP_FEE", description: "Accredited Person fee", lineTotalIncGst: 349 }],
  quoteUrl: url, validUntil: new Date("2026-12-10T12:59:59.999Z"), validDays: 30, officePhone: null, unsubscribeUrl: "https://estimate.homeinsulationvictoria.com.au/unsubscribe/abc",
  safetyCheckPrice: 349, areaM2: 137.6, product: "Bradford Gold R5.0", installerName: "Rapid Insulation", installerCertified: true,
};
describe("quote email", () => {
  test("kept = a NEW variant with the notice under the quote lines (v3 and v4, Home Insulation Victoria lead)", () => {
    for (const v4 of [false, true]) {
      const m = renderOwnerQuoteEmail({ ...base, v4, keptInsulation: true });
      expect(m.html).toContain("Your old insulation stays. Rapid Insulation checked it");
      expect(m.html.indexOf("Your old insulation stays")).toBeGreaterThan(m.html.indexOf("Not included: electrical upgrades"));
      expect(m.html.indexOf("Your old insulation stays")).toBeLessThan(m.html.indexOf("<strong>Next:</strong>"));
      expect(m.text).toContain(`${NOTICE}\n\nNext: accept and pay`);
      expect(m.text.split("Your old insulation stays").length).toBe(2);
    }
  });
  test("own customer: the notice names the originating installer", () => {
    const m = renderOwnerQuoteEmail({ ...base, v4: true, keptInsulation: true, installerName: null, ownCustomer: { installerName: "Deep Insulation", installerLogoUrl: null } }, { cobrandApproved: true });
    expect(m.text).toContain("Your old insulation stays. Deep Insulation checked it");
  });
  test("no installer name on file → \"Your installer\"", () => {
    expect(renderOwnerQuoteEmail({ ...base, v4: true, keptInsulation: true, installerName: null }).text).toContain("Your old insulation stays. Your installer checked it");
  });
  test("absent / false = byte-identical to today's email (the removal and no-old-insulation variants keep their pins)", () => {
    for (const extra of [{}, { removalM2: 40 }]) {
      const plain = renderOwnerQuoteEmail({ ...base, v4: true, ...extra });
      expect(renderOwnerQuoteEmail({ ...base, v4: true, ...extra, keptInsulation: false })).toEqual(plain);
      expect(plain.html).not.toContain("old insulation stays");
      expect(plain.text).not.toContain("old insulation stays");
    }
  });
});

describe("owner pages", () => {
  test("the quote page and My job show the view's keptInsulation line; the view reads it from the Ready Check record", () => {
    const page = readFileSync("src/routes/my-job.$token.tsx", "utf8");
    expect(page.match(/data-testid="kept-insulation"/g)?.length).toBe(2);
    expect(page).toContain("{v.keptInsulation && <p data-testid=\"kept-insulation\"");
    const server = readFileSync("src/lib/owner-myjob.server.ts", "utf8");
    expect(server).toContain('admin.from("ceiling_measurements").select("insulation_present, removal_required, zones")');
    expect(server).toContain("keptInsulation = { line: (await import(\"./kept-insulation.core\")).keptInsulationNotice(name) }");
  });
});
