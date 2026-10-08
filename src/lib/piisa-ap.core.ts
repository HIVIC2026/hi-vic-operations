import { AP_LEGAL_ENTITY } from "./authority";
import { flatten } from "./mitti.core";

export const PIISA_AP_ID = "b7212b10-067a-4fd8-8f6a-90efd2db8389";
export const piisaApItem = () => ({ item_id: PIISA_AP_ID, type: "textsingle", responses: { text: AP_LEGAL_ENTITY } });
export function assertPiisaAp(doc: unknown) {
  if (flatten(doc).find((e) => e.id === PIISA_AP_ID)?.value !== AP_LEGAL_ENTITY)
    throw new Error("Mitti has not confirmed the authoritative Accredited Person. Do not open or share this form; retry or ask the office to review it.");
}

/** Empty signature fields must be observed, not inferred from missing data. Any capture/name locks repair. */
export function apRepairAllowed(audit: unknown): boolean {
  if (!audit || typeof audit !== "object") return false;
  const root = audit as Record<string, unknown>;
  const meta = root["audit_data"] as Record<string, unknown> | undefined;
  if (root["completed"] || root["completed_at"] || root["signed_at"] || meta?.["date_completed"]) return false;
  let seen = false, locked = false;
  const walk = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(walk); return; }
    const item = value as Record<string, unknown>;
    if (item["type"] === "signature" || "signature" in item) {
      seen = true;
      const response = item["responses"];
      if (response && typeof response === "object" && Object.values(response).some((v) => v != null && v !== "" && !(Array.isArray(v) && !v.length))) locked = true;
      if (item["value"]) locked = true;
    }
    Object.values(item).forEach(walk);
  };
  walk(audit);
  return seen && !locked;
}

export async function ensurePiisaAp(audit: unknown, update: (items: ReturnType<typeof piisaApItem>[]) => Promise<unknown>, read: () => Promise<unknown>) {
  const field = flatten(audit).find((e) => e.id === PIISA_AP_ID);
  if (field?.value === AP_LEGAL_ENTITY) return;
  if (!field || field.value || !apRepairAllowed(audit)) throw new Error("Accredited Person is missing or differs on a locked/unknown form. Office review is required; signed history was not changed.");
  await update([piisaApItem()]);
  assertPiisaAp(await read());
}