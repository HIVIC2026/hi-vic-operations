/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
// A3 - PIISA + AP Evidence (native Mitti template template_f6a2597479164eb181453eb335ce5125). Pure rules only.
// Native labels are plain-language aliases OBSERVED in the Mitti editor (Jo, 8 Oct 2026) mapped onto the ACTUAL official
// PIISA item IDs in official-forms.core. The official DOCX wording is never changed. Repeated native labels are resolved
// by OCCURRENCE (form order), never "first match wins". Stable native item IDs below were READ FROM THE RENDERED
// EDITOR DOM of the draft (Jo, 8 Oct 2026 12:57 UTC) — draft-observed until the published API definition agrees;
// any disagreement fails closed (a3MissingFields).
import { flatten, norm, type Entry, type NativeMapping } from "./mitti.core";
import type { OfficialAnswers } from "./official-forms.core";

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
  "p2.installDate": ["Installation date"],
  "p2.ap": ["Accredited person (AP)"],
  "p2.company": ["Installer company"],
  "p2.lead": ["Lead installer"],
  // "EEC certification number" repeats: occurrence 0 = lead installer, 1..3 = additional installer rows.
  "p2.leadEec": ["EEC certification number"],
  "p2.addName": ["Additional installer"],
  "p2.addEec": ["EEC certification number"],
  "p3.swms": ["Has the SWMS been completed for this job and all risks identified?"],
  "p3.table1": ["Have all Table 1 hazards been considered and controlled in the SWMS?"],
  "p3.isolated": ["Have the main and any alternative power supplies been isolated, locked out and tagged, and the roof cavity confirmed electrically safe to enter?"],
  "p4.present": ["Is there solar, a battery or another power supply, such as a generator?"],
  "p4.instructions": ["Are safe shutdown, isolation and restart instructions available for every alternative power supply?"],
  "p4.isolator": ["Is the ground-level AC/DC isolator accessible, working and safe to isolate?"],
  "p5.reviewed": ["Has the lead installer reviewed the PIESA and confirmed the site is safe to start work?"],
  "p5.electricianPresent": ["If the PIESA requires an electrician at the start, has the electrician attended?"],
  "p5.recessed": ["Are there recessed lights in the ceiling?"],
  "p5.count": ["How many recessed lights are there?"],
  "p5.icConfirmed": ["Does the PIESA confirm all ceiling lights are classified and marked IC or IC-4?"],
  "p5.safeToCover": ["Are all recessed lights safe to cover with insulation?"],
  "p5.rcd": ["Does the PIESA confirm all mains cables in the ceiling have RCD protection where required?"],
  "p5.tps": ["Does the PIESA confirm all mains cables in the ceiling are TPS or an equivalent cable type?"],
  "p5.basic": ["Does the PIESA confirm all mains cables in the ceiling meet Basic Protection Requirements?"],
  "p5.noAccess": ["Has the owner or occupier confirmed no one has accessed or worked in the ceiling since the PIESA?"],
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
  "p2.installDate": ["747968d6-030d-46ca-a82a-4482cad9e81f"],
  "p2.ap": ["b7212b10-067a-4fd8-8f6a-90efd2db8389"],
  "p2.company": ["dc12088c-8316-461e-91e2-53b1db0dc558"],
  "p2.lead": ["e377bcdb-0ba0-46d3-82f6-5d84519b55c4"],
  "p2.leadEec": ["647221f2-f74c-4da1-a8be-e44a20f0b08b"],
  "p2.addName": ["4bea475f-516e-46a2-8922-e85896c68402", "726f9e46-8308-449e-822f-2280cd7affa7", "c0c2178e-e872-4c70-a260-78aecde3d01e"],
  "p2.addEec": ["24e41e61-a490-4bdc-bd34-002fb6ae1089", "65d9d9d5-b87e-4d81-b92a-fa877e5a4f98", "3681131a-dee1-429a-ba34-6e066ef07152"],
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
/** A3 evidence media items -> native item id (draft-observed). Electrician photo had no ID supplied: not mapped. */
export const A3_MEDIA_IDS: Partial<Record<A3EvidenceKey, string>> = {
  installer_photos: "06598474-e46a-4bba-8c9d-d1be2c9993e1",
  isolation_photo: "3d8347ae-ed16-4e93-be18-4ecada390a7a",
  before_video: "49c8ef21-dd6a-41e0-a4ae-acb0c53e7ada",
  product_photos: "0a587e0e-9787-464e-be40-7cdd2c636b87",
  completed_video: "86b3772c-6227-4b6f-8011-b7ed288e734e",
  final_plan: "344e863b-3af3-44f5-b1b8-966941f0e667",
};

