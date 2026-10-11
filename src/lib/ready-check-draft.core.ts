// Portal Ready Check draft for installer-supplied jobs (Jo, 8 Oct 2026). Pure rules only.
// Uses the ONE canonical Ready Check field model (READY_CHECK_FIELDS, the same model the Mitti A1 form maps to) and
// the job's own evidence_requirements — no second checklist. A saved draft is never "complete" or "verified".
import { READY_CHECK_FIELDS, validateObservations, type FieldDef, type Observations } from "./readycheck.core";

/** Fields the installer types. Who/which business are set by the server from the signed-in user, never typed. */
const SERVER_SET = new Set(["attendance.installer_user_id", "attendance.installer_business_id"]);
export const RC_DRAFT_FIELDS: readonly FieldDef[] = READY_CHECK_FIELDS.filter((f) => f.kind !== "evidence" && !SERVER_SET.has(f.key));
/** Required ORIGINAL-CONDITION answers (insulation, removal, access, downlights): recorded before any works start. */
export const RC_ORIGINAL_CONDITION_KEYS = RC_DRAFT_FIELDS.filter((f) => f.required && f.key !== "attendance.attended_at").map((f) => f.key);
/** Ready Check evidence = the job's assessment-gate requirements only; electrical/installation items have their own lists. */
export const RC_EVIDENCE_GATE = "assessment";

export type RcEvidence = { label: string; gate: string; required: boolean; status: string; category?: string | null };
export type RcDraftValues = Record<string, string>; // what the form holds; "" = unknown (never guessed)

/** Typed form strings -> canonical observations. Blank stays null (unknown). Bad numbers are reported, not coerced. */
export function toObservations(v: RcDraftValues): { obs: Observations; problems: string[] } {
  const obs: Observations = {}; const problems: string[] = [];
  for (const f of RC_DRAFT_FIELDS) {
    const raw = (v[f.key] ?? "").trim();
    if (raw === "") { obs[f.key] = null; continue; }
    if (f.kind === "number" || f.kind === "integer") { const n = Number(raw.replace(/,/g, "")); if (!Number.isFinite(n) || n < 0 || (f.kind === "integer" && !Number.isInteger(n))) problems.push(`${f.label}: enter a ${f.kind === "integer" ? "whole " : ""}number`); else obs[f.key] = n; continue; }
    if (f.kind === "boolean") { obs[f.key] = raw === "yes" ? true : raw === "no" ? false : null; continue; }
    if (f.kind === "enum" && !f.options?.includes(raw)) { problems.push(`${f.label}: choose an option`); continue; }
    obs[f.key] = raw;
  }
  // Same validator as completion; "required" is not enforced for a partial save.
  problems.push(...validateObservations(obs).filter((i) => !/: required$/.test(i)));
  return { obs, problems };
}

export function fromObservations(obs: Observations): RcDraftValues {
  const out: RcDraftValues = {};
  for (const f of RC_DRAFT_FIELDS) { const x = obs[f.key]; out[f.key] = x == null ? "" : typeof x === "boolean" ? (x ? "yes" : "no") : String(x); }
  return out;
}

/** Known facts that may prefill EMPTY answers. Installer-declared "unknown" insulation stays unknown; supplied area is a hint only. */
export function knownPrefill(k: { insulation: "none" | "below_r2" | "unknown" | null }): RcDraftValues {
  const out: RcDraftValues = {};
  if (k.insulation === "none") out["insulation.existing"] = "none";
  if (k.insulation === "below_r2") out["insulation.existing"] = "present";
  return out;
}

export type RcProgress = {
  missingAnswers: string[];
  evidence: { missing: string[]; rejected: string[]; awaitingReview: string[] };
  worksBlockers: string[];
  allEntered: boolean; // every answer + every evidence item uploaded — still NOT verified
  outstandingCount: number;
};

export function rcProgress(obs: Observations, evidence: RcEvidence[]): RcProgress {
  const missingAnswers = RC_DRAFT_FIELDS.filter((f) => f.required && obs[f.key] == null).map((f) => f.label);
  // Empty ceiling: the existing R-value item does not apply (never ask for a fabricated photo/value).
  const na = obs["insulation.existing"] === "none" ? "existing_insulation_r_value" : null;
  const ev = evidence.filter((e) => e.gate === RC_EVIDENCE_GATE && e.required && e.status !== "not_required" && !(na && e.category === na));
  const missing = ev.filter((e) => e.status === "outstanding").map((e) => e.label);
  const rejected = ev.filter((e) => e.status === "rejected").map((e) => e.label);
  const awaitingReview = ev.filter((e) => e.status === "uploaded").map((e) => e.label);
  const worksBlockers = RC_ORIGINAL_CONDITION_KEYS.filter((k) => obs[k] == null).map((k) => RC_DRAFT_FIELDS.find((f) => f.key === k)!.label);
  return {
    missingAnswers, evidence: { missing, rejected, awaitingReview }, worksBlockers,
    allEntered: missingAnswers.length === 0 && missing.length === 0 && rejected.length === 0,
    outstandingCount: missingAnswers.length + missing.length + rejected.length + awaitingReview.length,
  };
}

/** P1: what still stops an explicit "Submit for review" (same progress model; uploaded-awaiting-review is allowed —
 *  the office reviews after submission). Submitting never verifies, completes, signs or moves the job stage. */
export function rcSubmitBlockers(p: RcProgress): string[] {
  return [
    ...p.missingAnswers.map((l) => `Answer needed: ${l}`),
    ...p.evidence.missing.map((l) => `Photo or video needed: ${l}`),
    ...p.evidence.rejected.map((l) => `Rejected — upload again: ${l}`),
  ];
}
