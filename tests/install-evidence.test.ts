// Decisions 205/206/210/211/213: install-day evidence, SWMS, sign-off and Mitti-complete recording (pure rules).
import { describe, expect, test } from "bun:test";
import { A3_RELABELS, AFTER_INSTALL_QUESTIONS as A, FOIL_QUESTIONS as F, INSTALL_EVIDENCE_EFFECTIVE_DATE, INSTALL_EVIDENCE_QUESTIONS as Q, MAX_FORM_ZONES, SWMS_ADDITIONAL_INSTALLERS, SWMS_HAZARDS, SWMS_COMPLIANCE_MEASURES, SWMS_HOW_IMPLEMENTED, SWMS_HOW_IN_PLACE, SWMS_HRCW_NONE, SWMS_RECORD_TASK, SWMS_HRCW_OPTIONS, SWMS_PREPARED_FOR, SWMS_QUESTIONS as S, SWMS_WORK_DEFAULT, VIDEO_MAX_BYTES, ZONE_PRODUCT_OPTIONS, afterInstallBlockers, declaredProductProblems, evaluateInstallEvidence, foilBlockers, installCompletionDecision, installEvidenceApplies, installEvidenceGateLines, installEvidenceMissingQuestions, installEvidencePrefillItems, installEvidenceQuestionList, installerNextLine, jobProductOptions, readInstallEvidence, swmsBlockers, swmsCrossCheck, swmsRecordText, zoneNameValue } from "../src/lib/install-evidence.core";
import { A3_EVIDENCE_LABELS, A3_INSTRUCTION_LABELS_2026_10_09, A3_MEDIA_IDS, a3AcceptedMediaLabels, a3EvidenceChecklist, a3MissingFields } from "../src/lib/piisa-a3.core";
import { evidenceStageBlockers } from "../src/lib/ap-review-evidence.core";
import { validateSavedDefinition } from "../src/lib/mitti-form-schema.core";
import { mittiMediaFile } from "../src/lib/piesa-evidence.core";
import { expandShortAnswers } from "../src/lib/official-expand.core";
import { SHORT_PIESA_FIELDS } from "../src/lib/official-short.core";
import { a3Template } from "./helpers/a3-template";

const T0 = "2026-11-03T20:00:00Z";
const geo = (n: number, extra: Record<string, unknown> = {}, t = "2026-11-03T19:50:00Z") => Array.from({ length: n }, (_, i) => ({ media_id: `m${i}`, captured_at: t, location: { geometry: { coordinates: [145.0, -37.8] } }, ...extra }));
const item = (label: string, extra: Record<string, unknown> = {}) => ({ item_id: `id-${label.slice(0, 40)}`, label, type: "media", ...extra });
const pick = (label: string, v: string) => item(label, { type: "question", responses: { selected: [{ label: v }] } });
const tickAll = (label: string, vs: string[]) => item(label, { type: "list", responses: { selected: vs.map((label) => ({ label })) } });
const text = (label: string, v: string) => item(label, { type: "text", responses: { text: v } });
const tick = (label: string) => item(label, { type: "checkbox", responses: { value: true } });
const sign = (label: string, name: string, at: string) => item(label, { type: "signature", responses: { image: { media_id: "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b", name, timestamp: at } } });
const dt = (label: string, v: string) => item(label, { type: "datetime", responses: { datetime: v } });

