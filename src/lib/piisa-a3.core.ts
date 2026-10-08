/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
// A3 - PIISA + AP Evidence (native Mitti template template_f6a2597479164eb181453eb335ce5125). Pure rules only.
// Native labels are plain-language aliases OBSERVED in the Mitti editor (Jo, 8 Oct 2026) mapped onto the ACTUAL official
// PIISA item IDs in official-forms.core. The official DOCX wording is never changed. Repeated native labels are resolved
// by OCCURRENCE (form order), never "first match wins". No native item IDs are recorded here: the live published
// definition is still an empty draft, so stable IDs must be added once Jo publishes it (do not invent them).
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

/** NativeMapping for buildOfficialPrefill. Callers pass occurrence = a3Occurrence(itemId, row). */
export const PIISA_A3_MAPPING: NativeMapping = Object.fromEntries(Object.entries(A3_ALIASES).map(([k, labels]) => [k, { labels }]));

/** Native occurrence of an official item: EEC rows share one label with the lead's EEC field. */
export function a3Occurrence(itemId: string, row = 0): number {
  if (itemId === "p2.addEec") return row + 1;
  if (itemId === "p2.addName") return row;
  return 0;
}

/** Entry for an official item at its native occurrence (form order). Missing = undefined, never a neighbour's field. */
export function a3Entry(entries: Entry[], itemId: string, row = 0): Entry | undefined {
  const labels = (A3_ALIASES[itemId] ?? []).map(norm);
  if (!labels.length) return undefined;
  return entries.filter((e) => labels.includes(e.norm))[a3Occurrence(itemId, row)];
}

/** Every mapped field must exist on the native template, including all three crew rows. Visible failure list. */
export function a3MissingFields(template: unknown): string[] {
  const entries = flatten(template);
  const out: string[] = [];
  for (const id of Object.keys(A3_ALIASES)) {
    const rows = id === "p2.addName" || id === "p2.addEec" ? 3 : 1;
    for (let r = 0; r < rows; r++) if (!a3Entry(entries, id, r)) out.push(rows > 1 ? `${A3_ALIASES[id]![0]} (row ${r + 1})` : A3_ALIASES[id]![0]!);
  }
  return out;
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
  const sig = all.filter((o) => norm(o.label) === norm("Signature"))[0];
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
