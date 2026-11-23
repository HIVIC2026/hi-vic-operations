// No-login owner "My job" view. The secure estimate link token is the only credential. Read-only.
import { currentOwnerAction, isSpotSavedStage, spotReleasedForPage } from "./owner-myjob.core";
import { currentFeeWording } from "./hiv-quote.core";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { isWellFormedToken, LINK_PURPOSE, linkUsable } from "./estimatelink.core";
import { formatPropertyAddress, shortAddress } from "./address";
import { DEFAULT_PIESA_INSTALL_GAP_DAYS, OWNER_STEPS, nextVisitCard, ownerAction, ownerCanCancel, ownerHero, ownerStage } from "./owner-myjob.core";
import { splitForOption } from "./payment-gate.core";
import { stepInvoiceKind } from "./payments.core";
import { safetyCheckIncGstFor } from "./safety-check-amount.core";
import { SPOT_RELEASE_EVENTS } from "./spot-release.core";

const n = (v: unknown) => Number(v ?? 0) || 0;

/** True once the upfront safety check is paid. Fails closed: if the payment check errors, treat it as paid (no cancel). No invoice = nothing paid. */
export async function safetyCheckPaidFor(jobId: string, anyPaid = true): Promise<boolean> {
  if (!anyPaid) return false;
  try {
    const { jobPaymentView } = await import("./payments.server");
    const { isStepPaid } = await import("./payments.core");
    const v = await jobPaymentView(jobId);
    return !!v && isStepPaid(v.steps, "safety_check");
  } catch (e) {
    console.error("owner cancel: payment check failed, treating the safety check as paid", (e as Error).message);
    return true;
  }
}

