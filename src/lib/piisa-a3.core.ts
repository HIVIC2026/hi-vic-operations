/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
// A3 - PIISA + AP Evidence (native Mitti template template_f6a2597479164eb181453eb335ce5125). Pure rules only.
// Native labels are plain-language aliases OBSERVED in the Mitti editor (Jo, 8 Oct 2026) mapped onto the ACTUAL official
// PIISA item IDs in official-forms.core. The official DOCX wording is never changed. Repeated native labels are resolved
// by OCCURRENCE (form order), never "first match wins". Stable native item IDs below were READ FROM THE RENDERED
// EDITOR DOM of the draft (Jo, 8 Oct 2026 12:57 UTC) — draft-observed until the published API definition agrees;
// any disagreement fails closed (a3MissingFields).
import { excludedAreaName } from "./excluded-areas.core";
import { flatten, norm, type Entry, type NativeMapping } from "./mitti.core";
import { mittiMediaFile, type MittiMediaFile } from "./piesa-evidence.core";
import type { OfficialAnswers } from "./official-forms.core";
import { crewClearance, melbourneToday, whiteCardBlocker, whiteCardState } from "./worker-compliance.core";
import { effectiveWorkerRole } from "./worker-role.core";
import { INSTALL_EVIDENCE_RELABELS, INSTALL_EVIDENCE_RELABELS_LONG, zoneVideoFiles } from "./install-evidence.core";
import { INSTALL_DAY_Q, allWithLabel, installDayMedia, installDayMissingQuestions, installDayOfficialAnswers, isInstallDayDoc, labelledItems, readInstallDay } from "./install-day.core";

import { A3_NATIVE_CREW_LOOKUP, CREW_NOT_LEAD_MESSAGE, crewSelectionProblems, leadWorkerId, savedCrewNeedsRepick, type CrewPick, type CrewSelection, type StaffOption } from "./piisa-crew.core";
export { A3_NATIVE_CREW_LOOKUP, CREW_NOT_LEAD_MESSAGE, crewSelectionProblems, leadWorkerId, savedCrewNeedsRepick };
export type { CrewPick, CrewSelection, StaffOption };

export { PIISA_A3_TEMPLATE_ID } from "./mitti.core";

/** official item id -> exact native label(s) observed in the editor. Rows use the same label once per row. */
export const A3_ALIASES: Record<string, string[]> = {
  jobRef: ["Job number"],
  address: ["Property address"],
  startDate: ["Installation start date"],
  completionDate: ["Expected completion date"],
  "p1.powerInformed": ["Has the household or tenant been told the power will be off during installation?"],
  lifeSupport: ["Does anyone at this property rely on life support?"],
  lifeSupportConsent: ["Have you received written consent or a medical plan before starting this assessment?"],
  lifeSupportAttachment: ["Please upload the written consent or medical plan with every page clearly readable. Unclear or incomplete evidence may be rejected by the Essential Services Commission (ESC).", "Written consent or medical plan (kept as an attachment to this assessment)"],
  "p2.ap": ["Accredited person (AP)"],
  "p2.company": ["Installer company"],
  "p2.lead": ["Lead installer"],
  "p2.addName": ["Additional installer"],
  // Certificate numbers are no longer standalone native questions: known crew choices embed them; "Other" branches
  // carry their own required name + certificate fields (A3_CREW_OTHER_FIELDS). Official p2.leadEec/p2.addEec are
  // derived from the resolved choice, never from a native text box.
  "p3.swms": ["Has the Safe Work Method Statement (SWMS) been completed for this job and all risks identified?", "Has the SWMS been completed for this job and all risks identified?"],
  "p3.table1": ["Have all Table 1 hazards been assessed and controlled in the SWMS?", "Have all Table 1 hazards been considered and controlled in the SWMS?"],
  "p3.isolated": ["Have the main and any alternative power supplies been isolated, locked out and tagged, and the roof cavity confirmed electrically safe to enter?"],
  "p4.present": ["Is there solar, a battery or another power supply, such as a generator?"],
  "p4.instructions": ["Are safe shutdown, isolation and restart instructions available for every alternative power supply?"],
  "p4.isolator": ["Is the ground-level AC/DC isolator accessible, working and safe to isolate?"],
  "p5.reviewed": ["Has the lead installer read the electrical safety assessment (PIESA) and confirmed it is safe to start work?", "Has the lead installer reviewed the PIESA and confirmed the site is safe to start work?"],
  "p5.electricianPresent": ["If the PIESA requires an electrician at the start, has the electrician attended?"],
  "p5.recessed": ["Are there recessed lights in the ceiling?"],
  "p5.count": ["How many recessed lights are there?"],
  "p5.icConfirmed": ["Does the PIESA confirm all ceiling lights are classified and marked IC or IC-4?"],
  "p5.safeToCover": ["Are all recessed lights safe to cover with insulation?"],
  "p5.rcd": ["Does the PIESA confirm all mains cables in the ceiling have RCD protection where required?"],
  "p5.tps": ["Does the PIESA confirm all mains cables in the ceiling are TPS or an equivalent cable type?"],
  "p5.basic": ["Does the PIESA confirm all mains cables in the ceiling meet Basic Protection Requirements?"],
  "p5.noAccess": ["Has the owner or occupier confirmed that nobody has entered or worked in the ceiling since the PIESA?", "Has the owner or occupier confirmed no one has accessed or worked in the ceiling since the PIESA?"],
  "p6.present": ["Is there existing insulation in the ceiling?"],
  "p6.height": ["What is the average depth of the existing insulation (mm)?"],
  "p6.rValue": ["What is the existing insulation R-value, if known?"],
  "p6.treatment": ["Will the existing insulation be removed, topped up, or both?"],
  "p6.suitable": ["Is the existing insulation suitable to lay new insulation over?"],
  "p6.reason": ["Why is the existing insulation being retained?"],
  "p7.products": ["What insulation products are being installed? Include brand, model and R-value."],
  "p8.name": ["Installer full name"],
  "p8.signature": ["Signature"],
  "p8.date": ["Date"],
};

/** official item id -> native item id per ROW (index = row). Draft-observed in the editor DOM; never guessed. */
export const A3_NATIVE_IDS: Record<string, string[]> = {
  jobRef: ["d76e6595-b1b0-4022-ab5d-d73423e6393b"],
  address: ["a9e7dadc-b6ad-45a1-84db-79e4a88b63cd"],
  startDate: ["78e550a4-1c8b-4b59-be77-64a5c09ba848"],
  completionDate: ["84a8b69b-efd5-4830-9da7-66958cbfdb6e"],
  "p1.powerInformed": ["66768b5a-a5d4-491c-829a-096ce58fed8b"],
  lifeSupport: ["3075146f-44dc-411f-a438-dabb289dc539"],
  lifeSupportConsent: ["6bd6569f-bc6d-4019-ba28-68410328bf67"],
  lifeSupportAttachment: ["1c606c49-4c47-41e9-b351-fa15972fbbe9"],
  "p2.ap": ["b7212b10-067a-4fd8-8f6a-90efd2db8389"],
  "p2.company": ["dc12088c-8316-461e-91e2-53b1db0dc558"],
  "p2.lead": ["e377bcdb-0ba0-46d3-82f6-5d84519b55c4"],
  "p2.addName": ["4bea475f-516e-46a2-8922-e85896c68402", "726f9e46-8308-449e-822f-2280cd7affa7", "c0c2178e-e872-4c70-a260-78aecde3d01e"],
  "p3.swms": ["1be8ebff-a754-4a2a-83f0-9561708ffb85"],
  "p3.table1": ["ac43a81a-7576-4b2e-885c-389585fbded5"],
  "p3.isolated": ["d2bb79c9-6307-4283-950b-c808315d1998"],
  "p4.present": ["7a6f8dd0-9aae-472d-83a2-6f63f0c51b77"],
  "p4.instructions": ["d4298abc-7302-4555-a15b-ef4dc83e75e3"],
  "p4.isolator": ["e840fc02-6eea-415f-94dd-e5a5073845e5"],
  "p5.reviewed": ["1c9258de-d3a0-4dd4-a372-388bf725b2af"],
  "p5.electricianPresent": ["dc75c06c-662e-4c16-9f74-b2f0816cccbd"],
  "p5.recessed": ["d0369395-a471-4c27-a8b8-809c406206a9"],
  "p5.count": ["72eae2fe-ae1a-42e7-ac3f-e2c8a59a9a3f"],
  "p5.icConfirmed": ["0f7e9415-4649-4e8b-8519-6a31f4f18fea"],
  "p5.safeToCover": ["2d8bd875-09a8-4c8c-a3a7-f83b21231415"],
  "p5.rcd": ["7b0fee21-26b7-47dc-aa33-79d3224dd22e"],
  "p5.tps": ["930883db-4608-4cff-8955-7b48e2b42149"],
  "p5.basic": ["e38b971b-9088-4dfa-b127-ace3ed7e4213"],
  "p5.noAccess": ["ad9e1f51-6957-44cc-aaa1-1c41306b6f24"],
  "p6.present": ["f03e5612-b32b-4b4c-9784-27ee05b620d1"],
  "p6.height": ["14ea4360-9c22-45b8-ac90-768704ecdc07"],
  "p6.rValue": ["b3105b42-8545-432e-80cf-31f95a6a6174"],
  "p6.treatment": ["8dadd5c5-e8d7-431e-b65a-a5dc4d174864"],
  "p6.reason": ["01ccb26c-acea-488e-add5-da9d6169979f"],
  "p6.suitable": ["99f56c12-846d-4bac-bf89-d095e2cf16fe"],
  "p7.products": ["5426daa7-060d-43ac-b180-e698e27eac98"],
  "p8.declaration": ["3efc235d-da8e-46a5-b3f0-8c6a8c23e3e9"],
  "p8.signature": ["805138fa-827e-4e25-8ca5-3871eeda1202"],
  "p8.name": ["f7032d72-4135-4165-bd50-32d84a66d085"],
  "p8.date": ["cda99bb8-8865-46a1-928a-2267175a1e2a"],
};
/** A5 evidence media items -> native item id. All seven READ FROM THE EDITOR DOM (electrician photo: Jo, 8 Oct 2026). */
export const A3_MEDIA_IDS: Record<A3EvidenceKey, string> = {
  installer_photos: "06598474-e46a-4bba-8c9d-d1be2c9993e1",
  electrician_photo: "1b6461ce-2181-4c4e-b7e8-d53a5e093e75", // "Electrician photo — onsite today (geotagged)", branch attendance = Yes
  isolation_photo: "3d8347ae-ed16-4e93-be18-4ecada390a7a",
  before_video: "49c8ef21-dd6a-41e0-a4ae-acb0c53e7ada",
  product_photos: "0a587e0e-9787-464e-be40-7cdd2c636b87",
  completed_video: "86b3772c-6227-4b6f-8011-b7ed288e734e",
  final_plan: "344e863b-3af3-44f5-b1b8-966941f0e667",
};
/** Native media labels as observed (verification only; the stable ID owns the mapping). */
export const A3_MEDIA_LABELS: Partial<Record<A3EvidenceKey, string>> = { electrician_photo: "Electrician photo — onsite today (geotagged)" };
/** Recorded prior labels plus Jo's approved full instructions; never accept an arbitrary relabel on a stable ID. */
const A3_PREVIOUS_MEDIA_LABELS: Record<A3EvidenceKey, string> = {
  installer_photos: "Installer photos — every installer onsite today (geotagged)",
  electrician_photo: "Electrician photo — onsite today (geotagged)",
  isolation_photo: "Power isolation photo — isolated, locked out and tagged before work (geotagged)",
  before_video: "Before-work video — all ceiling areas and existing insulation",
  product_photos: "Installed product photos — brand, model and R-value (geotagged)",
  completed_video: "Completed-work video — coverage, depth and all waste removed",
  final_plan: "Final installation plan — actual installed area (m²) and products",
};
export function a3AcceptedMediaLabels(key: A3EvidenceKey): string[] {
  const long = (INSTALL_EVIDENCE_RELABELS_LONG as Partial<Record<A3EvidenceKey, string>>)[key];
  return [A3_PREVIOUS_MEDIA_LABELS[key], A3_INSTRUCTION_LABELS_2026_10_09[key], A3_EVIDENCE_LABELS[key], ...(long ? [long] : []), ...(A3_MEDIA_LABELS[key] ? [A3_MEDIA_LABELS[key]] : [])].map(norm);
}

