// Decision 178 (Jo 24 Oct 2026): PIESA evidence — switchboard photo, on-site photo (both geotagged), a photo per
// hazard, the CES once fixes are done. Pure rules + a fixture Mitti audit through the real parse/attach path
// + source-level checks that the sync and every completion gate apply the same rule. No network, no database.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  PIESA_EVIDENCE, PIESA_NOT_SYNCED, attachPiesaMedia, mittiMediaFile, piesaEvidenceBlockers, piesaEvidenceBlockersFromSnapshot,
  piesaEvidenceFilesToStore, piesaEvidenceIdForLabel, piesaEvidenceRequirements, piesaHazardsListed, piesaMediaFromAudit, piesaMediaFromSnapshot,
  emptyPiesaEvidenceMedia, type PiesaEvidenceMedia,
} from "../src/lib/piesa-evidence.core";
import { CEILING_PROBLEMS, MAINS_PROBLEMS, RECTIFICATION_OUTCOMES, shortAnswersFromEntries } from "../src/lib/official-short.core";
import { parseAudit, planSync } from "../src/lib/mitti.core";
import { FORMS, validateTemplate } from "../src/lib/mitti-forms.core";
import { PIESA_HOLD, piesaAdvanceDecision } from "../src/lib/piesa-advance.core";
import { a3MediaFiles, A3_MEDIA_IDS } from "../src/lib/piisa-a3.core";

const geo = (id: string, lat = -37.81, lng = 144.96) => ({ media_id: id, location: { lat, lng }, captured_at: "2026-10-24T01:00:00Z", date_created: "2026-10-24T02:00:00Z" });
const flat = (id: string) => ({ media_id: id, date_created: "2026-10-24T02:00:00Z" });
const SB = PIESA_EVIDENCE[0]!.label, ON = PIESA_EVIDENCE[1]!.label, HZ = PIESA_EVIDENCE[2]!.label, CES = PIESA_EVIDENCE[3]!.label;

const clean = { mainsSafe: "Yes", solarPresent: "No", ceilingSafe: "Yes", downlightsPresent: "No", appliancesPresent: "No", rectificationOutcome: RECTIFICATION_OUTCOMES[0] };
const withMedia = (p: Partial<PiesaEvidenceMedia>): PiesaEvidenceMedia => ({ ...emptyPiesaEvidenceMedia(), ...p });

describe("piesaEvidenceRequirements — which items the answers demand", () => {
  test("a clean PIESA needs only the two always-on photos", () => {
    expect(piesaEvidenceRequirements(clean).map((r) => r.id)).toEqual(["switchboard_photo", "onsite_photo"]);
  });
  test("any hazard answered Yes adds one hazard photo per hazard listed", () => {
    const a = { ...clean, mainsSafe: "No", mainsProblems: `${MAINS_PROBLEMS[1]}, ${MAINS_PROBLEMS[5]}`, ceilingSafe: "No", ceilingProblems: CEILING_PROBLEMS[0], appliancesPresent: "Yes", applianceWhat: "Gas flue near the manhole", applianceSafe: "No" };
    const hz = piesaHazardsListed(a);
    expect(hz).toEqual([MAINS_PROBLEMS[1], MAINS_PROBLEMS[5], CEILING_PROBLEMS[0], "Appliance or flue needs work: Gas flue near the manhole"]);
    const req = piesaEvidenceRequirements(a).find((r) => r.id === "hazard_photos");
    expect(req?.count).toBe(4);
    expect(req?.hazards).toEqual(hz);
  });
  test("options containing commas are matched whole, never split", () => {
    const a = { ...clean, solarPresent: "Yes", solarSafe: "No", solarProblems: "The isolator is not accessible, not working, or cannot be switched off safely." };
    expect(piesaHazardsListed(a)).toEqual(["The isolator is not accessible, not working, or cannot be switched off safely."]);
  });
  test("a hazard answered Yes with no ticked detail still needs at least one photo", () => {
    expect(piesaEvidenceRequirements({ ...clean, ceilingSafe: "No" }).find((r) => r.id === "hazard_photos")?.count).toBe(1);
    expect(piesaEvidenceRequirements({ ...clean, downlightsPresent: "Yes", downlightsNonIc: "Yes" }).find((r) => r.id === "hazard_photos")?.hazards).toEqual(["Downlights that are not IC or IC-4 rated"]);
  });
  test("the CES is required only after rectification was done on this form", () => {
    expect(piesaEvidenceRequirements({ ...clean, rectificationOutcome: RECTIFICATION_OUTCOMES[1] }).some((r) => r.id === "ces_file")).toBe(false);
    expect(piesaEvidenceRequirements({ ...clean, rectificationOutcome: RECTIFICATION_OUTCOMES[1], rectificationComplete: "No" }).some((r) => r.id === "ces_file")).toBe(false);
    expect(piesaEvidenceRequirements({ ...clean, rectificationOutcome: RECTIFICATION_OUTCOMES[1], rectificationComplete: "Yes" }).some((r) => r.id === "ces_file")).toBe(true);
    // "not possible" / "no repair" never ask for a CES even if the yes/no is stray
    expect(piesaEvidenceRequirements({ ...clean, rectificationOutcome: RECTIFICATION_OUTCOMES[2], rectificationComplete: "Yes" }).some((r) => r.id === "ces_file")).toBe(false);
  });
});