/** NativeMapping for buildOfficialPrefill: per-row stable IDs; labels kept only for verification. */
export const PIISA_A3_MAPPING: NativeMapping = Object.fromEntries(Object.keys(A3_NATIVE_IDS).map((k) => [k, { itemIds: A3_NATIVE_IDS[k], labels: A3_ALIASES[k], byRow: true }]));
const ROWS = (id: string) => A3_NATIVE_IDS[id]?.length ?? 1;

/** Native occurrence of an official item: EEC rows share one label with the lead's EEC field. */
export function a3Occurrence(itemId: string, row = 0): number {
  if (itemId === "p2.addEec") return row + 1;
  if (itemId === "p2.addName") return row;
  return 0;
}

/** Entry for an official item at its native occurrence (form order). Missing = undefined, never a neighbour's field. */
export function a3Entry(entries: Entry[], itemId: string, row = 0): Entry | undefined {
  const nid = A3_NATIVE_IDS[itemId]?.[row];
  if (nid) return entries.find((e) => String(e.id) === nid);
  const labels = (A3_ALIASES[itemId] ?? []).map(norm);
  if (!labels.length) return undefined;
  return entries.filter((e) => labels.includes(e.norm))[a3Occurrence(itemId, row)];
}

/** Every mapped field must exist on the native template, including all three crew rows. Visible failure list. */
export function a3MissingFields(template: unknown): string[] {
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
      if (al?.length && !al.map(norm).includes(e.norm)) out.push(`${name} — ID ${e.id} now reads "${e.label}"`);
    }
  }
  for (const [k, nid] of Object.entries(A3_MEDIA_IDS)) if (!entries.some((e) => String(e.id) === nid)) out.push(`${A3_EVIDENCE_LABELS[k as A3EvidenceKey]} (media)`);
  return out;
}

/** Media item ids that hold each evidence type on a completed audit (for evidence sync). */
export function a3MediaCounts(audit: unknown): { key: A3EvidenceKey; count: number }[] {
  const byId = new Map<string, Any>();
  const walk = (x: unknown) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === "object") { const o = x as Any; const id = o.item_id ?? o.id; if (id != null && "label" in o) byId.set(String(id), o); for (const v of Object.values(o)) if (typeof v === "object") walk(v); } };
  walk(audit);
  return (Object.entries(A3_MEDIA_IDS) as [A3EvidenceKey, string][]).map(([key, nid]) => {
    const o = byId.get(nid); const media = o?.media ?? o?.responses?.media ?? o?.responses?.attachments ?? [];
    return { key, count: Array.isArray(media) ? media.length : 0 };
  });
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
  const entries = flatten(audit);
  const answers: OfficialAnswers = {};
  for (const id of Object.keys(A3_ALIASES)) {
    if (id === "p2.addName" || id === "p2.addEec" || id === "p8.signature") continue;
    if (id === "p8.declaration") continue;
    const v = a3Entry(entries, id)?.value ?? null;
    if (v == null) continue;
    if (id === "p6.treatment") { const t = mergeTreatment(v); if (t) answers[id] = t; continue; }
    if (YN_IDS.has(id)) { const y = yn(v); if (y) answers[id] = y; continue; }
    answers[id] = v;
  }
  const crew: { name: string; eec: string | null }[] = [];
  for (let r = 0; r < 3; r++) {
    const name = a3Entry(entries, "p2.addName", r)?.value?.trim();
    if (name) crew.push({ name, eec: a3Entry(entries, "p2.addEec", r)?.value?.trim() || null });
  }
  return { answers, crew };
}