/** CONTROLLED label suffixes added in the editor on the SAME stable IDs (Jo, 8 Oct 2026). Only these exact additions pass. */
export const A3_ALIAS_SUFFIXES: Record<string, string[]> = {
  "p5.electricianPresent": ["Choose N/A only when attendance is not required by the PIESA or solar shutdown instructions."],
  "p4.instructions": ["If No, an electrician must isolate the supply, lock out, tag and confirm electrical safety before work starts."],
  "p4.isolator": ["If No, get electrical review before proceeding."],
  "p6.treatment": ["Foil-backed or electrically conductive insulation must be removed."],
  "p6.suitable": ["If No, remove it before laying new insulation."],
};
/** Exact accepted native labels for an official item: base alias, or base alias + one controlled suffix. */
export function a3AcceptedLabels(id: string): string[] {
  const base = A3_ALIASES[id] ?? [];
  return base.flatMap((a) => [norm(a), ...(A3_ALIAS_SUFFIXES[id] ?? []).map((x) => norm(`${a} ${x}`))]);
}

/** Official items the PUBLISHED native form (read 8 Oct 2026) no longer asks separately. Official Part 2 "Installation
 * date" is the same fact as the native "Installation start date", so it is copied from that answer, never asked twice. */
export const A3_NOT_ON_NATIVE = ["p2.installDate"] as const;

// ---------- native crew schema (saved + read from the rendered editor, Jo 8 Oct 2026 14:22 UTC) ----------
/** Retired standalone certificate items. Must NOT be required or written. */
export const A3_RETIRED_CREW_CERT_IDS = ["647221f2-f74c-4da1-a8be-e44a20f0b08b", "24e41e61-a490-4bdc-bd34-002fb6ae1089", "65d9d9d5-b87e-4d81-b92a-fa877e5a4f98", "3681131a-dee1-429a-ba34-6e066ef07152"] as const;
/** The four crew name items are SINGLE CHOICE on this response set. Options are read from the template at runtime. */
export const A3_DIRECT_SIGNATURE_ID = "83caffa2-e9c8-4315-885f-5337a4389372";
export const A3_CREW_RESPONSE_SET = "4fe1175e-502f-428d-8bd8-28c07f46eb2d";
export const A3_CREW_OTHER_OPTION = "8e9ba585-c0da-416a-90ab-d3cb09029b32";
/** Crew row 0 = lead, 1..3 = additional installer rows. */
export const A3_CREW_NAME_IDS = ["e377bcdb-0ba0-46d3-82f6-5d84519b55c4", "4bea475f-516e-46a2-8922-e85896c68402", "726f9e46-8308-449e-822f-2280cd7affa7", "c0c2178e-e872-4c70-a260-78aecde3d01e"] as const;
/** Required "Other" branch fields per row: Full legal name / EEC certification number. */
export const A3_CREW_OTHER_FIELDS: { name: string; eec: string }[] = [
  { name: "9e1a8b94-d3fc-492e-bb33-57b6bd4e85a8", eec: "6fea5874-992b-476b-8f09-839abaa2d049" },
  { name: "4ac27cb9-e588-4666-b5df-3e2172b60358", eec: "b8daad98-4a63-480d-85a7-c0fb670b34c3" },
  { name: "824af4ab-d764-403a-80eb-05b55f86d600", eec: "d986b4c1-1d3d-414c-9a14-8be9c000fa26" },
  { name: "1bc12288-7517-4d43-a1b3-c2235ae250dc", eec: "90609251-f347-407f-982f-1796e59db496" },
];

/** NativeMapping for buildOfficialPrefill: per-row stable IDs; labels kept only for verification. */
export const PIISA_A3_MAPPING: NativeMapping = Object.fromEntries(Object.keys(A3_NATIVE_IDS).filter((k) => k !== "p2.lead" && k !== "p2.addName").map((k) => [k, { itemIds: A3_NATIVE_IDS[k]!, labels: A3_ALIASES[k] ?? [], byRow: true }]));
const ROWS = (id: string) => A3_NATIVE_IDS[id]?.length ?? 1;

/** Native occurrence of an official item: EEC rows share one label with the lead's EEC field. */
export function a3Occurrence(itemId: string, row = 0): number {
  if (itemId === "p2.addName") return row;
  return 0;
}

/** Entry for an official item at its native occurrence (form order). Missing = undefined, never a neighbour's field. */
export function a3Entry(entries: Entry[], itemId: string, row = 0): Entry | undefined {
  const nid = A3_NATIVE_IDS[itemId]?.[row];
  if (nid) return entries.find((e) => String(e.id) === nid);
  const labels = a3AcceptedLabels(itemId);
  if (!labels.length) return undefined;
  return entries.filter((e) => labels.includes(e.norm))[a3Occurrence(itemId, row)];
}

/** Every mapped field must exist on the native template, including all three crew rows. Visible failure list. */
export function a3MissingFields(template: unknown): string[] {
  // Decision 262: the "A5 – Install day" template is read by wording (install-day.core), not by the old stable IDs.
  if (isInstallDayDoc(template)) return installDayMissingQuestions(template);
  const entries = flatten(template);
  const out: string[] = [];
  const ids = new Set([...Object.keys(A3_NATIVE_IDS), ...Object.keys(A3_ALIASES)]);
  for (const id of ids) {
    const rows = ROWS(id);
    for (let r = 0; r < rows; r++) {
      const name = `${A3_ALIASES[id]?.[0] ?? id}${rows > 1 ? ` (row ${r + 1})` : ""}`;
      const e = a3Entry(entries, id, r);
      if (!e) { out.push(name); continue; }
      // Definition must agree with the observed draft: a known ID carrying a different question is a mismatch.
      const al = A3_ALIASES[id];
      // Stable IDs own the mapping; only the exact alias or exact alias + controlled suffix passes. Anything else fails closed.
      if (al?.length && !a3AcceptedLabels(id).includes(e.norm)) out.push(`${name} — ID ${e.id} now reads "${e.label}"`);
    }
  }
  out.push(...a3CrewSchemaProblems(template));
  for (const [k, nid] of Object.entries(A3_MEDIA_IDS)) {
    const e = entries.find((x) => String(x.id) === nid);
    // Decision 211: the final roof-space plan upload is retired (the portal draws the diagram); its absence is fine.
    // Fix prompt (24 Oct 2026): the whole-job before / completed videos are deleted — each zone's own before / after
    // video in "Zones and evidence" stands in (A3_ZONE_VIDEO_KEYS), so their absence is fine too.
    if (!e && (k === "final_plan" || A3_ZONE_VIDEO_KEYS.includes(k as A3EvidenceKey))) continue;
    if (!e) out.push(`${A3_EVIDENCE_LABELS[k as A3EvidenceKey]} (media)`);
    else if (!a3AcceptedMediaLabels(k as A3EvidenceKey).includes(e.norm)) out.push(`${A3_EVIDENCE_LABELS[k as A3EvidenceKey]} (media) — ID ${nid} now reads "${e.label}"`);
  }
  return out;
}

/** One media file on the audit with ONLY the metadata Mitti actually returned. Unknown stays null (never faked). */
/** capturedAt = a real capture time only. Mitti's `date_created` is when the file reached Mitti (upload), so it is kept
 * separately as uploadedAt and never treated as the time the photo was taken. */