describe("piesaEvidenceBlockers — plain messages", () => {
  test("nothing attached → both photos missing", () => {
    expect(piesaEvidenceBlockers(clean, emptyPiesaEvidenceMedia())).toEqual(["Switchboard photo missing", "On-site photo missing"]);
  });
  test("attached without a location → must be geotagged; geotagged → clear", () => {
    expect(piesaEvidenceBlockers(clean, withMedia({ switchboard_photo: [mittiMediaFile(flat("m1"))], onsite_photo: [mittiMediaFile(geo("m2"))] }))).toEqual(["Switchboard photo must be geotagged"]);
    expect(piesaEvidenceBlockers(clean, withMedia({ switchboard_photo: [mittiMediaFile(geo("m1"))], onsite_photo: [mittiMediaFile(geo("m2"))] }))).toEqual([]);
  });
  test("a 0,0 or out-of-range location is not a geotag", () => {
    expect(mittiMediaFile(geo("x", 0, 0)).lat).toBeNull();
    expect(mittiMediaFile(geo("x", 95, 10)).lat).toBeNull();
    expect(piesaEvidenceBlockers(clean, withMedia({ switchboard_photo: [mittiMediaFile(geo("m1", 0, 0))], onsite_photo: [mittiMediaFile(geo("m2"))] }))).toEqual(["Switchboard photo must be geotagged"]);
  });
  test("hazard photos: one per hazard, names the hazards still without a photo, all geotagged", () => {
    const a = { ...clean, mainsSafe: "No", mainsProblems: `${MAINS_PROBLEMS[0]}, ${MAINS_PROBLEMS[6]}`, appliancesPresent: "Yes", applianceWhat: "Exhaust fan", applianceSafe: "No" };
    const ok = withMedia({ switchboard_photo: [mittiMediaFile(geo("s"))], onsite_photo: [mittiMediaFile(geo("o"))] });
    expect(piesaEvidenceBlockers(a, ok)).toEqual([`Hazard photo missing for: ${MAINS_PROBLEMS[0]}; ${MAINS_PROBLEMS[6]}; Appliance or flue needs work: Exhaust fan`]);
    expect(piesaEvidenceBlockers(a, { ...ok, hazard_photos: [mittiMediaFile(geo("h1"))] })).toEqual([`Hazard photo missing for: ${MAINS_PROBLEMS[6]}; Appliance or flue needs work: Exhaust fan`]);
    expect(piesaEvidenceBlockers(a, { ...ok, hazard_photos: [mittiMediaFile(geo("h1")), mittiMediaFile(flat("h2")), mittiMediaFile(geo("h3"))] })).toEqual(["Hazard photos must be geotagged (1 without a location)"]);
    expect(piesaEvidenceBlockers(a, { ...ok, hazard_photos: [mittiMediaFile(geo("h1")), mittiMediaFile(geo("h2")), mittiMediaFile(geo("h3"))] })).toEqual([]);
  });
  test("CES: missing only after rectification was done; a PDF with no location is fine", () => {
    const a = { ...clean, rectificationOutcome: RECTIFICATION_OUTCOMES[1], rectificationComplete: "Yes" };
    const ok = withMedia({ switchboard_photo: [mittiMediaFile(geo("s"))], onsite_photo: [mittiMediaFile(geo("o"))] });
    expect(piesaEvidenceBlockers(a, ok)).toEqual(["Certificate of Electrical Safety missing (photo or PDF)"]);
    expect(piesaEvidenceBlockers(a, { ...ok, ces_file: [mittiMediaFile(flat("ces.pdf"))] })).toEqual([]);
    expect(piesaEvidenceBlockers({ ...a, rectificationComplete: "No" }, ok)).toEqual([]);
  });
  test("deterministic: same inputs, same output, in form order", () => {
    const a = { ...clean, ceilingSafe: "No", ceilingProblems: CEILING_PROBLEMS[3], rectificationOutcome: RECTIFICATION_OUTCOMES[1], rectificationComplete: "Yes" };
    const r1 = piesaEvidenceBlockers(a, emptyPiesaEvidenceMedia()), r2 = piesaEvidenceBlockers(a, emptyPiesaEvidenceMedia());
    expect(r1).toEqual(r2);
    expect(r1).toEqual(["Switchboard photo missing", "On-site photo missing", `Hazard photo missing for: ${CEILING_PROBLEMS[3]}`, "Certificate of Electrical Safety missing (photo or PDF)"]);
  });
});

