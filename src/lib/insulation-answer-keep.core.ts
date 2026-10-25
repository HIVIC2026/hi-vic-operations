// Decision 400 (Jo 26 Oct 2026, box: "Keep the earlier answer"): a repeat website enquiry never wipes an earlier
// insulation answer. Base44 sends the whole questionnaire each time; when the repeat's insulation answer is blank or
// missing, the earlier answer (and its three detail answers) stay in the stored answer snapshot, so the estimate's
// insulation_declared (read from that snapshot by estimate.server) and every other reader keep the owner's answer.
// A new REAL answer ("none" / "present") always updates. "Not sure" never replaces an earlier real answer.
// PURE: no I/O. Used by enquiry.server mergeEvidence on every Base44 / qa_test upsert.
import { declaredExtras, EXISTING_INSULATION_KEYS, INSULATION_DETAIL_KEYS } from "./enquiry.core";
import { normaliseInsulation } from "./eligibility.core";

type Answers = Record<string, unknown>;
const isObj = (v: unknown): v is Answers => !!v && typeof v === "object" && !Array.isArray(v);
const blank = (v: unknown) => v == null || (typeof v === "string" && !v.trim());
const real = (v: string | null) => v === "none" || v === "present";

/** The answers to store: the new snapshot, with the earlier insulation answer kept where the new one is blank. */
export function keepEarlierInsulationAnswers(previous: unknown, next: Answers | null): Answers | null {
  const old = isObj(previous) ? previous : null;
  if (!old) return next;
  const before = normaliseInsulation(declaredExtras(old).existing_insulation);
  if (before == null) return next; // nothing earlier worth keeping
  const after = normaliseInsulation(declaredExtras(next).existing_insulation);
  if (real(after)) {
    // A new real answer updates. Blank detail answers keep earlier ones only while the answer is still "present".
    if (after !== "present" || before !== "present") return next;
    return withEarlier(old, next ?? {}, INSULATION_DETAIL_KEYS);
  }
  // Blank / missing, or "not sure" over an earlier real answer → keep the earlier answer and its details.
  if (after != null && !real(before)) return next; // "not sure" again over "not sure": the new one stands
  const out: Answers = { ...(next ?? {}) };
  for (const k of EXISTING_INSULATION_KEYS) { if (k in old) out[k] = old[k]; else delete out[k]; }
  return withEarlier(old, out, INSULATION_DETAIL_KEYS);
}

function withEarlier(old: Answers, next: Answers, keys: readonly string[]): Answers {
  const out = { ...next };
  for (const k of keys) if (blank(out[k]) && !blank(old[k])) out[k] = old[k];
  return out;
}