export type A3MediaFile = MittiMediaFile;
/** Shared with the PIESA evidence rules (piesa-evidence.core.ts): one media shape, one geotag check. */
function mediaFile(m: Any): A3MediaFile { return mittiMediaFile(m); }
function itemsById(audit: unknown): Map<string, Any> {
  const byId = new Map<string, Any>();
  const walk = (x: unknown) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === "object") { const o = x as Any; const id = o.item_id ?? o.id; if (id != null && "label" in o) byId.set(String(id), o); for (const v of Object.values(o)) if (typeof v === "object") walk(v); } };
  walk(audit);
  return byId;
}
/** Fix prompt (24 Oct 2026): A5 keys the per-zone videos now satisfy (whole-job items deleted from the form). */
export const A3_ZONE_VIDEO_KEYS: A3EvidenceKey[] = ["before_video", "completed_video"];
/**
 * Every A5 media item on an audit (in-progress or completed) with per-file metadata. before_video / completed_video
 * = the old whole-job video (older forms) PLUS every zone's before / after 360° video when EVERY zone the form counts
 * has one (zoneVideoFiles); a partly filmed set adds nothing, so the item stays missing. The before-work timing rule
 * and the after-work copy (piisa-postwork) therefore apply to the zone videos too.
 */
export function a3MediaFiles(audit: unknown): Record<A3EvidenceKey, A3MediaFile[]> {
  if (isInstallDayDoc(audit)) {
    // Decision 262: the photo items by wording; the before / completed videos are the areas' own videos.
    const m = installDayMedia(audit), zones = zoneVideoFiles(audit);
    return { installer_photos: m.installer_photos, electrician_photo: m.electrician_photo, isolation_photo: m.isolation_photo, product_photos: m.product_photos, before_video: zones.before ?? [], completed_video: zones.after ?? [], final_plan: [] };
  }
  const byId = itemsById(audit);
  const zones = zoneVideoFiles(audit);
  const zoneFor: Partial<Record<A3EvidenceKey, A3MediaFile[] | null>> = { before_video: zones.before, completed_video: zones.after };
  return Object.fromEntries((Object.entries(A3_MEDIA_IDS) as [A3EvidenceKey, string][]).map(([key, nid]) => {
    const o = byId.get(nid); const media = o?.media ?? o?.responses?.media ?? o?.responses?.attachments ?? [];
    const own = Array.isArray(media) ? media.map(mediaFile) : [];
    return [key, [...own, ...(zoneFor[key] ?? [])]];
  })) as Record<A3EvidenceKey, A3MediaFile[]>;
}
/** Files -> A3Media summary. Geotagged/timestamped only when actually recorded; anything missing is counted for review. */
export function a3MediaSummary(files: Record<A3EvidenceKey, A3MediaFile[]>): A3Media[] {
  return (Object.keys(A3_MEDIA_IDS) as A3EvidenceKey[]).map((key) => {
    const fs = files[key] ?? [];
    const times = fs.map((f) => f.capturedAt).filter((t): t is string => !!t).sort();
    return { key, count: fs.length, geotagged: fs.filter((f) => f.lat != null).length, timed: times.length, capturedAt: times.length ? times[times.length - 1]! : null };
  });
}
/** Back-compatible counts. */
export function a3MediaCounts(audit: unknown): { key: A3EvidenceKey; count: number }[] {
  return a3MediaSummary(a3MediaFiles(audit)).map(({ key, count }) => ({ key, count }));
}

/** "Removed" / "Topped up" / "Both" (or a multi-select) -> the official ticks. Unknown text = null (never guessed). */
export function mergeTreatment(v: string | null): ("Removed" | "Topped Up")[] | null {
  if (v == null) return null;
  const n = norm(v);
  const removed = /\bremov/.test(n) || /\bboth\b/.test(n);
  const topped = /\btop/.test(n) || /\bboth\b/.test(n);
  if (!removed && !topped) return null;
  return [...(removed ? ["Removed" as const] : []), ...(topped ? ["Topped Up" as const] : [])];
}

const yn = (v: string | null) => { if (v == null) return null; const n = norm(v); return /^yes\b/.test(n) ? "Yes" : /^no\b/.test(n) ? "No" : /^n a\b|^na\b/.test(n) ? "N/A" : null; };
const YN_IDS = new Set(["p1.powerInformed", "lifeSupport", "p3.swms", "p3.table1", "p3.isolated", "p4.present", "p4.instructions", "p4.isolator", "p5.reviewed", "p5.electricianPresent", "p5.recessed", "p5.icConfirmed", "p5.safeToCover", "p5.rcd", "p5.tps", "p5.basic", "p5.noAccess", "p6.present", "p6.suitable"]);

/** Completed native audit -> official PIISA answers (keyed by official IDs). Only answered fields are returned. */
export function parseA3Answers(audit: unknown): { answers: OfficialAnswers; crew: { name: string; eec: string | null }[] } {
  if (isInstallDayDoc(audit)) {
    // Decision 262: every asked answer mapped to its official item (install-day.core); Part 5 lights / cables come from
    // the stored PIESA (piesaPart5Answers), never from this form. Crew rows as typed (resolved against verified staff later).
    const r = installDayOfficialAnswers(audit);
    const crew = r.crew.slice(1).filter((c): c is { name: string | null; cii: string | null } => !!c?.name).map((c) => ({ name: c.name!, eec: c.cii }));
    return { answers: r.answers as OfficialAnswers, crew };
  }
  const entries = flatten(audit);
  const answers: OfficialAnswers = {};
  for (const id of Object.keys(A3_ALIASES)) {
    if (id === "p2.lead" || id === "p2.addName" || id === "p8.signature") continue;
    if (id === "p8.declaration") continue;
    const v = a3Entry(entries, id)?.value ?? null;
    if (v == null) continue;
    if (id === "p6.treatment") { const t = mergeTreatment(v); if (t) answers[id] = t; continue; }
    if (YN_IDS.has(id)) { const y = yn(v); if (y) answers[id] = y; continue; }
    answers[id] = v;
  }
  if (answers["startDate"] != null && answers["p2.installDate"] == null) answers["p2.installDate"] = answers["startDate"];
  // Additional rows as typed/selected (unresolved; a3ResolveCrewChoices decides what the official form may hold).
  const crew: { name: string; eec: string | null }[] = [];
  for (const c of a3CrewChoices(audit).slice(1)) {
    if (c.kind === "other" && c.name) crew.push({ name: c.name, eec: c.eec });
    else if (c.kind === "option" && c.optionLabel) crew.push({ name: c.optionLabel, eec: null });
  }
  return { answers, crew };
}

/** The installer's signature must carry its OWN timestamp. The audit's modified/completed time is never used. */
export function a3Signature(audit: unknown): { name: string | null; signedAt: string | null; present: boolean; mediaId: string | null; itemId: string | null } {
  if (isInstallDayDoc(audit)) {
    // Decision 262: the before-work "Lead installer's signature" (the FIRST of the two) is the official Part 8 signature.
    const sig = readInstallDay(audit).declarationSignature;
    return { ...sig, itemId: allWithLabel(labelledItems(audit), INSTALL_DAY_Q.signature)[0]?.id ?? null };
  }
  const root = (audit as { template?: unknown })?.template ?? audit;
  const all: Any[] = [];
  const walk = (x: unknown) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === "object") { const o = x as Any; if ("label" in o) all.push(o); for (const v of Object.values(o)) if (typeof v === "object") walk(v); } };
  walk([(root as Any)?.header_items, (root as Any)?.items]);
  // Audit-owned IDs only: a blank restored signature never falls back to historical media.
  const signatureId = all.some((o) => String(o.item_id ?? o.id) === A3_DIRECT_SIGNATURE_ID)
    ? A3_DIRECT_SIGNATURE_ID : A3_NATIVE_IDS["p8.signature"]?.[0];
  const sig = all.find((o) => String(o.item_id ?? o.id) === signatureId);
  const r = (sig?.responses ?? {}) as Any;
  // A real signature is an IMAGE reference. Plain text (e.g. a literal "signature-image-ref" or a typed name) is not one.
  const m = r.image ?? r.media ?? r.media_id ?? r.signature;
  const pick = (x: Any): string | null => typeof x === "string" ? (/^[0-9a-f-]{16,}$/i.test(x.trim()) || /^https:\/\//.test(x.trim()) ? x.trim() : null) : x && typeof x === "object" ? pick(Array.isArray(x) ? x[0] : (x.media_id ?? x.id ?? x.href)) : null;
  const mediaId = pick(m);
  const present = !!mediaId;
  const captured = m && typeof m === "object" && !Array.isArray(m) ? m : {};
  const ts = [r.timestamp, r.signed_at, r.datetime, captured.timestamp, captured.signed_at, captured.metadata?.signed_at].find((t) => typeof t === "string" && !Number.isNaN(Date.parse(t))) as string | undefined;
  const name = r.name ?? captured.name ?? captured.metadata?.signer_name;
  return { name: typeof name === "string" && name.trim() ? name.trim() : null, signedAt: ts ?? null, present, mediaId, itemId: sig ? String(sig.item_id ?? sig.id) : null };
}

/** Personal attribution comes from captured signature metadata, never the business account or an inferred typed name. */
export function directLeadSignatureProblem(audit: unknown, leadName: string | null): string | null {
  const sig = a3Signature(audit);
  if (!sig.present || !sig.signedAt) return "The lead installer's actual signature image and capture timestamp are required.";
  if (!leadName || !sig.name || norm(sig.name) !== norm(leadName)) return "The captured signature must identify the lead installer personally; signing on behalf is not accepted. Office must verify missing signer attribution.";
  const item = itemsById(audit).get(sig.itemId ?? "");
  const response = item?.responses;
  if ([response, response?.signature, response?.image, response?.media].some((v) => v && typeof v === "object" && (v.on_behalf === true || v.signed_on_behalf === true || v.metadata?.on_behalf === true))) return "The lead installer must sign personally, not on behalf of someone else.";
  return null;
}

/** Explicit linked signature attachment for the signed official DOCX (the Word form keeps its blank signature line). */
export type SignatureAttachment = { source: "mitti_signature"; audit_id: string; item_id: string | null; media_id: string; signer_name: string | null; signed_at: string; docx_path: string; docx_sha256: string };
export function signatureAttachment(auditId: string, sig: ReturnType<typeof a3Signature>, docx: { path: string; sha256: string }): SignatureAttachment | null {
  if (!sig.present || !sig.mediaId || !sig.signedAt || Number.isNaN(Date.parse(sig.signedAt))) return null;
  return { source: "mitti_signature", audit_id: auditId, item_id: sig.itemId, media_id: sig.mediaId, signer_name: sig.name, signed_at: sig.signedAt, docx_path: docx.path, docx_sha256: docx.sha256 };
}