describe("labels: exact spec wording plus the earlier wordings", () => {
  test("q42–q45 and aliases resolve; unrelated labels do not", () => {
    expect(piesaEvidenceIdForLabel(SB)).toBe("switchboard_photo");
    expect(piesaEvidenceIdForLabel("Switchboard cable photo")).toBe("switchboard_photo");
    expect(piesaEvidenceIdForLabel("Photo showing you on site at the property (geotagged)")).toBe("onsite_photo");
    expect(piesaEvidenceIdForLabel("Electrician photo at front of premises with photo ID")).toBe("onsite_photo");
    expect(piesaEvidenceIdForLabel(`${HZ}\nTake one photo per hazard.`)).toBe("hazard_photos"); // Mitti help text after a line break
    expect(piesaEvidenceIdForLabel(CES)).toBe("ces_file");
    expect(piesaEvidenceIdForLabel("Written consent or medical plan (kept as an attachment to this assessment)")).toBeNull();
  });
  test("q43 wording is the decision-178 wording (holding licence / photo ID)", () => {
    expect(ON).toBe("Photo showing you on site at the property, holding your licence / photo ID (geotagged)");
  });
  test("the portal PIESA form definition carries the four evidence items; the template check refuses a form without the three PIESA-visit photos (CES is on the A4 fixes form, decision 298)", () => {
    const labels = FORMS.piesa.fields.filter((f) => f.supplemental).map((f) => f.label);
    expect(labels).toEqual([SB, ON, HZ, CES]);
    const items = FORMS.piesa.fields.filter((f) => !f.supplemental).map((f) => ({ label: f.label, type: f.type === "yesno" ? "question" : f.type === "choice" || f.type === "multichoice" || f.type === "tick" ? "list" : f.type === "date" ? "datetime" : f.type === "text" || f.type === "number" ? "textsingle" : f.type }));
    const without = validateTemplate("piesa", items);
    expect(without.ok).toBe(false);
    expect(without.issues).toEqual(expect.arrayContaining([`Missing: ${SB}`, `Missing: ${ON}`, `Missing: ${HZ}`]));
    expect(without.issues).not.toContain(`Missing: ${CES}`);
    const withOld = validateTemplate("piesa", [...items, { label: "Switchboard cable photo", type: "media" }, { label: "Electrician photo at front of premises with photo ID", type: "media" }, { label: HZ, type: "media" }, { label: CES, type: "media" }]);
    expect(withOld.issues.filter((i) => /Missing: (Photo|Certificate)/.test(i))).toEqual([]);
  });
});