/** A complete SWMS section (decision 256) signed before work start; `crew` = additional installers who sign. */
function swmsItems(opts: { lead?: string; crew?: string[]; signedAt?: string; hazards?: string[]; hrcw?: string[]; multiDay?: boolean; controls?: boolean } = {}) {
  const lead = opts.lead ?? "Bhavdeep Singh", crew = opts.crew ?? [], signedAt = opts.signedAt ?? "2026-11-03T19:40:00Z";
  const items: Record<string, unknown>[] = [
    tickAll(S.hrcw, opts.hrcw ?? [SWMS_HRCW_OPTIONS[0], SWMS_HRCW_OPTIONS[1]]),
    tickAll(S.hazards, opts.hazards ?? [SWMS_HAZARDS[0]!.name, SWMS_HAZARDS[3]!.name, SWMS_HAZARDS[7]!.name]),
    ...(opts.controls === false ? [] : [tick(S.standardControls)]),
    text(S.changes, "None"),
  ];
  crew.forEach((n, i) => items.push(tick(S.installerRead(i + 1)), sign(S.installerSignature(i + 1), n, signedAt)));
  items.push(tick(S.leadDeclaration), sign(S.leadSignature, lead, signedAt), dt(S.signedAt, signedAt));
  if (opts.multiDay) items.push(text(S.day2Recheck, "4 Nov 7:30 BS — no change"));
  return items;
}
function afterItems(opts: { lead?: string; solar?: string; lockout?: string } = {}) {
  return [pick(A.lockoutRemoved, opts.lockout ?? "Yes"), text(A.lockoutRemovedBy, "Bhavdeep Singh, lead installer"), item(A.switchboardAfterPhoto, { media: geo(1, {}, "2026-11-04T04:00:00Z") }), pick(A.solarRestarted, opts.solar ?? "N/A – none at this property"), dt(A.finishedAt, "2026-11-04T04:05:00Z"), tick(A.leadPresent), sign(A.completionSignature, opts.lead ?? "Bhavdeep Singh", "2026-11-04T04:06:00Z")];
}
/** A complete, clean audit under the new rule. */
function cleanAudit(zones = 2, opts: { under?: boolean[]; multiDay?: boolean; recheck?: boolean; videoBytes?: number; foil?: boolean | null; swms?: Parameters<typeof swmsItems>[0]; after?: Parameters<typeof afterItems>[0]; noProduct?: boolean } = {}) {
  const items: Record<string, unknown>[] = [pick(Q.zoneCount, String(zones))];
  for (let z = 1; z <= zones; z++) {
    const under = opts.under?.[z - 1] ?? false;
    items.push(text(Q.zoneName(z), zoneNameValue(z, z === 1 ? "Main ceiling" : `Zone ${z} area`)), pick(Q.zoneUnderInsulated(z), under ? "Yes" : "No"));
    if (under) items.push(item(Q.zoneExistingPhoto(z), { media: geo(1) }));
    items.push(item(Q.zoneBeforeVideo(z), { media: geo(1, { file_size: opts.videoBytes ?? 90_000_000 }) }), item(Q.zoneAfterVideo(z), { media: geo(1, { file_size: opts.videoBytes ?? 90_000_000 }) }), item(Q.zoneDepthPhoto(z), { media: geo(2) }));
    if (!opts.noProduct) items.push(pick(Q.zoneProduct(z), "Bradford Gold R5"), item(Q.zoneAreaM2(z), { type: "number", responses: { value: z === 1 ? 120 : 30 } }));
  }
  items.push(pick(Q.multiDay, opts.multiDay ? "Yes" : "No"));
  if (opts.recheck) items.push(tick(Q.dailyRecheck));
  if (opts.foil !== null) items.push(pick(F.foil, opts.foil ? "Yes" : "No"));
  if (opts.foil) items.push(item(F.foilPhoto, { media: geo(1) }));
  items.push(...swmsItems({ multiDay: opts.multiDay, ...(opts.swms ?? {}) }), ...afterItems(opts.after ?? {}));
  return { items };
}
const ctx2 = { installDate: "2026-11-03", zones: [{ name: "Main ceiling", underInsulated: false }, { name: "Zone 2 area", underInsulated: false }], multiDay: false, leadName: "Bhavdeep Singh", additionalInstallers: [] as (string | null)[], isolationCapturedAt: T0, solarPresent: false, existingInsulation: false, p3Swms: "Yes" as const, p3Table1: "Yes" as const };
const evalClean = (zones = 2, o: Parameters<typeof cleanAudit>[1] = {}, c: Partial<typeof ctx2> = {}) => evaluateInstallEvidence(readInstallEvidence(cleanAudit(zones, o)), { ...ctx2, zones: ctx2.zones.slice(0, zones), ...c }, T0);

describe("effective date (grandfathering)", () => {
  test("installs before the effective date keep the old rule; on/after apply; unknown date applies once the date has arrived", () => {
    expect(INSTALL_EVIDENCE_EFFECTIVE_DATE).toBe("2026-11-01");
    expect(installEvidenceApplies("2026-10-31")).toBe(false);
    expect(installEvidenceApplies("2026-11-01")).toBe(true);
    expect(installEvidenceApplies(null, "2026-10-25")).toBe(false);
    expect(installEvidenceApplies(null, "2026-11-01")).toBe(true);
    const s = evaluateInstallEvidence(readInstallEvidence({ items: [] }), { ...ctx2, installDate: "2026-10-20" });
    expect(s.applies).toBe(false); expect(s.blockers).toEqual([]); expect(s.prestartBlockers).toEqual([]);
    expect(installEvidenceGateLines(null, "2026-10-20")).toEqual([]);
    expect(installEvidenceGateLines(null, "2026-11-05").join()).toContain("not been read");
  });
});

