// Decision 261: the portal's safety plan (SWMS) — built from job facts, signed per person on the job page, a pre-start
// blocker until signed; decision 266: the two existing installer texts carry the job-page link while it is unsigned.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  SWMS_HAZARDS, SWMS_HOW_IMPLEMENTED, SWMS_HOW_IN_PLACE, SWMS_HRCW, SWMS_PREPARED_FOR, SWMS_RECORD_TASK, SWMS_STANDARD_CONTROLS_TEXT, SWMS_WORK_DEFAULT,
  buildSwms, checkSwmsSign, swmsBlocker, swmsHighRiskWork, swmsRecordText, swmsSignerKey, swmsStatus, type SwmsFacts,
} from "../src/lib/swms.core";
import { prestartFailures, type PrestartFacts } from "../src/lib/prestart.core";
import { safetyPlanLine, withSafetyPlanLinks } from "../src/lib/sms.core";

const facts: SwmsFacts = {
  jobNumber: "HV-3100", address: "1 Test St, Box Hill, 3128", businessName: "Reinsulate Pty Ltd", installDate: "2026-11-03",
  lead: { name: "Bhavdeep Singh", workerId: "w1" }, crew: [{ name: "Dominic Doherty", workerId: "w2" }], yearBuilt: 1995, hazardNote: null, siteNote: null,
};
const sig = (key: string, name: string, at = "2026-11-02T08:00:00Z") => ({ key, name, typedName: name, signedAt: at });

describe("the plan from job facts", () => {
  test("nine ESC hazards with their control sentences; the standard-controls paragraph matches the decision 259 wording", () => {
    expect(SWMS_HAZARDS).toHaveLength(9);
    expect(SWMS_STANDARD_CONTROLS_TEXT.startsWith("Standard controls for the hazards of every ceiling insulation job. Live electrical: power isolated")).toBe(true);
    expect(SWMS_STANDARD_CONTROLS_TEXT).toContain("it is a licensed asbestos removalist's job before work continues");
    expect(SWMS_STANDARD_CONTROLS_TEXT.endsWith(SWMS_HOW_IN_PLACE)).toBe(true);
  });
  test("high-risk work: falls and electrical always; asbestos before 1990 or when a hazard note says so; confined space never assumed", () => {
    expect(swmsHighRiskWork({ yearBuilt: 1995, hazardNote: null, siteNote: null })).toEqual([SWMS_HRCW.falls, SWMS_HRCW.electrical]);
    expect(swmsHighRiskWork({ yearBuilt: 1975, hazardNote: null, siteNote: null })).toContain(SWMS_HRCW.asbestos);
    expect(swmsHighRiskWork({ yearBuilt: null, hazardNote: "Possible asbestos sheeting near manhole", siteNote: null })).toContain(SWMS_HRCW.asbestos);
    expect(swmsHighRiskWork({ yearBuilt: null, hazardNote: null, siteNote: null })).not.toContain(SWMS_HRCW.confined);
  });
  test("signers = lead + each crew member once (by worker id, else by name)", () => {
    const p = buildSwms({ ...facts, crew: [...facts.crew, { name: "Dominic Doherty", workerId: "w2" }, { name: "Casual Helper", workerId: null }] });
    expect(p.signers).toEqual([{ key: "w:w1", name: "Bhavdeep Singh", role: "lead" }, { key: "w:w2", name: "Dominic Doherty", role: "crew" }, { key: swmsSignerKey({ name: "Casual Helper", workerId: null }), name: "Casual Helper", role: "crew" }]);
  });
});

