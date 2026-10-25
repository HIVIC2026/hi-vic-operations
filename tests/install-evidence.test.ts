// Decisions 205/210/211/213/262–264: install-day evidence, sign-off and Mitti-complete recording (pure rules). The
// "A5 – Install day" form (two multi-file after-install items, Ready Check before videos and areas) and completed forms on
// the old "A3 - PIISA + AP Evidence" template (per-zone items, old wording) are both read.
import { describe, expect, test } from "bun:test";
import { FINAL_TICK_MISSING } from "../src/lib/install-day-confirm.core";
import {
  AFTER_INSTALL_QUESTIONS as A, AFTER_INSTALL_QUESTIONS_LONG as AL, FOIL_QUESTIONS as F, INSTALL_DAY_EVIDENCE as E, INSTALL_EVIDENCE_EFFECTIVE_DATE, INSTALL_EVIDENCE_QUESTIONS as Q, INSTALL_EVIDENCE_QUESTIONS_LONG as QL,
  VIDEO_MAX_BYTES, ZONE_PRODUCT_OPTIONS, afterInstallBlockers, declaredProductProblems, evaluateInstallEvidence, foilBlockers, installCompletionDecision, installEvidenceApplies, installEvidenceGateLines,
  installEvidenceMissingQuestions, installEvidencePrefillItems, installEvidenceQuestionList, installerNextLine, jobProductOptions, readInstallEvidence, zoneNameValue, zoneVideoFiles, type JobZone,
} from "../src/lib/install-evidence.core";
import { INSTALL_DAY_Q as ID } from "../src/lib/install-day.core";
import { a3EvidenceChecklist } from "../src/lib/piisa-a3.core";
import { evidenceStageBlockers } from "../src/lib/ap-review-evidence.core";
import { validateSavedDefinition } from "../src/lib/mitti-form-schema.core";
import { mittiMediaFile } from "../src/lib/piesa-evidence.core";
import { expandShortAnswers } from "../src/lib/official-expand.core";
import { SHORT_PIESA_FIELDS } from "../src/lib/official-short.core";
import { a3Template } from "./helpers/a3-template";

const T0 = "2026-11-03T20:00:00Z";
const geo = (n: number, extra: Record<string, unknown> = {}, t = "2026-11-03T19:50:00Z", prefix = "m") => Array.from({ length: n }, (_, i) => ({ media_id: `${prefix}${i}`, captured_at: t, location: { geometry: { coordinates: [145.0, -37.8] } }, ...extra }));
let k = 0;
const item = (label: string, extra: Record<string, unknown> = {}) => ({ item_id: `id-${k++}`, label, type: "media", ...extra });
const pick = (label: string, v: string) => item(label, { type: "question", responses: { selected: [{ label: v }] } });
const text = (label: string, v: string) => item(label, { type: "text", responses: { text: v } });
const tick = (label: string) => item(label, { type: "checkbox", responses: { value: true } });
const sign = (label: string, name: string, at: string) => item(label, { type: "signature", responses: { image: { media_id: "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b", name, timestamp: at } } });
const dt = (label: string, v: string) => item(label, { type: "datetime", responses: { datetime: v } });