// ---------- fixture audit through the real parse → attach → snapshot → gate path ----------
const Q = (item_id: string, label: string, answer: string | null) => ({ item_id, label, type: "question", responses: answer == null ? {} : { selected: [{ label: answer }] } });
const T = (item_id: string, label: string, text: string) => ({ item_id, label, type: "textsingle", responses: { text } });
const M = (item_id: string, label: string, media: unknown[]) => ({ item_id, label, type: "media", media });
function fixtureAudit(o: { completed: boolean; switchboard?: unknown[]; onsite?: unknown[]; hazards?: unknown[]; ces?: unknown[]; mainsSafe?: string; rectDone?: boolean }) {
  return {
    audit_id: "aud-178", template_id: "template_0123456789abcdef0123456789abcdef", completed: o.completed, modified_at: "2026-10-24T03:00:00Z",
    header_items: [T("h1", "Job Reference ID", "HV-9999"), T("h2", "Address including postcode", "1 Test St, Testville VIC 3000")],
    items: [
      Q("q5", "Is there life support equipment at the property?", "No"),
      Q("q8", "Is the mains power set-up safe? This means the mains cable in the ceiling is identified and marked, the main switch works and can be locked off, the ceiling is confirmed dead when the switch is off, and safety switches (RCDs) are fitted and tested.", o.mainsSafe ?? "Yes"),
      ...(o.mainsSafe === "No" ? [Q("q9", "Please tick each item that is not right.", MAINS_PROBLEMS[0])] : []),
      Q("q10", "Is there solar, a battery or a generator at the property?", "No"),
      Q("q13", "Are the cables, connections and fittings in the ceiling safe to work around and cover with insulation?", "Yes"),
      Q("q15", "Are there any downlights or other recessed lights in the ceiling?", "No"),
      Q("q18", "Are there any appliances, exhaust fans or flues in the ceiling space?", "No"),
      Q("q20", "Is any electrical repair work needed before insulation can be installed?", o.rectDone ? RECTIFICATION_OUTCOMES[1] : RECTIFICATION_OUTCOMES[0]),
      ...(o.rectDone ? [Q("q30", "Have you completed all of the repair work listed above, and is the ceiling now safe for insulation?", "Yes")] : []),
      M("q42", SB, o.switchboard ?? []),
      M("q43", ON, o.onsite ?? []),
      M("q44", HZ, o.hazards ?? []),
      M("q45", CES, o.ces ?? []),
    ],
  };
}
const syncLike = (audit: ReturnType<typeof fixtureAudit>) => {
  // Same steps as mitti.server's PIESA branch: planSync → attachPiesaMedia → shortAnswers → blockers → completed.
  const plan = planSync(audit, { storedAuditId: "aud-178", jobNumber: "HV-9999", assessmentStatus: "in_progress", templateId: "template_0123456789abcdef0123456789abcdef" });
  if (plan.locked) throw new Error("unexpected lock");
  const snapshot = attachPiesaMedia(audit, plan.snapshot);
  const blockers = piesaEvidenceBlockers(shortAnswersFromEntries("piesa", snapshot), piesaMediaFromSnapshot(snapshot));
  return { plan, snapshot, blockers, completed: plan.completed && blockers.length === 0 };
};

