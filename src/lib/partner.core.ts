// Pure Base44 partner-enquiry intake (property managers, installer partners, electricians/RECs).
// Partner enquiries are NOT jobs: this module only ever writes the partner_enquiries table.
import { z } from "zod";
import { BASE44_KEY_ID, verifyEd25519 } from "./enquiry.core";

export const PARTNER_TYPES = ["property_manager", "installer", "electrician_rec"] as const;
export type PartnerType = (typeof PARTNER_TYPES)[number];
export const PARTNER_STATUSES = ["new", "contacted", "onboarding", "approved", "declined", "closed"] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];
export const PARTNER_TYPE_LABEL: Record<PartnerType, string> = { property_manager: "Property Managers", installer: "Installers", electrician_rec: "Electricians / RECs" };

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
  property_count: z.coerce.number().int().min(0).max(1_000_000).nullish(),
  service_areas: list,
  cii_certification_status: str(100), cii_certification_details: str(2000),
  estimated_r5_install_rate_per_sqm_inc_gst: money,
  rec_registration_number: str(100), esv_licensed_electricians_confirmed: bool, services: list,
  estimated_piesa_fee_inc_gst: money, estimated_return_visit_fee_inc_gst: money,
  booking_lead_time: str(200), weekly_capacity: str(200),
  notes: str(5000), source_created_at: ts, source_updated_at: ts,
});
export type PartnerInput = z.output<typeof partnerSchema>;

/** Row written on create/update. Admin-owned fields (status, internal_notes, dates) are never overwritten by a resend. */
export function partnerRow(d: PartnerInput, raw: unknown) {
  return {
    source_system: "base44", enquiry_type: d.enquiry_type, submission_id: d.submission_id, external_id: d.external_id,
    source: d.source, source_status: d.status, name: d.name, email: d.email, phone: d.phone, company: d.company,
    property_count: d.property_count ?? null, service_areas: d.service_areas,
    cii_certification_status: d.cii_certification_status, cii_certification_details: d.cii_certification_details,
    estimated_r5_install_rate_per_sqm_inc_gst: d.estimated_r5_install_rate_per_sqm_inc_gst ?? null,
    rec_registration_number: d.rec_registration_number, esv_licensed_electricians_confirmed: d.esv_licensed_electricians_confirmed, services: d.services,
    estimated_piesa_fee_inc_gst: d.estimated_piesa_fee_inc_gst ?? null, estimated_return_visit_fee_inc_gst: d.estimated_return_visit_fee_inc_gst ?? null,
    booking_lead_time: d.booking_lead_time, weekly_capacity: d.weekly_capacity, notes: d.notes,
    source_created_at: d.source_created_at, source_updated_at: d.source_updated_at, raw_payload: raw as import("@/integrations/supabase/types").Json,
  };
}
export type PartnerRow = ReturnType<typeof partnerRow>;

/** The only side effect the endpoint may have: upsert one partner_enquiries row. */
export type PartnerDeps = { upsert: (row: PartnerRow) => Promise<{ id: string; created: boolean }>; publicKey?: string };

/** Full request handling: key id -> size -> Ed25519 over exact raw body -> parse -> validate -> upsert. */
export async function handlePartnerEnquiry(raw: string, headers: { get(n: string): string | null }, deps: PartnerDeps): Promise<{ status: number; body: Record<string, unknown> }> {
  const keyId = headers.get("x-hivic-key-id");
  if (keyId && keyId !== BASE44_KEY_ID) return { status: 401, body: { error: "Unknown key id" } };
  if (raw.length > 100_000) return { status: 413, body: { error: "Payload too large" } };
  if (!(await verifyEd25519(raw, headers.get("x-hivic-signature"), deps.publicKey))) return { status: 401, body: { error: "Invalid signature" } };
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return { status: 400, body: { error: "Invalid JSON" } }; }
  const parsed = partnerSchema.safeParse(json);
  if (!parsed.success) return { status: 400, body: { error: "Validation failed", issues: parsed.error.flatten() } };
  const r = await deps.upsert(partnerRow(parsed.data, json));
  return { status: 200, body: { ok: true, id: r.id, created: r.created } };
}