// ---------- the install day form ----------
/** The install day form's after-install items + both "Lead installer's signature" items (declaration first). */
function installDay(o: { after?: number; depth?: number; multiDay?: boolean; recheck?: boolean; lockout?: string; solar?: string; signer?: string; bytes?: number; noFinalTick?: boolean } = {}) {
  return { items: [
    tick(ID.declaration), sign(ID.signature, "Bhavdeep Singh", "2026-11-03T19:45:00Z"),
    item(E.afterVideos, { media: geo(o.after ?? 2, { file_size: o.bytes ?? 90_000_000 }, "2026-11-04T03:00:00Z", "av") }),
    item(E.depthPhotos, { media: geo(o.depth ?? 2, {}, "2026-11-04T03:10:00Z", "dp") }),
    pick(Q.multiDay, o.multiDay ? "Yes" : "No"), ...(o.recheck ? [tick(Q.dailyRecheck)] : []),
    pick(A.lockoutRemoved, o.lockout ?? "Yes"), text(A.lockoutRemovedBy, "Bhavdeep Singh, installer"), item(A.switchboardAfterPhoto, { media: geo(1, {}, "2026-11-04T04:00:00Z") }),
    pick(A.solarRestarted, o.solar ?? "There isn't one"), tick(A.leadPresent), ...(o.noFinalTick ? [] : [tick(ID.allFilledIn)]), sign(A.completionSignature, o.signer ?? "Bhavdeep Singh", "2026-11-04T04:06:00Z"),
  ] };
}
const rcZones: JobZone[] = [
  { name: "Main house", underInsulated: true, areaM2: 120, product: "Bradford Gold R5", beforeVideo: true },
  { name: "Garage", underInsulated: false, areaM2: 30, product: "Bradford Gold R5", beforeVideo: true },
];
const ctxDay = { installDate: "2026-11-03", zones: rcZones, multiDay: false, leadName: "Bhavdeep Singh", solarPresent: false, existingInsulation: true };
const evalDay = (o: Parameters<typeof installDay>[0] = {}, c: Partial<typeof ctxDay> = {}) => evaluateInstallEvidence(readInstallEvidence(installDay(o)), { ...ctxDay, ...c }, T0);

describe("effective date (grandfathering)", () => {
  test("installs before the effective date keep the old rule; on/after apply; unknown date applies once the date has arrived", () => {
    expect(INSTALL_EVIDENCE_EFFECTIVE_DATE).toBe("2026-11-01");
    expect(installEvidenceApplies("2026-10-31")).toBe(false);
    expect(installEvidenceApplies("2026-11-01")).toBe(true);
    expect(installEvidenceApplies(null, "2026-10-25")).toBe(false);
    expect(installEvidenceApplies(null, "2026-11-01")).toBe(true);
    const s = evaluateInstallEvidence(readInstallEvidence({ items: [] }), { ...ctxDay, installDate: "2026-10-20" });
    expect(s.applies).toBe(false); expect(s.blockers).toEqual([]); expect(s.prestartBlockers).toEqual([]);
    expect(installEvidenceGateLines(null, "2026-10-20")).toEqual([]);
    expect(installEvidenceGateLines(null, "2026-11-05").join()).toContain("not been read");
  });
});