describe("sync-level: a Mitti PIESA marked complete is refused until the evidence is on the form", () => {
  test("completed in Mitti, no photos → not completed here; the blockers name what is missing", () => {
    const r = syncLike(fixtureAudit({ completed: true }));
    expect(r.plan.completed).toBe(true);
    expect(r.blockers).toEqual(["Switchboard photo missing", "On-site photo missing"]);
    expect(r.completed).toBe(false);
  });
  test("photos present but the on-site photo has no location → still refused, says geotag", () => {
    const r = syncLike(fixtureAudit({ completed: true, switchboard: [geo("s1")], onsite: [flat("o1")] }));
    expect(r.blockers).toEqual(["On-site photo must be geotagged"]);
    expect(r.completed).toBe(false);
  });
  test("both geotagged photos present → completed", () => {
    const r = syncLike(fixtureAudit({ completed: true, switchboard: [geo("s1")], onsite: [geo("o1")] }));
    expect(r.blockers).toEqual([]);
    expect(r.completed).toBe(true);
  });
  test("a hazard answered on the form needs its photo; rectification done needs the CES", () => {
    const base = { completed: true, switchboard: [geo("s1")], onsite: [geo("o1")] };
    expect(syncLike(fixtureAudit({ ...base, mainsSafe: "No" })).blockers).toEqual([`Hazard photo missing for: ${MAINS_PROBLEMS[0]}`]);
    expect(syncLike(fixtureAudit({ ...base, mainsSafe: "No", hazards: [geo("h1")] })).completed).toBe(true);
    expect(syncLike(fixtureAudit({ ...base, rectDone: true })).blockers).toEqual(["Certificate of Electrical Safety missing (photo or PDF)"]);
    expect(syncLike(fixtureAudit({ ...base, rectDone: true, ces: [flat("ces-1")] })).completed).toBe(true);
  });
  test("an audit still open in Mitti is never completed, with or without evidence", () => {
    expect(syncLike(fixtureAudit({ completed: false, switchboard: [geo("s1")], onsite: [geo("o1")] })).completed).toBe(false);
  });
  test("the stored snapshot (JSON round trip) re-runs the identical rule for the completion gates", () => {
    const r = syncLike(fixtureAudit({ completed: true, switchboard: [geo("s1")], onsite: [flat("o1")] }));
    const stored = JSON.parse(JSON.stringify(r.snapshot));
    expect(piesaEvidenceBlockersFromSnapshot(stored, (e) => shortAnswersFromEntries("piesa", e))).toEqual(["On-site photo must be geotagged"]);
    // The snapshot keeps only what Mitti recorded: media id, capture time, lat/lng, upload time.
    const sb = stored.find((e: { label: string }) => e.label === SB);
    expect(sb.media).toEqual([{ mediaId: "s1", capturedAt: "2026-10-24T01:00:00Z", uploadedAt: "2026-10-24T02:00:00Z", lat: -37.81, lng: 144.96 }]);
    // Non-evidence entries are untouched.
    expect(stored.find((e: { label: string }) => e.label === "Job Reference ID").media).toBeUndefined();
  });
  test("a Mitti PIESA that was never synced fails closed", () => {
    expect(piesaEvidenceBlockersFromSnapshot(null, (e) => shortAnswersFromEntries("piesa", e))).toEqual([PIESA_NOT_SYNCED]);
    expect(piesaEvidenceBlockersFromSnapshot([], (e) => shortAnswersFromEntries("piesa", e))).toEqual([PIESA_NOT_SYNCED]);
  });
  test("files to keep for the AP record: every evidence file with a media id, by item", () => {
    const r = syncLike(fixtureAudit({ completed: true, switchboard: [geo("s1")], onsite: [geo("o1")], ces: [flat("ces-1")] }));
    expect(piesaEvidenceFilesToStore(piesaMediaFromSnapshot(r.snapshot)).map((f) => [f.id, f.file.mediaId])).toEqual([["switchboard_photo", "s1"], ["onsite_photo", "o1"], ["ces_file", "ces-1"]]);
    expect(piesaMediaFromAudit(fixtureAudit({ completed: true, switchboard: [geo("s1")] })).switchboard_photo[0]?.mediaId).toBe("s1");
  });
  test("parseAudit still counts an evidence question with uploads as answered (no change to answer reading)", () => {
    expect(parseAudit(fixtureAudit({ completed: true, switchboard: [geo("s1"), geo("s2")] })).snapshot.find((e) => e.label === SB)?.value).toBe("2 photos");
  });
});

