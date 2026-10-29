// Jo 30 Oct 2026 (spec docs/superpowers/specs/2026-10-30-swms-house-facts-design.md): the SWMS "Specific to this house"
// part fills in from the job's Ready Check answers and PIESA result, with a set safety step for four facts only.
// PURE: no database, no network. Unknown facts are null and their lines are left out — never guessed.
import { LEAN_ALIASES, LEAN_Q, LEAN_REMOVE } from "./ready-check-lean.core";

/** Exact wording approved by Jo (30 Oct 2026). */
export const SWMS_HOUSE_STEPS = {
  foil: "Foil or conductive insulation: power off at the switchboard before anyone enters the ceiling",
  lifeSupport: "Life support at the property: don't switch off power without the owner's OK and a plan for the equipment",
  difficultAccess: "Difficult access: extra care getting in and out of the ceiling space",
  downlights: "Recessed downlights: keep the required clearance or fit approved covers around every downlight",
} as const;

type Entry = { label: string; value: unknown };
export type SwmsHouseExtras = { lifeSupportStatus: string | null; piesaOutcome: string | null; upgradesDone: boolean; piesaHazards: string | null };
export type SwmsHouseArea = { name: string; conductive: boolean | null; downlights: number | null; issue: string | null };
export type SwmsHouseFacts = {
  roofType: string | null; accessRating: string | null; accessNote: string | null; lifeSupport: boolean | null; builtLast5: boolean | null;
  areas: SwmsHouseArea[]; piesa: { outcome: "pass" | "fail" | null; upgradesDone: boolean; hazards: string | null };
};

const norm = (s: unknown) => String(s ?? "").split("\n")[0]!.toLowerCase().replace(/²/g, "2").replace(/[^a-z0-9]+/g, " ").trim();
const labels = (k: keyof typeof LEAN_Q) => new Set([LEAN_Q[k], ...((LEAN_ALIASES as Record<string, string[] | undefined>)[k] ?? [])].map(norm));
const Q = {
  roofType: labels("roofType"), access: labels("access"), lifeSupport: labels("lifeSupport"), builtLast5: labels("builtLast5"),
  areaName: labels("areaName"), conductive: labels("existingConductive"), downlights: labels("downlights"),
  downlightsCount: labels("downlightsCount"), issueNote: labels("issueNote"),
  accessNote: new Set([LEAN_REMOVE.explainDifficult, LEAN_REMOVE.explainNoSafe].map(norm)),
};
const text = (v: unknown): string | null => { const s = v == null ? "" : String(v).trim(); return s && s !== "null" && s !== "<nil>" ? s : null; };
const yesNo = (v: unknown): boolean | null => (/^\s*(yes|true)\s*$/i.test(String(v ?? "")) ? true : /^\s*(no|false)\s*$/i.test(String(v ?? "")) ? false : null);
const count = (v: unknown): number | null => { const t = text(v); if (!t) return null; const n = Number(t.replace(/[^0-9.]/g, "")); return Number.isFinite(n) && n >= 0 ? Math.round(n) : null; };

export function swmsHouseFacts(entries: Entry[], x: SwmsHouseExtras): SwmsHouseFacts {
  let roofType: string | null = null, accessRating: string | null = null, accessNote: string | null = null, lifeSupport: boolean | null = null, builtLast5: boolean | null = null;
  const areas: SwmsHouseArea[] = [];
  let cur: SwmsHouseArea | null = null;
  for (const e of entries ?? []) {
    const l = norm(e.label);
    const v = e.value;
    if (Q.areaName.has(l)) { cur = { name: text(v) ?? `Area ${areas.length + 1}`, conductive: null, downlights: null, issue: null }; areas.push(cur); continue; }
    if (Q.roofType.has(l)) { roofType = text(v) ?? roofType; continue; }
    if (Q.access.has(l)) { accessRating = text(v) ?? accessRating; continue; }
    if (Q.accessNote.has(l)) { accessNote = text(v) ?? accessNote; continue; }
    if (Q.lifeSupport.has(l)) { lifeSupport = yesNo(v) ?? lifeSupport; continue; }
    if (Q.builtLast5.has(l)) { builtLast5 = yesNo(v) ?? builtLast5; continue; }
    if (!cur) continue;
    if (Q.conductive.has(l)) { cur.conductive = yesNo(v); continue; }
    if (Q.downlightsCount.has(l)) { cur.downlights = count(v); continue; }
    if (Q.downlights.has(l)) { if (yesNo(v) === false) cur.downlights = 0; continue; }
    if (Q.issueNote.has(l)) { cur.issue = text(v); continue; }
  }
  if (x.lifeSupportStatus === "yes") lifeSupport = true;
  else if (lifeSupport == null && x.lifeSupportStatus === "no") lifeSupport = false;
  const outcome = x.piesaOutcome === "pass" || x.piesaOutcome === "fail" ? x.piesaOutcome : null;
  return { roofType, accessRating, accessNote, lifeSupport, builtLast5, areas, piesa: { outcome, upgradesDone: x.upgradesDone, hazards: text(x.piesaHazards) } };
}

/** The listed facts, in the spec's order: roof and access, ceiling facts, Ready Check issues, PIESA result. */
export function swmsHouseLines(f: SwmsHouseFacts): string[] {
  const out: string[] = [];
  if (f.roofType) out.push(`Roof: ${f.roofType}`);
  if (f.accessRating) out.push(`Ceiling access: ${f.accessRating}`);
  if (f.accessNote) out.push(`Access note: ${f.accessNote}`);
  if (f.lifeSupport) out.push("Life support equipment at the property");
  if (f.builtLast5) out.push("Ceiling or roof built or replaced in the last 5 years");
  for (const a of f.areas) if (a.conductive) out.push(`${a.name}: foil-backed or conductive existing insulation`);
  for (const a of f.areas) if (a.downlights) out.push(`${a.name}: ${a.downlights} recessed downlight${a.downlights === 1 ? "" : "s"}`);
  for (const a of f.areas) if (a.issue) out.push(`Ready Check issue (${a.name}): ${a.issue}`);
  if (f.piesa.outcome === "pass") out.push("PIESA: passed");
  if (f.piesa.outcome === "fail") out.push(`PIESA: electrical upgrades needed (${f.piesa.upgradesDone ? "done" : "not done yet"})`);
  if (f.piesa.hazards) out.push(`PIESA hazards: ${f.piesa.hazards}`);
  return out;
}

/** The four set safety steps, each only when its fact is true. */
export function swmsHouseSteps(f: SwmsHouseFacts): string[] {
  const out: string[] = [];
  if (f.areas.some((a) => a.conductive)) out.push(SWMS_HOUSE_STEPS.foil);
  if (f.lifeSupport) out.push(SWMS_HOUSE_STEPS.lifeSupport);
  if (/^\s*difficult\s*$/i.test(f.accessRating ?? "")) out.push(SWMS_HOUSE_STEPS.difficultAccess);
  if (f.areas.some((a) => (a.downlights ?? 0) > 0)) out.push(SWMS_HOUSE_STEPS.downlights);
  return out;
}
