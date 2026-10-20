// Read-only Mitti form health. Provider access, template identity, required questions and official approval are separate facts.
// All I/O is injected; this module never saves settings, creates an inspection or approves a form.
import type { FormKey } from "./mitti-forms.core";
import { canonicalMittiTemplateId, mittiTemplateIdentity, sameMittiTemplateId } from "./mitti-identity.core";
export { canonicalMittiTemplateId, mittiTemplateIdentity } from "./mitti-identity.core";

export type MittiConnectionState = "not_checked" | "reachable" | "not_configured" | "access_denied" | "not_found" | "unavailable";
export type MittiFormHealth = {
  key: FormKey;
  savedId: string | null;
  checkedAt: string;
  connection: MittiConnectionState;
  connectionMessage: string;
  returnedId: string | null;
  templateName: string | null;
  identity: "not_checked" | "verified" | "mismatch" | "missing";
  schema: "not_checked" | "valid" | "invalid";
  schemaIssues: string[];
  approvalBlocker: string | null;
  ok: boolean;
};

const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Public messages deliberately omit provider bodies and credentials. */
export function mittiConnectionFailure(error: unknown): { state: MittiConnectionState; message: string } {
  const e = object(error);
  if (e?.["code"] === "not_configured") return { state: "not_configured", message: "Mitti access is not configured for this project. Connect Mitti in the project settings, then check again." };
  if (e?.["status"] === 401 || e?.["status"] === 403) return { state: "access_denied", message: "Mitti rejected the project's access. The account owner needs to reconnect or renew access." };
  if (e?.["status"] === 404) return { state: "not_found", message: "Mitti could not find this saved form. Check the form ID and that this Mitti account can access it." };
  return { state: "unavailable", message: "Mitti could not be checked. Try again shortly; the saved form has not been changed." };
}

export async function inspectSavedMittiForm(
  input: { key: FormKey; savedId: string | null; approvalBlocker: string | null },
  readDefinition: (id: string) => Promise<unknown>,
  validateDefinition: (key: FormKey, definition: unknown) => { ok: boolean; issues: string[] },
  now: () => string = () => new Date().toISOString(),
): Promise<MittiFormHealth> {
  const result: MittiFormHealth = {
    ...input, checkedAt: now(), connection: "not_checked", connectionMessage: "No form ID is saved.",
    returnedId: null, templateName: null, identity: "not_checked", schema: "not_checked", schemaIssues: [], ok: false,
  };
  if (!input.savedId) return result;
  const requested = canonicalMittiTemplateId(input.savedId);
  if (!requested) return { ...result, connectionMessage: "The saved form ID is not a supported Mitti ID. Check and replace it." };
  let definition: unknown;
  try {
    definition = await readDefinition(input.savedId);
  } catch (error) {
    const failure = mittiConnectionFailure(error);
    return { ...result, checkedAt: now(), connection: failure.state, connectionMessage: failure.message };
  }
  result.checkedAt = now();
  result.connection = "reachable";
  result.connectionMessage = "Mitti responded to the saved-form check.";
  const identity = mittiTemplateIdentity(definition);
  result.returnedId = identity.id;
  result.templateName = identity.name;
  if (!identity.id || !canonicalMittiTemplateId(identity.id)) {
    return { ...result, identity: "missing", schemaIssues: ["Mitti did not return a verifiable template ID. This form has not been confirmed."] };
  }
  if (!sameMittiTemplateId(identity.id, input.savedId)) {
    return { ...result, identity: "mismatch", schemaIssues: ["Mitti returned a different template. Check the saved form before using it."] };
  }
  result.identity = "verified";
  try {
    const schema = validateDefinition(input.key, definition);
    result.schema = schema.ok ? "valid" : "invalid";
    result.schemaIssues = schema.issues;
    result.ok = schema.ok && input.approvalBlocker === null;
  } catch {
    result.schema = "invalid";
    result.schemaIssues = ["The returned form definition could not be validated. Check the form in Mitti."];
  }
  return result;
}