describe("install day form (decisions 262–264)", () => {
  test("question list = the install day form's items; form health reads the template by its own wording", () => {
    expect(installEvidenceQuestionList().map((q) => q.label)).toEqual([E.afterVideos, E.depthPhotos, Q.multiDay, Q.dailyRecheck, A.lockoutRemoved, A.lockoutRemovedBy, A.switchboardAfterPhoto, A.solarRestarted, A.leadPresent, A.completionSignature]);
    expect(installEvidenceMissingQuestions(installDay({ recheck: true }))).toEqual([]);
    expect(installEvidenceMissingQuestions({ items: [] })).toHaveLength(10);
  });
  test("clean job: Ready Check before videos for every area, an after video and depth photo per area, sign-off done; areas come from the Ready Check", () => {
    const s = evalDay();
    expect(s.blockers).toEqual([]);
    expect(s.prestartBlockers).toEqual([]);
    expect(s.zoneProducts).toEqual([{ zone: 1, name: "Main house", product: "Bradford Gold R5", areaM2: 120 }, { zone: 2, name: "Garage", product: "Bradford Gold R5", areaM2: 30 }]);
    expect(s.items.find((i) => i.id === "before_videos")).toMatchObject({ state: "met", count: 2 });
  });
  test("solo area job needs one file of each; fewer files than Ready Check areas is short", () => {
    expect(evalDay({ after: 1, depth: 1 }, { zones: [rcZones[0]!] }).blockers).toEqual([]);
    const short = evalDay({ after: 1, depth: 0 });
    expect(short.blockers).toContain("After videos (one per area — 2 ceiling areas): 1 of 2 uploaded");
    expect(short.blockers).toContain("Depth photos with a ruler (one per area — 2 ceiling areas): 0 of 2 uploaded");
    expect(short.prestartBlockers.some((b) => b.startsWith("After videos"))).toBe(false);
  });
  test("a Ready Check area without its before video is a before-work blocker", () => {
    const s = evalDay({}, { zones: [rcZones[0]!, { ...rcZones[1]!, beforeVideo: false }] });
    expect(s.prestartBlockers).toEqual(["Ready Check before video missing for Garage — the before video of every area is taken at the Ready Check"]);
  });
  test("a Ready Check area without product or m² is listed (the final diagram and tax invoice need them)", () => {
    const s = evalDay({}, { zones: [{ ...rcZones[0]!, product: null, areaM2: null }, rcZones[1]!] });
    expect(s.blockers).toContain("Ready Check area 1 (Main house): insulation product not recorded");
    expect(s.blockers).toContain("Ready Check area 1 (Main house): m² not recorded");
  });
  test("oversized videos are review lines; no foil or existing-photo item is asked on this form", () => {
    const s = evalDay({ bytes: VIDEO_MAX_BYTES + 1 });
    expect(s.blockers.filter((b) => b.includes("over the 250 MB limit"))).toHaveLength(1); // same line for both files, listed once
    expect(s.blockers.some((b) => /foil|existing insulation ruler/i.test(b))).toBe(false);
  });
  test("multi-day installs need only the daily re-check tick", () => {
    expect(evalDay({ multiDay: true }).blockers).toEqual(["Daily pre-start re-check not ticked for this multi-day installation"]);
    expect(evalDay({ multiDay: true, recheck: true }).blockers).toEqual([]);
    expect(evalDay({}, { multiDay: true }).blockers.join()).toContain("ran over more than one day");
  });
  test("the completion signature is the SECOND 'Lead installer's signature' and its own time is the finish time", () => {
    const r = readInstallEvidence(installDay());
    expect(r.after.completionSignature).toMatchObject({ present: true, signedAt: "2026-11-04T04:06:00Z" });
    expect(r.after.finishedAt).toBe("2026-11-04T04:06:00Z");
    const beforeOnly = readInstallEvidence({ items: [sign(ID.signature, "Bhavdeep Singh", "2026-11-03T19:45:00Z")] });
    expect(beforeOnly.after.completionSignature.present).toBe(false);
    expect(evalDay({ signer: "Someone Else" }).blockers.some((b) => b.includes("not the lead installer (Bhavdeep Singh)"))).toBe(true);
  });
  test("the after videos stand in for the whole-job completed video; the before videos are the Ready Check's", () => {
    expect(zoneVideoFiles(installDay()).after!.map((f) => f.mediaId)).toEqual(["av0", "av1"]);
    expect(zoneVideoFiles(installDay()).before).toBeNull();
  });
});

describe("after-install sign-off", () => {
  test("complete sign-off passes; each gap is one plain line; 'There isn't one' with solar present is a review", () => {
    const ok = readInstallEvidence(installDay()).after;
    expect(afterInstallBlockers(ok, { leadName: "Bhavdeep Singh", solarPresent: false })).toEqual([]);
    expect(afterInstallBlockers(ok, { leadName: "Bhavdeep Singh", solarPresent: true })).toEqual(["Solar/battery restart answered \"None here\" but the safety form says the home has solar, a battery or another supply — office review"]);
    const no = readInstallEvidence(installDay({ solar: "No" })).after;
    expect(afterInstallBlockers(no, { leadName: "Bhavdeep Singh", solarPresent: true })).toContain("Solar, battery or generator not restarted — restart it per the instructions (or have the electrician do it) before leaving site");
    // Decision 328: the install day form's final tick is required; unticked = not complete. Old A3 forms have none.
    const unticked = readInstallEvidence(installDay({ noFinalTick: true })).after;
    expect(unticked.allFilledIn).toBe(false);
    expect(afterInstallBlockers(unticked, { leadName: "Bhavdeep Singh", solarPresent: false })).toEqual([FINAL_TICK_MISSING]);
    expect(evalDay({ noFinalTick: true }).blockers).toEqual([FINAL_TICK_MISSING]);
    const none = readInstallEvidence({ items: [pick(A.lockoutRemoved, "Yes")] }).after;
    expect(afterInstallBlockers(none, {})).toEqual([`${A.lockoutRemovedBy}: not entered`, "Switchboard photo after re-energising: 0 of 1 uploaded", `${A.solarRestarted}: not answered`, "Lead installer has not confirmed being on site for the whole installation", `${A.completionSignature}: missing`]);
  });
});

