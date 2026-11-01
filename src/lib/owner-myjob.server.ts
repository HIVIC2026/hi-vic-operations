// No-login owner "My job" view. The secure estimate link token is the only credential. Read-only.
import { isSpotSavedStage, spotReleasedForPage } from "./owner-myjob.core";
import { currentFeeWording } from "./hiv-quote.core";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { isWellFormedToken, LINK_PURPOSE, linkUsable } from "./estimatelink.core";
import { formatPropertyAddress, shortAddress } from "./address";
import { DEFAULT_PIESA_INSTALL_GAP_DAYS, OWNER_STEPS, ownerAction, ownerCanCancel, ownerHero, ownerStage } from "./owner-myjob.core";
import { splitForOption } from "./payment-gate.core";
import { stepInvoiceKind } from "./payments.core";
import { safetyCheckIncGstFor } from "./safety-check-amount.core";
import { section1FromFacts } from "./consent.core";
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
    admin.from("jobs").select("job_number, stage, deleted_at, channel, external_refs, owners(full_name, email, phone), properties(address_line, suburb, state, postcode)").eq("id", jobId).single(),
    admin.from("quotes").select("id, kind, status, release_state, option_label, customer_total_inc_gst, veec_discount_inc_gst, subtotal_inc_gst, sent_at, accepted_at, version, quote_items(code, description, quantity, line_total_inc_gst, sort)").eq("job_id", jobId).eq("kind", "installation").in("status", ["issued", "accepted", "declined"]).order("created_at", { ascending: false }).order("created_at", { ascending: false }),
    admin.from("bookings").select("kind, status, scheduled_start, contractor_id, business_id").eq("job_id", jobId).in("status", ["confirmed", "completed"]).order("scheduled_start"),
    // "Paid" next to the install price: the installation invoice (batch 3b: fixes / repeat check have their own invoices).
    admin.from("invoices").select("total_paid, amount_paid").eq("job_id", jobId).eq("kind", "installation"),
    admin.from("indicative_estimates").select("applied_discount").eq("job_id", jobId).is("superseded_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("workflow_settings").select("office_time_limits, piesa_install_window_days, safety_check_payment_inc_gst").eq("id", 1).maybeSingle(),
  ]);
  if (!j) return null;
  const [{ data: rc }, { data: spot }, { data: consent }, { data: cancellableBookings }, { data: veecRows }, released] = await Promise.all([
    admin.from("ready_check_acceptances").select("accepted_at").eq("job_id", jobId).limit(1).maybeSingle(),
    admin.from("lead_campaign_responses").select("spot_saved_at, opted_out_at, media_received_at, video_requested, saved_veu_discount, saved_total").eq("job_id", jobId).maybeSingle(),
    admin.from("owner_esc_consents").select("status, scheduled_start").eq("job_id", jobId).eq("status", "awaiting_owner").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("bookings").select("kind").eq("job_id", jobId).in("status", ["proposed", "confirmed"]),
    admin.from("customer_assignments").select("status, consumer_signed_at").eq("job_id", jobId).eq("record_kind", "final_veec_assignment").order("created_at", { ascending: false }),
    // Jo 29 Oct (HV-3542): once the spot is released the spot-saved page stops saying "we'll be in touch". Lapsed = back in the queue. A failed read = not released. (Six reads in this wave: at the cap.)
    admin.from("workflow_events").select("event_type, created_at, details").eq("job_id", jobId).in("event_type", [...SPOT_RELEASE_EVENTS]).then(({ data, error }) => !error && spotReleasedForPage(data ?? []), () => false),
  ]);
  const veec = ((veecRows ?? []) as { status: string; consumer_signed_at: string | null }[]).find((a) => a.status !== "cancelled") ?? null;
  // An archived job reads as closed to the owner, the same as a cancelled one.
  const stage = ownerStage(j.stage as string, (j as { deleted_at?: string | null }).deleted_at ?? null);
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
  const inHouseDispatch = await (await import("./in-house-suppression.server")).inHouseDispatchSkip(jobId);
  const action = ownerAction({ stage, readyCheckRequested: !!rc?.accepted_at, visit: upcoming?.scheduled_start ? { kind: upcoming.kind, startsAt: upcoming.scheduled_start } : null, quoteOpen, bookingOpen });
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
    const { data: a } = await admin.from("job_assignments").select("business_id, businesses(name, trading_name)").eq("job_id", jobId).eq("role", "installer").order("created_at").limit(1).maybeSingle();
    const b = a?.businesses as { name: string; trading_name: string | null } | null;
    agreed = { agreed: true, installerName: b?.trading_name || b?.name || null };
  }
  const owner = j.owners as { full_name: string | null; email?: string | null; phone?: string | null } | null;
  const total = quote ? n(quote.customer_total_inc_gst) : null;
  // Decisions 139/140/141: what is due now, how to pay it (card for the card steps), bank details + reference. Batch 3b:
  // each step shows its own amount, and the reference is the due step's own invoice (fixes / repeat check have their own).
  // Owner-safe: amounts, state, the Xero online-invoice link and the invoice reference only – never Xero IDs or errors.
  const pay = quote?.status === "accepted" ? await (await import("./payments.server")).jobPaymentView(jobId).catch(() => null) : null;
  const payment = pay ? {
    steps: pay.steps.map((s) => ({ key: s.key, label: s.label, amount: s.amountCents / 100, state: s.state, card: s.methods.includes("card") })),
    dueNow: pay.due.dueNowCents / 100, remaining: pay.due.remainingCents / 100, paid: pay.paidCents / 100,
    payNow: { ...pay.payNow, amount: pay.payNow.amountCents / 100 }, reference: pay.due.step ? pay.references[stepInvoiceKind(pay.due.step.key)] : pay.reference,
    provisional: pay.provisional.decision === "provisional" ? { expiresAt: pay.provisional.expiresAt, deposit: pay.plan.installDepositCents / 100 } : null,
  } : null;
  const limits = (ws?.office_time_limits ?? {}) as Record<string, unknown>;
  let currentAction: Exclude<import('./owner-myjob.core').OwnerScreen,'home'|'done'> | null = null;
  if (!['cancelled','on_hold'].includes(stage)) {
    const taps = await (await import('./quick-taps.server')).quickTapsState(String(token));
    if (taps.kind === 'ask' || taps.kind === 'retry') currentAction = 'taps';
    else if (quoteOpen) currentAction = 'quote';
    else {
      const confirmation = await (await import('./piesa-owner-confirm.server')).ownerPiesaConfirmFacts(jobId);
      if (confirmation && !confirmation.confirmation) currentAction = 'piesa';
      else {
        const fixes = await (await import('./owner-fixes.server')).ownerFixesState(jobId);
        if (['approve','pay','pick'].includes(fixes.step) && !(inHouseDispatch && fixes.step === 'pick')) currentAction = 'fixes';
        else if ((payment?.dueNow ?? 0) > 0 || payment?.provisional) currentAction = 'pay';
        else if (veec?.status === 'awaiting_consumer_signature' && !veec.consumer_signed_at) currentAction = 'veec';
        else if (action.button?.screen === 'spot' && !spot?.spot_saved_at) currentAction = 'spot';
        else if (!inHouseDispatch && bookingOpen) {
          const times = await (await import('./piesa-times.server')).ownerPiesaTimesState(jobId);
          const days = await (await import('./install-days.server')).ownerInstallDayState(jobId);
          if (times.turn === 'owner_to_answer' || days.turn === 'owner_to_answer') currentAction = 'book';
        }
      }
    }
  }
  return {
    currentAction,
    inHouseDispatch,
    jobNumber: j.job_number, firstName: owner?.full_name?.trim().split(/\s+/)[0] ?? null,
    address: formatPropertyAddress(j.properties as never) || null, stage, hero, action, trade: upcoming ? trade : null,
    visit: upcoming ? { kind: upcoming.kind, startsAt: upcoming.scheduled_start } : null, progress,
    numbers: { rebate, cost: total, paid }, agreed,
    // heldUntil: the same 14-day "price held" date the action card already uses (approved P2 page shows it in the sub line).
    quote: quote ? { id: quote.id, status: quote.status, accepted_at: quote.accepted_at, label: quote.option_label, total, rebate: n(quote.veec_discount_inc_gst), version: quote.version, heldUntil: quoteOpen?.expiresAt ?? null, lines: [...(quote.quote_items ?? [])].sort((a, b) => a.sort - b.sort).map((i) => ({ description: currentFeeWording(i.description), amount: n(i.line_total_inc_gst) })), split: total != null ? splitForOption(total, safetyCheckIncGstFor({ lines: quote.quote_items ?? [], settingIncGst: ws?.safety_check_payment_inc_gst ?? null })) : null } : null,
    payment,
    // Approved P3 page (decision 128): Section 1 is prefilled from the owner + property, never typed again by the owner.
    consent: consent ? { scheduledStart: consent.scheduled_start, section1: section1FromFacts({ owner: { name: owner?.full_name ?? null, email: owner?.email ?? null, phone: owner?.phone ?? null }, premises_address: formatPropertyAddress(j.properties as never) }) } : null,
    spotSaved: isSpotSavedStage(stage, spot ?? null, !!upcoming || (bookings ?? []).some((b) => b.kind === "ready_check")) ? {
      rebate: spot?.saved_veu_discount != null ? n(spot.saved_veu_discount) : rebate,
      cost: spot?.saved_total != null ? n(spot.saved_total) : null,
      shortAddress: shortAddress((j.properties as { address_line: string | null } | null)?.address_line, (j.properties as { suburb: string | null } | null)?.suburb),
      videoInvite: !!spot?.video_requested && !spot.media_received_at,
      released,
      optOutUrl: await (await import("./emailsafety.server")).unsubscribeUrlForJob(jobId),
    } : null,
    piesaInstallGapDays: n(limits["piesa_install_gap_days"] ?? DEFAULT_PIESA_INSTALL_GAP_DAYS),
    canCancel: ownerCanCancel(stage, (cancellableBookings ?? []).map((b) => b.kind), await safetyCheckPaidFor(jobId, paid > 0)),
    // Decision 119: after the install the owner signs the official VEEC assignment form here (never before install).
    veecAssignment: ["evidence_outstanding", "ap_review", "ready_for_veec", "complete"].includes(stage) ? { status: veec?.status ?? "not_prepared", signedAt: veec?.consumer_signed_at ?? null } : null,
    // Decision 296: between the electrician's PIESA and the install day the owner confirms the PIESA here (the card reads its own facts via ownerPiesaConfirmFn).
    // Decision 330: after the A4 electrical fixes the owner confirms them here (the card reads its own facts; nothing without a fixes record).
    fixesConfirm: ["rectification_booked", "installation_scheduling", "installation_booked", "evidence_outstanding", "ap_review", "ready_for_veec"].includes(stage),
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