// ---------- Ready Check -> Part 6 prefill (multi-area aware) ----------
export type RcArea = {
  name?: string | null; present?: boolean | null; depthMm?: number | null; rValue?: number | null; downlights?: number | null; removal?: boolean | null;
  /** Decision 375: the area's measured m² (weights the Part 6 average depth when areas differ). */
  areaM2?: number | null;
  /** Decision 359 (Ready Check, per area with existing insulation): suitable to lay over / foil-metallic-conductive / photo ref / reason kept. */
  suitable?: boolean | null; conductive?: boolean | null; conductiveEvidence?: string | null; keepReason?: string | null;
};
/** Strict yes/no: real booleans, or exact Yes/No text. "No", "false", "" and anything else never become true. */
export const strictPresent = (v: unknown): boolean | null => typeof v === "boolean" ? v : typeof v === "string" ? (/^\s*(yes|true)\s*$/i.test(v) ? true : /^\s*(no|false)\s*$/i.test(v) ? false : null) : null;
/**
 * Areas from the CANONICAL persisted Ready Check record. Mitti syncs store raw_snapshot as a flat entry list
 * (id/label/section/value) and the canonical parser's per-room results are written to the row columns, so the row
 * columns are the source. Structured per-area zones are used only when present as objects; only they carry the
 * existing-insulation depth and m² (decision 375), the row columns never do -> null. Removal/top-up only when actually recorded; never inferred from absence.
 */
export function rcAreasFromRecord(m: { insulation_present: unknown; existing_r_value: unknown; removal_required?: unknown; zones?: unknown } | null, downlightsQty: number | null): RcArea[] {
  if (!m) return [];
  const n = (v: unknown) => { const x = v == null || v === "" ? NaN : Number(v); return Number.isFinite(x) ? x : null; };
  const zones = Array.isArray(m.zones) ? (m.zones as Any[]).filter((z) => z && typeof z === "object" && !Array.isArray(z)) : [];
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  // Decision 359: the Part 6 facts ride on the same zone record (absent on older forms → null, i.e. not recorded).
  if (zones.length) return zones.map((a) => ({ name: typeof a.name === "string" ? a.name : null, present: strictPresent(a.present ?? a.insulation_present), depthMm: n(a.depth_mm ?? a.depthMm), areaM2: n(a.areaM2 ?? a.area_m2), rValue: n(a.r_value ?? a.rValue ?? a.existing_r_value), downlights: n(a.downlights), removal: strictPresent(a.removal_required ?? a.removal), suitable: strictPresent(a.suitable), conductive: strictPresent(a.conductive), conductiveEvidence: str(a.conductiveEvidence), keepReason: str(a.keepReason) }));
  return [{ present: strictPresent(m.insulation_present), depthMm: null, rValue: n(m.existing_r_value), downlights: downlightsQty, removal: strictPresent(m.removal_required) }];
}

/**
 * Part 6/5 facts from the SAME job's completed Ready Check. A single shared value is prefilled; areas that disagree are
 * left blank with a note (one official field cannot hold several areas). Counts are summed (additive). Never inferred.
 */
export function readyCheckPartPrefill(areas: RcArea[]): { values: Record<string, string>; notes: string[] } {
  const values: Record<string, string> = {}, notes: string[] = [];
  if (!areas.length) return { values, notes };
  const pres = areas.map((a) => a.present).filter((x): x is boolean => x != null);
  if (pres.length === areas.length) values["p6.present"] = pres.some(Boolean) ? "Yes" : "No";
  const one = (key: "depthMm" | "rValue", id: string, label: string) => {
    const xs = areas.filter((a) => a.present !== false).map((a) => a[key]).filter((x): x is number => x != null && Number.isFinite(x));
    const distinct = [...new Set(xs)];
    if (distinct.length === 1 && xs.length === areas.filter((a) => a.present !== false).length) values[id] = String(distinct[0]);
    else if (distinct.length > 1) notes.push(`${label} differs between ceiling areas (${distinct.join(", ")}) — the installer must enter it.`);
  };
  one("depthMm", "p6.height", "Existing insulation depth");
  // Removal / top-up only where existing insulation is present AND removal was actually recorded for every such area.
  const withIns = areas.filter((a) => a.present === true);
  if (withIns.length && withIns.every((a) => a.removal != null)) {
    const rem = withIns.some((a) => a.removal === true), top = withIns.some((a) => a.removal === false);
    values["p6.treatment"] = rem && top ? "Removed, Topped up" : rem ? "Removed" : "Topped up"; // multi-select seed merged to one response
  }
  one("rValue", "p6.rValue", "Existing insulation R-value");
  const dl = areas.map((a) => a.downlights);
  if (dl.every((x) => x != null && Number.isFinite(x))) { const sum = (dl as number[]).reduce((a, b) => a + b, 0); values["p5.recessed"] = sum > 0 ? "Yes" : "No"; if (sum > 0) values["p5.count"] = String(sum); }
  return { values, notes };
}

/**
 * Decision 262: official PIISA Part 6 (existing insulation) filled by the portal from the job's Ready Check record — the
 * install day form no longer asks it. Decision 359: condition (suitable to lay over), reason kept, foil/metallic/conductive
 * and its photo come from each area's Ready Check answers (`RcArea`); `extra` (when non-null) overrides them. Decision 360:
 * when every area with existing insulation is Removed, Part 6 is filled by the portal (suitable = No, no reason, the foil
 * note satisfied by removal). Decision 375: p6.height = the areas' recorded depth (m²-weighted average when they differ). Every fact the record does not establish is listed in `missing` (a pre-start blocker), never guessed.
 */
export type Part6Extra = { suitable: boolean | null; conductive: boolean | null; reason: string | null; conductiveEvidence?: string | null };
export type Part6Result = {
  answers: Record<string, string | string[]>; missing: string[];
  /** Portal conductivity record (supp.conductive); null = not recorded (never needed on a full removal). */
  conductive: boolean | null;
  /** Portal conductivity photo reference (supp.conductiveEvidence), null when none. */
  conductiveEvidence: string | null;
  /** Decision 360: every area with existing insulation is removed (the foil note is satisfied by removal). */
  fullRemoval: boolean;
};
const NO_EXTRA: Part6Extra = { suitable: null, conductive: null, reason: null };
/** Decision 375: average existing insulation depth weighted by each area's m², rounded to the nearest mm. */
export function weightedDepthMm(areas: { depthMm: number; areaM2: number }[]): number {
  const m2 = areas.reduce((s, a) => s + a.areaM2, 0);
  return Math.round(areas.reduce((s, a) => s + a.depthMm * a.areaM2, 0) / m2);
}
export function readyCheckPart6Answers(areas: RcArea[], extra: Part6Extra = NO_EXTRA): Part6Result {
  const answers: Record<string, string | string[]> = {}, missing: string[] = [];
  const none = { conductive: null, conductiveEvidence: null, fullRemoval: false };
  if (!areas.length) return { answers, missing: ["Ready Check: no current measure-up on this job — existing insulation (official Part 6) can't be filled in"], ...none };
  // Garage / carport / shed areas are not part of the claim, so they never decide "present" either.
  const claimAreas = areas.filter((a) => !excludedAreaName(a.name ?? ""));
  if (!claimAreas.length) return { answers, missing: ["Ready Check: no eligible ceiling area (only a garage, carport or shed) — existing insulation (official Part 6) can't be filled in"], ...none };
  const pres = claimAreas.map((a) => a.present);
  if (pres.some((x) => x == null)) { missing.push("Ready Check: existing insulation present or not is not recorded for every area"); return { answers, missing, ...none }; }
  const present = pres.some(Boolean);
  answers["p6.present"] = present ? "Yes" : "No";
  if (!present) return { answers, missing, ...none };
  // Garage / carport / shed areas are not part of the claim (Jo 30 Oct 2026).
  const withIns = claimAreas.filter((a) => a.present === true);
  // Decision 375 (Jo 25 Oct 2026): the official form asks the average height whenever insulation is present (removal
  // included); the Ready Check asks the depth per area with existing insulation. One shared depth is used as is; differing
  // depths become ONE average weighted by each area's m² (nearest mm). A missing depth, or a missing m² when weighting is
  // needed, names the area — never guessed.
  const okNum = (x: number | null | undefined): x is number => x != null && Number.isFinite(x);
  const areaName = (a: RcArea) => a.name?.trim() || `Area ${areas.indexOf(a) + 1}`;
  const whichAreas = (xs: RcArea[]) => (withIns.length > 1 ? ` (${xs.map(areaName).join(", ")})` : "");
  const noDepth = withIns.filter((a) => !okNum(a.depthMm));
  const depths = [...new Set(withIns.map((a) => a.depthMm).filter(okNum))];
  if (noDepth.length) missing.push(`Ready Check: existing insulation depth (mm) not recorded${whichAreas(noDepth)}`);
  else if (depths.length === 1) answers["p6.height"] = String(depths[0]);
  else {
    const noM2 = withIns.filter((a) => !okNum(a.areaM2) || a.areaM2 <= 0);
    if (noM2.length) missing.push(`Ready Check: ceiling area (m²) not recorded, so the average existing insulation depth can't be worked out${whichAreas(noM2)}`);
    else answers["p6.height"] = String(weightedDepthMm(withIns as { depthMm: number; areaM2: number }[]));
  }
  const rs = [...new Set(withIns.map((a) => a.rValue).filter((x): x is number => x != null && Number.isFinite(x)))];
  if (rs.length === 1) answers["p6.rValue"] = String(rs[0]);
  if (!withIns.every((a) => a.removal != null)) {
    missing.push("Ready Check: removal or top-up not recorded for every area with existing insulation");
    // Without the treatment the Part 6 facts can't be scoped; the recorded answers still show what is missing.
    if (extra.suitable != null) answers["p6.suitable"] = extra.suitable ? "Yes" : "No"; else missing.push("Ready Check: condition of the existing insulation (suitable to lay over) not recorded");
    if (extra.conductive == null) missing.push("Ready Check: whether the existing insulation is foil, metallic or conductive is not recorded");
    return { answers, missing, conductive: extra.conductive, conductiveEvidence: extra.conductiveEvidence ?? null, fullRemoval: false };
  }
  const topUp = withIns.filter((a) => a.removal === false);
  const rem = withIns.some((a) => a.removal === true);
  answers["p6.treatment"] = [...(rem ? ["Removed"] : []), ...(topUp.length ? ["Topped Up"] : [])];
  // Decision 360: every area with existing insulation is removed → the portal fills Part 6 itself: not laid over
  // (suitable = No, as official-expand already does), the foil/conductive note is satisfied by removal, no reason needed.
  if (!topUp.length) {
    answers["p6.suitable"] = "No";
    const recorded = withIns.map((a) => a.conductive).filter((x): x is boolean => x != null);
    const conductive = extra.conductive ?? (recorded.length === withIns.length ? recorded.some(Boolean) : null);
    return { answers, missing, conductive, conductiveEvidence: extra.conductiveEvidence ?? withIns.map((a) => a.conductiveEvidence).find((x) => !!x) ?? null, fullRemoval: true };
  }
  // Decision 359: top-up areas carry their own answers from the Ready Check (one official field → combined across areas).
  const named = topUp.map((a) => ({ a, n: a.name?.trim() || `Area ${areas.indexOf(a) + 1}` }));
  const gap = (xs: { n: string }[]) => (topUp.length > 1 ? ` (${xs.map((x) => x.n).join(", ")})` : "");
  // Reason the existing insulation is kept.
  if (extra.reason?.trim()) answers["p6.reason"] = extra.reason.trim();
  else {
    const noReason = named.filter((x) => !x.a.keepReason?.trim());
    if (noReason.length) missing.push(`Ready Check: reason the existing insulation is being kept not recorded${gap(noReason)}`);
    else { const rs = [...new Set(named.map((x) => x.a.keepReason!.trim()))]; answers["p6.reason"] = rs.length === 1 ? rs[0]! : named.map((x) => `${x.n}: ${x.a.keepReason!.trim()}`).join("; "); }
  }
  // Condition: suitable to lay over (any No = No, which the official P6 rule then refuses for a top-up).
  if (extra.suitable != null) answers["p6.suitable"] = extra.suitable ? "Yes" : "No";
  else {
    const noAns = named.filter((x) => x.a.suitable == null);
    if (noAns.length) missing.push(`Ready Check: condition of the existing insulation (suitable to lay over) not recorded${gap(noAns)}`);
    else answers["p6.suitable"] = named.every((x) => x.a.suitable === true) ? "Yes" : "No";
  }
  // Foil / metallic / conductive (+ the HI VIC photo) for every area being topped up.
  let conductive: boolean | null = extra.conductive;
  if (conductive == null) {
    const noAns = named.filter((x) => x.a.conductive == null);
    if (noAns.length) missing.push(`Ready Check: whether the existing insulation is foil, metallic or conductive is not recorded${gap(noAns)}`);
    else conductive = named.some((x) => x.a.conductive === true);
  }
  let conductiveEvidence: string | null = extra.conductiveEvidence ?? null;
  if (!conductiveEvidence) {
    const noPhoto = named.filter((x) => !x.a.conductiveEvidence);
    if (noPhoto.length) missing.push(`Ready Check: photo showing whether the existing insulation is foil-backed or conductive not added${gap(noPhoto)}`);
    else conductiveEvidence = named[0]!.a.conductiveEvidence!;
  }
  return { answers, missing, conductive, conductiveEvidence, fullRemoval: false };
}

