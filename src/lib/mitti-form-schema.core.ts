// Saved Mitti form schema check (pure). Unreadable envelopes are never "missing questions".
import { flattenDefinition, definitionReadable, validateTemplate, type FormKey } from "./mitti-forms.core";
import { a3MissingFields, A3_NATIVE_IDS } from "./piisa-a3.core";
import { flatten } from "./mitti.core";
import { installDayMissingQuestions, isInstallDayDoc } from "./install-day.core";
import { INSTALL_EVIDENCE_EFFECTIVE_DATE, installEvidenceMissingQuestions } from "./install-evidence.core";
import { fixesDayMissingQuestions } from "./fixes-day.core";

const NATIVE_A3_IDS = new Set(Object.values(A3_NATIVE_IDS).flat());
/** Pure-ish dispatcher (exported for tests). PIISA saved as the native A3 is compared with its own stable-ID contract. */
export function validateSavedDefinition(form: FormKey, definition: unknown): { ok: boolean; issues: string[]; unreadable?: boolean; basis: string } {
  if (!definitionReadable(definition)) return { ok: false, unreadable: true, basis: "none", issues: ["Mitti's reply had no readable question items (metadata-only or unsupported format). This does not prove any question is missing."] };
  // Decision 262: the "A3 – Install day" template, checked by its exact wording (install-day.core).
  if (form === "piisa" && isInstallDayDoc(definition)) {
    const missing = installDayMissingQuestions(definition);
    return { ok: missing.length === 0, issues: missing.map((q) => `Install day form: "${q}" not found (exact wording)`), basis: "install day form — every question by exact wording (docs/MITTI_INSTALL_FORM_FIX_PROMPT.md)" };
  }
  // Decision 293: the "A5 – Electrical fixes" template, checked by its exact wording (fixes-day.core).
  if (form === "fixes") {
    const missing = fixesDayMissingQuestions(definition);
    return { ok: missing.length === 0, issues: missing.map((q) => `Electrical fixes form: "${q}" not found (exact wording)`), basis: "fixes day form — every question by exact wording (docs/MITTI_FIXES_FORM_PROMPT.md)" };
  }
  if (form === "piisa" && flatten(definition as never).some((e) => NATIVE_A3_IDS.has(e.id))) {
    const missing = a3MissingFields(definition);
    // Decision 205: the Table 4 items are read by exact wording; listing them here is advisory (the form stays usable)
    // because the stage gate already fails closed for installs from INSTALL_EVIDENCE_EFFECTIVE_DATE.
    const pending = installEvidenceMissingQuestions(definition);
    return { ok: missing.length === 0, issues: [...missing.map((m) => `Native A3: ${m}`), ...pending.map((q) => `Table 4 item not on the form yet (required for installs from ${INSTALL_EVIDENCE_EFFECTIVE_DATE}): "${q}"`)], basis: "native A3 stable IDs/aliases (a3MissingFields) + Table 4 wording (installEvidenceMissingQuestions)" };
  }
  const v = validateTemplate(form, flattenDefinition(definition));
  return { ...v, basis: "labels, counts and types only — required flags, choices and repeating/conditional structure not verified" };
}