export async function resolveOwnerJob(token: unknown) {
  if (!isWellFormedToken(token)) return null;
  const { data: l } = await admin.from("customer_estimate_links").select("job_id, status, expires_at").eq("token", token as string).eq("purpose", LINK_PURPOSE).maybeSingle();
  if (!l || !linkUsable(l)) return null;
  const jobId = l.job_id;
  // At most six reads per wave: the published runtime has six outbound slots.
  const [{ data: j }, { data: quotes }, { data: bookings }, { data: invoices }, { data: est }, { data: ws }] = await Promise.all([
    admin.from("jobs").select("job_number, stage, deleted_at, channel, originating_installer_business_id, external_refs, cancelled_reason, installation_completed_at, owners(full_name, email, phone), properties(address_line, suburb, state, postcode)").eq("id", jobId).single(),
    admin.from("quotes").select("id, kind, status, release_state, option_label, customer_total_inc_gst, veec_discount_inc_gst, subtotal_inc_gst, sent_at, accepted_at, version, quote_items(code, description, quantity, line_total_inc_gst, sort)").eq("job_id", jobId).eq("kind", "installation").in("status", ["issued", "accepted", "declined", "expired"]).order("created_at", { ascending: false }),
    admin.from("bookings").select("kind, status, scheduled_start, contractor_id, business_id").eq("job_id", jobId).in("status", ["confirmed", "completed"]).order("scheduled_start"),
    // "Paid" next to the install price: the installation invoice (batch 3b: fixes / repeat check have their own invoices).
    admin.from("invoices").select("total_paid, amount_paid").eq("job_id", jobId).eq("kind", "installation"),
    admin.from("indicative_estimates").select("applied_discount").eq("job_id", jobId).is("superseded_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("workflow_settings").select("office_time_limits, piesa_install_window_days, safety_check_payment_inc_gst").eq("id", 1).maybeSingle(),
  ]);
  if (!j) return null;
  const [{ data: rc }, { data: spot }, { data: cancellableBookings }, { data: veecRows }, released, { data: cm }] = await Promise.all([
    admin.from("ready_check_acceptances").select("accepted_at").eq("job_id", jobId).limit(1).maybeSingle(),
    admin.from("lead_campaign_responses").select("spot_saved_at, opted_out_at, media_received_at, video_requested, saved_veu_discount, saved_total").eq("job_id", jobId).maybeSingle(),
    admin.from("bookings").select("kind").eq("job_id", jobId).in("status", ["proposed", "confirmed"]),
    admin.from("customer_assignments").select("status, consumer_signed_at").eq("job_id", jobId).eq("record_kind", "final_veec_assignment").order("created_at", { ascending: false }),
    // Jo 29 Oct (HV-3542): once the spot is released the spot-saved page stops saying "we'll be in touch". Lapsed = back in the queue. A failed read = not released. (Six reads in this wave: at the cap.)
    admin.from("workflow_events").select("event_type, created_at, details").eq("job_id", jobId).in("event_type", [...SPOT_RELEASE_EVENTS]).then(({ data, error }) => !error && spotReleasedForPage(data ?? []), () => false),
    // Jo 4 Nov 2026 16:10: the Ready Check's "old insulation stays" facts (kept-insulation.core). A failed read = no notice. (Sixth read in this wave: at the cap.)
    admin.from("ceiling_measurements").select("insulation_present, removal_required, zones").eq("job_id", jobId).eq("is_current", true).maybeSingle().then((r) => r, () => ({ data: null })),
  ]);
  const veec = ((veecRows ?? []) as { status: string; consumer_signed_at: string | null }[]).find((a) => a.status !== "cancelled") ?? null;
  // An archived job reads as closed to the owner, the same as a cancelled one.
  const stage = ownerStage(j.stage as string, (j as { deleted_at?: string | null }).deleted_at ?? null);
  // Held/queued quotes are office-only until released (source of truth: nothing goes to the owner while queued).
  const { ownerVisibleQuotes } = await import("./owner-quote-visibility.core");
  const shown = ownerVisibleQuotes(quotes ?? []);
  const latestQuote = shown.find((q) => q.status === "accepted") ?? shown[0] ?? null;
  // An owner-requested garage-only scope change makes the previous whole-house quote obsolete.
  // Hide it from My job (including old ?screen=quote links); do not show its rebate or any payment button.
  // The acceptance server independently checks this same owner-email fact before any payment/signature.
  // Only held issued jobs need the extra inbound-email lookup; normal My job traffic remains fast.
  const scopeChangePending = latestQuote?.status === "issued" && stage === "on_hold"
    ? await (await import("./mates-rates-guard.server")).garageScopeChangeAfterQuote(jobId, latestQuote.sent_at)
    : false;
  const quote = scopeChangePending ? null : latestQuote;
  const rebate = scopeChangePending ? 0 : quote ? n(quote.veec_discount_inc_gst) : n(est?.applied_discount);
  const now = Date.now();
  const upcoming = (bookings ?? []).find((b) => b.status === "confirmed" && b.scheduled_start && new Date(b.scheduled_start).getTime() > now - 6 * 3600_000) ?? null;
  let trade: { name: string; company: string | null; phone: string | null; initial: string } | null = null;
  if (upcoming) {
    // G8 (4): who is coming — the booking's profile when the person has a login; a safety check / upgrades visit by a no-login
    // Team electrician names the worker on the job (teamElectricianOnJob); the business comes from the booking. ≤3 reads.
    const electrical = upcoming.kind === "assessment" || upcoming.kind === "rectification";
    const [{ data: p }, { data: b }, team] = await Promise.all([
      upcoming.contractor_id ? admin.from("profiles").select("full_name, phone").eq("id", upcoming.contractor_id).maybeSingle() : Promise.resolve({ data: null }),
      upcoming.business_id ? admin.from("businesses").select("name, trading_name").eq("id", upcoming.business_id).maybeSingle() : Promise.resolve({ data: null }),
      !upcoming.contractor_id && electrical ? (await import("./in-house-electrician.server")).teamElectricianOnJob(jobId).catch(() => null) : Promise.resolve(null),
    ]);
    const full = (p as { full_name?: string | null } | null)?.full_name ?? team?.name ?? null;
    const company = ((b as { trading_name: string | null; name: string } | null)?.trading_name ?? (b as { name: string } | null)?.name ?? null)?.replace(/^\[TEST PARTNER\]\s*/, "") ?? null;
    if (full || company) {
      const name = full?.trim().split(/\s+/)[0] || (electrical ? "Your electrician" : "Your trade");
      trade = { name, company, phone: (p as { phone?: string | null } | null)?.phone ?? null, initial: name.charAt(0).toUpperCase() };
    }
  }
  const paid = (invoices ?? []).reduce((s, i) => s + n(i.total_paid ?? i.amount_paid), 0);
  const quoteOpen = quote?.status === "issued" && (stage === "awaiting_quote_acceptance" || stage === "measured_estimate_ready") ? { expiresAt: quote.sent_at ? (await import('./quote-expiry.core')).quoteExpiresAt(quote.sent_at).toISOString() : null } : null;
  const bookingOpen = ["measured_quote_accepted", "piesa_and_install_window_pending", "installation_scheduling"].includes(stage);
  const inHouseDispatch = await (await import("./in-house-suppression.server")).inHouseDispatchSkip(jobId);
  // Fix round 1 (Task 14): the installer's name for the "will call you to book" line while the install day is being arranged.
  let installerName: string | null = null;
  if (bookingOpen) {
    const { data: ia } = await admin.from("job_assignments").select("businesses(name, trading_name)").eq("job_id", jobId).eq("role", "installer").eq("active", true).order("assigned_at", { ascending: false }).limit(1).maybeSingle();
    const ib = ia?.businesses as { name: string; trading_name: string | null } | null;
    installerName = (ib?.trading_name || ib?.name || null)?.replace(/^\[TEST PARTNER\]\s*/, "") ?? null;
  }
  const action = ownerAction({ stage, readyCheckRequested: !!rc?.accepted_at, visit: upcoming?.scheduled_start ? { kind: upcoming.kind, startsAt: upcoming.scheduled_start } : null, quoteOpen, bookingOpen, installerName });
  if (inHouseDispatch && action.button?.screen === "book") { action.button = null; action.title = ""; action.sentence = ""; }
  const hero = ownerHero(stage, rebate);
  const done = (bookings ?? []).filter((b) => b.status === "completed");
  const doneAt = (kind: string) => done.find((b) => b.kind === kind)?.scheduled_start ?? null;
  const piesaDone = doneAt("assessment") ?? doneAt("rectification");
  const progress = OWNER_STEPS.map((label, i) => {
    const at = i === 0 ? doneAt("ready_check") : i === 1 ? quote?.accepted_at ?? null : i === 2 ? piesaDone : i === 3 ? doneAt("installation") : null;
    const state = i < hero.step || (i === 4 && stage === "complete") ? "done" : i === hero.step ? "now" : "later";
    // Decision 388: before the spot is saved the first step is never called a Ready Check.
    return { label: i === 0 && action.button?.screen === "spot" ? "Save your spot" : label, state, at, mustBy: i === 3 && piesaDone ? new Date(new Date(piesaDone).getTime() + n(ws?.piesa_install_window_days ?? 30) * 86400_000).toISOString() : null };
  });
  // Installer already quoted and the owner agreed (Jo, 7 Oct 9:25pm): same acceptance path, different title.
  let agreed: { agreed: boolean; installerName: string | null } = { agreed: false, installerName: null };
  if ((j as { channel?: string }).channel === "installer_sourced" && ((j as { external_refs?: Record<string, unknown> | null }).external_refs ?? {})["owner_agreed_price"] === true) {
    const { data: a } = await admin.from("job_assignments").select("business_id, businesses(name, trading_name)").eq("job_id", jobId).eq("role", "installer").order("assigned_at").limit(1).maybeSingle();
    const b = a?.businesses as { name: string; trading_name: string | null } | null;
    agreed = { agreed: true, installerName: b?.trading_name || b?.name || null };
  }
  const owner = j.owners as { full_name: string | null; email?: string | null; phone?: string | null } | null;
  // Jo 4 Nov 2026 16:10 (approved): "Your old insulation stays." on the quote page and My job when the Ready Check recorded
  // it was kept (not removed + good enough to lay over) — Home Insulation Victoria leads and own customers alike. The
  // installer's name comes from the names already read, else one small read; unknown → "Your installer" (never a guess).
  let keptInsulation: { line: string } | null = null;
  if (quote && (await import("./kept-insulation.core")).oldInsulationKept(cm as { insulation_present?: boolean | null; removal_required?: boolean | null; zones?: unknown } | null)) {
    let name: string | null = installerName ?? agreed.installerName ?? null;
    if (!name) {
      try {
        const { data: ia } = await admin.from("job_assignments").select("businesses(name, trading_name)").eq("job_id", jobId).eq("role", "installer").eq("active", true).order("assigned_at", { ascending: false }).limit(1).maybeSingle();
        const ib = ia?.businesses as { name: string | null; trading_name: string | null } | null;
        name = (ib?.trading_name || ib?.name || null)?.replace(/^\[TEST PARTNER\]\s*/, "") ?? null;
      } catch { name = null; }
    }
    keptInsulation = { line: (await import("./kept-insulation.core")).keptInsulationNotice(name) };
  }
  // Quote page (#29/#33): the "What's changed" rows and the 30-day valid line. Best-effort presentation: a failed read shows
  // neither (never a wrong date or number); 14-day quotes keep "price held until" and have no valid line.
  let quoteChanges: { label: string; estimate: string; quote: string }[] = [];
  // undefined = the Ready Check wording; null = no footnote (a photo quote — never "Ready Check").
  let quoteChangesFootnote: string | null | undefined;
  let quoteValid: { line: string; until: string } | null = null;
  if (quote && quoteOpen) {
    try {
      const { loadOwnerQuoteFacts } = await import("./quote-ready-notify.server");
      const { quoteValidLine } = await import("./quote-expiry.core");
      const facts = await loadOwnerQuoteFacts(jobId, quote.id, owner?.full_name ?? null, null);
      quoteChanges = facts.input?.changes ?? [];
      quoteChangesFootnote = facts.input?.changesFootnote;
      if (facts.input?.validDays === 30 && facts.input.validUntil) quoteValid = { line: quoteValidLine(facts.input.validUntil), until: facts.input.validUntil.toISOString() };
    } catch (e) { console.error("owner quote page: changes/valid line unavailable", (e as Error).message); }
  }
  const total = quote ? n(quote.customer_total_inc_gst) : null;
  // Decisions 139/140/141: what is due now, how to pay it (card for the card steps), bank details + reference. Batch 3b:
  // each step shows its own amount, and the reference is the due step's own invoice (fixes / repeat check have their own).
  // Owner-safe: amounts, state, the Xero online-invoice link and the invoice reference only – never Xero IDs or errors.
  const pay = quote?.status === "accepted" ? await (await import("./payments.server")).jobPaymentView(jobId) : null;
  const payment = pay ? {
    steps: pay.steps.map((s) => ({ key: s.key, label: s.label, amount: s.amountCents / 100, state: s.state, card: s.methods.includes("card") })),
    dueNow: pay.due.dueNowCents / 100, remaining: pay.due.remainingCents / 100, paid: pay.paidCents / 100,
    payNow: { ...pay.payNow, amount: pay.payNow.amountCents / 100 }, reference: pay.due.step ? pay.references[stepInvoiceKind(pay.due.step.key)] : pay.reference,
    provisional: pay.provisional.decision === "provisional" ? { expiresAt: pay.provisional.expiresAt, deposit: pay.plan.installDepositCents / 100 } : null,
  } : null;
  const limits = (ws?.office_time_limits ?? {}) as Record<string, unknown>;
  let currentAction: Exclude<import('./owner-myjob.core').OwnerScreen,'home'|'done'> | null = null;
  let clearStepsUnsigned = false;
  // G8 (4), 4 Nov 2026 (LOOKS WRONG 1): on an A2 run the installer picked the day and the portal proposed the owner's 1-hour
  // Ready Check window — the owner confirms it on ?screen=book (OwnerRunTime). Read only at the one stage it can exist.
  let readyCheckWindow = false;
  const {isQuoteExpiredCancelReason,quoteIsExpired}=await import('./quote-expiry.core');
  if (stage === 'cancelled' && isQuoteExpiredCancelReason(j.cancelled_reason)) currentAction='newquote';
  if (!['cancelled','on_hold'].includes(stage)) {
    const taps = await (await import('./quick-taps.server')).quickTapsState(String(token));
    const turn = stage === 'ready_check_ready_to_schedule' && !inHouseDispatch ? await (await import('./spot-release.server')).ownerTurnState(jobId) : {kind:'closed'};
    if (stage === 'ready_check_ready_to_schedule') readyCheckWindow = (await (await import('./installer-run.server')).ownerRunSlotState(jobId).catch(() => ({ kind: 'none' as const }))).kind === 'proposed';
    if (turn.kind === 'ask') currentAction='turn';
    else if (taps.kind === 'ask' || taps.kind === 'retry') currentAction = 'taps';
    else if (readyCheckWindow) currentAction = 'book';
    else if (quoteOpen) currentAction = quoteIsExpired({kind:'installation',sent_at:quote?.sent_at ?? null}) ? 'newquote' : 'quote';
    else {
      const confirmation = await (await import('./piesa-owner-confirm.server')).ownerPiesaConfirmFacts(jobId);
      // Part 4 T5 (Jo 2 Nov, answer 21): straight after the PIESA result — also with upgrades still to come — the ONE confirm-and-pay page,
      // while the 50% deposit is unpaid. Everything it covers that is already signed (old flow) just shows as done there.
      const { stepsUnsigned } = await import('./confirm-sign-pay.core');
      const { piesaOutcomeKind } = await import('./piesa-owner-confirm.core');
      const stepOf = (k: string) => payment?.steps.find((x) => x.key === k);
      const cleared = (k: string) => ['paid', 'waived'].includes(stepOf(k)?.state ?? '');
      const clearFacts = { stage, outcome: confirmation ? (piesaOutcomeKind(confirmation) === 'all_clear' ? 'all_clear' as const : 'upgrades_needed' as const) : null, safetyCleared: cleared('safety_check'), depositCleared: cleared('install_deposit'), depositCents: Math.round((stepOf('install_deposit')?.amount ?? 0) * 100) };
      // "clear" only when the page's own state loads (no consent row / missing facts -> the old pay / piesa screens, never a dead end).
      // Fix round 1: when the pay page would not open but the ESC consent is still awaiting the owner, the same page opens
      // consent-only (no deposit step) so the owner can always sign the Reg 23A consent (clearPageMode, one shared rule).
      const page = await (await import('./confirm-sign-pay.server')).clearPageMode(jobId, clearFacts, { hasConfirmation: !!confirmation });
      const clearState = page.state;
      const clearOpen = page.mode !== null;
      clearStepsUnsigned = clearOpen && !!clearState && stepsUnsigned(clearState);
      if (clearOpen) currentAction = 'clear';
      else if ((payment?.dueNow ?? 0) > 0 || payment?.provisional) currentAction='pay';
      else if (confirmation && !confirmation.confirmation) currentAction = 'piesa';
      else {
        const fixes = ['piesa_complete','electrical_variation_pending','rectification_scheduling','rectification_booked','installation_scheduling'].includes(stage) ? await (await import('./owner-fixes.server')).ownerFixesState(jobId) : {step:'none'};
        if (['approve','pay','pick'].includes(fixes.step) && !(inHouseDispatch && fixes.step === 'pick')) currentAction = 'fixes';
        else if ((payment?.dueNow ?? 0) > 0 || payment?.provisional) currentAction = 'pay';
        else if (j.installation_completed_at && veec?.status === 'awaiting_consumer_signature' && !veec.consumer_signed_at) currentAction = 'veec';
        else if (action.button?.screen === 'spot' && !spot?.spot_saved_at) currentAction = 'spot';
        else if (!inHouseDispatch && bookingOpen) {
          const times = await (await import('./piesa-times.server')).ownerPiesaTimesState(jobId);
          const days = await (await import('./install-days.server')).ownerInstallDayState(jobId);
          if (times.turn === 'owner_to_answer' || days.turn === 'owner_to_answer') currentAction = 'book';
        }
      }
    }
    if (!currentAction && j.installation_completed_at) {
      const {OWNER_EMAIL_TRIGGER_EVENT}=await import('./owner-email-triggers.core');
      const {data:invited,error}=await admin.from('workflow_events').select('id').eq('job_id',jobId).eq('event_type',OWNER_EMAIL_TRIGGER_EVENT).contains('details',{code:'O51'}).limit(1);
      if(error)throw new Error('Your next step could not be checked. Please retry.');
      if(invited?.length){const review=await (await import('./owner-review.server')).ownerReviewState(jobId);if(review.open && (!review.latestStars || review.latestStars<=3&&!review.feedbackSent))currentAction='review';}
    }
  }
  currentAction=currentOwnerAction({clear:currentAction==='clear',taps:currentAction==='taps',spot:currentAction==='spot',quote:currentAction==='quote',pay:currentAction==='pay',piesa:currentAction==='piesa',veec:currentAction==='veec',book:currentAction==='book',fixes:currentAction==='fixes',newquote:currentAction==='newquote',review:currentAction==='review',turn:currentAction==='turn'});
  // Part 10 Task 6: an installer's own customer — the originating business's name + Part 5's https logo and the approved
  // rows from the quote's codes (one extra read, only for installer_sourced jobs; a failed read = our logo + generic rows).
  const ownView = await (async () => {
    const { OWN_CUSTOMER_COBRAND_APPROVED } = await import("./cobrand.core");
    const { ownCustomerQuoteView } = await import("./own-customer-price.core");
    const channel = (j as { channel?: string | null }).channel ?? null;
    const bizId = (j as { originating_installer_business_id?: string | null }).originating_installer_business_id ?? null;
    if (channel !== "installer_sourced" || !OWN_CUSTOMER_COBRAND_APPROVED || !quote || !bizId) return { cobrand: null, rows: null };
    const [{ data: b }, logoUrl] = await Promise.all([
      admin.from("businesses").select("name, trading_name").eq("id", bizId).maybeSingle(),
      (await import("./trade-view.server")).businessLogoUrl(bizId).catch(() => null),
    ]);
    const biz = b as { name: string | null; trading_name: string | null } | null;
    return ownCustomerQuoteView({
      channel, approved: OWN_CUSTOMER_COBRAND_APPROVED, installerName: biz?.trading_name ?? biz?.name ?? null, logoUrl,
      items: (quote.quote_items ?? []).map((i) => ({ code: i.code ?? null, description: currentFeeWording(i.description), line_total_inc_gst: n(i.line_total_inc_gst) })),
      rebateIncGst: n(quote.veec_discount_inc_gst), totalIncGst: n(quote.customer_total_inc_gst),
    });
  })().catch(() => ({ cobrand: null, rows: null }));
  return {
    scopeChangePending,
    replacementSentAt: quote?.sent_at ?? null,
    replacedQuoteIds: (await admin.from('quotes').select('id').eq('job_id',jobId).eq('kind','installation').eq('status','superseded').not('sent_at','is',null)).data?.map(q=>q.id) ?? [],
    currentAction,
    clearStepsUnsigned,
    inHouseDispatch,
    // G8 (4): the owner's Ready Check window is waiting for their Confirm (?screen=book shows OwnerRunTime).
    readyCheckWindow,
    // G8 (4), Jo 4 Nov 2026 ("show the next visit"): the next booked visit — day, time and who is coming — for the all-set screen.
    nextVisit: upcoming?.scheduled_start ? nextVisitCard({ kind: upcoming.kind, startsAt: upcoming.scheduled_start, person: trade?.name ?? null, company: trade?.company ?? null }) : null,
    jobNumber: j.job_number, firstName: owner?.full_name?.trim().split(/\s+/)[0] ?? null,
    address: formatPropertyAddress(j.properties as never) || null, stage, hero, action, trade: upcoming ? trade : null,
    visit: upcoming ? { kind: upcoming.kind, startsAt: upcoming.scheduled_start } : null, progress,
    numbers: { rebate, cost: total, paid }, agreed,
    // Jo 4 Nov 2026 16:10: the approved "Your old insulation stays." paragraph (quote page + My job), null when not recorded as kept.
    keptInsulation,
    // heldUntil: the "price held" date (30 days for a 30-day quote, else the 14-day date the action card already uses (approved P2 page shows it in the sub line).
    // Part 10 Task 6: the installer's logo beside ours (null = our logo alone) — behind OWN_CUSTOMER_COBRAND_APPROVED.
    cobrand: ownView.cobrand,
    quote: quote ? { id: quote.id, status: quote.status, accepted_at: quote.accepted_at, label: quote.option_label, total, rebate: n(quote.veec_discount_inc_gst), version: quote.version,
      // Part 10 Task 6: an own customer's approved rows (Insulation · extras · fee · PIESA · Rebate · Your price); null = the generic rows below.
      ownRows: ownView.rows, heldUntil: quoteValid?.until ?? quoteOpen?.expiresAt ?? null, validLine: quoteValid?.line ?? null, changes: quoteChanges, ...(quoteChangesFootnote !== undefined ? { changesFootnote: quoteChangesFootnote } : {}), lines: [...(quote.quote_items ?? [])].sort((a, b) => a.sort - b.sort).map((i) => ({ description: currentFeeWording(i.description), amount: n(i.line_total_inc_gst) })), split: total != null ? splitForOption(total, safetyCheckIncGstFor({ lines: quote.quote_items ?? [], settingIncGst: ws?.safety_check_payment_inc_gst ?? null })) : null } : null,
    payment,
    // Part 4 Task 14: the separate P3 consent step is gone — the ESC consent is signed on the confirm-and-pay page (?screen=clear).
    spotSaved: isSpotSavedStage(stage, spot ?? null, !!upcoming || (bookings ?? []).some((b) => b.kind === "ready_check")) ? {
      rebate: spot?.saved_veu_discount != null ? n(spot.saved_veu_discount) : rebate,
      cost: spot?.saved_total != null ? n(spot.saved_total) : null,
      shortAddress: shortAddress((j.properties as { address_line: string | null } | null)?.address_line, (j.properties as { suburb: string | null } | null)?.suburb),
      videoInvite: !!spot?.video_requested && !spot.media_received_at,
      released,
      optOutUrl: await (await import("./emailsafety.server")).unsubscribeUrlForJob(jobId),
    } : null,
    piesaInstallGapDays: n(limits["piesa_install_gap_days"] ?? DEFAULT_PIESA_INSTALL_GAP_DAYS),
    canCancel: ownerCanCancel(stage, (cancellableBookings ?? []).map((b) => b.kind), paid > 0 && pay ? (await import('./payments.core')).isStepPaid(pay.steps, 'safety_check') : await safetyCheckPaidFor(jobId, paid > 0)),
    // Decision 119: after the install the owner signs the official VEEC assignment form here (never before install).
    veecAssignment: ["evidence_outstanding", "ap_review", "ready_for_veec", "complete"].includes(stage) ? { status: veec?.status ?? "not_prepared", signedAt: veec?.consumer_signed_at ?? null } : null,
    // Decision 296: between the electrician's PIESA and the install day the owner confirms the PIESA here (the card reads its own facts via ownerPiesaConfirmFn).
    piesaConfirm: ["piesa_complete", "electrical_variation_pending", "awaiting_deposit_payment", "rectification_scheduling", "rectification_booked", "installation_scheduling", "installation_booked"].includes(stage),
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
  if (!ownerCanCancel(j.stage, (bk ?? []).map((b) => b.kind), await safetyCheckPaidFor(l.job_id))) return { ok: false, reason: "Your Pre Insulation Electrical Safety Assessment (PIESA) is booked, so this can't be cancelled here. Reply to any of our emails and we'll help." };
  // Race guard: the stage may have moved since the first read.
  const { data: fresh } = await admin.from("jobs").select("stage").eq("id", l.job_id).single();
  if (!fresh || !ownerCanCancel(fresh.stage, (bk ?? []).map((b) => b.kind), false)) return { ok: false, reason: "Your job has just changed. Refresh the page and try again." };
  // Full clean-up (bookings, offers, assignments, ESC notices, install holds; prior stage kept) lives in cancelJobFully.
  try {
    await (await import("./office-actions.server")).cancelJobFully(l.job_id, "Owner cancelled from My job", null, { tell: { owner: false, installer: true } });
  } catch (e) {
    const { data: now } = await admin.from("jobs").select("stage").eq("id", l.job_id).single();
    if (now?.stage === "cancelled") return { ok: true };
    throw e;
  }
  // Stage 5 (Jo 23 Oct): cancelling the job releases its Mitti Ready Check form too.
  if (bk?.some((b) => b.kind === "ready_check")) await (await import("./mitti-pickup.server")).releaseReadyCheckFormOnCancel(l.job_id, null, "owner cancelled the job").catch(() => undefined);
  // A48 batch 2 Task 8: a confirmed window in an installer's run → the installer is told once and can fill it (best-effort).
  try { await (await import("./installer-run.server")).runOwnerCancelled(l.job_id); } catch (e) { console.error("run cancel hook skipped", (e as Error).message); }
  const { logEvent } = await import("./workflow.server");
  await logEvent(l.job_id, null, "owner_cancelled_job", "Owner cancelled their job from My job (before the Pre Insulation Electrical Safety Assessment (PIESA) was booked). No charge.", { bookings_cancelled: bk?.length ?? 0, trades_to_notify: true }, { internal: true });
  return { ok: true };
}

// ---- A48 batch 1 final fix (Jo 29 Oct 2026): the owner uploads the life support consent / medical plan on My job ----
// Same pattern as the owner photo/video upload (owner-capture.server): the secure link token is the only credential, the job
// always comes from the token, the file goes to the private job-files bucket by a short-lived signed upload URL, its stored
// type and first bytes are checked, then ONE documents row (kind life_support_plan) is written. That file alone clears the
// life support block (job-records.server lifeSupportPlansOnFile). Never moves a stage.
const LS_GENERIC = "This link is not available. Please contact Home Insulation Victoria.";
const LS_BUCKET = "job-files";

/** The link's job when it is open and the owner still needs to upload the plan; null otherwise. */
async function lifeSupportPlanJob(token: unknown): Promise<string | null> {
  if (!isWellFormedToken(token)) return null;
  const { data: l } = await admin.from("customer_estimate_links").select("job_id, status, expires_at").eq("token", token).eq("purpose", LINK_PURPOSE).maybeSingle();
  if (!l || !linkUsable(l)) return null;
  const { data: j } = await admin.from("jobs").select("stage, deleted_at").eq("id", l.job_id).maybeSingle();
  if (!j || j.deleted_at || ["cancelled", "complete"].includes(String(j.stage))) return null;
  const { lifeSupportPlanMissing } = await import("./job-records.server");
  return (await lifeSupportPlanMissing(l.job_id)) ? l.job_id : null;
}

/** My job: show the upload only when life support is yes or unknown and no plan is on file. Never throws. */
export async function ownerLifeSupportPlanState(token: unknown): Promise<{ show: boolean }> {
  try { return { show: !!(await lifeSupportPlanJob(token)) }; } catch { return { show: false }; }
}

export async function startLifeSupportPlanUpload(token: unknown, f: { fileName: string; mime: string; size: number }) {
  const jobId = await lifeSupportPlanJob(token);
  if (!jobId) throw new Error(LS_GENERIC);
  const { validateLifeSupportPlanFile, lifeSupportPlanPath } = await import("./owner-myjob.core");
  const v = validateLifeSupportPlanFile({ mime: f.mime, fileName: f.fileName, size: f.size });
  if (!v.ok) throw new Error(v.error);
  const path = lifeSupportPlanPath(jobId, crypto.randomUUID(), v.mime);
  const { data, error } = await admin.storage.from(LS_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error("Something went wrong. Please try again.");
  return { path, uploadToken: data.token, mime: v.mime };
}

export async function finishLifeSupportPlanUpload(token: unknown, x: { path: string; fileName: string }): Promise<{ recorded: true }> {
  if (!isWellFormedToken(token)) throw new Error(LS_GENERIC);
  const { data: l } = await admin.from("customer_estimate_links").select("job_id, status, expires_at").eq("token", token).eq("purpose", LINK_PURPOSE).maybeSingle();
  if (!l || !linkUsable(l)) throw new Error(LS_GENERIC);
  const jobId = l.job_id;
  const { parseLifeSupportPlanPath, lifeSupportPlanType, LIFE_SUPPORT_PLAN_MAX_BYTES, LIFE_SUPPORT_PLAN_SOURCE, LIFE_SUPPORT_PLAN_WRONG_TYPE, LIFE_SUPPORT_PLAN_TOO_BIG } = await import("./owner-myjob.core");
  const uploadId = parseLifeSupportPlanPath(jobId, x.path);
  if (!uploadId) throw new Error(LS_GENERIC);
  // The same upload finished twice (retry after a dropped reply): already recorded.
  const { data: prior } = await admin.from("documents").select("id").eq("job_id", jobId).eq("source_system", LIFE_SUPPORT_PLAN_SOURCE).eq("external_id", uploadId).limit(1);
  if ((prior ?? []).length) return { recorded: true };
  if (!(await lifeSupportPlanJob(token))) throw new Error(LS_GENERIC);
  const folder = x.path.slice(0, x.path.lastIndexOf("/"));
  const { data: objs, error: le } = await admin.storage.from(LS_BUCKET).list(folder, { search: uploadId });
  if (le) throw new Error("Something went wrong. Please try again.");
  const obj = (objs ?? []).find((o) => x.path.endsWith(`/${o.name}`));
  if (!obj) throw new Error("The upload was interrupted. Please check your connection and try again.");
  const size = Number((obj.metadata as { size?: number } | null)?.size ?? 0);
  const storedMime = lifeSupportPlanType((obj.metadata as { mimetype?: string } | null)?.mimetype ?? null, x.path);
  const { verifyStoredUpload, BAD_FILE_MESSAGE } = await import("./upload-safety.server");
  if (!storedMime || size <= 0 || size > LIFE_SUPPORT_PLAN_MAX_BYTES) {
    await admin.storage.from(LS_BUCKET).remove([x.path]);
    throw new Error(storedMime && size > LIFE_SUPPORT_PLAN_MAX_BYTES ? LIFE_SUPPORT_PLAN_TOO_BIG : LIFE_SUPPORT_PLAN_WRONG_TYPE);
  }
  // The shared check's wrong-type message is for other uploads; this card uses its own approved line.
  try { await verifyStoredUpload(LS_BUCKET, x.path, storedMime); }
  catch (e) { throw (e as Error).message === BAD_FILE_MESSAGE ? new Error(LIFE_SUPPORT_PLAN_WRONG_TYPE) : e; }
  const safeName = x.fileName.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";
  const { LIFE_SUPPORT_PLAN_DOC_KIND } = await import("./job-records.server");
  const { error, data: ins } = await admin.from("documents").insert({
    job_id: jobId, kind: LIFE_SUPPORT_PLAN_DOC_KIND, title: `Life support plan (owner upload): ${safeName}`, storage_path: x.path, mime_type: storedMime,
    source_system: LIFE_SUPPORT_PLAN_SOURCE, external_id: uploadId, original_name: safeName, size_bytes: size,
  }).select("id").maybeSingle();
  if (error && !/duplicate/i.test(error.message)) throw new Error("Something went wrong. Please try again.");
  if (!error) {
    const { logEvent } = await import("./workflow.server");
    await logEvent(jobId, null, "life_support_plan_uploaded", "Owner uploaded the life support consent / medical plan on My job", { document_id: ins?.id ?? null, size_bytes: size, mime_type: storedMime }, { internal: true });
  }
  return { recorded: true };
}
