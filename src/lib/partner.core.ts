// Pure Base44 trade-partner enquiry intake (installers and electricians/RECs).
// Partner enquiries are NOT jobs: this module only ever writes the partner_enquiries table.
import { z } from "zod";
import { BASE44_KEY_ID, verifyBase44Webhook } from "./enquiry.core";

export const PARTNER_TYPES = ["installer", "electrician_rec"] as const;
export type PartnerType = (typeof PARTNER_TYPES)[number];
export const PARTNER_STATUSES = ["new", "contacted", "onboarding", "approved", "declined", "closed"] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];
export const PARTNER_TYPE_LABEL: Record<PartnerType, string> = { installer: "Installers", electrician_rec: "Electricians / RECs" };

const str = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const money = z.coerce.number().min(0).max(100000).nullish();
const list = z.union([z.array(z.string().trim().max(200)).max(50), z.string().max(2000)]).nullish()
  .transform((v) => (v == null ? null : (Array.isArray(v) ? v : v.split(/[,;\n]/)).map((s) => s.trim()).filter(Boolean).slice(0, 50)));
const bool = z.union([z.boolean(), z.enum(["yes", "no", "true", "false"])]).nullish()
  .transform((v) => (v == null ? null : v === true || v === "yes" || v === "true"));
const ts = z.string().max(40).nullish().transform((v) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null));

export const partnerSchema = z.object({
  enquiry_type: z.enum(PARTNER_TYPES),
  submission_id: z.string().trim().min(1).max(200),
  external_id: str(200),
  status: str(50),
  name: str(200), email: z.string().trim().email().max(320).nullish().transform((v) => v ?? null), phone: str(50), company: str(200), source: str(100),
  service_areas: list,
  cii_certification_status: str(100), cii_certification_details: str(2000),
  estimated_r5_install_rate_per_sqm_inc_gst: money,
  estimated_batts_removal_rate_per_sqm_inc_gst: money,
  estimated_loose_fill_removal_rate_per_sqm_inc_gst: money,
  free_quotes_for_hivic_leads: bool,
  free_measureups_for_hivic_quote_leads: bool,
  rec_registration_number: str(100), esv_licensed_electricians_confirmed: bool, services: list,
  estimated_piesa_fee_inc_gst: money, estimated_return_visit_fee_inc_gst: money,
  booking_lead_time: str(200),
  notes: str(5000), source_created_at: ts, source_updated_at: ts,
});
export type PartnerInput = z.output<typeof partnerSchema>;

/** Row written on create/update. Admin-owned fields (status, internal_notes, dates) are never overwritten by a resend. */
export function partnerRow(d: PartnerInput, raw: unknown) {
  return {
    source_system: "base44", enquiry_type: d.enquiry_type, submission_id: d.submission_id, external_id: d.external_id,
    source: d.source, source_status: d.status, name: d.name, email: d.email, phone: d.phone, company: d.company,
    service_areas: d.service_areas,
    cii_certification_status: d.cii_certification_status, cii_certification_details: d.cii_certification_details,
    estimated_r5_install_rate_per_sqm_inc_gst: d.estimated_r5_install_rate_per_sqm_inc_gst ?? null,
    estimated_batts_removal_rate_per_sqm_inc_gst: d.estimated_batts_removal_rate_per_sqm_inc_gst ?? null,
    estimated_loose_fill_removal_rate_per_sqm_inc_gst: d.estimated_loose_fill_removal_rate_per_sqm_inc_gst ?? null,
    free_quotes_for_hivic_leads: d.free_quotes_for_hivic_leads ?? null,
    free_measureups_for_hivic_quote_leads: d.free_measureups_for_hivic_quote_leads ?? null,
    rec_registration_number: d.rec_registration_number, esv_licensed_electricians_confirmed: d.esv_licensed_electricians_confirmed, services: d.services,
    estimated_piesa_fee_inc_gst: d.estimated_piesa_fee_inc_gst ?? null, estimated_return_visit_fee_inc_gst: d.estimated_return_visit_fee_inc_gst ?? null,
    booking_lead_time: d.booking_lead_time, notes: d.notes,
    source_created_at: d.source_created_at, source_updated_at: d.source_updated_at, raw_payload: raw as import("@/integrations/supabase/types").Json,
  };
}
export type PartnerRow = ReturnType<typeof partnerRow>;

/**
 * Review-time issue flags for a partner application. Pure: same row in, same flags out.
 * These are warnings for the office, never automatic declines.
 */