// ---------- crew ----------
type WorkerRow = { id: string; full_legal_name: string; approval_status: string | null; removed_at: string | null; trade_role: string | null; worker_role?: string | null; declarations_due?: boolean | null; licence_expires_on?: string | null; certification: unknown };
type CertRow = { id: string; status: string | null; certificate_number: string | null; issuer: string | null; worker_id?: string | null };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const certificationRef = (c: unknown): string | null => { const v = (c as { verification_id?: unknown } | null)?.verification_id; return typeof v === "string" && UUID.test(v) ? v : null; };

/** Roster from RECORDED facts: EEC verified only through a linked verified certification row (declared text never counts). */
export type LevelRow = { certification_id: string; level: string | null; expires_on: string | null; recorded_at: string };
/** `whiteCardFor`: decision 319 — when given, `whiteCardBlocked` is set from the White Card state and the installation booking's created time (null = no booking yet = enforced). */
export function staffFromRecords(workers: WorkerRow[], certs: CertRow[], levels: LevelRow[] = [], noticeAck?: Map<string, boolean>, today: string = melbourneToday(), whiteCardFor?: { bookingCreatedAt: string | null }): StaffOption[] {
  const byId = new Map(certs.map((c) => [c.id, c]));
  const lv = new Map<string, LevelRow>();
  for (const l of [...levels].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))) lv.set(l.certification_id, l); // latest recorded wins
  return workers.filter((w) => !w.removed_at && w.trade_role === "installer").map((w) => {
    const ref = certificationRef(w.certification);
    const c = ref ? byId.get(ref) : undefined;
    const ok = !!c && c.status === "verified" && !!c.certificate_number?.trim() && (!c.worker_id || c.worker_id === w.id);
    const level = ok ? lv.get(c!.id)?.level ?? null : null, expiresOn = ok ? lv.get(c!.id)?.expires_on ?? null : null;
    // Decision 153: clearance is derived from the verified check + recorded level/expiry, never from approval_status.
    const cl = crewClearance({ removed_at: w.removed_at, certStatus: ok ? "verified" : c?.status === "rejected" ? "rejected" : null, level, expiresOn }, today);
    const wc = whiteCardState({ trade_role: w.trade_role, certification: w.certification });
    return { workerId: w.id, name: w.full_legal_name.trim(), workerRole: effectiveWorkerRole({ tradeRole: w.trade_role ?? "", stored: w.worker_role }), eec: ok ? c!.certificate_number!.trim() : null, eecVerified: ok, approved: w.approval_status === "approved", cleared: cl.cleared, clearanceReason: cl.reason, issuer: ok ? c!.issuer?.trim() || null : null, certificationId: ok ? c!.id : null, level, expiresOn, ...(noticeAck ? { noticeAcknowledged: noticeAck.get(w.id) === true } : {}),
      whiteCard: wc, ...(whiteCardFor ? { whiteCardBlocked: whiteCardBlocker(wc, whiteCardFor.bookingCreatedAt) !== null } : {}), ...(typeof w.declarations_due === "boolean" ? { declarationsDue: w.declarations_due } : {}) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
/** Crew -> official Part 2 prefill (lead + additional rows, with their verified certification numbers). */
export function crewPrefill(sel: CrewSelection, staff: StaffOption[]): { itemId: string; row: number; value: string }[] {
  const byId = new Map(staff.map((s) => [s.workerId, s]));
  const out: { itemId: string; row: number; value: string }[] = [];
  const lid = leadWorkerId(sel);
  const lead = lid ? byId.get(lid) : undefined;
  if (sel.lead && typeof sel.lead === "object") { const o = sel.lead.other; if (o.name.trim()) out.push({ itemId: "p2.lead", row: 0, value: o.name.trim() }, { itemId: "p8.name", row: 0, value: o.name.trim() }); if (o.eec.trim()) out.push({ itemId: "p2.leadEec", row: 0, value: o.eec.trim() }); }
  if (lead) { out.push({ itemId: "p2.lead", row: 0, value: lead.name }, { itemId: "p8.name", row: 0, value: lead.name }); if (lead.eecVerified && lead.eec) out.push({ itemId: "p2.leadEec", row: 0, value: lead.eec }); }
  sel.additional.slice(0, 3).forEach((a, row) => {
    const s = "workerId" in a ? byId.get(a.workerId) : null;
    const name = s ? s.name : "other" in a ? a.other.name.trim() : "";
    const eec = s ? (s.eecVerified ? s.eec : null) : "other" in a ? a.other.eec.trim() : null; // Other = typed, unverified
    if (name) out.push({ itemId: "p2.addName", row, value: name });
    if (eec) out.push({ itemId: "p2.addEec", row, value: eec });
  });
  return out;
}

// ---------- AP evidence for the A5 path ----------
export type A3EvidenceKey = "installer_photos" | "electrician_photo" | "isolation_photo" | "before_video" | "product_photos" | "completed_video" | "final_plan";
export const A3_EVIDENCE_QUALITY = "Unclear or incomplete evidence may be rejected by the Essential Services Commission (ESC).";
/** Jo's 9 Oct 2026 full instructions — still accepted on the same stable IDs (a3AcceptedMediaLabels). */
export const A3_INSTRUCTION_LABELS_2026_10_09: Record<A3EvidenceKey, string> = {
  installer_photos: `Please take a clear, geotagged photo of every installer at this property. ${A3_EVIDENCE_QUALITY}`,
  electrician_photo: `Please take a clear, geotagged photo of the electrician attending this property. ${A3_EVIDENCE_QUALITY}`,
  isolation_photo: `Before work starts, please take a clear, geotagged photo showing the power isolated, locked out and tagged. ${A3_EVIDENCE_QUALITY}`,
  before_video: `Before installation, please record a clear video of every ceiling area being upgraded, including any existing insulation. ${A3_EVIDENCE_QUALITY}`,
  product_photos: `Before installation, please take a clear, geotagged photo of each product label showing the brand, model and R-value. ${A3_EVIDENCE_QUALITY}`,
  completed_video: `After installation, please record a clear video showing all insulated areas, coverage, depth and removal of waste. ${A3_EVIDENCE_QUALITY}`,
  final_plan: `Please upload a clear final roof-space plan showing the installed area in m² and the products used. ${A3_EVIDENCE_QUALITY}`,
};
/** Current labels. Decision 205 (Activity Guide v1.2 Table 4): the four photo items are reworded on the SAME Mitti items
 * (front of premises + photo ID; lock-out tag + solar/battery isolators off; packaging brand/model/R-value). The per-zone
 * videos, ruler photos and daily re-check are NEW label-read items in install-evidence.core.ts. */
export const A3_EVIDENCE_LABELS: Record<A3EvidenceKey, string> = {
  ...A3_INSTRUCTION_LABELS_2026_10_09,
  installer_photos: INSTALL_EVIDENCE_RELABELS.installer_photos,
  electrician_photo: INSTALL_EVIDENCE_RELABELS.electrician_photo,
  isolation_photo: INSTALL_EVIDENCE_RELABELS.isolation_photo,
  product_photos: INSTALL_EVIDENCE_RELABELS.product_photos,
};
/** What the installer/office is told when a requirement is short. The whole-job videos are gone from the current form
 *  (fix prompt), so their requirement names the per-zone videos that now satisfy it. */
export const A3_REQUIREMENT_LABELS: Record<A3EvidenceKey, string> = {
  ...A3_EVIDENCE_LABELS,
  before_video: "Before-work video — the before 360° video of every zone (Zones and evidence page)",
  completed_video: "Completed-work video — the after 360° video of every zone (Zones and evidence page)",
};
/** What the office checks on each photo before AP sign-off (Table 4 wording), shown beside the checklist row. */
export const A3_EVIDENCE_VERIFICATION: Partial<Record<A3EvidenceKey, string>> = {
  installer_photos: "Each installer is at the front of the premises and their photo ID is clearly readable; location and time recorded.",
  electrician_photo: "The electrician is at the front of the premises with photo ID clearly readable, taken before work started; location and time recorded.",
  isolation_photo: "The switchboard is tagged and locked out; where the home has solar or a battery, each isolator is visibly switched off.",
  product_photos: "Brand, model and R-value are readable on the packaging label of every product installed.",
};
const GEOTAG: A3EvidenceKey[] = ["installer_photos", "electrician_photo", "isolation_photo", "product_photos"];

export type A3EvidenceCtx = {
  crewCount: number;
  electricianRequiredAtStart: boolean; // signed PIESA attendance OR Part 4 instructions = No
  /** A valid existing plan whose area/products match what was installed (reused; no new upload needed). */
  existingPlanMatchesInstall: boolean;
  /** Current published form requires an attachment on this audit, never a historical plan substitute. */
  mandatoryCurrentPostwork?: boolean;
  /** Life-support consent/plan already on file (reused, never uploaded twice). */
  lifeSupportConsentOnFile: boolean;
  /** Decision 211: the portal's generated final installation plan (kind `final_area_diagram`) is on the job file. */
  generatedFinalPlan?: boolean;
  /** Decision 262: the "A5 – Install day" template (before videos come from the Ready Check). */
  installDayForm?: boolean;
};
/** Decision 211 (Jo 24 Oct 2026): the generated final plan replaces the install-day "final plan" upload. Old jobs keep
 *  their uploaded plan (existingPlanMatchesInstall) as an accepted alternative. */
export function generatedPlanSatisfiesFinalPlan(ctx: Pick<A3EvidenceCtx, "generatedFinalPlan" | "existingPlanMatchesInstall" | "mandatoryCurrentPostwork">): boolean {
  if (ctx.generatedFinalPlan === true) return true;
  return ctx.existingPlanMatchesInstall && !ctx.mandatoryCurrentPostwork;
}
/** capturedAt = LATEST recorded capture time; timed = files with a recorded time (undefined = legacy, treated as all). */
export type A3Media = { key: A3EvidenceKey; count: number; geotagged: number; timed?: number; capturedAt?: string | null };
/** Before-work media are checked at prestart; after-work media only at completion (never block the prestart check). */
export const A3_PRESTART_KEYS: A3EvidenceKey[] = ["installer_photos", "electrician_photo", "isolation_photo", "before_video", "product_photos"];
export const A3_AFTER_KEYS: A3EvidenceKey[] = ["completed_video", "final_plan"];

/** Required A5 evidence. The old ID-holding / 360° / ruler extras are NOT in this path (no official basis). */
export function a3EvidenceRequired(answers: OfficialAnswers, ctx: A3EvidenceCtx): { key: A3EvidenceKey; min: number; label: string }[] {
  const ea = answers["p5.electricianPresent"];
  const elec = ctx.electricianRequiredAtStart || answers["p4.instructions"] === "No" || ea === "Yes";
  const req: { key: A3EvidenceKey; min: number }[] = [
    { key: "installer_photos", min: Math.max(1, ctx.crewCount) },
    ...(elec ? [{ key: "electrician_photo" as const, min: 1 }] : []),
    { key: "isolation_photo", min: 1 },
    // Decision 264: on the install day form the before video of each area is the Ready Check's (checked by install-evidence).
    ...(ctx.installDayForm ? [] : [{ key: "before_video" as const, min: 1 }]),
    { key: "product_photos", min: 1 },
    { key: "completed_video", min: 1 },
    ...(generatedPlanSatisfiesFinalPlan(ctx) ? [] : [{ key: "final_plan" as const, min: 1 }]),
  ];
  return req.map((r) => ({ ...r, label: A3_REQUIREMENT_LABELS[r.key] }));
}

function evidenceBlockers(keys: A3EvidenceKey[], answers: OfficialAnswers, ctx: A3EvidenceCtx, media: A3Media[], workStartAt?: string | null): string[] {
  const b: string[] = [];
  const by = new Map(media.map((m) => [m.key, m]));
  for (const r of a3EvidenceRequired(answers, ctx).filter((x) => keys.includes(x.key))) {
    const m = by.get(r.key);
    if (!m || m.count < r.min) { b.push(`${r.label}: ${m?.count ?? 0} of ${r.min}`); continue; }
    if (GEOTAG.includes(r.key) && m.geotagged < r.min) b.push(`${r.label}: location not recorded on ${r.min - m.geotagged} — office review`);
    if (m.timed != null && m.timed < m.count) b.push(`${r.label}: capture time not recorded on ${m.count - m.timed} — office review`);
    if ((r.key === "isolation_photo" || r.key === "before_video" || r.key === "product_photos") && workStartAt && m.capturedAt && Date.parse(m.capturedAt) > Date.parse(workStartAt)) b.push(`${r.label}: must be taken before work starts`);
  }
  return b;
}
/** Prestart: before-work evidence + life support only. After-work media are never required here. */
/** Prominent banner heading (Jo, 9 Oct 2026). No calendar delay: work may proceed only once the unmet prerequisite is
 * actually corrected and safety clearance reconfirmed. Banners are instructions, never proof of clearance. */
export const STOP_BANNER = "🛑 STOP —";
export const stopMsg = (action: string) => `${STOP_BANNER} ${action}`;
/** STOP-WORK rules (Jo's PIISA review, 8 Oct 2026). Presence questions answered No (solar, recessed lights, existing
 * insulation) are factual and green. Every other safety "No" is a hard stop, never just a score. Follow-up questions
 * apply only when their trigger is actually Yes. Unanswered applicable questions also block (never assumed). */
export function a3StopWork(answers: OfficialAnswers, ctx: Pick<A3EvidenceCtx, "electricianRequiredAtStart" | "lifeSupportConsentOnFile">): string[] {
  const a = (id: string) => { const v = answers[id]; return typeof v === "string" ? v : null; };
  const out: string[] = [];
  const need = (id: string, label: string, stop: string) => {
    const v = a(id);
    if (v == null) out.push(`${label}: not answered`);
    else if (v === "No") out.push(stop);
  };
  need("p1.powerInformed", "Power-off notice", "STOP - Please ensure the household is aware the power will be turned off before continuing.");
  const ls = a("lifeSupport");
  if (ls == null) out.push("Life support: not answered");
  else if (ls === "Yes") {
    const c = a("lifeSupportConsent");
    if (c == null) out.push("Life support: consent or medical plan not answered — " + stopMsg("Record written consent or the medical plan before work starts."));
    else if (/^no\b/i.test(c.trim())) out.push(stopMsg("Obtain the occupant’s written consent or medical plan for life support and attach it, then reconfirm it is safe to start."));
    else if (!ctx.lifeSupportConsentOnFile) out.push(stopMsg("Attach the life support consent or medical plan, then reconfirm it is safe to start."));
  }
  need("p3.swms", "SWMS", stopMsg("Please complete the Safe Work Method Statement for this job, identify all risks and reconfirm safety clearance before work starts."));
  need("p3.table1", "Table 1 hazards", stopMsg("Please assess every hazard listed in Table 1, record and implement the control measures in the Safe Work Method Statement, and reconfirm safety clearance before continuing."));
  need("p3.isolated", "Power isolation", stopMsg("Please have the main and any alternative power supplies isolated, locked out and tagged, and reconfirm that the ceiling space is electrically safe to enter before continuing."));
  const solar = a("p4.present");
  if (solar == null) out.push("Solar/battery/other supply: not answered");
  else if (solar === "Yes") {
    need("p4.instructions", "Shutdown instructions", stopMsg("Please obtain safe shutdown, isolation and restart instructions for every alternative power supply and have the required electrician isolate the supplies, lock out, tag and reconfirm Pre Insulation Electrical Safety Assessment (PIESA) before work starts."));
    need("p4.isolator", "Ground-level isolator", stopMsg("Please arrange electrical review of the ground-level AC/DC isolator so it is accessible, working and safe to isolate, and reconfirm Pre Insulation Electrical Safety Assessment (PIESA) before continuing."));
  }
  need("p5.reviewed", "PIESA review", stopMsg("The lead installer must read the PIESA and confirm it is safe to start work."));
  const required = ctx.electricianRequiredAtStart || a("p4.instructions") === "No";
  const el = a("p5.electricianPresent");
  if (el == null) out.push("Electrician attendance: not answered");
  else if (el === "No") out.push(stopMsg("Get the required electrician onsite, then reconfirm it is safe to start."));
  else if (el === "N/A" && required) out.push(stopMsg("Please arrange for the electrician required by the PIESA or shutdown instructions to attend and reconfirm Pre Insulation Electrical Safety Assessment (PIESA) before work starts; N/A is not valid for this job."));
  const rec = a("p5.recessed");
  if (rec == null) out.push("Recessed lights: not answered");
  else if (rec === "Yes") {
    need("p5.icConfirmed", "IC-rated lights", stopMsg("Please obtain PIESA confirmation that the relevant ceiling lights are classified and marked IC or IC-4, and reconfirm safety clearance before continuing."));
    need("p5.safeToCover", "Safe to cover", stopMsg("Please arrange electrical review to confirm the recessed lights are safe to cover with insulation, and reconfirm safety clearance before continuing."));
  }
  need("p5.rcd", "RCD protection", stopMsg("Please arrange electrical review to confirm that mains-connected cables in the ceiling have RCD protection where required, and reconfirm safety clearance before continuing."));
  need("p5.tps", "TPS cables", stopMsg("Please arrange electrical review to confirm that mains-connected cables in the ceiling are thermoplastic insulated and sheathed (TPS), or an equivalent cable type, and reconfirm safety clearance before continuing."));
  need("p5.basic", "Basic protection", stopMsg("Please arrange electrical review to confirm that mains-connected cables in the ceiling meet Basic Protection Requirements, and reconfirm safety clearance before continuing."));
  need("p5.noAccess", "No ceiling access since PIESA", stopMsg("Please clarify with the owner or occupier who has entered or worked in the ceiling since the PIESA, arrange review of any changed conditions, and reconfirm safety clearance before continuing."));
  const ins = a("p6.present");
  if (ins == null) out.push("Existing insulation: not answered");
  else if (ins === "Yes") {
    const t = answers["p6.treatment"]; const ticks = Array.isArray(t) ? t : [];
    if (!ticks.length) out.push("Existing insulation: removed or topped up not answered");
    const suit = a("p6.suitable");
    if (suit == null) out.push("Existing insulation suitability: not answered");
    else if (suit === "No" && ticks.includes("Topped Up")) out.push(stopMsg("Unsuitable existing insulation can't be kept or topped up; remove it first."));
  }
  return out;
}
export function a3PrestartBlockers(answers: OfficialAnswers, ctx: A3EvidenceCtx, media: A3Media[], workStartAt?: string | null): string[] {
  const b = evidenceBlockers(A3_PRESTART_KEYS, answers, ctx, media, workStartAt);
  b.push(...a3StopWork(answers, ctx));
  return b;
}
/** Completion: after-work evidence only (prestart is checked separately against its own snapshot). */
export function a3CompletionBlockers(answers: OfficialAnswers, ctx: A3EvidenceCtx, media: A3Media[]): string[] {
  return evidenceBlockers(A3_AFTER_KEYS, answers, ctx, media);
}
export function a3EvidenceBlockers(answers: OfficialAnswers, ctx: A3EvidenceCtx, media: A3Media[], workStartAt?: string | null): string[] {
  return [...a3PrestartBlockers(answers, ctx, media, workStartAt), ...a3CompletionBlockers(answers, ctx, media)];
}

/** Checklist rows for the job page/AP: every A5 item with its real state. */
export type A3ChecklistRow = { key: A3EvidenceKey; label: string; phase: "before" | "after"; required: number; count: number; state: "not_required" | "missing" | "review" | "met"; /** Decision 205: what the office verifies on the photo (Table 4 wording). */ verification?: string };
/** Office verification text for a photo item; with solar/battery present the isolation photo must show the isolators off. */
export function a3VerificationNote(key: A3EvidenceKey, answers: OfficialAnswers): string | undefined {
  const base = A3_EVIDENCE_VERIFICATION[key];
  if (key === "isolation_photo" && answers["p4.present"] === "Yes") return `${base} Solar or battery is present at this home — the isolator switches must be visibly off.`;
  return base;
}
export function a3EvidenceChecklist(answers: OfficialAnswers, ctx: A3EvidenceCtx, media: A3Media[]): A3ChecklistRow[] {
  const req = new Map(a3EvidenceRequired(answers, ctx).map((r) => [r.key, r.min]));
  const by = new Map(media.map((m) => [m.key, m]));
  return (Object.keys(A3_EVIDENCE_LABELS) as A3EvidenceKey[]).map((key) => {
    const m = by.get(key); const min = req.get(key) ?? 0; const count = m?.count ?? 0;
    const phase = A3_PRESTART_KEYS.includes(key) ? "before" as const : "after" as const;
    const v = a3VerificationNote(key, answers);
    const row = (required: number, state: A3ChecklistRow["state"]): A3ChecklistRow => ({ key, label: A3_REQUIREMENT_LABELS[key], phase, required, count, state, ...(v ? { verification: v } : {}) });
    if (!min) return row(0, "not_required");
    if (count < min) return row(min, "missing");
    const review = (GEOTAG.includes(key) && (m?.geotagged ?? 0) < min) || (m?.timed != null && m.timed < count);
    return row(min, review ? "review" : "met");
  });
}

// ---------- prestart snapshot ----------
export type A3PrestartSnapshot = {
  audit_id: string; captured_from: "in_progress_audit" | "completed_audit"; answers: OfficialAnswers; crew: { name: string; eec: string | null }[];
  signature: { media_id: string; item_id: string | null; signer_name: string | null; signed_at: string };
  media: Record<A3EvidenceKey, A3MediaFile[]>; blockers: string[];
};
/** Builds the immutable prestart snapshot from the CURRENT audit. Signature time = the signature's own timestamp only. */
/** `portal` = official answers the portal fills itself on the install day form (decision 262: Part 5 lights / cables from the
 *  PIESA, Part 6 existing insulation from the Ready Check) with the facts it could not establish (each one a blocker). */
export function a3PrestartSnapshot(auditId: string, audit: unknown, ctx: A3EvidenceCtx, opts: { completed: boolean; portal?: { answers: Record<string, string | string[]>; missing: string[] } }): { ok: true; snapshot: A3PrestartSnapshot } | { ok: false; reason: string } {
  const sig = a3Signature(audit);
  if (!sig.present || !sig.mediaId) return { ok: false, reason: "The installer has not signed the PIISA yet (no signature image)." };
  if (!sig.signedAt) return { ok: false, reason: "The PIISA signature has no time recorded, so it can't be used." };
  const installDay = isInstallDayDoc(audit);
  if (a3AuditUsesDirectCrew(audit) || installDay) {
    const lead = installDay ? installDayOfficialAnswers(audit).crew[0]?.name ?? null : flatten(audit).find((e) => e.id === A3_CREW_OTHER_FIELDS[0]?.name)?.value ?? null;
    const problem = directLeadSignatureProblem(audit, lead);
    if (problem) return { ok: false, reason: problem };
  }
  const parsed = parseA3Answers(audit);
  const answers: OfficialAnswers = { ...(opts.portal?.answers ?? {}), ...parsed.answers } as OfficialAnswers;
  const crew = parsed.crew;
  const files = a3MediaFiles(audit);
  const prestartFiles = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, A3_PRESTART_KEYS.includes(k as A3EvidenceKey) ? v : []])) as Record<A3EvidenceKey, A3MediaFile[]>;
  const blockers = [...a3PrestartBlockers(answers, { ...ctx, crewCount: Math.max(ctx.crewCount, 1 + crew.length) }, a3MediaSummary(prestartFiles), sig.signedAt), ...(opts.portal?.missing ?? [])];
  return { ok: true, snapshot: { audit_id: auditId, captured_from: opts.completed ? "completed_audit" : "in_progress_audit", answers, crew, signature: { media_id: sig.mediaId, item_id: sig.itemId, signer_name: sig.name, signed_at: sig.signedAt }, media: prestartFiles, blockers } };
}

