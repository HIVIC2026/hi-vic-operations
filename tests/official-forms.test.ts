import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import {
  OFFICIAL_ITEMS, OFFICIAL_TEMPLATES, B1_OPTIONS, B2_OPTIONS, answerItems, answersFromEntries, buildSignedSnapshot,
  evaluatePiesa, evaluatePiisa, officialFormUseBlocker, renderOfficialDocument, snapshotProblems, type OfficialAnswers,
} from "../src/lib/official-forms.core";
import { FORMS } from "../src/lib/mitti-forms.core";

const nrm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const docText = (k: "piesa" | "piisa") => {
  const xml = strFromU8(unzipSync(readFileSync(OFFICIAL_TEMPLATES[k].originalFile))["word/document.xml"]!);
  return ` ${nrm(xml.replace(/<\/w:p>/g, " ").replace(/<w:tab\/>/g, " ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&[a-z#0-9]+;/g, " "))} `;
};

describe("template records", () => {
  for (const k of ["piesa", "piisa"] as const) {
    test(`${k}: stored original matches its SHA-256`, () => expect(createHash("sha256").update(readFileSync(OFFICIAL_TEMPLATES[k].originalFile)).digest("hex")).toBe(OFFICIAL_TEMPLATES[k].sha256));
    test(`${k}: source confirmed`, () => {
      const t = OFFICIAL_TEMPLATES[k];
      expect(t.sourceUrlStatus).toBe("confirmed"); expect(t.retrievalDateStatus).toBe("confirmed"); expect(t.retrievalDate).toBe("2026-10-02"); expect(t.publication).toBe("© DEECA March 2026"); expect(t.sourceUrl).toMatch(/^https:\/\/www\.energy\.vic\.gov\.au\//);
      // Fail-closed holds independently of approval: an unconfirmed source still blocks live use.
      expect(officialFormUseBlocker(k, { ...t, sourceUrl: null, sourceUrlStatus: "NEEDS CONFIRMATION" })).toMatch(/source web address/);
      expect(officialFormUseBlocker(k, { ...t, superseded: true })).toMatch(/superseded/);
    });
    // STEP 97: the PIISA mapping is approved by the project owner (official DEECA template). PIESA is unchanged.
    test(`${k}: ${k === "piisa" ? "approved mapping is usable live" : "not approved, blocked from use"}`, () => {
      const t = OFFICIAL_TEMPLATES[k];
      if (k === "piisa") {
        const a = t.approved as { by: string; at: string };
        expect(a.by.length).toBeGreaterThan(0); expect(Number.isNaN(Date.parse(a.at))).toBe(false);
        expect(officialFormUseBlocker(k)).toBeNull();
      } else {
        expect(t.approved).toBe(false);
        expect(officialFormUseBlocker(k)).toMatch(/approved/);
        expect(officialFormUseBlocker(k, { ...t, approved: { by: "jo", at: "x" } })).toBeNull();
      }
    });
  }
});

describe("verbatim wording and order against the original Word files", () => {
  for (const k of ["piesa", "piisa"] as const) test(`${k}: every item appears verbatim, in official order`, () => {
    const text = docText(k); let cur = 0; const bad: string[] = []; const seen = new Set<string>();
    for (const i of OFFICIAL_ITEMS[k]) {
      if (i.derivedFrom || (i.row && seen.has(i.id))) continue; seen.add(i.id);
      const p = text.indexOf(` ${nrm(i.label)} `, cur);
      if (p < 0) bad.push(i.label); else cur = p + 1;
    }
    expect(bad).toEqual([]);
  });
  test("an invented label is caught", () => expect(docText("piesa").includes(` ${nrm("Totally invented question")} `)).toBe(false));
  test("portal forms use the short onsite version first, then clearly separate supplemental evidence", () => {
    // The Mitti form is the short, plain-sentence onsite version; the portal expands answers into the
    // official Word form (see tests/official-short.test.ts for the full mapping coverage).
    for (const k of ["piesa", "piisa"] as const) {
      const fields = FORMS[k].fields; const firstSupp = fields.findIndex((f) => f.supplemental);
      expect(firstSupp).toBeGreaterThan(0);
      expect(fields.slice(firstSupp).every((f) => f.supplemental)).toBe(true);
      expect(fields.slice(0, firstSupp).every((f) => !f.supplemental)).toBe(true);
    }
    expect(FORMS.piisa.fields.some((f) => /owner name/i.test(f.label))).toBe(false);
  });
  test("types: ticks not signatures, dates not date-times, tables as rows, both treatments allowed", () => {
    const P = Object.fromEntries(OFFICIAL_ITEMS.piesa.map((i) => [i.id, i])), I = Object.fromEntries(OFFICIAL_ITEMS.piisa.map((i) => [i.id, i]));
    expect(P["b3.declaration"]!.kind).toBe("tick");
    expect(["inspectionDate", "c.completionDate", "c.certDate", "o.date"].map((k) => P[k]!.kind)).toEqual(["date", "date", "date", "date"]);
    expect(P["p7.appliance"]!.row).toEqual({ group: "p7.applianceTable", rows: 10 });
    expect(P["p7.otherAction"]!.row!.rows).toBe(14);
    expect(I["p2.addName"]!.row!.rows).toBe(3);
    expect(I["p6.treatment"]!.kind).toBe("ticks");
    expect(OFFICIAL_ITEMS.piisa.filter((i) => i.letter).map((i) => i.letter)).toEqual(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);
    expect(OFFICIAL_ITEMS.piesa.at(-1)!.id).toBe("o.date"); expect(OFFICIAL_ITEMS.piesa.at(-2)!.id).toBe("o.name");
  });
});

// ---------- printed rules ----------
const piesaPass = (): OfficialAnswers => {
  const a: OfficialAnswers = { jobRef: "HV-1", address: "1 Test St VIC 3000", inspectionDate: "2026-10-01", lifeSupport: "No",
    "p2.mains": "Yes", "p2.switch": "Yes", "p2.switchAccessible": "Yes", "p2.switchIsolates": "Yes", "p2.switchSecured": "Yes", "p2.tested": "Yes", "p2.rcdPresent": "Yes", "p2.rcdTested": "Yes",
    "p3.present": "No", "p4.conduit": "Yes", "p4.supported": "Yes", "p4.treatment": "Yes", "p4.tps": "N/A", "p4.terminations": "Yes", "p4.plugBases": "Yes", "p4.foil": "Yes",
    "p5.nonTps": "No", "p5.splitConduit": "No", "p5.damaged": "No", "p6.recessed": "No", "p7.appliances": "No", "p7.flues": "No", b1: B1_OPTIONS[0],
    "b3.licence": "L1", "b3.name": "E One", "b3.recName": "Spark", "b3.recNo": "R1", "b3.phone": "0400", "b3.declaration": true,
    "o.signature": "O Owner", "o.name": "O Owner", "o.date": "2026-10-01" };
  for (let i = 1; i <= 4; i++) a[`o.tick${i}`] = true;
  return a;
};
const rules = (e: { blockers: { rule: string }[] }) => e.blockers.map((b) => b.rule);

describe("PIESA printed rules", () => {
  test("a clean form passes", () => expect(evaluatePiesa(piesaPass()).blockers).toEqual([]));
  test("life support without consent and attachment cannot proceed", () => {
    expect(rules(evaluatePiesa({ ...piesaPass(), lifeSupport: "Yes" }))).toContain("P1-LIFE-SUPPORT");
    expect(rules(evaluatePiesa({ ...piesaPass(), lifeSupport: "Yes", lifeSupportConsent: "Yes – received Consent", lifeSupportAttachment: "file.pdf" }))).not.toContain("P1-LIFE-SUPPORT");
  });
  test("main switch overall must be NO when a sub-item is NO", () => {
    expect(rules(evaluatePiesa({ ...piesaPass(), "p2.switchSecured": "No" }))).toContain("P2-SWITCH-OVERALL");
    expect(rules(evaluatePiesa({ ...piesaPass(), "p2.switchSecured": "No", "p2.switch": "No" }))).not.toContain("P2-SWITCH-OVERALL");
  });
  test("Part 2 NO forbids 'not required'; 'not possible' or 'required' is allowed", () => {
    expect(rules(evaluatePiesa({ ...piesaPass(), "p2.rcdTested": "No" }))).toContain("P2P3-NO");
    expect(rules(evaluatePiesa({ ...piesaPass(), "p2.rcdTested": "No", b1: B1_OPTIONS[2] }))).not.toContain("P2P3-NO");
  });
  test("Part 4 NO / Part 5 YES / prohibited luminaire require rectification", () => {
    expect(rules(evaluatePiesa({ ...piesaPass(), "p4.conduit": "No" })).some((r) => r.startsWith("RECT-REQUIRED"))).toBe(true);
    expect(rules(evaluatePiesa({ ...piesaPass(), "p5.damaged": "Yes", b1: B1_OPTIONS[2] })).some((r) => r.startsWith("RECT-REQUIRED"))).toBe(true);
    expect(rules(evaluatePiesa({ ...piesaPass(), "p6.recessed": "Yes", "p6.count": 4, "p6.prohibited": "Yes" })).some((r) => r.startsWith("RECT-REQUIRED"))).toBe(true);
    expect(rules(evaluatePiesa({ ...piesaPass(), "p4.tps": "N/A" })).some((r) => r.startsWith("RECT-REQUIRED"))).toBe(false);
  });
  test("hazard rows: Yes needs a complete row; incomplete rows block", () => {
    expect(rules(evaluatePiesa({ ...piesaPass(), "p7.flues": "Yes" }))).toContain("P7-DESCRIBE");
    const ok = { ...piesaPass(), "p7.flues": "Yes", "p7.appliance#0": "Exhaust fan", "p7.location#0": "Bathroom", "p7.hazard#0": "Heat", "p7.actions": "Clearance", "p7.effective": "Yes" };
    expect(evaluatePiesa(ok).blockers).toEqual([]);
    expect(rules(evaluatePiesa({ ...ok, "p7.hazard#0": "" }))).toContain("P7-ROW-INCOMPLETE");
    expect(rules(evaluatePiesa({ ...ok, "p7.otherHazard#0": "Rotten joist" }))).toContain("P7-OTHER-INCOMPLETE");
    expect(evaluatePiesa({ ...ok, "p7.effective": "No" }).blockers.find((b) => b.rule === "P7-NOT-EFFECTIVE")?.confirmation).toBe("NEEDS OFFICIAL/LEGAL CONFIRMATION");
  });
  test("rectification needs B2 and all of Section C; Section C ticks are ticks", () => {
    const r = { ...piesaPass(), "p4.conduit": "No", b1: B1_OPTIONS[1] };
    const e = rules(evaluatePiesa(r));
    expect(e).toContain("B1-B2"); expect(e).toContain("REQ:c.tick1"); expect(e).toContain("REQ:c.coes");
    const full: OfficialAnswers = { ...r, b2: [B2_OPTIONS[2]], "c.licence": "L", "c.name": "N", "c.recName": "R", "c.recNo": "1", "c.phone": "0", "c.signature": "N", "c.completionDate": "2026-10-03", "c.coes": "C1", "c.certDate": "2026-10-03" };
    for (let i = 1; i <= 7; i++) full[`c.tick${i}`] = true;
    expect(evaluatePiesa(full).blockers).toEqual([]);
    expect(rules(evaluatePiesa({ ...full, b2: [B2_OPTIONS[5]] }))).toContain("REQ:b2.other");
  });
  test("B3 declaration tick, owner ticks and dates-only are mandatory", () => {
    expect(rules(evaluatePiesa({ ...piesaPass(), "b3.declaration": false }))).toContain("REQ:b3.declaration");
    expect(rules(evaluatePiesa({ ...piesaPass(), "o.tick3": false }))).toContain("REQ:o.tick3");
    expect(evaluatePiesa({ ...piesaPass(), inspectionDate: "2026-10-01T09:00" }).blockers[0]!.message).toMatch(/date only/);
  });
  test("'not possible' only under parts 2 and 3", () => {
    expect(rules(evaluatePiesa({ ...piesaPass(), b1: B1_OPTIONS[2] }))).toContain("B1-NOT-POSSIBLE-SCOPE");
  });
  test("copies must reach installer and owner 24h before install", () => {
    expect(rules(evaluatePiesa(piesaPass(), { installStart: "2026-10-05T08:00:00Z", deliveredToInstallerAt: "2026-10-04T09:00:00Z", deliveredToOwnerAt: "2026-10-01T00:00:00Z" }))).toEqual(["COPY-24H"]);
    expect(evaluatePiesa(piesaPass(), { installStart: "2026-10-05T08:00:00Z", deliveredToInstallerAt: "2026-10-04T08:00:00Z", deliveredToOwnerAt: "2026-10-04T08:00:00Z" }).blockers).toEqual([]);
  });
});

const piisaPass = (): OfficialAnswers => ({ jobRef: "HV-1", address: "1 Test St", startDate: "2026-10-10", completionDate: "2026-10-10", "p1.powerInformed": "Yes", lifeSupport: "No",
  "p2.installDate": "2026-10-10", "p2.ap": "DC", "p2.company": "Co", "p2.lead": "Lead", "p2.leadEec": "E1", "p3.swms": "Yes", "p3.table1": "Yes", "p3.isolated": "Yes", "p4.present": "No",
  "p5.reviewed": "Yes", "p5.electricianPresent": "N/A", "p5.recessed": "No", "p5.icConfirmed": "Yes", "p5.safeToCover": "Yes", "p5.rcd": "Yes", "p5.tps": "Yes", "p5.basic": "Yes", "p5.noAccess": "Yes",
  "p6.present": "Yes", "p6.height": 50, "p6.treatment": ["Removed"], "p6.suitable": "Yes", "p7.products": "Brand R5.0", "p8.declaration": true, "p8.signature": "Lead", "p8.name": "Lead", "p8.date": "2026-10-10" });
const ctx = { piesaCompletionDate: "2026-10-01", piesaReceivedAt: "2026-10-02T00:00:00Z", conductiveExistingInsulation: false, conductivityEvidence: "file-1" };

describe("PIISA printed rules", () => {
  test("a clean form passes", () => expect(evaluatePiisa(piisaPass(), ctx).blockers).toEqual([]));
  test("Part 3 NO cannot proceed; Part 5 NO cannot commence", () => {
    expect(rules(evaluatePiisa({ ...piisaPass(), "p3.isolated": "No" }, ctx))).toContain("P3-CANNOT-PROCEED");
    expect(rules(evaluatePiisa({ ...piisaPass(), "p5.noAccess": "No" }, ctx))).toContain("P5-CANNOT-COMMENCE");
    expect(rules(evaluatePiisa({ ...piisaPass(), "p5.recessed": "No" }, ctx))).not.toContain("P5-CANNOT-COMMENCE");
  });
  test("solar instructions NO requires an electrician at the start (Jo, 8 Oct 2026)", () => {
    const a = { ...piisaPass(), "p4.present": "Yes", "p4.instructions": "No", "p4.isolator": "Yes" };
    expect(rules(evaluatePiisa(a, ctx))).toContain("ELECTRICIAN-AT-START");
    expect(evaluatePiisa({ ...a, "p5.electricianPresent": "Yes" }, ctx).blockers).toEqual([]);
  });
  test("both Removed and Topped Up allowed; top-up of conductive insulation blocked; unknown needs confirmation", () => {
    const both = { ...piisaPass(), "p6.treatment": ["Removed", "Topped Up"], "p6.reason": "Rear section retained in good condition" };
    expect(evaluatePiisa(both, ctx).blockers).toEqual([]);
    expect(rules(evaluatePiisa(both, { ...ctx, conductiveExistingInsulation: true }))).toContain("P6-FOIL");
    expect(rules(evaluatePiisa(both, { ...ctx, conductiveExistingInsulation: null }))).toContain("P6-FOIL-UNKNOWN");
    expect(rules(evaluatePiisa({ ...piisaPass(), "p6.treatment": ["Topped Up"] }, ctx))).toContain("REQ:p6.reason");
  });
  test("additional installer rows need name and EEC number", () => {
    expect(rules(evaluatePiisa({ ...piisaPass(), "p2.addName#0": "Sam" }, ctx))).toContain("P2-ADDITIONAL-ROW");
    expect(evaluatePiisa({ ...piisaPass(), "p2.addName#0": "Sam", "p2.addEec#0": "E2" }, ctx).blockers).toEqual([]);
  });
  test("30-day window, PIESA copy received, declaration and life-support attachment", () => {
    expect(rules(evaluatePiisa({ ...piisaPass(), "p8.date": "2026-11-05" }, ctx))).toContain("PIISA-30D");
    expect(rules(evaluatePiisa(piisaPass(), { ...ctx, piesaCompletionDate: null }))).toContain("PIISA-30D");
    expect(rules(evaluatePiisa(piisaPass(), { ...ctx, piesaReceivedAt: null }))).toContain("P8-A");
    expect(rules(evaluatePiisa({ ...piisaPass(), "p8.declaration": false }, ctx))).toContain("REQ:p8.declaration");
    expect(rules(evaluatePiisa({ ...piisaPass(), lifeSupport: "Yes", lifeSupportConsent: "Yes – received Medical Plan" }, ctx))).toContain("P1-LIFE-SUPPORT");
  });
});

describe("Mitti answers and signed snapshots", () => {
  test("duplicate official labels map in form order", () => {
    const a = answersFromEntries("piesa", [{ label: "Licence no:", value: "B3-L" }, { label: "Licence no:", value: "C-L" }, { label: "Appliance", value: "Fan" }, { label: "Appliance", value: "Heater" }]);
    expect(a["b3.licence"]).toBe("B3-L"); expect(a["c.licence"]).toBe("C-L"); expect(a["p7.appliance#1"]).toBe("Heater");
  });
  const snap = () => buildSignedSnapshot({ key: "piesa", answers: piesaPass(), signer: { userId: "u1", name: "O Owner", role: "owner" }, enteredDate: "2026-10-01", serverTimestamp: "2026-10-01T03:00:00Z", jobFacts: { jobNumber: "HV-1" }, acknowledgementIds: ["o.tick1", "o.tick2", "o.tick3", "o.tick4"], signature: "O Owner" });
  test("snapshot keeps template, mapping, signer, dates, facts and verifies", () => {
    const s = snap();
    expect(s.mappingVersion).toBe(OFFICIAL_TEMPLATES.piesa.mappingVersion); expect(s.templateSha256).toBe(OFFICIAL_TEMPLATES.piesa.sha256);
    expect(snapshotProblems(s, piesaPass())).toEqual([]);
    expect(s.document.map((d) => d.label)).toEqual(renderOfficialDocument("piesa", piesaPass()).map((d) => d.label));
  });
  test("tampering, answer changes and mapping changes invalidate a signed snapshot", () => {
    expect(snapshotProblems({ ...snap(), signature: "X" })).toHaveLength(1);
    expect(snapshotProblems(snap(), { ...piesaPass(), "p2.mains": "No" })[0]).toMatch(/changed after signing/);
    expect(snapshotProblems({ ...snap(), mappingVersion: "old" }).some((p) => /different template/.test(p))).toBe(true);
  });
  test("entered date must be date-only and acknowledgements ticked", () => {
    expect(() => buildSignedSnapshot({ ...{ key: "piesa" as const, answers: piesaPass(), signer: { userId: "u", name: "n", role: "owner" as const }, serverTimestamp: "x", jobFacts: {}, signature: "s" }, enteredDate: "2026-10-01T10:00", acknowledgementIds: [] })).toThrow();
    expect(() => buildSignedSnapshot({ key: "piesa", answers: { ...piesaPass(), "o.tick2": false }, signer: { userId: "u", name: "n", role: "owner" }, enteredDate: "2026-10-01", serverTimestamp: "x", jobFacts: {}, signature: "s", acknowledgementIds: ["o.tick2"] })).toThrow();
  });
  test("every required official item is covered by the answer list", () => expect(answerItems("piesa").length).toBeGreaterThan(70));
});

// ---------- installation-day PIISA gate ----------
import { piisaGate, type StoredCopy } from "../src/lib/piisa-workflow.core";
import { HAZARD_UNRESOLVED, CONDUCTIVITY_UNCONFIRMED } from "../src/lib/official-forms.core";
describe("PIISA installation-day gate", () => {
  const facts = { installDate: "2026-10-10", lifeSupport: "false", leadInstallerId: "i1", piesaCopyId: "pe1", piesaCompletionDate: "2026-10-01", existingInsulation: "false" };
  const copy = (key: "piesa" | "piisa", answers: OfficialAnswers, date: string, jobFacts = facts): StoredCopy => ({ id: key === "piesa" ? "pe1" : "pi1", status: "current", signatureDate: date,
    snapshot: buildSignedSnapshot({ key, answers, signer: { userId: "u", name: "N", role: key === "piesa" ? "electrician" : "installer" }, enteredDate: date, serverTimestamp: "2026-10-10T00:00:00Z", jobFacts, acknowledgementIds: [], signature: "N" }) });
  const base = (over: Partial<Parameters<typeof piisaGate>[0]> = {}) => piisaGate({ today: "2026-10-10", installDate: "2026-10-10", piisa: copy("piisa", { ...piisaPass(), "p8.date": "2026-10-10" }, "2026-10-10"), piesa: copy("piesa", piesaPass(), "2026-10-01"),
    facts, piesaReceivedAt: "2026-10-02T00:00:00Z", conductiveExistingInsulation: false, conductivityEvidence: "f1", hazardResolution: null, formUse: { piesa: null, piisa: null }, ...over });
  test("happy path passes", () => { const r = base(); expect(r.blockers).toEqual([]); expect(r.due).toBe("passed"); });
  // STEP 97: the PIISA mapping is approved by the project owner, so live use is no longer blocked by approval.
  // Fail-closed is preserved — an unapproved or superseded mapping still blocks immediately.
  test("approved PIISA is usable by default; fail-closed still holds", () => {
    expect(base({ formUse: undefined }).blockers).toEqual([]);
    expect(base({ formUse: { piesa: null, piisa: officialFormUseBlocker("piisa", { ...OFFICIAL_TEMPLATES.piisa, approved: false }) } }).blockers.some((b) => b.includes("can't be used yet"))).toBe(true);
    expect(base({ formUse: { piesa: null, piisa: officialFormUseBlocker("piisa", { ...OFFICIAL_TEMPLATES.piisa, superseded: true }) } }).blockers.some((b) => b.includes("superseded"))).toBe(true);
  });
  test("missing PIISA: installer responsible, due states", () => {
    expect(base({ piisa: null }).responsible).toBe("installer");
    expect(base({ piisa: null, today: "2026-10-09" }).due).toBe("due_on_installation_day");
    expect(base({ piisa: null }).due).toBe("due_today");
    expect(base({ piisa: null, today: "2026-10-11" }).due).toBe("overdue");
  });
  test("signed on another day is blocked", () => expect(base({ piisa: copy("piisa", { ...piisaPass(), "p8.date": "2026-10-09" }, "2026-10-09") }).blockers.some((b) => b.includes("installation day"))).toBe(true));
  test("changed material fact makes signed PIISA stale", () => { const r = base({ facts: { ...facts, installDate: "2026-10-12" } }); expect(r.due).toBe("stale"); });
  test("invalidated copy counts as missing", () => expect(base({ piisa: { ...copy("piisa", piisaPass(), "2026-10-10"), status: "invalidated" } }).blockers.length).toBeGreaterThan(0));
  test("cannot-proceed answer blocks", () => expect(base({ piisa: copy("piisa", { ...piisaPass(), "p8.date": "2026-10-10", "p3.swms": "No" }, "2026-10-10") }).blockers.some((b) => b.includes("CANNOT proceed"))).toBe(true));
  test("life support without attachment blocks", () => expect(base({ piisa: copy("piisa", { ...piisaPass(), "p8.date": "2026-10-10", lifeSupport: "Yes", lifeSupportConsent: undefined }, "2026-10-10") }).blockers.length).toBeGreaterThan(0));
  test("electrician needed: explicit blocker, electrician responsible", () => {
    const r = base({ piisa: copy("piisa", { ...piisaPass(), "p8.date": "2026-10-10", "p4.present": "Yes", "p4.instructions": "No", "p4.isolator": "Yes", "p5.electricianPresent": "N/A" }, "2026-10-10") });
    expect(r.responsible).toBe("electrician"); expect(r.nextAction).toContain("electrician");
  });
  test("rule A: ineffective hazard action blocks with the exact message; attempted action not success; review not yet accepted", () => {
    const pe = { ...piesaPass(), "p7.flues": "Yes", "p7.appliance#0": "Fan", "p7.location#0": "Bath", "p7.hazard#0": "Heat", "p7.actions": "Tried", "p7.effective": "No" };
    expect(evaluatePiesa(pe).blockers.find((b) => b.rule === "P7-NOT-EFFECTIVE")?.message).toBe(HAZARD_UNRESOLVED);
    expect(base({ piesa: copy("piesa", pe, "2026-10-01") }).blockers).toContain(HAZARD_UNRESOLVED);
    expect(evaluatePiesa(pe, { hazardResolution: { kind: "authorised_review", reviewId: "r" } }).blockers.some((b) => b.rule === "P7-NOT-EFFECTIVE")).toBe(true);
    expect(evaluatePiesa(pe, { hazardResolution: { kind: "verified_rectification", resolvedHazards: ["appliance#0"] } }).blockers.some((b) => b.rule === "P7-NOT-EFFECTIVE")).toBe(false);
    expect(evaluatePiesa(pe, { hazardResolution: { kind: "verified_rectification", resolvedHazards: ["appliance#1"] } }).blockers.some((b) => b.rule === "P7-NOT-EFFECTIVE")).toBe(true);
  });
  test("rule B: conductivity blank is never No; needs answer and evidence", () => {
    const a = { ...piisaPass(), "p8.date": "2026-10-10", "p6.present": "Yes", "p6.height": 50, "p6.treatment": ["Removed"], "p6.suitable": "Yes" };
    const p = copy("piisa", a, "2026-10-10");
    expect(base({ piisa: p, conductiveExistingInsulation: null }).blockers.some((b) => b.includes(CONDUCTIVITY_UNCONFIRMED))).toBe(true);
    const noPhoto = base({ piisa: p, conductivityEvidence: null }).blockers;
       expect(noPhoto.some((b) => b.includes(CONDUCTIVITY_UNCONFIRMED))).toBe(false); // the Yes/No answer is recorded
       expect(noPhoto.some((b) => b.includes("Home Insulation Victoria supporting evidence"))).toBe(true); // separate Home Insulation Victoria photo requirement
    expect(base({ piisa: p }).blockers.some((b) => b.includes(CONDUCTIVITY_UNCONFIRMED))).toBe(false);
  });
  test("storage missing fails closed", () => expect(base({ storageUnavailable: true }).due).toBe("blocked"));
  test("document hash stored and checked", () => { const c = copy("piisa", piisaPass(), "2026-10-10"); expect(c.snapshot.documentSha256).toMatch(/^[0-9a-f]{64}$/); expect(snapshotProblems({ ...c.snapshot, documentSha256: "0".repeat(64) }).length).toBeGreaterThan(0); });
});