export function partnerIssues(r: {
  enquiry_type: string;
  phone?: string | null;
  service_areas?: string[] | null;
  rec_registration_number?: string | null;
  esv_licensed_electricians_confirmed?: boolean | null;
  estimated_piesa_fee_inc_gst?: number | null;
  estimated_return_visit_fee_inc_gst?: number | null;
  cii_certification_status?: string | null;
  raw_payload?: unknown;
  estimated_r5_install_rate_per_sqm_inc_gst?: number | null;
  free_quotes_for_hivic_leads?: boolean | null;
  free_measureups_for_hivic_quote_leads?: boolean | null;
}): string[] {
  const issues: string[] = [];
  if (!r.phone) issues.push("No phone number supplied");
  if (!r.service_areas || r.service_areas.length === 0) issues.push("No service areas listed");
  if (r.enquiry_type === "electrician_rec") {
    if (r.esv_licensed_electricians_confirmed === false) issues.push("Confirmed NO ESV-licensed electricians — PIESA compliance risk");
    else if (r.esv_licensed_electricians_confirmed == null) issues.push("ESV-licensed electricians not confirmed");
    if (!r.rec_registration_number) issues.push("No REC registration number");
    if (r.estimated_piesa_fee_inc_gst == null) issues.push("No indicative PIESA fee");
    if (r.estimated_return_visit_fee_inc_gst == null) issues.push("No indicative return visit fee");
  }
  if (r.enquiry_type === "installer") {
    const people = signedInstallers(r.raw_payload);
    if (people) {
      // Signed onboarding: CII is per person, never a business-level claim.
      const uncertified = people.filter((p) => p.cii_holds !== "held").length;
      if (people.length === 0) issues.push("No installers listed");
      else if (uncertified > 0) issues.push(`${uncertified} of ${people.length} installer${people.length === 1 ? "" : "s"} not CII certified yet`);
    } else if (r.cii_certification_status === "not_certified") issues.push("Not CII certified");
    else if (!r.cii_certification_status) issues.push("CII certification status not supplied");
    if (r.estimated_r5_install_rate_per_sqm_inc_gst == null) issues.push("No indicative R5.0 install rate");
    if (r.free_quotes_for_hivic_leads === false) issues.push("Charges for quotes on pre-qualified Home Insulation Victoria leads");
    if (r.free_measureups_for_hivic_quote_leads === false) issues.push("Does not offer free Ready Checks for pre-qualified Home Insulation Victoria quote leads");
  }
  return issues;
}

/** The only side effect the endpoint may have: upsert one partner_enquiries row. */
export type PartnerDeps = { upsert: (row: PartnerRow) => Promise<{ id: string; created: boolean }>; consumeNonce: (nonce: string, signedAt: string) => Promise<boolean>; publicKey?: string };

/** Full request handling: key id -> size -> Ed25519 over exact raw body -> parse -> validate -> upsert. */
export async function handlePartnerEnquiry(raw: string, headers: { get(n: string): string | null }, deps: PartnerDeps): Promise<{ status: number; body: Record<string, unknown> }> {
  const keyId = headers.get("x-hivic-key-id");
  if (keyId && keyId !== BASE44_KEY_ID) return { status: 401, body: { error: "Unknown key id" } };
  if (raw.length > 100_000) return { status: 413, body: { error: "Payload too large" } };
  const signed = await verifyBase44Webhook(raw, headers as Headers, deps.publicKey);
  if (!signed.ok) return { status: 401, body: { error: "Invalid signature" } };
  if (signed.protocol === "timestamped" && !(await deps.consumeNonce(signed.nonce, signed.timestamp))) return { status: 401, body: { error: "Invalid signature" } };
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return { status: 400, body: { error: "Invalid JSON" } }; }
  const parsed = partnerSchema.safeParse(json);
  if (!parsed.success) return { status: 400, body: { error: "Validation failed" } };
  const r = await deps.upsert(partnerRow(parsed.data, json));
  return { status: 200, body: { ok: true, id: r.id, created: r.created } };
}

/** Per-person installers from a signed onboarding snapshot; null when the row didn't come from signed onboarding. */
export function signedInstallers(raw: unknown): { name: string | null; cii_holds: string | null }[] | null {
  const list = (raw as { installers?: unknown } | null | undefined)?.installers;
  if (!Array.isArray(list)) return null;
  return list.map((x) => ({ name: (x as { name?: string | null })?.name ?? null, cii_holds: (x as { cii_holds?: string | null })?.cii_holds ?? null }));
}

/** Short plain-words CII line for office lists. */
export function ciiSummary(r: { cii_certification_status?: string | null; raw_payload?: unknown }): string {
  const people = signedInstallers(r.raw_payload);
  if (!people) return r.cii_certification_status ?? "—";
  if (people.length === 0) return "No installers listed";
  const held = people.filter((p) => p.cii_holds === "held").length;
  return `${held} of ${people.length} installer${people.length === 1 ? "" : "s"} certified`;
}