// ---------- crew resolution against CURRENT verified staff ----------
/** Composite label a native staff dropdown shows: exact "Name — EEC <no> — <Business>". Built from records, never parsed by regex. */
export const staffCompositeLabel = (s: StaffOption, business: string) => `${s.name} — EEC ${s.eec ?? ""} — ${business}`;
/**
 * Each crew value from the audit (plain name, or a native composite label) must equal a CURRENT cleared (decision 153) staff member with
 * a verified EEC whose number matches. Stale, mismatched or "Other" entries block AP approval — never trusted by pattern.
 */
export function a3CrewResolution(crew: { name: string; eec: string | null }[], staff: StaffOption[], business: string): { resolved: string[]; blockers: string[] } {
  const resolved: string[] = [], blockers: string[] = [];
  const ok = staff.filter((s) => s.cleared !== false && s.eecVerified && s.eec);
  for (const c of crew) {
    const raw = c.name.trim();
    const hit = ok.find((s) => raw === staffCompositeLabel(s, business)) ?? ok.find((s) => norm(s.name) === norm(raw));
    if (!hit) { blockers.push(`${raw}: not a current verified installer of ${business} — office review before AP approval`); continue; }
    if (c.eec && norm(c.eec) !== norm(hit.eec!)) { blockers.push(`${hit.name}: EEC on the form (${c.eec}) does not match the verified record (${hit.eec})`); continue; }
    resolved.push(hit.workerId);
  }
  return { resolved, blockers };
}

