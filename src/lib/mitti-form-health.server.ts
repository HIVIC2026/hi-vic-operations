// This health path performs one GET of a Mitti template. It cannot create/share audits, write settings or approve forms.
import { mittiApi, type MittiCall } from "./mitti.core";
import { realMittiCall } from "./mitti.server";
import { flattenDefinition, validateTemplate, type FormKey } from "./mitti-forms.core";
import { officialFormUseBlocker } from "./official-forms.core";
import { inspectSavedMittiForm } from "./mitti-form-health.core";

export async function checkMittiFormHealth(key: FormKey, savedId: string | null, call: MittiCall = realMittiCall) {
  const approvalBlocker = key === "piesa" || key === "piisa" ? officialFormUseBlocker(key) : null;
  return inspectSavedMittiForm(
    { key, savedId, approvalBlocker },
    (id) => mittiApi(call).getTemplateDefinition(id),
    (form, definition) => validateTemplate(form, flattenDefinition(definition)),
  );
}