// ---------- completed forms on the OLD A3 template ----------
/** An old-A3 audit: per-zone items and sign-off in the decision-205 wording. */
function oldAudit(zones = 1, o: { foil?: boolean | null } = {}) {
  const items: Record<string, unknown>[] = [pick(QL.zoneCount, String(zones))];
  for (let z = 1; z <= zones; z++) items.push(
    text(Q.zoneName(z), zoneNameValue(z, z === 1 ? "Main ceiling" : `Zone ${z} area`)), pick(Q.zoneUnderInsulated(z), "No"),
    item(Q.zoneBeforeVideo(z), { media: geo(1, { file_size: 90_000_000 }) }), item(Q.zoneAfterVideo(z), { media: geo(1, { file_size: 90_000_000 }) }), item(Q.zoneDepthPhoto(z), { media: geo(2) }),
    pick(Q.zoneProduct(z), "Bradford Gold R5"), item(Q.zoneAreaM2(z), { type: "number", responses: { value: z === 1 ? 120 : 30 } }),
  );
  items.push(pick(QL.multiDay, "No"));
  if (o.foil != null) items.push(pick(F.foil, o.foil ? "Yes" : "No"));
  if (o.foil) items.push(item(F.foilPhoto, { media: geo(1) }));
  items.push(pick(AL.lockoutRemoved, "Yes"), text(AL.lockoutRemovedBy, "Bhavdeep Singh, lead installer"), item(AL.switchboardAfterPhoto, { media: geo(1, {}, "2026-11-04T04:00:00Z") }), pick(AL.solarRestarted, "N/A – none at this property"), dt("Installation finished at (date and time)", "2026-11-04T04:05:00Z"), tick(AL.leadPresent), sign(AL.completionSignature, "Bhavdeep Singh", "2026-11-04T04:06:00Z"));
  return { items };
}
const ctxOld = { installDate: "2026-11-03", zones: [{ name: "Main ceiling", underInsulated: false }], multiDay: false, leadName: "Bhavdeep Singh", solarPresent: false, existingInsulation: false };

describe("old A3 forms still read (decision-205 wording as aliases)", () => {
  test("a clean old form passes; zone products come from the form; the old finish time is kept", () => {
    const r = readInstallEvidence(oldAudit());
    expect(r.installDay).toBe(false);
    expect(r.after.finishedAt).toBe("2026-11-04T04:05:00Z");
    const s = evaluateInstallEvidence(r, ctxOld, T0);
    expect(s.blockers).toEqual([]);
    expect(s.zoneProducts).toEqual([{ zone: 1, name: "Area 1 – Main ceiling", product: "Bradford Gold R5", areaM2: 120 }]);
  });
  test("per-zone items are still checked; foil is still asked on an old form with existing insulation", () => {
    const audit = oldAudit();
    (audit.items.find((i) => (i as { label: string }).label === Q.zoneDepthPhoto(1)) as { media: unknown[] }).media = [];
    expect(evaluateInstallEvidence(readInstallEvidence(audit), ctxOld, T0).blockers).toContain("Zone 1 (Main ceiling) after-install depth photo with vertical ruler: 0 of 1 uploaded");
    expect(foilBlockers(readInstallEvidence({ items: [pick(F.foil, "Yes")] }).foil, true)).toEqual(["Existing insulation facing photo (foil / conductive): 0 of 1 uploaded"]);
    const s = evaluateInstallEvidence(readInstallEvidence(oldAudit(1, { foil: true })), { ...ctxOld, existingInsulation: true }, T0);
    expect(s.foil).toBe(true); expect(s.foilPhotoMediaId).toBe("m0");
  });
  test("old-template prefill sends zone names only for questions on the template", () => {
    const tpl = { items: [item(Q.zoneName(1)), item(Q.zoneName(2))] };
    expect(installEvidencePrefillItems(tpl, { zoneNames: ["Main house", "Garage"] }).map((i) => i.responses.text)).toEqual(["Area 1 – Main house", "Area 2 – Garage"]);
    expect(installEvidencePrefillItems(a3Template(), { zoneNames: ["X"] })).toEqual([]);
  });
  test("media size is read only when Mitti reports it (shape unchanged otherwise)", () => {
    expect(mittiMediaFile({ media_id: "a", file_size: 12 }).sizeBytes).toBe(12);
    expect("sizeBytes" in mittiMediaFile({ media_id: "a" })).toBe(false);
  });
  test("form health of the old template stays advisory", () => {
    expect(validateSavedDefinition("piisa", a3Template()).ok).toBe(true);
  });
});