/** AP gate from the stored A5 evidence record (non-A5 declarations have none and are unaffected). Review/missing block. */
export function a3EvidenceGate(official: unknown): string[] {
  const ev = (official as { a3_evidence?: { checklist?: A3ChecklistRow[]; prestart_blockers?: string[]; completion_blockers?: string[]; crew_blockers?: string[]; prestart_captured_from?: string } } | null)?.a3_evidence;
  if (!ev) return [];
  const out = [...(ev.prestart_blockers ?? []).map((b) => `PIISA start-of-work: ${b}`), ...(ev.completion_blockers ?? []).map((b) => `PIISA evidence: ${b}`), ...(ev.crew_blockers ?? []).map((b) => `PIISA crew: ${b}`)];
  if (ev.prestart_captured_from === "completed_audit") out.push("PIISA start-of-work check was only captured after the form was completed — office review");
  return out;
}

// ---------- native crew choices ----------
type Opt = { id: string; label: string };
function rootOf(t: unknown): Any { return (t as Any)?.template ?? t; }
/** Options of the crew response set as published in the template (never a hardcoded roster). */
export function a3CrewOptions(template: unknown): Opt[] | null {
  const root = rootOf(template);
  const sets: Any[] = [...(root?.response_sets ?? []), ...(root?.global_response_sets ?? [])];
  const set = sets.find((x) => String(x.id) === A3_CREW_RESPONSE_SET);
  return set ? (set.responses ?? []).map((o: Any) => ({ id: String(o.id), label: String(o.label) })) : null;
}
function allItems(t: unknown): Map<string, Any> {
  const out = new Map<string, Any>();
  const walk = (x: unknown) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === "object") { const o = x as Any; const id = o.item_id ?? o.id; if (o.item_id != null || (o.id != null && ("label" in o || "type" in o || "question" in o))) out.set(String(id), o); for (const v of Object.values(o)) if (typeof v === "object") walk(v); } };
  walk(rootOf(t)); return out;
}
/** Template must have: retired cert items gone (tolerated if present but never required), 4 name items on the crew set, Other option, all 8 Other branch fields. */
export function a3CrewSchemaProblems(template: unknown): string[] {
  const p: string[] = [];
  const items = allItems(template);
  const opts = a3CrewOptions(template);
  if (!opts) p.push("Crew choice list (response set) not found on the form");
  else if (!opts.some((o) => o.id === A3_CREW_OTHER_OPTION)) p.push("Crew choice list has no Other option");
  A3_CREW_NAME_IDS.forEach((id, r) => {
    const it = items.get(id);
    const label = r === 0 ? "Lead installer" : `Additional installer (row ${r})`;
    if (!it) { p.push(`${label} (crew choice)`); return; }
    const rs = it.question?.response_set_id ?? it.response_set_id ?? it.response_set;
    if (rs !== A3_CREW_RESPONSE_SET) p.push(`${label} — ID ${id} is not a single choice on the crew list`);
    const f = A3_CREW_OTHER_FIELDS[r]!;
    if (!items.get(f.name)) p.push(`${label} — Other: Full legal name`);
    if (!items.get(f.eec)) p.push(`${label} — Other: EEC certification number`);
  });
  return p;
}
/** What each crew row holds on an audit: a selected option id (+ its label), Other with its branch fields, or nothing. */
export type CrewChoice = { row: number; kind: "none" } | { row: number; kind: "option"; optionId: string; optionLabel: string | null } | { row: number; kind: "other"; name: string | null; eec: string | null };
export function a3AuditUsesDirectCrew(audit: unknown): boolean {
  const items = allItems(audit);
  return items.has(A3_DIRECT_SIGNATURE_ID) && !A3_CREW_NAME_IDS.some((id) => items.has(id));
}
export function a3CrewChoices(audit: unknown): CrewChoice[] {
  if (isInstallDayDoc(audit)) {
    // Decision 262: typed names + CII numbers (lead, second, third); a fourth row never exists on this form.
    const rows = installDayOfficialAnswers(audit).crew;
    return [0, 1, 2, 3].map((row): CrewChoice => { const c = rows[row]; return c ? { row, kind: "other", name: c.name, eec: c.cii } : { row, kind: "none" }; });
  }
  const items = allItems(audit);
  const txt = (id: string) => { const r = items.get(id)?.responses ?? {}; const v = r.text ?? r.value; return typeof v === "string" && v.trim() ? v.trim() : null; };
  if (a3AuditUsesDirectCrew(audit)) return A3_CREW_OTHER_FIELDS.map((pair, row): CrewChoice => {
    const name = txt(pair.name), eec = txt(pair.eec);
    return name || eec ? { row, kind: "other", name, eec } : { row, kind: "none" };
  });
  return A3_CREW_NAME_IDS.map((id, row): CrewChoice => {
    const sel = items.get(id)?.responses?.selected;
    const s = Array.isArray(sel) ? sel[0] : null;
    if (!s) return { row, kind: "none" };
    const oid = String(s.id ?? "");
    if (oid === A3_CREW_OTHER_OPTION) return { row, kind: "other", name: txt(A3_CREW_OTHER_FIELDS[row]!.name), eec: txt(A3_CREW_OTHER_FIELDS[row]!.eec) };
    return { row, kind: "option", optionId: oid, optionLabel: typeof s.label === "string" ? s.label : null };
  });
}
/** A native option belongs to a staff member only if its label EQUALS the label built from the current record (name case-normalised; certificate and business exact). The label is compared, never parsed. */
export function optionForStaff(opts: Opt[], s: StaffOption, business: string): Opt | null {
  if (!s.eecVerified || !s.eec) return null;
  const tail = ` — EEC ${s.eec} — ${business}`;
  return opts.find((o) => o.id !== A3_CREW_OTHER_OPTION && o.label.endsWith(tail) && o.label.slice(0, -tail.length).trim().toLowerCase() === s.name.trim().toLowerCase()) ?? null;
}
/** Roster upkeep: verified+cleared staff without a native option, and native options matching no current verified staff. */
export function a3RosterStatus(template: unknown, staff: StaffOption[], business: string): { missingOptions: string[]; staleOptions: string[]; alert: string | null } {
  const opts = a3CrewOptions(template) ?? [];
  const ok = staff.filter((s) => s.cleared !== false && s.eecVerified && s.eec);
  const matched = new Set<string>();
  const missingOptions: string[] = [];
  for (const s of ok) { const o = optionForStaff(opts, s, business); if (o) matched.add(o.id); else missingOptions.push(s.name); }
  const staleOptions = opts.filter((o) => o.id !== A3_CREW_OTHER_OPTION && !matched.has(o.id)).map((o) => o.label);
  // Named choices on the SHARED template would expose one company's staff to every other company: privacy alert.
  const alert = staleOptions.length || opts.some((o) => o.id !== A3_CREW_OTHER_OPTION)
    ? `Privacy: the shared Mitti safety form lists ${opts.filter((o) => o.id !== A3_CREW_OTHER_OPTION).length} named crew choice(s). Remove them — crew is filled in under Other from ${business}'s own verified records.`
    : null;
  return { missingOptions, staleOptions, alert };
}
/**
 * Native crew prefill: each row selects the REAL option id matching the chosen verified worker; a verified worker with no
 * native option (or a portal "Other") selects Other and seeds the required branch fields so nothing is retyped.
 */
