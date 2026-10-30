// Jo 26 Oct 2026: which jobs' safety check we pay to the INSTALLER instead of the electrician (rules in
// installer-paid-electricians.core.ts). Read-only, batched by job id; read errors throw (fail closed upstream).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { installerPaysOwnElectricians, safetyCheckPayee, type InstallerPaidElectricians, type InstallerPiesaResult } from "./installer-paid-electricians.core";
import type { InHousePiesaBusiness } from "./installer-paid-electricians.core";
import { melbourneToday } from "./melbourne-time.core";

/** Pending schema uses a local read overlay; a missing flag never enables the arrangement. */
export async function inHouseBusinessesFor(ids: string[]): Promise<Map<string, InHousePiesaBusiness>> {
  const out = new Map<string, InHousePiesaBusiness>();
  if (!ids.length) return out;
  const { data: businesses, error } = await admin.from("businesses").select("id,name,in_house").in("id", [...new Set(ids)]).eq("in_house", true);
  if (error) throw new Error("Could not read in-house partner configuration.");
  const enabled = (businesses ?? []).filter(b => (b as unknown as { in_house?: boolean }).in_house === true);
  if (!enabled.length) return out;
  const { data: cards, error: ce } = await admin.from("rate_cards").select("id,business_id,version,effective_from")
    .in("business_id", enabled.map(b => b.id)).eq("kind", "electrical").eq("is_active", true).lte("effective_from", melbourneToday()).order("version", { ascending: false });
  if (ce) throw new Error("Could not read the in-house PIESA rate cards.");
  const { data: lines, error: le } = cards?.length ? await admin.from("rate_card_items").select("rate_card_id,code,unit_price_ex_gst").in("rate_card_id", cards.map(c => c.id)).ilike("code", "piesa") : { data: [], error: null };
  if (le) throw new Error("Could not read the in-house PIESA prices.");
  for (const b of enabled) {
    const card = (cards ?? []).find(c => c.business_id === b.id && (lines ?? []).some(l => l.rate_card_id === c.id));
    const line = card ? (lines ?? []).find(l => l.rate_card_id === card.id) : null;
    out.set(b.id, { id: b.id, name: b.name, in_house: true, piesaIncGst: line ? Math.round(Number(line.unit_price_ex_gst) * 110) / 100 : null });
  }
  return out;
}

export async function readInstallerPaidElectricians(businessId: string | null | undefined): Promise<InstallerPiesaResult | null> {
  if (!businessId) return null;
  return installerPaysOwnElectricians((await inHouseBusinessesFor([businessId])).get(businessId));
}

export async function inHouseFactsFor(businessId: string) {
  const { data: workers, error } = await admin.from("partner_workers").select("profile_id,email")
    .eq("business_id", businessId).eq("trade_role", "electrician").eq("approval_status", "approved").is("removed_at", null);
  if (error) throw new Error("Could not read approved electrician workers.");
  const ids = (workers ?? []).flatMap(w => w.profile_id ? [w.profile_id] : []);
  const { data: profiles, error: pe } = ids.length ? await admin.from("profiles").select("id,email,mitti_user_id,mitti_checked_at,mitti_checked_email").in("id", ids) : { data: [], error: null };
  if (pe) throw new Error("Could not read electrician Mitti logins.");
  const { mittiAccessOf } = await import("./mitti-membership.core");
  // Read cards independently of the current flag so an office can enable a new partner.
  const { data: cards, error: ce } = await admin.from("rate_cards").select("id").eq("business_id", businessId).eq("is_active", true).lte("effective_from", melbourneToday());
  if (ce) throw new Error("Could not read the partner rate cards.");
  const { data: lines, error: le } = cards?.length ? await admin.from("rate_card_items").select("unit_price_ex_gst").in("rate_card_id", cards.map(c => c.id)).ilike("code", "piesa") : { data: [], error: null };
  if (le) throw new Error("Could not read the PIESA rate-card line.");
  return { approvedElectricianWorkers: workers?.length ?? 0,
    hasActiveRateCardWithPiesa: (lines ?? []).some(l => Number(l.unit_price_ex_gst) > 0),
    mittiElectricianLogins: (workers ?? []).filter(w => {
      const p = (profiles ?? []).find(p => p.id === w.profile_id);
      return !!p && mittiAccessOf({ ...p, email: w.email ?? p.email }) === "member";
    }).length };
}

/** Per job: the installer we pay for the safety check, or null (we pay the electrician as usual). */
export async function safetyCheckPayeesFor(jobs: { id: string; originating_installer_business_id: string | null }[]): Promise<Map<string, InstallerPaidElectricians | null>> {
  const out = new Map<string, InstallerPaidElectricians | null>(jobs.map((j) => [j.id, null]));
  const businesses = await inHouseBusinessesFor([...new Set(jobs.flatMap(j => j.originating_installer_business_id ? [j.originating_installer_business_id] : []))]);
  const candidates = jobs.filter((j) => installerPaysOwnElectricians(businesses.get(j.originating_installer_business_id ?? "")));
  if (!candidates.length) return out;
  const { data, error } = await admin.from("workflow_events").select("job_id, details, created_at").in("job_id", candidates.map((j) => j.id))
    .eq("event_type", "mitti_electrician_recorded").order("created_at", { ascending: false });
  if (error) throw new Error(`Could not read the Ready Check electrician choices: ${error.message}`);
  const choice = new Map<string, string | null>();
  for (const e of (data ?? []) as { job_id: string; details: { choice?: string | null } | null }[]) if (!choice.has(e.job_id)) choice.set(e.job_id, e.details?.choice ?? null);
  for (const j of candidates) {
    const payee = safetyCheckPayee({ business: businesses.get(j.originating_installer_business_id ?? ""), electricianChoice: choice.get(j.id) ?? null });
    if (payee?.release_hold_reason) throw new Error(payee.release_hold_reason);
    out.set(j.id, payee);
  }
  return out;
}
