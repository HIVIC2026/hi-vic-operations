// No-login owner "My job" view. The secure estimate link token is the only credential. Read-only.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { isWellFormedToken, LINK_PURPOSE, linkUsable } from "./estimatelink.core";
import { formatPropertyAddress } from "./address";
import { DEFAULT_PIESA_INSTALL_GAP_DAYS, OWNER_STEPS, ownerAction, ownerHero } from "./owner-myjob.core";
import { splitForOption } from "./payment-gate.core";

const n = (v: unknown) => Number(v ?? 0) || 0;

export async function resolveOwnerJob(token: unknown) {
  if (!isWellFormedToken(token)) return null;
  const { data: l } = await admin.from("customer_estimate_links").select("job_id, status, expires_at").eq("token", token as string).eq("purpose", LINK_PURPOSE).maybeSingle();
  if (!l || !linkUsable(l)) return null;
  const jobId = l.job_id;
  const [{ data: j }, { data: quotes }, { data: bookings }, { data: invoices }, { data: est }, { data: rc }, { data: ws }] = await Promise.all([
    admin.from("jobs").select("job_number, stage, owners(full_name), properties(address_line, suburb, state, postcode)").eq("id", jobId).single(),
    admin.from("quotes").select("id, kind, status, option_label, customer_total_inc_gst, veec_discount_inc_gst, subtotal_inc_gst, sent_at, accepted_at, version, quote_items(description, quantity, line_total_inc_gst, sort)").eq("job_id", jobId).eq("kind", "installation").in("status", ["issued", "accepted"]).order("created_at", { ascending: false }),
    admin.from("bookings").select("kind, status, scheduled_start, contractor_id, business_id").eq("job_id", jobId).in("status", ["confirmed", "completed"]).order("scheduled_start"),
    admin.from("invoices").select("total_paid, amount_paid").eq("job_id", jobId),
    admin.from("indicative_estimates").select("applied_discount").eq("job_id", jobId).is("superseded_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("ready_check_acceptances").select("accepted_at").eq("job_id", jobId).limit(1).maybeSingle(),
    admin.from("workflow_settings").select("office_time_limits, piesa_install_window_days").eq("id", 1).maybeSingle(),
  ]);
  if (!j) return null;
  const { data: consent } = await admin.from("owner_esc_consents").select("status, scheduled_start").eq("job_id", jobId).eq("status", "awaiting_owner").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const stage = j.stage as string;
  const quote = (quotes ?? []).find((q) => q.status === "accepted") ?? (quotes ?? [])[0] ?? null;
  const rebate = quote ? n(quote.veec_discount_inc_gst) : n(est?.applied_discount);
  const now = Date.now();
  const upcoming = (bookings ?? []).find((b) => b.status === "confirmed" && b.scheduled_start && new Date(b.scheduled_start).getTime() > now - 6 * 3600_000) ?? null;
  let trade: { name: string; company: string | null; phone: string | null; initial: string } | null = null;
  if (upcoming?.contractor_id) {
    const [{ data: p }, { data: b }] = await Promise.all([
      admin.from("profiles").select("full_name, phone").eq("id", upcoming.contractor_id).maybeSingle(),
      upcoming.business_id ? admin.from("businesses").select("name, trading_name").eq("id", upcoming.business_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const name = p?.full_name?.split(" ")[0] ?? "Your trade";
    trade = { name, company: (b as { trading_name: string | null; name: string } | null)?.trading_name ?? (b as { name: string } | null)?.name ?? null, phone: p?.phone ?? null, initial: name.charAt(0).toUpperCase() };
  }
  const paid = (invoices ?? []).reduce((s, i) => s + n(i.total_paid ?? i.amount_paid), 0);
  const quoteOpen = quote?.status === "issued" && stage === "awaiting_quote_acceptance" ? { expiresAt: quote.sent_at ? new Date(new Date(quote.sent_at).getTime() + 14 * 86400_000).toISOString() : null } : null;
  const bookingOpen = ["measured_quote_accepted", "piesa_and_install_window_pending", "installation_scheduling"].includes(stage);
  const action = ownerAction({ stage, readyCheckRequested: !!rc?.accepted_at, visit: upcoming ? { kind: upcoming.kind, startsAt: upcoming.scheduled_start! } : null, quoteOpen, bookingOpen });
  const hero = ownerHero(stage, rebate);
  const done = (bookings ?? []).filter((b) => b.status === "completed");
  const doneAt = (kind: string) => done.find((b) => b.kind === kind)?.scheduled_start ?? null;
  const piesaDone = doneAt("assessment") ?? doneAt("rectification");
  const progress = OWNER_STEPS.map((label, i) => {
    const at = i === 0 ? doneAt("ready_check") : i === 1 ? quote?.accepted_at ?? null : i === 2 ? piesaDone : i === 3 ? doneAt("installation") : null;
    const state = i < hero.step || (i === 4 && stage === "complete") ? "done" : i === hero.step ? "now" : "later";
    return { label, state, at, mustBy: i === 3 && piesaDone ? new Date(new Date(piesaDone).getTime() + n(ws?.piesa_install_window_days ?? 30) * 86400_000).toISOString() : null };
  });
  const owner = j.owners as { full_name: string | null } | null;
  const total = quote ? n(quote.customer_total_inc_gst) : null;
  const limits = (ws?.office_time_limits ?? {}) as Record<string, unknown>;
  return {
    jobNumber: j.job_number, firstName: owner?.full_name?.trim().split(/\s+/)[0] ?? null,
    address: formatPropertyAddress(j.properties as never) || null, stage, hero, action, trade: upcoming ? trade : null,
    visit: upcoming ? { kind: upcoming.kind, startsAt: upcoming.scheduled_start } : null, progress,
    numbers: { rebate, cost: total, paid },
    quote: quote ? { id: quote.id, status: quote.status, label: quote.option_label, total, rebate: n(quote.veec_discount_inc_gst), version: quote.version, lines: [...(quote.quote_items ?? [])].sort((a, b) => a.sort - b.sort).map((i) => ({ description: i.description, amount: n(i.line_total_inc_gst) })), split: total != null ? splitForOption(total) : null } : null,
    consent: consent ? { scheduledStart: consent.scheduled_start } : null,
    piesaInstallGapDays: n(limits["piesa_install_gap_days"] ?? DEFAULT_PIESA_INSTALL_GAP_DAYS),
  };
}