export function a3CrewNativeItems(template: unknown, sel: CrewSelection, staff: StaffOption[], business: string): { items: Any[]; notes: string[]; problems: string[] } {
  const schemaProblems = a3CrewSchemaProblems(template);
  if (schemaProblems.length) return { items: [], notes: [], problems: schemaProblems };
  const opts = a3CrewOptions(template);
  const items: Any[] = [], notes: string[] = [], problems: string[] = [];
  if (!opts) return { items, notes, problems: ["Crew choice list not found on the Mitti form"] };
  const other = opts.find((o) => o.id === A3_CREW_OTHER_OPTION);
  const byId = new Map(staff.map((s) => [s.workerId, s]));
  const rows: (CrewPick | null)[] = [typeof sel.lead === "string" ? { workerId: sel.lead } : sel.lead ? sel.lead : null, ...sel.additional.slice(0, 3)];
  rows.forEach((pick, row) => {
    if (!pick) return;
    const nameId = A3_CREW_NAME_IDS[row]!, f = A3_CREW_OTHER_FIELDS[row]!;
    const choose = (o: Opt) => items.push({ item_id: nameId, type: "question", responses: { selected: [{ id: o.id, label: o.label }] } });
    const seedOther = (name: string, eec: string) => {
      if (!other) { problems.push("Crew choice list has no Other option"); return; }
      choose(other);
      items.push({ item_id: f.name, type: "text", responses: { text: name } }, { item_id: f.eec, type: "text", responses: { text: eec } });
    };
    if ("workerId" in pick) {
      const s = byId.get(pick.workerId);
      if (!s || !s.eecVerified || !s.eec || s.cleared === false) { problems.push(`Crew row ${row + 1}: not a verified, cleared installer of this company`); return; }
      // PRIVACY (Jo 8 Oct 2026): the A5 template is shared by every company, so it must hold no named staff. Known,
      // verified staff of the ASSIGNED company always go in as Other + their recorded name/certificate (never retyped),
      // and a named option is never selected even if one appears in the shared list.
      seedOther(s.name, s.eec);
    } else seedOther(pick.other.name.trim(), pick.other.eec.trim());
  });
  return { items, notes, problems };
}
/**
 * Completed audit crew -> official Part 2 answers + blockers. Known option: resolved ONLY to a current verified, cleared
 * staff member of the assigned company whose built label equals the option label; the certificate comes from the DB
 * record. Other: typed branch values, always office verification.
 */
export function a3ResolveCrewChoices(choices: CrewChoice[], template: unknown | null, staff: StaffOption[], business: string): { answers: Record<string, string>; blockers: string[]; needsVerification: string[] } {
  const answers: Record<string, string> = {}, blockers: string[] = [], nv: string[] = [];
  const optsFromTemplate = template ? a3CrewOptions(template) : null;
  const seen = new Set<string>();
  for (const c of choices) {
    const label = c.row === 0 ? "Lead installer" : `Additional installer ${c.row}`;
    const put = (name: string, eec: string) => { if (c.row === 0) { answers["p2.lead"] = name; answers["p2.leadEec"] = eec; } else { answers[`p2.addName#${c.row - 1}`] = name; answers[`p2.addEec#${c.row - 1}`] = eec; } };
    if (c.kind === "none") { if (c.row === 0) blockers.push("Lead installer not chosen on the PIISA"); continue; }
    if (c.kind === "other") {
      if (!c.name || !c.eec) { blockers.push(`${label}: Other needs a full legal name and EEC certification number`); continue; }
      const k = c.name.toLowerCase(); if (seen.has(k)) { blockers.push(`${c.name} is listed twice`); continue; } seen.add(k);
      put(c.name, c.eec); nv.push(`${label} ${c.name} (EEC ${c.eec}) entered as Other — office must verify before AP approval`);
      continue;
    }
    const opts = optsFromTemplate ?? (c.optionLabel ? [{ id: c.optionId, label: c.optionLabel }] : []);
    const opt = opts.find((o) => o.id === c.optionId);
    const s = opt ? staff.find((x) => x.cleared !== false && optionForStaff([opt], x, business)) : undefined;
    if (!s) { blockers.push(`${label}: chosen option does not match a current verified, cleared installer of ${business} — office review`); continue; }
    if (seen.has(s.workerId)) { blockers.push(`${s.name} is listed twice`); continue; } seen.add(s.workerId);
    put(s.name, s.eec!);
  }
  return { answers, blockers, needsVerification: nv };
}