describe("question wording and reading", () => {
  test("52 new questions in form order; relabels are the four A3 photo items; zone product options are the Ready Check eight", () => {
    const list = installEvidenceQuestionList();
    expect(list).toHaveLength(SWMS_ADDITIONAL_INSTALLERS * 2 + 8 + 1 + MAX_FORM_ZONES * 8 + 4 + 2 + 7);
    expect(list[0]!.label).toBe("SWMS — additional installer 1: I have read this SWMS, understand the hazards and controls, and will follow it");
    expect(list.find((q) => q.label === S.hazards)!.options).toEqual(SWMS_HAZARDS.map((h) => h.name));
    expect(list.filter((q) => q.zone === 2).every((q) => q.label.startsWith("Zone 2 — "))).toBe(true);
    expect(new Set(list.map((q) => q.label)).size).toBe(list.length);
    expect(Object.keys(A3_RELABELS)).toEqual(["installer_photos", "electrician_photo", "isolation_photo", "product_photos"]);
    expect(A3_EVIDENCE_LABELS.installer_photos).toBe(A3_RELABELS.installer_photos);
    expect(ZONE_PRODUCT_OPTIONS).toEqual(["Bradford Gold R5", "Bradford Gold R6", "Bradford Gold R7", "Fletchers Pink Batts R5", "Fletchers Pink Batts R6", "Fletchers Pink Batts R7", "Earthwool R5", "ECOWOOL R5"]);
    expect(list.some((q) => (q.type === "photo" || q.type === "video") && /plan/i.test(q.label))).toBe(false); // decision 211: no plan upload
  });
  test("old A3 labels (short and 9 Oct instructions) stay accepted on the same stable IDs", () => {
    for (const k of ["installer_photos", "electrician_photo", "isolation_photo", "product_photos"] as const) expect(a3AcceptedMediaLabels(k)).toContain(A3_INSTRUCTION_LABELS_2026_10_09[k].toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
    const t = a3Template() as { items: { item_id: string; label: string }[] };
    t.items.find((x) => x.item_id === A3_MEDIA_IDS.installer_photos)!.label = A3_INSTRUCTION_LABELS_2026_10_09.installer_photos;
    expect(a3MissingFields(t)).toEqual([]);
  });
  test("reads by exact first-line wording; help text ignored; signatures, tick-alls, numbers and dates read; missing question reads nothing", () => {
    const a = { items: [pick(`${Q.zoneCount}\nCount each separately insulated area`, "2"), text(Q.zoneName(1), "Area 1 – Main"), pick(Q.multiDay, "Yes"), tick(Q.dailyRecheck), item(Q.zoneAreaM2(1), { type: "number", responses: { value: 88.5 } }), ...swmsItems({ crew: ["Dominic Doherty"] }), ...afterItems()] };
    const r = readInstallEvidence(a);
    expect(r.formZoneCount).toBe(2); expect(r.zones[0]!.name).toBe("Area 1 – Main"); expect(r.zones[0]!.areaM2).toBe(88.5); expect(r.zones[1]!.name).toBeNull();
    expect(r.multiDay).toBe(true); expect(r.dailyRecheck).toBe(true);
    expect(r.swms.hazards).toEqual([SWMS_HAZARDS[0]!.name, SWMS_HAZARDS[3]!.name, SWMS_HAZARDS[7]!.name]);
    expect(r.swms.standardControls).toBe(true); expect(r.swms.changes).toBe("None");
    expect(r.swms.installers[0]).toMatchObject({ row: 1, read: true, signature: { present: true, name: "Dominic Doherty" } });
    expect(r.swms.installers[1]).toMatchObject({ row: 2, read: false, signature: { present: false } });
    expect(r.swms.leadSignature).toMatchObject({ present: true, name: "Bhavdeep Singh", signedAt: "2026-11-03T19:40:00Z" });
    expect(r.after.finishedAt).toBe("2026-11-04T04:05:00Z");
    expect(readInstallEvidence({ items: [] })).toMatchObject({ questionsOnForm: false, swms: { onForm: false }, after: { onForm: false }, foil: { onForm: false } });
  });
  test("template without the new items lists every missing wording; a built template lists none; form health stays advisory", () => {
    expect(installEvidenceMissingQuestions(a3Template())).toHaveLength(installEvidenceQuestionList().length);
    const built = { items: [...(a3Template() as { items: unknown[] }).items, ...installEvidenceQuestionList().map((q) => item(q.label))] };
    expect(installEvidenceMissingQuestions(built)).toEqual([]);
    const health = validateSavedDefinition("piisa", a3Template());
    expect(health.ok).toBe(true);
    expect(health.issues.filter((i) => i.startsWith("Table 4 item not on the form yet"))).toHaveLength(installEvidenceQuestionList().length);
  });
  test("media size is read only when Mitti reports it (shape unchanged otherwise)", () => {
    expect(mittiMediaFile({ media_id: "a", file_size: 12 }).sizeBytes).toBe(12);
    expect("sizeBytes" in mittiMediaFile({ media_id: "a" })).toBe(false);
  });
});

describe("Table 4 zones, videos, ruler photos, product and m²", () => {
  test("clean two-zone job passes with every item met; zone products feed the diagram; SWMS complete; foil read", () => {
    const s = evalClean(2);
    expect(s.blockers).toEqual([]);
    expect(s.prestartBlockers).toEqual([]);
    expect(s.swmsComplete).toBe(true);
    expect(s.zoneProducts).toEqual([{ zone: 1, name: "Area 1 – Main ceiling", product: "Bradford Gold R5", areaM2: 120 }, { zone: 2, name: "Area 2 – Zone 2 area", product: "Bradford Gold R5", areaM2: 30 }]);
    expect(s.foil).toBe(false);
  });
  test("form without the new questions fails closed with plain pointers to the build prompt", () => {
    const s = evaluateInstallEvidence(readInstallEvidence(a3Template()), ctx2);
    expect(s.blockers.filter((b) => b.includes("MITTI_INSTALL_FORM_CHATGPT_PROMPT"))).toHaveLength(1);
    expect(s.blockers.filter((b) => b.includes("MITTI_INSTALL_FORM_FIX_PROMPT"))).toHaveLength(1);
    expect(s.blockers.some((b) => b.includes("no after-install sign-off yet"))).toBe(true);
  });
  test("every missing, ungeotagged, untimed and oversized item is listed in plain words", () => {
    const audit = cleanAudit(2, { videoBytes: VIDEO_MAX_BYTES + 1 });
    (audit.items.find((i) => (i as { label: string }).label === Q.zoneDepthPhoto(2)) as { media: unknown[] }).media = [];
    (audit.items.find((i) => (i as { label: string }).label === Q.zoneBeforeVideo(1)) as { media: unknown[] }).media = [{ media_id: "x" }];
    const s = evaluateInstallEvidence(readInstallEvidence(audit), ctx2, T0);
    expect(s.blockers).toContain("Zone 2 (Zone 2 area) after-install depth photo with vertical ruler: 0 of 1 uploaded");
    expect(s.blockers.some((b) => b.startsWith("Zone 1 (Main ceiling) before 360° video: location (GPS) not recorded on 1 of 1"))).toBe(true);
    expect(s.blockers.some((b) => b.includes("capture time not recorded on 1 of 1"))).toBe(true);
    expect(s.blockers.filter((b) => b.includes("over the 250 MB limit"))).toHaveLength(3);
  });
  test("under-insulated zone needs the ruler/brand photo — from the job record or the form answer; the tick alone is not enough", () => {
    const fromJob = evalClean(1, {}, { zones: [{ name: "Main ceiling", underInsulated: true }] });
    expect(fromJob.blockers).toContain("Zone 1 (Main ceiling) existing insulation ruler/brand photo: 0 of 1 uploaded");
    const fromForm = evalClean(1, { under: [true] }, { zones: [{ name: "Main ceiling", underInsulated: null }] });
    expect(fromForm.blockers).toEqual([]);
    expect(fromForm.items.find((i) => i.id === "zone_existing_photo")!.state).toBe("met");
  });
  test("zone count must match the job; names compare on the part after 'Area N –'; more than three zones is an office review", () => {
    expect(evalClean(2, {}, { zones: [ctx2.zones[0]!] }).blockers).toContain("The form says 2 upgrade zones but the job records 1 — office review");
    expect(evalClean(1, {}, { zones: [{ name: "Lounge", underInsulated: false }] }).blockers.join()).toContain("names this area \"Area 1 – Main ceiling\"");
    const four = evalClean(3, {}, { zones: [1, 2, 3, 4].map((n) => ({ name: n === 1 ? "Main ceiling" : n === 2 ? "Zone 2 area" : `A${n}`, underInsulated: false })) });
    expect(four.blockers.some((b) => b.startsWith("This job records 4 upgrade zones"))).toBe(true);
  });
  test("product and m² per zone are required and checked", () => {
    const s = evalClean(1, { noProduct: true }, { zones: [ctx2.zones[0]!] });
    expect(s.blockers).toContain("Zone 1 (Main ceiling): insulation product installed not chosen");
    expect(s.blockers).toContain("Zone 1 (Main ceiling): area insulated (m²) not entered");
    const audit = cleanAudit(1);
    (audit.items.find((i) => (i as { label: string }).label === Q.zoneProduct(1)) as { responses: { selected: { label: string }[] } }).responses.selected = [{ label: "Mystery R9" }];
    expect(evaluateInstallEvidence(readInstallEvidence(audit), { ...ctx2, zones: [ctx2.zones[0]!] }, T0).blockers).toContain("Zone 1 (Main ceiling): product \"Mystery R9\" is not one of the approved options");
  });
  test("multi-day installs need the daily re-check tick and the SWMS day-2 line; one-day installs do not", () => {
    const missing = evalClean(2, { multiDay: true, swms: { multiDay: false } });
    expect(missing.blockers).toContain("Daily pre-start re-check not ticked for this multi-day installation");
    expect(missing.blockers).toContain(`${S.day2Recheck}: not entered for this multi-day installation`);
    expect(evalClean(2, { multiDay: true, recheck: true }).blockers).toEqual([]);
    expect(evalClean(2, {}, { multiDay: true }).blockers.join()).toContain("ran over more than one day");
  });
  test("before-work items taken after the signed start are flagged", () => {
    const audit = cleanAudit(1);
    (audit.items.find((i) => (i as { label: string }).label === Q.zoneBeforeVideo(1)) as { media: unknown[] }).media = geo(1, {}, "2026-11-03T23:00:00Z");
    const s = evaluateInstallEvidence(readInstallEvidence(audit), { ...ctx2, zones: [ctx2.zones[0]!] }, "2026-11-03T21:00:00Z");
    expect(s.blockers).toContain("Zone 1 (Main ceiling) before 360° video: 1 taken after work started — must be taken before work starts");
  });
});

describe("SWMS section (decisions 206/256)", () => {
  const meta = { jobNumber: "HV-3100", address: "1 Test St, Box Hill", auditId: "audit_1", preparedBy: "Reinsulate Pty Ltd", leadName: "Bhavdeep Singh", additionalInstallers: ["Dominic Doherty", null, null] };
  test("a complete SWMS has no blockers; the filed record takes the header from job facts and prints each ticked hazard's own control sentence", () => {
    const r = readInstallEvidence({ items: swmsItems({ crew: ["Dominic Doherty"] }) });
    expect(swmsBlockers(r.swms, { leadName: "Bhavdeep Singh", additionalInstallers: ["Dominic Doherty", null, null], isolationCapturedAt: T0, multiDay: false })).toEqual([]);
    const txt = swmsRecordText(r.swms, meta);
    expect(txt).toContain("Job HV-3100 — Mitti Install day form audit_1");
    for (const line of ["Direct employer: Reinsulate Pty Ltd", `Principal contractor: ${SWMS_PREPARED_FOR}`, "Work supervisor: Bhavdeep Singh", "Site location/address: 1 Test St, Box Hill", `Work activity: ${SWMS_WORK_DEFAULT}`, "Date SWMS prepared: 2026-11-03T19:40:00Z", "Person responsible for ensuring compliance with SWMS: Bhavdeep Singh", `Measures to ensure compliance: ${SWMS_COMPLIANCE_MEASURES}`, "How control measures will be reviewed: Specific to this house / changes during the job: None", "Tasks | Hazard | Control measures | How implemented | Responsible", "Name | Signature | Date"]) expect(txt, line).toContain(line);
    expect(txt).toContain(`${SWMS_RECORD_TASK} | ${SWMS_HAZARDS[0]!.name} | ${SWMS_HAZARDS[0]!.short}: ${SWMS_HAZARDS[0]!.control}. | ${SWMS_HOW_IMPLEMENTED} | Bhavdeep Singh (lead installer)`);
    expect(txt).toContain(`| ${SWMS_HAZARDS[7]!.name} | ${SWMS_HAZARDS[7]!.short}: ${SWMS_HAZARDS[7]!.control}. |`);
    expect(txt).not.toContain(SWMS_HAZARDS[1]!.control); // unticked hazard not printed
    expect(txt).toContain(SWMS_HOW_IN_PLACE);
    expect(txt).toContain("Bhavdeep Singh (lead installer) | signed (signature image 0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b) | 2026-11-03T19:40:00Z");
    expect(txt).toContain("Dominic Doherty (additional installer 1; read and will follow: Yes) | signed (signature image 0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b) | 2026-11-03T19:40:00Z");
    const multi = swmsRecordText(readInstallEvidence({ items: swmsItems({ multiDay: true }) }).swms, meta);
    expect(multi).toContain("How control measures will be reviewed: Day 2 re-check: 4 Nov 7:30 BS — no change · Specific to this house / changes during the job: None");
  });
  test("solo crew: no additional installer named = no crew sign-off needed", () => {
    const r = readInstallEvidence({ items: swmsItems() });
    expect(swmsBlockers(r.swms, { leadName: "Bhavdeep Singh", additionalInstallers: [null, null, null], isolationCapturedAt: T0, multiDay: false })).toEqual([]);
    expect(swmsRecordText(r.swms, { ...meta, additionalInstallers: [] }).split("Name | Signature | Date\n")[1]).toBe("Bhavdeep Singh (lead installer) | signed (signature image 0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b) | 2026-11-03T19:40:00Z");
  });
  test("each named additional installer must tick and sign; an unnamed row is not asked", () => {
    const r = readInstallEvidence({ items: swmsItems({ crew: ["Dominic Doherty"] }) });
    const b = swmsBlockers(r.swms, { leadName: "Bhavdeep Singh", additionalInstallers: ["Dominic Doherty", null, "Third Person"], isolationCapturedAt: T0, multiDay: false });
    expect(b).toEqual(["SWMS — additional installer 3 (Third Person): has not ticked that they read the SWMS", "SWMS — additional installer 3 (Third Person): signature missing"]);
    const unsigned = readInstallEvidence({ items: swmsItems().concat(tick(S.installerRead(1)), sign(S.installerSignature(1), "Dominic Doherty", "")) });
    expect(swmsBlockers(unsigned.swms, { leadName: "Bhavdeep Singh", additionalInstallers: ["Dominic Doherty"], isolationCapturedAt: T0, multiDay: false })).toEqual(["SWMS — additional installer 1 (Dominic Doherty): signature has no time recorded"]);
  });
  test("every gap is a plain line: high-risk work, hazards, controls tick, specific/changes box, lead declaration and signature", () => {
    const none = readInstallEvidence({ items: [tickAll(S.hrcw, [SWMS_HRCW_NONE, SWMS_HRCW_OPTIONS[0]]), item(S.hazards, { type: "list", responses: {} })] });
    expect(swmsBlockers(none.swms, { leadName: "Bhavdeep Singh", additionalInstallers: [], isolationCapturedAt: null, multiDay: false })).toEqual([
      "SWMS — high-risk work: \"None of these apply\" cannot be ticked with another type",
      `${S.hrcwNone}: not entered`,
      `${S.hazards}: nothing ticked`,
      `${S.standardControls}: not ticked`,
      `${S.changes}: not entered`,
      "SWMS — lead installer declaration not ticked",
      `${S.leadSignature}: missing`,
      `${S.signedAt}: not entered`,
    ]);
    const noTicks = readInstallEvidence({ items: [item(S.hazards, { type: "list", responses: {} })] });
    expect(swmsBlockers(noTicks.swms, { additionalInstallers: [], multiDay: false })[0]).toBe(`${S.hrcw}: nothing ticked`);
  });
  test("a form still on the old SWMS (no hazards question) fails closed with a pointer to the fix prompt", () => {
    const old = readInstallEvidence({ items: [text("SWMS — prepared by (installer business name)", "X")] });
    expect(swmsBlockers(old.swms, { multiDay: false })).toEqual([`The Mitti Install day form does not have the current SWMS yet ("${S.hazards}" not found) — apply docs/MITTI_INSTALL_FORM_FIX_PROMPT.md to the template.`]);
  });
  test("lead signature must be the lead's own and before the isolation photo; a different signer or a late signature blocks", () => {
    const late = readInstallEvidence({ items: swmsItems({ signedAt: "2026-11-03T20:30:00Z" }) });
    expect(swmsBlockers(late.swms, { leadName: "Bhavdeep Singh", additionalInstallers: [], isolationCapturedAt: T0, multiDay: false })).toEqual(["SWMS was signed after the power-isolation photo was taken — the SWMS must be completed before work starts; office review"]);
    const other = readInstallEvidence({ items: swmsItems({ lead: "Someone Else" }) });
    const b = swmsBlockers(other.swms, { leadName: "Bhavdeep Singh", additionalInstallers: [], isolationCapturedAt: T0, multiDay: false });
    expect(b.some((x) => x.includes("signing on behalf is not accepted"))).toBe(true);
  });
  test("official Part 3 ticks are cross-checked, never removed: Yes on a half-done SWMS contradicts; No on a complete one must be corrected", () => {
    const done = readInstallEvidence({ items: swmsItems() }).swms;
    expect(swmsCrossCheck(done, [], "Yes", "Yes")).toEqual([]);
    expect(swmsCrossCheck(done, ["x"], "Yes", "Yes")[0]).toContain("says the SWMS is complete, but the SWMS section on the form is not");
    expect(swmsCrossCheck(done, [], "No", "Yes")[0]).toContain("installer must correct Part 3");
    const half = readInstallEvidence({ items: swmsItems({ controls: false }) }).swms;
    expect(swmsCrossCheck(half, ["x"], "Yes", "Yes").some((l) => l.includes("Table 1"))).toBe(true);
    expect(swmsCrossCheck({ ...done, onForm: false }, ["x"], "Yes", "Yes")).toEqual([]);
  });
  test("SWMS gaps are prestart blockers; after-install gaps are not", () => {
    const s = evalClean(1, { swms: { controls: false }, after: { lockout: "No" } }, { zones: [ctx2.zones[0]!] });
    expect(s.prestartBlockers).toContain(`${S.standardControls}: not ticked`);
    expect(s.prestartBlockers.some((b) => b.includes("Lock-out"))).toBe(false);
    expect(s.blockers).toContain("Lock-out still in place — the premises must be re-energised and the lock-out removed before leaving site");
  });
});

describe("after-install sign-off and foil (decision 210)", () => {
  test("complete sign-off passes; each gap is one plain line; solar N/A with solar present is a review; wrong signer blocks", () => {
    const ok = readInstallEvidence({ items: afterItems() }).after;
    expect(afterInstallBlockers(ok, { leadName: "Bhavdeep Singh", solarPresent: false })).toEqual([]);
    expect(afterInstallBlockers(ok, { leadName: "Bhavdeep Singh", solarPresent: true })).toEqual(["Solar/battery restart answered N/A but the safety form says the home has solar, a battery or another supply — office review"]);
    const no = readInstallEvidence({ items: afterItems({ solar: "No", lead: "Someone Else" }) }).after;
    const b = afterInstallBlockers(no, { leadName: "Bhavdeep Singh", solarPresent: true });
    expect(b).toContain("Solar, battery or generator not restarted — restart it per the instructions (or have the electrician do it) before leaving site");
    expect(b.some((x) => x.includes("not the lead installer (Bhavdeep Singh)"))).toBe(true);
    const none = readInstallEvidence({ items: [pick(A.lockoutRemoved, "Yes")] }).after;
    expect(afterInstallBlockers(none, {})).toEqual([`${A.lockoutRemovedBy}: not entered`, "Switchboard photo after re-energising: 0 of 1 uploaded", `${A.solarRestarted}: not answered`, `${A.finishedAt}: not entered`, "Lead installer has not confirmed being on site for the whole installation", `${A.completionSignature}: missing`]);
  });
  test("foil is asked whenever existing insulation is present; Yes needs the geotagged facing photo; No needs nothing; feeds P6", () => {
    expect(foilBlockers(readInstallEvidence({ items: [] }).foil, false)).toEqual([]);
    expect(foilBlockers(readInstallEvidence({ items: [] }).foil, true)[0]).toContain("has no \"Is any of the existing insulation foil-backed");
    expect(foilBlockers(readInstallEvidence({ items: [pick(F.foil, "Yes")] }).foil, true)).toEqual(["Existing insulation facing photo (foil / conductive): 0 of 1 uploaded"]);
    expect(foilBlockers(readInstallEvidence({ items: [pick(F.foil, "No")] }).foil, true)).toEqual([]);
    const s = evalClean(1, { under: [true], foil: true }, { zones: [{ name: "Main ceiling", underInsulated: true }], existingInsulation: true });
    expect(s.blockers).toEqual([]); expect(s.foil).toBe(true); expect(s.foilPhotoMediaId).toBe("m0");
    const unanswered = evalClean(1, { under: [true], foil: null }, { zones: [{ name: "Main ceiling", underInsulated: true }] });
    expect(unanswered.blockers.some((b) => b.includes(`has no "${F.foil}" question yet`))).toBe(true);
    expect(foilBlockers(readInstallEvidence({ items: [item(F.foil, { type: "question" })] }).foil, true)).toEqual([`${F.foil}: not answered`]);
  });
});

describe("gates, prefill and products", () => {
  test("evidenceStageBlockers lists install-evidence and product lines after the checklist rows, for both stages", () => {
    const rows = [{ label: "Install photos", status: "verified", required: true, gate: "installation" }];
    const extras = { installEvidence: ["Install evidence: Zone 1 after 360° video: 0 of 1 uploaded"], productProblems: ["Product: Installed R-value R3.5 is below the Activity 48 minimum of R5.0."] };
    expect(evidenceStageBlockers("ready_for_veec", rows, false, extras)).toEqual([extras.installEvidence[0], extras.productProblems[0]]);
    expect(evidenceStageBlockers("ap_review", rows, false, extras)).toHaveLength(2);
    expect(evidenceStageBlockers("ap_review", rows, false)).toEqual([]);
    expect(evidenceStageBlockers("ap_review", null, true, extras)).toHaveLength(1);
  });
  test("gate lines prefix every blocker and stay silent when the rule does not apply", () => {
    const s = evalClean(2, { multiDay: true, swms: { multiDay: true } });
    expect(installEvidenceGateLines(s, "2026-11-03")).toEqual(["Install evidence: Daily pre-start re-check not ticked for this multi-day installation"]);
    expect(installEvidenceGateLines({ ...s, applies: false }, "2026-11-03")).toEqual([]);
  });
  test("prefill sends zone names only ('Area N – name', single area = Main ceiling), only for questions on the template; the SWMS has no prefilled items", () => {
    const tpl = { items: [item(Q.zoneName(1)), item(Q.zoneName(2)), item("SWMS — prepared by (installer business name)"), item(S.changes)] };
    expect(installEvidencePrefillItems(tpl, { zoneNames: [null] }).map((i) => i.responses.text)).toEqual(["Area 1 – Main ceiling"]);
    expect(installEvidencePrefillItems(tpl, { zoneNames: ["Main house", "Garage"] }).map((i) => i.responses.text)).toEqual(["Area 1 – Main house", "Area 2 – Garage"]);
    expect(installEvidencePrefillItems(a3Template(), { zoneNames: ["X"] })).toEqual([]);
  });
  test("declared product: register + date + R5.0 on install and VEEC-creation dates; zone products win over the Ready Check option", () => {
    expect(declaredProductProblems(null, { installDate: "2026-11-03", veecCreationDate: "2026-11-10" })).toEqual([]);
    expect(declaredProductProblems("Bradford Gold R5", { installDate: "2026-11-03", veecCreationDate: "2026-11-10" })).toEqual([]);
    expect(declaredProductProblems("Earthwool R5", { installDate: "2027-02-20", veecCreationDate: "2027-03-01" })).toEqual([expect.stringContaining("Product: Earthwool Ceiling batt — R5.0 — 1160 × 430 mm — 2437543 is not approved on 2027-03-01")]);
    expect(declaredProductProblems("Mystery R9", { installDate: null, veecCreationDate: "2026-11-10" })[0]).toContain("does not match any model");
    expect(declaredProductProblems(null, { installDate: null, veecCreationDate: "2026-11-10" }, ["4006102"])).toEqual(["Product: Installed R-value R3.5 is below the Activity 48 minimum of R5.0."]);
    expect(jobProductOptions([{ product: "Earthwool R5" }, { product: "Earthwool R5" }, { product: null }], "Bradford Gold R5")).toEqual(["Earthwool R5"]);
    expect(jobProductOptions([], "Bradford Gold R5")).toEqual(["Bradford Gold R5"]);
    expect(jobProductOptions(null, null)).toEqual([]);
  });
  test("A3 checklist rows carry the office verification text; solar adds the isolators-off note", () => {
    const rows = a3EvidenceChecklist({ "p4.present": "Yes" } as never, { crewCount: 1, electricianRequiredAtStart: false, existingPlanMatchesInstall: false, lifeSupportConsentOnFile: false }, []);
    expect(rows.find((r) => r.key === "isolation_photo")!.verification).toContain("isolator switches must be visibly off");
    expect(rows.find((r) => r.key === "installer_photos")!.verification).toContain("photo ID");
    expect(rows.find((r) => r.key === "final_plan")!.verification).toBeUndefined();
  });
});

describe("decision 213: Mitti Complete records the installation only when every check passes", () => {
  const clean = evalClean(2);
  test("records when the form is Complete, the declaration is saved and nothing is outstanding; old-rule installs record on the original checks", () => {
    expect(installCompletionDecision({ formCompleted: true, declarationSaved: true, summary: clean, alreadyCompleted: false })).toMatchObject({ record: true, nextLine: null });
    expect(installCompletionDecision({ formCompleted: true, declarationSaved: true, summary: { ...clean, applies: false }, alreadyCompleted: false }).record).toBe(true);
  });
  test("never records twice, never before Complete, never without the signed declaration, never with an outstanding item — and says what is next", () => {
    expect(installCompletionDecision({ formCompleted: true, declarationSaved: true, summary: clean, alreadyCompleted: true })).toMatchObject({ record: false, nextLine: null });
    expect(installCompletionDecision({ formCompleted: false, declarationSaved: true, summary: clean, alreadyCompleted: false }).nextLine).toContain("mark it Complete");
    expect(installCompletionDecision({ formCompleted: true, declarationSaved: false, summary: clean, alreadyCompleted: false }).nextLine).toContain("Sign the safety form");
    expect(installCompletionDecision({ formCompleted: true, declarationSaved: true, summary: null, alreadyCompleted: false }).record).toBe(false);
    const held = evalClean(2, { after: { lockout: "No" }, noProduct: true });
    const d = installCompletionDecision({ formCompleted: true, declarationSaved: true, summary: held, alreadyCompleted: false });
    expect(d.record).toBe(false);
    expect(d.outstanding).toEqual(held.blockers);
    expect(d.nextLine).toBe(installerNextLine(held));
    expect(d.nextLine).toMatch(/^Install day form: .* \(and \d+ more items\)$/);
    expect(installerNextLine({ ...held, blockers: ["only one"] })).toBe("Install day form: only one");
  });
});

describe("PIESA official Part 7 effective question (decision 210)", () => {
  test("the short form asks it only when appliances = Yes and the expansion fills p7.effective; blank is flagged, never Yes", () => {
    const f = SHORT_PIESA_FIELDS.find((x) => x.id === "appliancesEffective")!;
    expect(f).toMatchObject({ label: "Does the action you described effectively reduce the risk from each hazard listed?", type: "yesno", when: "appliancesPresent = Yes" });
    const base = { appliancesPresent: "Yes", applianceDetails: "Exhaust fan over the bathroom — kept clear" } as never;
    const ctx = {} as never;
    const yes = expandShortAnswers("piesa", { ...base, appliancesEffective: "Yes" } as never, ctx);
    expect(yes.answers["p7.effective"]).toBe("Yes");
    const blank = expandShortAnswers("piesa", base, ctx);
    expect(blank.answers["p7.effective"]).toBeUndefined();
    expect(blank.flagged.some((x) => x.includes("effectively reduce the risk"))).toBe(true);
  });
});

describe("live Mitti structure (24 Oct 10:07 UTC: Parts A and B already on the A3 template)", () => {
  /** Template definition shape: items nested under section / logicfield children, Mitti kinds as `type`, relabelled photos on the stable IDs. */
  function liveTemplate() {
    const t = a3Template() as { items: Record<string, unknown>[] };
    for (const k of ["installer_photos", "electrician_photo", "isolation_photo", "product_photos"] as const) (t.items.find((x) => x["item_id"] === A3_MEDIA_IDS[k]) as { label: string }).label = A3_RELABELS[k];
    const zone = (z: number) => [
      { item_id: `zn${z}`, type: "textsingle", label: Q.zoneName(z) },
      { item_id: `zu${z}`, type: "question", label: Q.zoneUnderInsulated(z), children: [{ item_id: `zul${z}`, type: "logicfield", label: "Yes", children: [{ item_id: `zp${z}`, type: "media", label: Q.zoneExistingPhoto(z) }] }] },
      { item_id: `zb${z}`, type: "media", label: Q.zoneBeforeVideo(z) }, { item_id: `za${z}`, type: "media", label: Q.zoneAfterVideo(z) }, { item_id: `zd${z}`, type: "media", label: Q.zoneDepthPhoto(z) },
    ];
    t.items.push({ item_id: "sec-zones", type: "section", label: "Zones and evidence", children: [
      { item_id: "zc", type: "question", label: Q.zoneCount, children: [
        ...zone(1),
        { item_id: "lf2", type: "logicfield", label: "2 or 3", children: zone(2) },
        { item_id: "lf3", type: "logicfield", label: "3", children: zone(3) },
      ] },
      { item_id: "md", type: "question", label: Q.multiDay, children: [{ item_id: "mdl", type: "logicfield", label: "Yes", children: [{ item_id: "dr", type: "checkbox", label: Q.dailyRecheck }] }] },
    ] });
    return { template: t };
  }
  test("form health reports Part A/B present and only the SWMS, product/m², foil and sign-off items as not yet on the form", () => {
    const missing = installEvidenceMissingQuestions(liveTemplate());
    expect(missing.some((m) => m.startsWith("Zone ") && !/product installed|area insulated/.test(m))).toBe(false);
    expect(missing).not.toContain(Q.zoneCount); expect(missing).not.toContain(Q.multiDay); expect(missing).not.toContain(Q.dailyRecheck);
    expect(missing).toContain(Q.zoneProduct(1)); expect(missing).toContain(S.hazards); expect(missing).toContain(A.lockoutRemoved); expect(missing).toContain(F.foil);
    const health = validateSavedDefinition("piisa", liveTemplate());
    expect(health.ok).toBe(true);
    expect(health.issues.filter((i) => i.startsWith("Native A3:"))).toEqual([]);
    // Decision 211: the retired final-plan upload may be deleted from the form without the form reading as broken.
    const noPlan = liveTemplate();
    noPlan.template.items = noPlan.template.items.filter((x) => x["item_id"] !== A3_MEDIA_IDS.final_plan);
    expect(a3MissingFields(noPlan)).toEqual([]);
    expect(validateSavedDefinition("piisa", noPlan).ok).toBe(true);
  });
  test("an audit in the live shape (flat items with parent_id, media files carrying their own label) reads the zone answers", () => {
    const audit = { audit_id: "audit_x", items: [
      { parent_id: "sec", item_id: "zc", type: "question", label: Q.zoneCount, responses: { selected: [{ id: "o1", label: "1" }] } },
      { parent_id: "zc", item_id: "zn1", type: "textsingle", label: Q.zoneName(1), responses: { text: "Area 1 – Main ceiling" } },
      { parent_id: "zc", item_id: "zu1", type: "question", label: Q.zoneUnderInsulated(1), responses: { selected: [{ id: "o2", label: "No" }] } },
      { parent_id: "zc", item_id: "zb1", type: "media", label: Q.zoneBeforeVideo(1), responses: {}, media: [{ date_created: "2026-11-03T20:10:00Z", file_ext: "mp4", label: "original.mp4", media_id: "v1", captured_at: "2026-11-03T19:50:00Z", location: { lat: -37.8, lng: 145.0 }, file_size: 1000 }] },
      { parent_id: "zc", item_id: "zq1", type: "number", label: Q.zoneAreaM2(1), responses: { number: 120 } },
      { parent_id: "sec", item_id: "md", type: "question", label: Q.multiDay, responses: { selected: [{ id: "o3", label: "No" }] } },
      { parent_id: "md", item_id: "dr", type: "checkbox", label: Q.dailyRecheck, responses: { value: true } },
    ] };
    const r = readInstallEvidence(audit);
    expect(r).toMatchObject({ formZoneCount: 1, multiDay: false, dailyRecheck: true });
    expect(r.zones[0]).toMatchObject({ name: "Area 1 – Main ceiling", underInsulated: false, areaM2: 120 });
    expect(r.zones[0]!.beforeVideo).toEqual([{ mediaId: "v1", capturedAt: "2026-11-03T19:50:00Z", uploadedAt: "2026-11-03T20:10:00Z", lat: -37.8, lng: 145.0, sizeBytes: 1000 }]);
  });
});
