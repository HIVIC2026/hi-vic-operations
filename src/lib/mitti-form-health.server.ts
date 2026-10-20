// This health path performs one GET of a Mitti template. It cannot create/share audits, write settings or approve forms.
import { mittiApi, type MittiCall } from "./mitti.core";
import { realMittiCall } from "./mitti.server";
import { flattenDefinition, definitionReadable, validateTemplate, type FormKey } from "./mitti-forms.core";
import { a3MissingFields, A3_NATIVE_IDS } from "./piisa-a3.core";
import { flatten } from "./mitti.core";
import { officialFormUseBlocker } from "./official-forms.core";
import { inspectSavedMittiForm } from "./mitti-form-health.core";

export async function checkMittiFormHealth(key: FormKey, savedId: string | null, call: MittiCall = realMittiCall) {
  const approvalBlocker = key === "piesa" || key === "piisa" ? officialFormUseBlocker(key) : null;
  return inspectSavedMittiForm(
    { key, savedId, approvalBlocker },
    (id) => mittiApi(call).getTemplateDefinition(id),
    (form, definition) => validateSavedDefinition(form, definition),
  );
}


const NATIVE_A3_IDS = new Set(Object.values(A3_NATIVE_IDS).flat());
/** Pure-ish dispatcher (exported for tests). PIISA saved as the native A3 is compared with its own stable-ID contract. */
export function validateSavedDefinition(form: FormKey, definition: unknown): { ok: boolean; issues: string[]; unreadable?: boolean; basis: string } {
  if (!definitionReadable(definition)) return { ok: false, unreadable: true, basis: "none", issues: ["Mitti's reply had no readable question items (metadata-only or unsupported format). This does not prove any question is missing."] };
  if (form === "piisa" && flatten(definition as never).some((e) => NATIVE_A3_IDS.has(e.id))) {
    const missing = a3MissingFields(definition);
    return { ok: missing.length === 0, issues: missing.map((m) => `Native A3: ${m}`), basis: "native A3 stable IDs/aliases (a3MissingFields)" };
  }
  const v = validateTemplate(form, flattenDefinition(definition));
  return { ...v, basis: "labels, counts and types only — required flags, choices and repeating/conditional structure not verified" };
}
