// Installer declaration is collected INSIDE the Mitti installer safety form (PIISA), signed onsite.
// The portal never asks the installer to sign it separately; it only saves what comes back from Mitti.
import type { FormField } from "./mitti-forms.core";

export const MISSING_INSTALLER_DECLARATION = "Missing evidence: installer declaration";
export const DECL_HEADING = "Installer declaration (Home Insulation Victoria)";
export const DECL_TICK = "I make the installer declaration above";
export const DECL_AREA = "Area installed (m²)";
/** Reused from the PIISA itself — never asked twice. */
export const DECL_PRODUCT = "List the insulation product(s) brand, model and R-value being installed";
export const DECL_SIGNATURE = "Installer signature";
export const DECL_NAME = "Installer full name:";
export const DECL_DATE = "Date:";

/** Added to the end of the PIISA Mitti form, before the existing Part 8 signature. */
export const PIISA_DECLARATION_FIELDS: FormField[] = [
  { label: DECL_HEADING, type: "statement", statement: "heading", required: false, source: "Approved installer declaration template (Compliance templates) — paste the current approved wording as a Mitti instruction", id: "decl.heading" },
  { label: DECL_AREA, type: "number", required: true, prefill: true, source: "portal prefill (measured area) — installer confirms", id: "decl.area" },
  { label: DECL_TICK, type: "tick", required: true, source: "Installer declaration — signed with the installer signature below", id: "decl.tick" },
];

type Entry = { label: string; value: string | null; section?: string | null };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const get = (es: Entry[], label: string) => {
  const hits = es.filter((e) => norm(e.label) === norm(label) && e.value != null && String(e.value).trim() !== "");
  return hits.length ? String(hits[hits.length - 1]!.value).trim() : null;
};
const ticked = (v: string | null) => !!v && /^(yes|true|ticked|checked|1|on|x)$/i.test(v.trim());

export type PiisaDeclaration = { product: string; rValue: string | null; areaM2: number; signatureName: string; signature: string; signedOn: string | null };

/** Pure: read the signed declaration out of a completed PIISA result. Missing anything → not signed. */
export function declarationFromPiisa(entries: Entry[]): { ok: true; decl: PiisaDeclaration } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  const tick = get(entries, DECL_TICK);
  const product = get(entries, DECL_PRODUCT);
  const area = Number(get(entries, DECL_AREA));
  const signature = get(entries, DECL_SIGNATURE);
  const name = get(entries, DECL_NAME);
  if (!ticked(tick)) missing.push("declaration not ticked");
  if (!signature) missing.push("installer signature");
  if (!name || name.length < 2) missing.push("installer full name");
  if (!product || product.length < 2) missing.push("product installed");
  if (!Number.isFinite(area) || area <= 0) missing.push("area installed");
  if (missing.length) return { ok: false, missing };
  return { ok: true, decl: { product: product!, rValue: product!.match(/R\s?\d+(\.\d+)?/i)?.[0]?.replace(/\s/g, "") ?? null, areaM2: Math.round(area * 100) / 100, signatureName: name!, signature: signature!, signedOn: get(entries, DECL_DATE) } };
}

/** TEST/journey only: a completed PIISA Mitti result, with or without the signed declaration. */
export function simulatedPiisaAudit(o: { auditId: string; templateId: string; jobNumber: string; signed: boolean; areaM2?: number }) {
  const t = (label: string, text: string) => ({ item_id: label.slice(0, 20), label, responses: { text } });
  const items = [
    t(DECL_PRODUCT, "Earthwool R5.0 ceiling batts"),
    t(DECL_AREA, String(o.areaM2 ?? 120)),
    ...(o.signed ? [t(DECL_TICK, "Yes"), t(DECL_SIGNATURE, "signature-image-ref"), t(DECL_NAME, "TEST Installer"), t(DECL_DATE, "2026-10-07")] : []),
  ];
  return {
    audit_id: o.auditId, template_id: o.templateId, modified_at: "2026-10-07T05:00:00Z",
    audit_data: { template_id: o.templateId, date_completed: "2026-10-07T05:00:00Z", date_modified: "2026-10-07T05:00:00Z" },
    header_items: [t("Job Reference ID", o.jobNumber)], items,
  };
}

/** Published direct form has no duplicate name/product/area questions. Only verified job facts may supply them. */
export function declarationFromDirectPiisa(input: { tick: unknown; product: string | null; areaM2: number | null; name: string | null; signature: string | null; signedAt: string | null }): { ok: true; decl: PiisaDeclaration } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  if (!ticked(input.tick == null ? null : String(input.tick))) missing.push("declaration not ticked");
  if (!input.signature || !input.signedAt || !Number.isFinite(Date.parse(input.signedAt))) missing.push("installer signature and its own time");
  if (!input.name?.trim()) missing.push("verified lead installer");
  if (!input.product?.trim()) missing.push("reviewed actual installed products");
  if (input.areaM2 == null || !Number.isFinite(input.areaM2) || input.areaM2 <= 0) missing.push("accepted installed area");
  if (missing.length || !input.product || !input.name || !input.signature || !input.signedAt || input.areaM2 == null) return { ok: false, missing };
  return { ok: true, decl: { product: input.product, rValue: null, areaM2: input.areaM2, signatureName: input.name, signature: input.signature, signedOn: new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date(input.signedAt)) } };
}
