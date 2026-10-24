// No-login owner "My job" view. The secure estimate link token is the only credential. Read-only.
import { isSpotSavedStage } from "./owner-myjob.core";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { isWellFormedToken, LINK_PURPOSE, linkUsable } from "./estimatelink.core";
import { formatPropertyAddress, shortAddress } from "./address";
import { DEFAULT_PIESA_INSTALL_GAP_DAYS, OWNER_STEPS, ownerAction, ownerCanCancel, ownerHero } from "./owner-myjob.core";
import { splitForOption } from "./payment-gate.core";

const n = (v: unknown) => Number(v ?? 0) || 0;

export async function resolveOwnerJob(token: unknown) {
  if (!isWellFormedToken(token)) return null;
  const { data: l } = await admin.from("customer_estimate_links").select("job_id, status, expires_at").eq("token", token as string).eq("purpose", LINK_PURPOSE).maybeSingle();
  if (!l || !linkUsable(l)) return null;
  const jobId = l.job_id;
  // At most six reads per wave: the published runtime has six outbound slots.
  const [{ data: j }, { data: quotes }, { data: bookings }, { data: invoices }, { data: est }, { data: ws }] = await Promise.all([
    admin.from("jobs").select("job_number, stage, channel, external_refs, owners(full_name), properties(address_line, suburb, state, postcode)").eq("id", jobId).single(),
    admin.from("quotes").select("id, kind, status, release_state, option_label, customer_total_inc_gst, veec_discount_inc_gst, subtotal_inc_gst, sent_at, accepted_at, version, quote_items(description, quantity, line_total_inc_gst, sort)").eq("job_id", jobId).eq("kind", "installation").in("status", ["issued", "accepted", "declined"]).order("created_at", { ascending: false }).order("created_at", { ascending: false }),
    admin.from("bookings").select("kind, status, scheduled_start, contractor_id, business_id").eq("job_id", jobId).in("status", ["confirmed", "completed"]).order("scheduled_start"),
    admin.from("invoices").select("total_paid, amount_paid").eq("job_id", jobId),
    admin.from("indicative_estimates").select("applied_discount").eq("job_id", jobId).is("superseded_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("workflow_settings").select("office_time_limits, piesa_install_window_days, safety_check_payment_inc_gst").eq("id", 1).maybeSingle(),
  ]);
  if (!j) return null;
  const [{ data: rc }, { data: spot }, { data: consent }, { data: cancellableBookings }] = await Promise.all([
    admin.from("ready_check_acceptances").select("accepted_at").eq("job_id", jobId).limit(1).maybeSingle(),
    admin.from("lead_campaign_responses").select("spot_saved_at, opted_out_at, media_received_at, video_requested, saved_veu_discount, saved_total").eq("job_id", jobId).maybeSingle(),
    admin.from("owner_esc_consents").select("status, scheduled_start").eq("job_id", jobId).eq("status", "awaiting_owner").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("bookings").select("kind").eq("job_id", jobId).in("status", ["proposed", "confirmed"]),
  ]);
  const stage = j.stage as string;
  // Held/queued quotes are office-only until released (source of truth: nothing goes to the owner while queued).
  const { ownerVisibleQuotes } = await import("./owner-quote-visibility.core");
  const shown = ownerVisibleQuotes(quotes ?? []);
  const quote = shown.find((q) => q.status === "accepted") ?? shown[0] ?? null;
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
  const quoteOpen = quote?.status === "issued" && (stage === "awaiting_quote_acceptance" || stage === "measured_estimate_ready") ? { expiresAt: quote.sent_at ? new Date(new Date(quote.sent_at).getTime() + 14 * 86400_000).toISOString() : null } : null;
  const bookingOpen = ["measured_quote_accepted", "piesa_and_install_window_pending", "installation_scheduling"].includes(stage);
  const action = ownerAction({ stage, readyCheckRequested: !!rc?.accepted_at, visit: upcoming?.scheduled_start ? { kind: upcoming.kind, startsAt: upcoming.scheduled_start } : null, quoteOpen, bookingOpen });
  const hero = ownerHero(stage, rebate);
  const done = (bookings ?? []).filter((b) => b.status === "completed");
  const doneAt = (kind: string) => done.find((b) => b.kind === kind)?.scheduled_start ?? null;
  const piesaDone = doneAt("assessment") ?? doneAt("rectification");
  const progress = OWNER_STEPS.map((label, i) => {
    const at = i === 0 ? doneAt("ready_check") : i === 1 ? quote?.accepted_at ?? null : i === 2 ? piesaDone : i === 3 ? doneAt("installation") : null;
    const state = i < hero.step || (i === 4 && stage === "complete") ? "done" : i === hero.step ? "now" : "later";
    return { label, state, at, mustBy: i === 3 && piesaDone ? new Date(new Date(piesaDone).getTime() + n(ws?.piesa_install_window_days ?? 30) * 86400_000).toISOString() : null };
  });
  // Installer already quoted and the owner agreed (Jo, 7 Oct 9:25pm): same acceptance path, different title.
  let agreed: { agreed: boolean; installerName: string | null } = { agreed: false, installerName: null };
  if ((j as { channel?: string }).channel === "installer_sourced" && ((j as { external_refs?: Record<string, unknown> | null }).external_refs ?? {})["owner_agreed_price"] === true) {
    const { data: a } = await admin.from("job_assignments").select("business_id, businesses(name, trading_name)").eq("job_id", jobId).eq("role", "installer").order("created_at").limit(1).maybeSingle();
    const b = a?.businesses as { name: string; trading_name: string | null } | null;
    agreed = { agreed: true, installerName: b?.trading_name || b?.name || null };
  }
  const owner = j.owners as { full_name: string | null } | null;
  const total = quote ? n(quote.customer_total_inc_gst) : null;
  // Decisions 139/140/141: what is due now, how to pay it (card only for the $349 / fixes), bank details + reference.
  // Owner-safe: amounts, state, the Xero online-invoice link and the invoice reference only – never Xero IDs or errors.
  const pay = quote?.status === "accepted" ? await (await import("./payments.server")).jobPaymentView(jobId).catch(() => null) : null;
  const payment = pay ? {
    steps: pay.steps.map((s) => ({ key: s.key, label: s.label, amount: s.amountCents / 100, state: s.state, card: s.methods.includes("card") })),
    dueNow: pay.due.dueNowCents / 100, remaining: pay.due.remainingCents / 100, paid: pay.paidCents / 100,
    payNow: { ...pay.payNow, amount: pay.payNow.amountCents / 100 }, reference: pay.reference,
    provisional: pay.provisional.decision === "provisional" ? { expiresAt: pay.provisional.expiresAt, deposit: pay.plan.installDepositCents / 100 } : null,
  } : null;
  const limits = (ws?.office_time_limits ?? {}) as Record<string, unknown>;
  return {
    jobNumber: j.job_number, firstName: owner?.full_name?.trim().split(/\s+/)[0] ?? null,
    address: formatPropertyAddress(j.properties as never) || null, stage, hero, action, trade: upcoming ? trade : null,
    visit: upcoming ? { kind: upcoming.kind, startsAt: upcoming.scheduled_start } : null, progress,
    numbers: { rebate, cost: total, paid }, agreed,
    quote: quote ? { id: quote.id, status: quote.status, label: quote.option_label, total, rebate: n(quote.veec_discount_inc_gst), version: quote.version, lines: [...(quote.quote_items ?? [])].sort((a, b) => a.sort - b.sort).map((i) => ({ description: i.description, amount: n(i.line_total_inc_gst) })), split: total != null ? splitForOption(total, ws?.safety_check_payment_inc_gst ?? null) : null } : null,
    payment,
    consent: consent ? { scheduledStart: consent.scheduled_start } : null,
    spotSaved: isSpotSavedStage(stage, spot ?? null, !!upcoming || (bookings ?? []).some((b) => b.kind === "ready_check")) ? {
      rebate: spot?.saved_veu_discount != null ? n(spot.saved_veu_discount) : rebate,
      cost: spot?.saved_total != null ? n(spot.saved_total) : null,
      shortAddress: shortAddress((j.properties as { address_line: string | null } | null)?.address_line, (j.properties as { suburb: string | null } | null)?.suburb),
      videoInvite: !!spot?.video_requested && !spot.media_received_at,
      optOutUrl: await (await import("./emailsafety.server")).unsubscribeUrlForJob(jobId),
    } : null,
    piesaInstallGapDays: n(limits["piesa_install_gap_days"] ?? DEFAULT_PIESA_INSTALL_GAP_DAYS),
    canCancel: ownerCanCancel(stage, (cancellableBookings ?? []).map((b) => b.kind)),
  };
}

/** Owner "Cancel my job" from the no-login My job page. Allowed only until the safety check is booked. */
export async function cancelOwnerJob(token: unknown): Promise<{ ok: boolean; reason?: string }> {
  if (!isWellFormedToken(token)) return { ok: false, reason: "Link not recognised." };
  const { data: l } = await admin.from("customer_estimate_links").select("job_id, status, expires_at").eq("token", token as string).eq("purpose", LINK_PURPOSE).maybeSingle();
  if (!l || !linkUsable(l)) return { ok: false, reason: "Link not recognised." };
  const [{ data: j }, { data: bk }] = await Promise.all([
    admin.from("jobs").select("stage").eq("id", l.job_id).single(),
    admin.from("bookings").select("id, kind, status").eq("job_id", l.job_id).in("status", ["proposed", "confirmed"]),
  ]);
  if (!j) return { ok: false, reason: "Link not recognised." };
  if (j.stage === "cancelled") return { ok: true };
  if (!ownerCanCancel(j.stage, (bk ?? []).map((b) => b.kind))) return { ok: false, reason: "Your Pre Insulation Electrical Safety Assessment (PIESA) is booked, so this can't be cancelled here. Reply to any of our emails and we'll help." };
  const { data: moved, error } = await admin.from("jobs").update({ stage: "cancelled", cancelled_reason: "Owner cancelled from My job", next_action: "Owner cancelled. Tell any assigned trade." }).eq("id", l.job_id).eq("stage", j.stage).select("id");
  if (error) throw new Error(error.message);
  // Nothing changed (the stage moved between the read and the update): report it, touch nothing else.
  if (!moved?.length) return { ok: false, reason: "Your job has just changed. Refresh the page and try again." };
  if (bk?.length) await admin.from("bookings").update({ status: "cancelled" }).in("id", bk.map((b) => b.id));
  // Stage 5 (Jo 23 Oct): cancelling the job releases its Mitti Ready Check form too.
  if (bk?.some((b) => b.kind === "ready_check")) await (await import("./mitti-pickup.server")).releaseReadyCheckFormOnCancel(l.job_id, null, "owner cancelled the job").catch(() => undefined);
  const { logEvent } = await import("./workflow.server");
  await logEvent(l.job_id, null, "owner_cancelled_job", "Owner cancelled their job from My job (before the Pre Insulation Electrical Safety Assessment (PIESA) was booked). No charge.", { bookings_cancelled: bk?.length ?? 0, trades_to_notify: true }, { from: j.stage as never, to: "cancelled" });
  return { ok: true };
}