/** The installer's signature must carry its OWN timestamp. The audit's modified/completed time is never used. */
export function a3Signature(audit: unknown): { name: string | null; signedAt: string | null; present: boolean } {
  const root = (audit as { template?: unknown })?.template ?? audit;
  const all: Any[] = [];
  const walk = (x: unknown) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === "object") { const o = x as Any; if ("label" in o) all.push(o); for (const v of Object.values(o)) if (typeof v === "object") walk(v); } };
  walk([(root as Any)?.header_items, (root as Any)?.items]);
  const sig = all.find((o) => String(o.item_id ?? o.id) === A3_NATIVE_IDS["p8.signature"]![0]) ?? all.filter((o) => norm(o.label) === norm("Signature"))[0];
  const r = (sig?.responses ?? {}) as Any;
  const present = !!(r.image ?? r.media ?? r.media_id ?? r.signature ?? r.name);
  const ts = [r.timestamp, r.signed_at, r.datetime].find((t) => typeof t === "string" && !Number.isNaN(Date.parse(t))) as string | undefined;
  return { name: typeof r.name === "string" && r.name.trim() ? r.name.trim() : null, signedAt: ts ?? null, present };
}

// ---------- Ready Check -> Part 6 prefill (multi-area aware) ----------
export type RcArea = { name?: string | null; present?: boolean | null; depthMm?: number | null; rValue?: number | null; downlights?: number | null };

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
  one("rValue", "p6.rValue", "Existing insulation R-value");
  const dl = areas.map((a) => a.downlights);
  if (dl.every((x) => x != null && Number.isFinite(x))) { const sum = (dl as number[]).reduce((a, b) => a + b, 0); values["p5.recessed"] = sum > 0 ? "Yes" : "No"; if (sum > 0) values["p5.count"] = String(sum); }
  return { values, notes };
}

// ---------- crew ----------
export type StaffOption = { workerId: string; name: string; eec: string | null; eecVerified: boolean };
export type CrewPick = { workerId: string } | { other: { name: string; eec: string } };
export type CrewSelection = { lead: string | null; additional: CrewPick[] };

/** Lead = verified staff of the assigned installer business; ≤3 additional; no duplicates; "Other" needs name + EEC and office verification. */
export function crewSelectionProblems(sel: CrewSelection, staff: StaffOption[]): { problems: string[]; needsVerification: string[] } {
  const p: string[] = [], nv: string[] = [];
  const byId = new Map(staff.map((s) => [s.workerId, s]));
  const lead = sel.lead ? byId.get(sel.lead) : undefined;
  if (!lead) p.push("Choose the lead installer from your verified staff");
  else if (!lead.eecVerified || !lead.eec) p.push(`${lead.name}: EEC certification not verified`);
  if (sel.additional.length > 3) p.push("The official form has room for 3 additional installers");
  const seenIds = new Set<string>(sel.lead ? [sel.lead] : []);
  const seenEec = new Set<string>(lead?.eec ? [norm(lead.eec)] : []);
  const seenName = new Set<string>(lead ? [norm(lead.name)] : []);
  for (const a of sel.additional) {
    if ("workerId" in a) {
      const s = byId.get(a.workerId);
      if (!s) { p.push("An additional installer is not on your verified staff list"); continue; }
      if (seenIds.has(a.workerId)) { p.push(`${s.name} is listed twice`); continue; }
      seenIds.add(a.workerId); seenName.add(norm(s.name)); if (s.eec) seenEec.add(norm(s.eec));
      if (!s.eecVerified || !s.eec) p.push(`${s.name}: EEC certification not verified`);
    } else {
      const name = a.other.name.trim(), eec = a.other.eec.trim();
      if (!name || !eec) { p.push("Other installer needs a full name and EEC certification number"); continue; }
      if (seenName.has(norm(name)) || seenEec.has(norm(eec))) { p.push(`${name} is listed twice`); continue; }
      seenName.add(norm(name)); seenEec.add(norm(eec));
      nv.push(`${name} (EEC ${eec}) must be verified by the office before work starts`);
    }
  }
  return { problems: p, needsVerification: nv };
}