describe("the same media reader serves the PIISA install-day photos", () => {
  test("piisa-a3 reads lat/lng, capture and upload time exactly as before", () => {
    const audit = { items: [{ item_id: A3_MEDIA_IDS.electrician_photo, label: "Electrician photo — onsite today (geotagged)", media: [geo("e1"), flat("e2")] }] };
    expect(a3MediaFiles(audit).electrician_photo).toEqual([
      { mediaId: "e1", capturedAt: "2026-10-24T01:00:00Z", uploadedAt: "2026-10-24T02:00:00Z", lat: -37.81, lng: 144.96 },
      { mediaId: "e2", capturedAt: null, uploadedAt: "2026-10-24T02:00:00Z", lat: null, lng: null },
    ]);
  });
});

describe("completion gates apply the evidence rule", () => {
  test("piesaAdvanceDecision holds on evidence blockers (after the complete check, before the outcome check)", () => {
    const f = { stage: "piesa_scheduled", assessmentStatus: "complete", outcome: "pass", hasCurrentPiesa: true } as const;
    expect(piesaAdvanceDecision({ ...f, evidenceBlockers: ["Switchboard photo missing"] })).toEqual({ action: "hold", reason: PIESA_HOLD.evidence(["Switchboard photo missing"]) });
    expect(piesaAdvanceDecision({ ...f, evidenceBlockers: [] })).toEqual({ action: "advance", outcome: "pass" });
    expect(piesaAdvanceDecision(f)).toEqual({ action: "advance", outcome: "pass" }); // non-Mitti PIESA: no evidence facts, unchanged
    expect(piesaAdvanceDecision({ ...f, assessmentStatus: "in_progress", evidenceBlockers: ["x"] })).toEqual({ action: "hold", reason: PIESA_HOLD.notComplete });
  });
  test("the sync writes mitti_completed from the evidence-gated value and the issues carry the blockers", () => {
    const src = readFileSync("src/lib/mitti.server.ts", "utf8");
    const body = src.slice(src.indexOf("export async function syncMittiAssessment"));
    expect(body).toContain("completed = plan.completed && evidenceBlockers.length === 0");
    expect(body.indexOf("completed = plan.completed && evidenceBlockers.length === 0")).toBeLessThan(body.indexOf("mitti_completed: completed"));
    expect(body).toContain("mitti_completed: completed");
    expect(body).toContain("mitti_raw_snapshot: snapshot as unknown as Json");
    expect(body).toContain("savePiesaEvidenceFiles(jobId, actorId, a.external_mitti_id, snapshot, fetchMedia)");
    expect(src).toContain('kind: "piesa_evidence"');
  });
  test("completeAssessment, stageEntryBlockers(piesa_complete) and advanceAfterPiesa all read the stored snapshot rule", () => {
    const pf = readFileSync("src/lib/portal.functions.ts", "utf8");
    const ca = pf.slice(pf.indexOf("export const completeAssessment"), pf.indexOf("export const recordPiesa"));
    expect(ca).toContain("piesaEvidenceBlockersFromSnapshot(a.mitti_raw_snapshot");
    expect(ca.indexOf("piesaEvidenceBlockersFromSnapshot")).toBeLessThan(ca.indexOf('from("assessments").update({ status: "complete"'));
    const wf = readFileSync("src/lib/workflow.server.ts", "utf8");
    const seb = wf.slice(wf.indexOf("export async function stageEntryBlockers"));
    expect(seb).toContain('if (to === "piesa_complete")');
    expect(seb).toContain("await piesaEvidenceHold(jobId)");
    const rq = readFileSync("src/lib/requirements.server.ts", "utf8");
    expect(rq).toContain(".piesaEvidenceHold(jobId)");
    expect(rq).toContain("evidenceBlockers,\n  });");
    const srv = readFileSync("src/lib/piesa-evidence.server.ts", "utf8");
    expect(srv).toContain("piesaEvidenceBlockersFromSnapshot(a.mitti_raw_snapshot");
    expect(srv).not.toMatch(/fetch\(|realMittiCall|\.update\(|\.insert\(/);
  });
});