describe("gates, products and the checklist", () => {
  test("evidenceStageBlockers lists install-evidence and product lines after the checklist rows, for both stages", () => {
    const rows = [{ label: "Install photos", status: "verified", required: true, gate: "installation" }];
    const extras = { installEvidence: ["Install evidence: After videos: 0 of 1 uploaded"], productProblems: ["Product: Installed R-value R3.5 is below the Activity 48 minimum of R5.0."] };
    expect(evidenceStageBlockers("ready_for_veec", rows, false, extras)).toEqual([extras.installEvidence[0], extras.productProblems[0]]);
    expect(evidenceStageBlockers("ap_review", rows, false, extras)).toHaveLength(2);
    expect(evidenceStageBlockers("ap_review", rows, false)).toEqual([]);
    expect(evidenceStageBlockers("ap_review", null, true, extras)).toHaveLength(1);
  });
  test("gate lines prefix every blocker and stay silent when the rule does not apply", () => {
    const s = evalDay({ multiDay: true });
    expect(installEvidenceGateLines(s, "2026-11-03")).toEqual(["Install evidence: Daily pre-start re-check not ticked for this multi-day installation"]);
    expect(installEvidenceGateLines({ ...s, applies: false }, "2026-11-03")).toEqual([]);
  });
  test("declared product: register + date + R5.0; area products win over the Ready Check option", () => {
    expect(declaredProductProblems(null, { installDate: "2026-11-03", veecCreationDate: "2026-11-10" })).toEqual([]);
    expect(declaredProductProblems("Bradford Gold R5", { installDate: "2026-11-03", veecCreationDate: "2026-11-10" })).toEqual([]);
    expect(declaredProductProblems("Mystery R9", { installDate: null, veecCreationDate: "2026-11-10" })[0]).toContain("does not match any model");
    expect(jobProductOptions([{ product: "Earthwool R5" }, { product: "Earthwool R5" }, { product: null }], "Bradford Gold R5")).toEqual(["Earthwool R5"]);
    expect(jobProductOptions([], "Bradford Gold R5")).toEqual(["Bradford Gold R5"]);
    expect(ZONE_PRODUCT_OPTIONS).toHaveLength(8);
  });
  test("A5 checklist rows carry the office verification text; on the install day form the before video is the Ready Check's", () => {
    const base = { crewCount: 1, electricianRequiredAtStart: false, existingPlanMatchesInstall: false, lifeSupportConsentOnFile: false };
    const rows = a3EvidenceChecklist({ "p4.present": "Yes" } as never, base, []);
    expect(rows.find((r) => r.key === "isolation_photo")!.verification).toContain("isolator switches must be visibly off");
    expect(rows.find((r) => r.key === "before_video")!.state).toBe("missing");
    expect(a3EvidenceChecklist({} as never, { ...base, installDayForm: true }, []).find((r) => r.key === "before_video")!.state).toBe("not_required");
  });
});