/** Crew -> official Part 2 prefill (lead + additional rows, with their verified certification numbers). */
export function crewPrefill(sel: CrewSelection, staff: StaffOption[]): { itemId: string; row: number; value: string }[] {
  const byId = new Map(staff.map((s) => [s.workerId, s]));
  const out: { itemId: string; row: number; value: string }[] = [];
  const lead = sel.lead ? byId.get(sel.lead) : undefined;
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

// ---------- AP evidence for the A3 path ----------
export type A3EvidenceKey = "installer_photos" | "electrician_photo" | "isolation_photo" | "before_video" | "product_photos" | "completed_video" | "final_plan";
export const A3_EVIDENCE_LABELS: Record<A3EvidenceKey, string> = {
  installer_photos: "Installer photos — every installer onsite today (geotagged)",
  electrician_photo: "Electrician photo — onsite today (geotagged)",
  isolation_photo: "Power isolation photo — isolated, locked out and tagged before work (geotagged)",
  before_video: "Before-work video — all ceiling areas and existing insulation",
  product_photos: "Installed product photos — brand, model and R-value (geotagged)",
  completed_video: "Completed-work video — coverage, depth and all waste removed",
  final_plan: "Final installation plan — actual installed area (m²) and products",
};
const GEOTAG: A3EvidenceKey[] = ["installer_photos", "electrician_photo", "isolation_photo", "product_photos"];

export type A3EvidenceCtx = {
  crewCount: number;
  electricianRequiredAtStart: boolean; // signed PIESA attendance OR Part 4 instructions = No
  /** A valid existing plan whose area/products match what was installed (reused; no new upload needed). */
  existingPlanMatchesInstall: boolean;
  /** Life-support consent/plan already on file (reused, never uploaded twice). */
  lifeSupportConsentOnFile: boolean;
};
export type A3Media = { key: A3EvidenceKey; count: number; geotagged: number; capturedAt?: string | null };

/** Required A3 evidence. The old ID-holding / 360° / ruler extras are NOT in this path (no official basis). */
export function a3EvidenceRequired(answers: OfficialAnswers, ctx: A3EvidenceCtx): { key: A3EvidenceKey; min: number; label: string }[] {
  const ea = answers["p5.electricianPresent"];
  const elec = ctx.electricianRequiredAtStart || answers["p4.instructions"] === "No" || ea === "Yes";
  const req: { key: A3EvidenceKey; min: number }[] = [
    { key: "installer_photos", min: Math.max(1, ctx.crewCount) },
    ...(elec ? [{ key: "electrician_photo" as const, min: 1 }] : []),
    { key: "isolation_photo", min: 1 },
    { key: "before_video", min: 1 },
    { key: "product_photos", min: 1 },
    { key: "completed_video", min: 1 },
    ...(ctx.existingPlanMatchesInstall ? [] : [{ key: "final_plan" as const, min: 1 }]),
  ];
  return req.map((r) => ({ ...r, label: A3_EVIDENCE_LABELS[r.key] }));
}

export function a3EvidenceBlockers(answers: OfficialAnswers, ctx: A3EvidenceCtx, media: A3Media[], workStartAt?: string | null): string[] {
  const b: string[] = [];
  const by = new Map(media.map((m) => [m.key, m]));
  for (const r of a3EvidenceRequired(answers, ctx)) {
    const m = by.get(r.key);
    if (!m || m.count < r.min) { b.push(`${r.label}: ${m?.count ?? 0} of ${r.min}`); continue; }
    if (GEOTAG.includes(r.key) && m.geotagged < r.min) b.push(`${r.label}: location missing on ${r.min - m.geotagged}`);
    if ((r.key === "isolation_photo" || r.key === "before_video") && workStartAt && m.capturedAt && Date.parse(m.capturedAt) > Date.parse(workStartAt)) b.push(`${r.label}: must be taken before work starts`);
  }
  if (answers["lifeSupport"] === "Yes" && !ctx.lifeSupportConsentOnFile) b.push("Life support: written consent or medical plan must be on file before work");
  return b;
}
