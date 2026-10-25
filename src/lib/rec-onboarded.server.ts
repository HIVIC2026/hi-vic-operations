// Decision 303 (Jo 25 Oct 2026): read-only facts for "is the installer's electrician an approved REC?" — approved, active
// REC businesses (business_type rec / electrician capability), their approved electrician workers' licences and their
// ACTIVE onboarded PIESA rate (electrician_rates, selectAgreedRate). Rules live in rec-onboarded.core.ts. No writes, no
// senders: this module is reached from the quote pipeline (autoAdvance graph).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { selectAgreedRate, type ElectricianRateRow } from "./allocation.core";
import type { ApprovedRecCandidate } from "./rec-onboarded.core";

const melbourneToday = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/** Every REC business on the portal with the facts the onboarded check needs. Read errors throw (fail closed upstream). */
export async function loadApprovedRecCandidates(now = new Date()): Promise<ApprovedRecCandidate[]> {
  const { data: bizs, error } = await admin.from("businesses").select("id, name, trading_name, rec_number, onboarding_status, is_active").or("business_type.eq.rec,capabilities.cs.{electrician}");
  if (error) throw new Error("Could not read the approved electricians.");
  const ids = (bizs ?? []).map((b) => b.id);
  if (!ids.length) return [];
  const [{ data: workers, error: we }, { data: rates, error: re }] = await Promise.all([
    admin.from("partner_workers").select("business_id, licence_number").eq("trade_role", "electrician").eq("approval_status", "approved").is("removed_at", null).in("business_id", ids),
    admin.from("electrician_rates").select("id, business_id, service_type, rate_inc_gst, status, effective_from, effective_to").in("business_id", ids).eq("service_type", "piesa").eq("status", "active"),
  ]);
  if (we || re) throw new Error("Could not read the approved electricians' rates.");
  const today = melbourneToday(now);
  return (bizs ?? []).map((b) => {
    const rate = selectAgreedRate((rates ?? []) as ElectricianRateRow[], b.id, "piesa", today);
    const ws = (workers ?? []).filter((w) => w.business_id === b.id);
    return {
      business_id: b.id, name: b.name ?? null, trading_name: b.trading_name ?? null, rec_number: b.rec_number ?? null,
      onboarding_status: b.onboarding_status ?? null, is_active: b.is_active ?? null,
      worker_licences: ws.map((w) => w.licence_number), approved_electricians: ws.length,
      piesa_rate: rate ? { id: rate.id, rate_inc_gst: rate.rate_inc_gst } : null,
    };
  });
}