describe("signing and completeness", () => {
  const plan = buildSwms(facts);
  test("complete only when the lead and every crew member signed; missing names are listed", () => {
    expect(swmsStatus(plan, [])).toMatchObject({ complete: false, missing: ["Bhavdeep Singh", "Dominic Doherty"] });
    expect(swmsStatus(plan, [sig("w:w1", "Bhavdeep Singh")])).toMatchObject({ complete: false, missing: ["Dominic Doherty"] });
    expect(swmsStatus(plan, [sig("w:w1", "Bhavdeep Singh"), sig("w:w2", "Dominic Doherty")]).complete).toBe(true);
    expect(swmsStatus(buildSwms({ ...facts, lead: null, crew: [] }), []).missing).toEqual(["No lead installer is chosen for this install"]);
  });
  test("a person signs for themselves: on the crew, own full name typed, once", () => {
    expect(checkSwmsSign(plan, [], "w:w1", "bhavdeep  singh")).toMatchObject({ ok: true });
    expect(checkSwmsSign(plan, [], "w:w9", "Someone")).toEqual({ ok: false, reason: "That person is not on this job's crew." });
    expect(checkSwmsSign(plan, [], "w:w1", "Dominic Doherty")).toEqual({ ok: false, reason: "Type Bhavdeep Singh's full name exactly to sign." });
    expect(checkSwmsSign(plan, [sig("w:w1", "Bhavdeep Singh")], "w:w1", "Bhavdeep Singh")).toEqual({ ok: false, reason: "Bhavdeep Singh has already signed the safety plan." });
  });
  test("pre-start blocker until signed (prestart.core)", () => {
    const st = swmsStatus(plan, [sig("w:w1", "Bhavdeep Singh")]);
    expect(swmsBlocker(st)).toBe("Safety plan not signed: Dominic Doherty");
    expect(swmsBlocker(null)).toContain("has not been prepared");
    expect(swmsBlocker(swmsStatus(plan, [sig("w:w1", "Bhavdeep Singh"), sig("w:w2", "Dominic Doherty")]))).toBeNull();
    const base: PrestartFacts = { start: "2026-11-03T21:00:00Z", clearance: { cleared: true, blocker: null }, deadline: "2026-11-30", esc: null, lead: { found: false } as never, consentBlockers: [], piesaCompletedAt: null };
    expect(prestartFailures({ ...base, swmsBlocker: swmsBlocker(st) })).toContain("Safety plan not signed: Dominic Doherty");
    expect(prestartFailures({ ...base, swmsBlocker: null }).some((f) => f.startsWith("Safety plan"))).toBe(false);
  });
});

describe("the filed record (WorkSafe Victoria sample template layout)", () => {
  test("header from job facts, every hazard with its own sentence, review line, site note and the sign-off table", () => {
    const plan = buildSwms({ ...facts, siteNote: "Tight access near the hot water unit" });
    const txt = swmsRecordText(plan, [sig("w:w1", "Bhavdeep Singh", "2026-11-02T08:00:00Z")]);
    for (const line of ["Direct employer: Reinsulate Pty Ltd", `Principal contractor: ${SWMS_PREPARED_FOR}`, "Work supervisor: Bhavdeep Singh", "Site location/address: 1 Test St, Box Hill, 3128", `Work activity: ${SWMS_WORK_DEFAULT}`, "Install date: 2026-11-03",
      "Person responsible for ensuring compliance with SWMS: Bhavdeep Singh", "Tasks | Hazard | Control measures | How implemented | Responsible", "Specific to this house: Tight access near the hot water unit", "Name | Signature | Date",
      'Bhavdeep Singh (lead installer) | signed — typed "Bhavdeep Singh" | 2026-11-02T08:00:00Z', "Dominic Doherty (installer) | NOT SIGNED | —"]) expect(txt, line).toContain(line);
    for (const h of SWMS_HAZARDS) expect(txt).toContain(`${SWMS_RECORD_TASK} | ${h.name} | ${h.short}: ${h.control}. | ${SWMS_HOW_IMPLEMENTED} | Bhavdeep Singh (lead installer)`);
  });
  test("the install day prompt points the installer to the job page and asks for no SWMS item", () => {
    const prompt = readFileSync("docs/MITTI_INSTALL_FORM_FIX_PROMPT.md", "utf8");
    expect(prompt).toContain("`Is the safety plan for this job signed?`");
    expect(prompt).not.toMatch(/`SWMS — /);
  });
});

describe("decision 266: safety plan link on two existing installer texts", () => {
  test("added only when there is a link; no duplicate links", () => {
    expect(withSafetyPlanLinks("Install tomorrow 8am, 1 Test St (HV-3100). Job + forms: https://x/field/j1", ["https://x/field/j1"])).toBe(`Install tomorrow 8am, 1 Test St (HV-3100). Job + forms: https://x/field/j1 ${safetyPlanLine(["https://x/field/j1"])}`);
    expect(safetyPlanLine(["a", "b"])).toBe("Sign the safety plan first: a b");
    expect(withSafetyPlanLinks("Good morning!", [])).toBe("Good morning!");
    expect(withSafetyPlanLinks("Good morning!", ["l", "l", null])).toBe("Good morning! Sign the safety plan first: l");
  });
});