describe("decision 213: Mitti Complete records the installation only when every check passes", () => {
  const clean = evalDay();
  test("records when the form is Complete, the declaration is saved and nothing is outstanding; old-rule installs record on the original checks", () => {
    expect(installCompletionDecision({ formCompleted: true, declarationSaved: true, summary: clean, alreadyCompleted: false })).toMatchObject({ record: true, nextLine: null });
    expect(installCompletionDecision({ formCompleted: true, declarationSaved: true, summary: { ...clean, applies: false }, alreadyCompleted: false }).record).toBe(true);
  });
  test("never records twice, never before Complete, never without the signed declaration, never with an outstanding item — and says what is next", () => {
    expect(installCompletionDecision({ formCompleted: true, declarationSaved: true, summary: clean, alreadyCompleted: true })).toMatchObject({ record: false, nextLine: null });
    expect(installCompletionDecision({ formCompleted: false, declarationSaved: true, summary: clean, alreadyCompleted: false }).nextLine).toContain("mark it Complete");
    expect(installCompletionDecision({ formCompleted: true, declarationSaved: false, summary: clean, alreadyCompleted: false }).nextLine).toContain("Sign the safety form");
    expect(installCompletionDecision({ formCompleted: true, declarationSaved: true, summary: null, alreadyCompleted: false }).record).toBe(false);
    const held = evalDay({ lockout: "No", depth: 0 });
    const d = installCompletionDecision({ formCompleted: true, declarationSaved: true, summary: held, alreadyCompleted: false });
    expect(d.record).toBe(false);
    expect(d.outstanding).toEqual(held.blockers);
    expect(d.nextLine).toBe(installerNextLine(held));
    expect(installerNextLine({ ...held, blockers: ["only one"] })).toBe("Install day form: only one");
  });
  test("decision 328: an unticked final tick holds the record whatever the install date", () => {
    const d = installCompletionDecision({ formCompleted: true, declarationSaved: true, summary: { ...clean, applies: false }, alreadyCompleted: false, allFilledInTicked: false });
    expect(d).toMatchObject({ record: false, outstanding: [FINAL_TICK_MISSING] });
    expect(installCompletionDecision({ formCompleted: true, declarationSaved: true, summary: clean, alreadyCompleted: false, allFilledInTicked: true }).record).toBe(true);
    expect(installCompletionDecision({ formCompleted: true, declarationSaved: true, summary: clean, alreadyCompleted: false, allFilledInTicked: null }).record).toBe(true);
  });
});

describe("PIESA Part 7 from the appliance block (decision 295)", () => {
  test("rows fill the official table; effective = Yes only when every item is safe (or the repair work is complete); blank never Yes", () => {
    const base = { appliancesPresent: "Yes", applianceWhat: "Exhaust fan over the bathroom", appliancePhoto: "media_a", applianceSafe: "Yes" } as never;
    const safe = expandShortAnswers("piesa", base, {} as never);
    expect(safe.answers["p7.appliance#0"]).toBe("Exhaust fan over the bathroom");
    expect(safe.answers["p7.effective"]).toBe("Yes");
    const unsafe = expandShortAnswers("piesa", { ...base, "applianceWhat#1": "Gas flue near the manhole", "appliancePhoto#1": "media_b", "applianceSafe#1": "No" } as never, {} as never);
    expect(unsafe.answers["p7.hazard#1"]).toMatch(/Needs work/);
    expect(unsafe.answers["p7.effective"]).toBeUndefined();
    expect(unsafe.flagged.some((x) => /effective/.test(x))).toBe(true);
    const fixed = expandShortAnswers("piesa", { ...base, "applianceWhat#1": "Gas flue", "applianceSafe#1": "No", rectificationComplete: "Yes" } as never, {} as never);
    expect(fixed.answers["p7.effective"]).toBe("Yes");
    // Old forms: one description + the self-graded answer are still read.
    const legacy = expandShortAnswers("piesa", { appliancesPresent: "Yes", applianceDetails: "Exhaust fan", appliancesEffective: "Yes" } as never, {} as never);
    expect(legacy.answers["p7.effective"]).toBe("Yes");
  });
});
