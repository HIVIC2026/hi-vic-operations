// Automatic DRAFT owner quote for installer-brought jobs (A1): the Ready Check facts + the business owner's portal price
// (decision 278; old forms that still carry a price are the fallback).
// Never sends anything: the office reviews the co-branded preview and sends it (installer-quote.functions.ts).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { type LocationVariables } from "./activity48.core";
import { wholeVeecDiscount } from "./estimate.core";
import { quotedPriceFromEntries } from "./installer-led.core";
import { installerQuoteReleaseBlockers, payerFromChoice } from "./installer-intake.core";
import { IN_HOUSE_PIESA_HOLD_REASON } from "./installer-paid-electricians.core";

export const INSTALLER_QUOTE_CODE = "INSTALLER_A1";
type SigLine = { code: string | null; line_total_inc_gst: number | string | null; description?: string | null; quantity?: number | string | null; unit?: string | null; unit_price_inc_gst?: number | string | null; explanation?: string | null; is_other?: boolean | null };
/** Full scope fingerprint: equal amounts with changed inclusions/description/explanation are a DIFFERENT quote. */
export const quoteLineSignature = (lines: SigLine[], discountNote?: string | null) =>
  JSON.stringify([lines.map((l) => [l.code ?? "", Number(l.line_total_inc_gst), (l.description ?? "").trim(), Number(l.quantity ?? 0), l.unit ?? "", Number(l.unit_price_inc_gst ?? 0), (l.explanation ?? "").trim(), !!l.is_other]).map((x) => JSON.stringify(x)).sort(), (discountNote ?? "").trim()]);

/** Current installer quote's electrical billing lines vs the job's CURRENT payer (any path). Null = fine / not applicable.
 *  Fix wave J1 (1), ruling 4 Nov 2026: a quote the owner already has (issued) or accepted is never re-priced — a later
 *  PIESA rate change or lapse never blocks the owner's acceptance; only drafts (send / release) are checked. */
export async function quoteBillingBlocker(quoteId: string): Promise<string | null> {
  const { data: q } = await admin.from("quotes").select("option_code, status, job_id").eq("id", quoteId).maybeSingle();
  if (!q || q.option_code !== INSTALLER_QUOTE_CODE || q.status === "accepted" || q.status === "issued") return null;
  const { data: j } = await admin.from("jobs").select("channel, electrician_choice, originating_installer_business_id").eq("id", q.job_id).maybeSingle();
  if (j?.channel !== "installer_sourced") return null;
  const { data: snapshot, error: se } = await admin.from("workflow_events").select("details").eq("job_id", q.job_id).eq("event_type", "mitti_quote_electrician_snapshot").contains("details", { quote_id: quoteId }).limit(1).maybeSingle();
  if (se) return "Quote electrician history could not be checked";
  if (snapshot) {
    const saved = (snapshot.details as unknown as { electrician: import("./usual-electrician.core").MittiElectricianResolution }).electrician;
    const { data: last, error: le } = await admin.from("workflow_events").select("details").eq("job_id", q.job_id).eq("event_type", "mitti_electrician_recorded").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const current = le ? null : last?.details as unknown as import("./usual-electrician.core").MittiElectricianResolution | null;
    // Join ruling (4 Nov 2026): a Team-electrician snapshot names the worker, not the My business usual electrician;
    // `mittiQuoteElectricalBlocker` below compares that identity and price with the current resolution.
    if (saved?.choice === "usual" && saved.source !== "team_worker") {
      if (!j.originating_installer_business_id) return "Installer has no electrician saved";
      // Jo 5 Nov 2026: compared with the installer's Main electrician (never ticked = the old saved usual electrician).
      const profile = await (await import("./installer-electricians.server")).readMainElectrician(j.originating_installer_business_id).catch(() => null);
      const usual = profile?.electrician;
      // Decision 303: an approved-REC snapshot carries the REC's onboarded rate, not the declared price — identity must still
      // match. Decision 369: My business no longer records a price, so only the identity is compared (a re-save without a
      // price must not hold an existing quote).
      // Jo 5 Nov 2026 (HV-3193): the same electrician = the same LICENCE (case and spaces ignored), never the name
      // ("ORLANDO POWERED" business vs "Peter orlando" person, both A63151).
      const changed = (await import("./installer-electricians.core")).usualElectricianChangedBlocker(usual, saved);
      if (changed) return changed;
    }
    const { data: lines, error: ie } = await admin.from("quote_items").select("code, line_total_inc_gst").eq("quote_id", quoteId);
    if (ie) return "Quote electrical lines could not be checked";
    return (await import("./mitti-installer-quote.core")).mittiQuoteElectricalBlocker(lines ?? [], saved, current);
  }
  const { data: items } = await admin.from("quote_items").select("code, line_total_inc_gst").eq("quote_id", quoteId);
  const { electricalLineBlocker } = await import("./installer-intake.core");
  // Jo 4 Nov 2026: the PIESA line must still be the business's current PIESA rate (none set → held, never $349).
  const rate = await (await import("./installer-paid-electricians.server")).installerSafetyCheckPrice(j.originating_installer_business_id).catch(() => undefined);
  if (rate === undefined) return "Installer PIESA rate could not be checked";
  return electricalLineBlocker(items ?? [], payerFromChoice(j.electrician_choice), rate);
}

export async function draftInstallerQuoteFromReadyCheck(jobId: string, actorId: string | null, formEntries: { label: string; value: string | null }[], auditId: string, intakePrice?: { totalIncGst: number; includes: string; areaM2?: number; separateLines?: { code: string; description: string; amountIncGst: number }[]; exclusions?: string | null;
  /** Photo quote Part 2 (Jo 5 Nov 16:44): the From photos installer's own price record (the Your price card's ticks) and
   *  product — read the way the Ready Check path reads a portal price, worded the same (own-photo-quote.core). */
  photo?: { record: import("./installer-price.core").InstallerPriceRecord; product: string; removeM2: number } }) {
  const { data: job } = await admin.from("jobs").select("channel, stage, deleted_at, qa_archived_at, ap_fee_override_inc_gst, electrician_choice, originating_installer_business_id, properties(postcode)").eq("id", jobId).single();
  if (!job || job.channel !== "installer_sourced") return null;
  if ((await import("./mitti.core")).isClosedOrArchivedJob(job)) return null; // HV-1351: no draft, no hold, no events
  // Decision 278: price, inclusions and electrician come from the business owner's portal entry (`installer_price_set`,
  // latest wins) FIRST; the Mitti answers are read only on old forms that still carry them.
  const entries = intakePrice ? formEntries : (await (await import("./installer-price.server")).entriesWithInstallerPrice(jobId, formEntries)) as { label: string; value: string | null }[];
  const partialSubmission = !intakePrice && (await (await import("./installer-price.server")).readInstallerPrice(jobId))?.sendToQuote === true;
  // Fee awareness is an office quote-SEND prerequisite (Jo, 8 Oct 2026): the draft is still prepared, but held.
  const { data: feeConfirmation } = await admin.from("workflow_events").select("id, details").eq("job_id", jobId).eq("event_type", "installer_owner_fee_awareness").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: open } = await admin.from("quotes").select("id, status, subtotal_inc_gst, veec_discount_inc_gst, option_code, discount_note").eq("job_id", jobId).eq("kind", "installation").in("status", ["draft", "issued", "accepted"]);
  // A sent quote is never touched. An ACCEPTED quote is never changed either, but when its facts were corrected
  // (reconfirmation open) a replacement draft may be prepared so the owner can reconfirm at the corrected figures.
  const { reconfirmationOpen } = await import("./installer-intake.server");
  const priceChange = await (await import('./installer-price-change.server')).pendingChangeFor(jobId);
  if ((open ?? []).some((q) => q.status === "issued") && !priceChange) return null;
  if ((open ?? []).some((q) => q.status === "accepted") && !(await reconfirmationOpen(jobId))) return null;

  // Jo 23 Oct hard stops (contact No, R2+, life support, built in last 5 years): no quote at all.
  const answers = await import("./ready-check-answers.core");
  const stops = !intakePrice ? answers.readyCheckStopReasons(entries) : [];
  if (stops.length) {
    await (await import("./ready-check-quote.server")).recordNeedsOffice(jobId, actorId, null, stops);
    return { ready: false, blockers: stops, lines: [], subtotal: 0, discount: 0, afterDiscount: 0, discountNote: null };
  }
  const mittiElectrician = !intakePrice ? await (await import("./usual-electrician.server")).mittiElectricianForJob(jobId, actorId, entries, auditId) : null;
  // Jo 4 Nov follow-up: a new-wording Ready Check with the boss's per-area picks (brand + batts chosen on the price link).
  const a1Layout = !intakePrice ? await a1LayoutForJob(jobId) : null;
  const mittiProduct = !intakePrice && !a1Layout ? await (await import("./insulation-product.server")).mittiProductForJob(jobId, actorId, entries, auditId) : null;

  const { data: m } = await admin.from("ceiling_measurements").select("measured_area_m2, verified_area_m2, removal_required").eq("job_id", jobId).eq("is_current", true).maybeSingle();
  const m2 = (m ? Number(m.verified_area_m2 ?? m.measured_area_m2) || null : null) ?? intakePrice?.areaM2 ?? null; // intake: provisional installer scope
  const postcode = String((job.properties as { postcode: string | null } | null)?.postcode ?? "").trim();
  const [{ data: loc }, { data: rs }, { data: workflow }] = await Promise.all([
    admin.from("veu_location_variables").select("*").eq("postcode", postcode).maybeSingle(),
    admin.from("retail_estimator_settings").select("ap_management_inc_gst, piesa_assessment_inc_gst, indicative_veec_value, minimum_customer_copayment_inc_gst").eq("is_current", true).maybeSingle(),
    admin.from("workflow_settings").select("auto_send_quote, customer_comms_enabled").eq("id", 1).maybeSingle(),
  ]);
  const wholeVeec = loc && m2 && rs ? wholeVeecDiscount(m2, loc as unknown as LocationVariables, Number(rs.indicative_veec_value)) : null;
  // Jo 24 Oct: the installer's total INCLUDES any difficult access fee (never added twice); the fee is shown on the
  // installer line and taken out only for the per-m² price check.
  const accessFee = !intakePrice ? answers.difficultAccessFee(entries) : { amountIncGst: null, reason: null };
  // Jo 4 Nov 2026 (final, supersedes Part 10's "$349 PIESA whatever the rate"): every own-customer quote carries the $349
  // Home Insulation Victoria fee and the PIESA at the installer business's OWN rate (their rate card's PIESA line, inc GST —
  // `installerSafetyCheckPrice`), paid through in full. The Ready Check path already carries that rate on the electrician
  // resolution (`mittiElectricianForJob` → `withOwnerSafetyCheckPrice`); the intake-price fallback reads it here. No rate →
  // held (`IN_HOUSE_PIESA_HOLD_REASON`), never $349. The settings' AP/PIESA amounts and `ap_fee_override_inc_gst` are not read.
  // J3 (2): a rate READ failure is not "no rate" — the quote holds with PIESA_PRICE_CHECK_FAILED (try again in a minute),
  // never the "not set / ask the office" hold; nothing is sent either way.
  let piesaReadFailed = false;
  const listPiesa = mittiElectrician ? null : await (await import("./installer-paid-electricians.server")).installerSafetyCheckPrice(job.originating_installer_business_id).catch((e: unknown) => {
    console.error("draftInstallerQuoteFromReadyCheck: installer PIESA rate could not be read", (e as Error).message);
    piesaReadFailed = true;
    return null; // fail closed: the quote holds until the read works; nothing is sent
  });
  const ownPhoto = intakePrice?.photo ? await import("./own-photo-quote.core") : null;
  const draftInput = {
    price: intakePrice?.photo && ownPhoto ? ownPhoto.ownPhotoDraftInput({ record: intakePrice.photo.record, installM2: m2 ?? 0, removeM2: intakePrice.photo.removeM2, wholeVeec, metropolitan: null, minCopay: 0 }).price : intakePrice ? { ok: true, issues: [], price: { included: [intakePrice.exclusions ? `${intakePrice.includes} (excludes: ${intakePrice.exclusions})` : intakePrice.includes], otherDescription: "", totalIncGst: Math.round(intakePrice.totalIncGst * 100) / 100, agreedWithOwner: false } } : quotedPriceFromEntries(entries, m?.removal_required ?? null), measuredM2: m2, wholeVeec,
    separateLines: intakePrice?.separateLines ?? [],
    caps: {
      metropolitan: loc ? (loc as unknown as LocationVariables).metropolitan_or_regional === "Metropolitan" : null,
      minCopay: rs ? Number(rs.minimum_customer_copayment_inc_gst) : 200,
    },
  };
  const quoteCore = await import("./mitti-installer-quote.core");
  // Same lines on both branches (Task 2 review): the Ready Check path adds the electrician's hold reasons; the intake-price
  // fallback (no Mitti electrician) still holds below while the electrician is undecided.
  const draft = mittiElectrician ? quoteCore.buildMittiInstallerQuote(draftInput, mittiElectrician) : quoteCore.buildOwnCustomerQuoteDraft(draftInput, listPiesa);
  if (intakePrice?.photo && ownPhoto) ownPhoto.applyOwnPhotoWording(draft, { product: intakePrice.photo.product, installM2: m2 ?? 0, removeM2: intakePrice.photo.removeM2 });
  if (piesaReadFailed) { const { PIESA_PRICE_CHECK_FAILED } = await import("./own-customer-price.core"); draft.blockers = draft.blockers.map((b) => (b === IN_HOUSE_PIESA_HOLD_REASON ? PIESA_PRICE_CHECK_FAILED : b)); draft.ready = false; }
  const payer = payerFromChoice(job.electrician_choice);
  if (!mittiElectrician && payer === "undecided") draft.blockers.unshift("Electrician not decided yet — the owner's electrician cost must be known before the quote");
  if (!mittiElectrician && payer === "undecided") draft.ready = false;
  // Jo 23 Oct: insulation product on the owner quote; incomplete product holds the quote.
  if (mittiProduct) {
    const { applyMittiProduct } = await import("./mitti-installer-quote.core");
    applyMittiProduct(draft, mittiProduct, m2, { optionalMissing: partialSubmission && !(await import('./mitti.core')).contactAnswersFromEntries(entries).productOption });
  }
  const accessIncluded = !intakePrice && (answers.a1DifficultAccessIncluded(entries) || !!accessFee.amountIncGst);
  if (!intakePrice) {
    const mq = await import("./mitti-installer-quote.core");
    if (a1Layout) applyA1Wording(draft, a1Layout.mainLines);
    else mq.applyMittiRemoval(draft, answers.removalTotalM2(entries));
    mq.applyMittiAccessFeeIncluded(draft, accessIncluded, accessFee.amountIncGst);
  }
  // The owner's "thicker too" option: the same builder at the boss's thicker total, same electrician/fees, its own rebate.
  const buildThicker = async () => {
    if (!a1Layout?.thicker || !(a1Layout.thickerTotal && a1Layout.thickerTotal > 0) || !draftInput.price.ok || !draftInput.price.price) return null;
    const input = { ...draftInput, price: { ...draftInput.price, price: { ...draftInput.price.price, totalIncGst: Math.round(a1Layout.thickerTotal * 100) / 100 } } };
    // Decision 431 (join): the thicker option carries the same own-customer PIESA line as the main draft (the business's own rate, never $349).
    const t = mittiElectrician ? quoteCore.buildMittiInstallerQuote(input, mittiElectrician) : quoteCore.buildOwnCustomerQuoteDraft(input, listPiesa);
    applyA1Wording(t, a1Layout.thickerLines);
    (await import("./mitti-installer-quote.core")).applyMittiAccessFeeIncluded(t, accessIncluded, accessFee.amountIncGst);
    return t;
  };
  if (!draft.ready) {
    if (mittiProduct && !mittiProduct.ready) await (await import("./ready-check-quote.server")).recordNeedsOffice(jobId, actorId, null, mittiProduct.reasons);
    if (mittiElectrician?.needsProfile) {
      await (await import("./ready-check-quote.server")).recordNeedsOffice(jobId, actorId, null, mittiElectrician.reasons);
      // Part 7 Task 8 (Jo 2 Nov 2026): the "We need your usual electrician" text is retired (decisions 374/303 choose the electrician); no reminder here.
    }
    // History only on change (Jo 23 Oct): the 15-minute sync/tick re-runs this while the quote waits (decision 113);
    // the same hold for the same form is not written again.
    const { data: lastHeld } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "installer_quote_held").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const prev = lastHeld?.details as { audit_id?: string; blockers?: string[] } | null;
    // Decision 303: the "Electrician not onboarded: <name>" hold names the electrician on the Needs me row and keeps the
    // declared identity on the event so the tick's invite sweep and the installer job page can read it.
    const notOnboarded = mittiElectrician?.notOnboarded ?? null;
    if (!(prev?.audit_id === auditId && JSON.stringify(prev.blockers ?? []) === JSON.stringify(draft.blockers)))
      await logEvent(jobId, actorId, "installer_quote_held", notOnboarded ? `Quote held · ${mittiElectrician!.reasons[0]}` : "Owner quote not drafted — needs office review", { audit_id: auditId, blockers: draft.blockers, ...(notOnboarded ? { electrician_not_onboarded: notOnboarded } : {}) });
    // An earlier held DRAFT (e.g. one priced from a free-text electrician) now carries the current hold reason, so the
    // Quote card and Quotes to check say why; `quoteBillingBlocker` refuses Send until a new snapshot is ready.
    const inHousePriceHeld = mittiElectrician?.reasons.includes(IN_HOUSE_PIESA_HOLD_REASON) || draft.blockers.includes(IN_HOUSE_PIESA_HOLD_REASON);
    if (notOnboarded || inHousePriceHeld || piesaReadFailed) {
      const holdNow = piesaReadFailed ? (await import("./own-customer-price.core")).PIESA_PRICE_CHECK_FAILED : inHousePriceHeld ? IN_HOUSE_PIESA_HOLD_REASON : [...draft.blockers, "Waiting for office review before sending"].join(" · ");
      for (const q of (open ?? []).filter((q) => q.status === "draft" && q.option_code === INSTALLER_QUOTE_CODE)) {
        const { error: holdError } = await admin.from("quotes").update({ release_state: "held", release_hold_reason: holdNow }).eq("id", q.id).eq("status", "draft");
        if (holdError) throw new Error("Quote hold reasons could not be refreshed.");
      }
    }
    return draft;
  }
  const installerPrice = draft.lines.find((line) => line.code === "INSTALLER_PRICE")?.line_total_inc_gst ?? null;
  // Jo 24 Oct: on the installer's own jobs he charges what he wants — no price-range or access-fee limit. Only a
  // difficult access fee with no usable amount holds the quote (the owner's quote can't show it otherwise).
  const rangeReason = !intakePrice ? accessFee.reason ?? null : null;
  // Honest status: the automatic step only ever creates a DRAFT held for office review. Nothing is issued,
  // marked sent or released here; the office sends via sendInstallerQuote, which checks consent/fees/switches.
  const releaseBlockers = !intakePrice
    ? (await import("./mitti-quote-release.core")).mittiQuoteReleaseBlockers("granted", mittiElectrician)
    : installerQuoteReleaseBlockers({ consentStatus: "granted", feeAwarenessRecorded: !!feeConfirmation, feeAwarenessPayer: ((feeConfirmation?.details as { payer?: "hivic" | "own" } | null)?.payer ?? null), electricianPayer: payer });
  const holdReason = [rangeReason, ...releaseBlockers, "Waiting for office review before sending"].filter(Boolean).join(" · ");
  void workflow?.auto_send_quote;
  // Dedup only on identical figures AND identical lines (a payer change can keep totals but change scope/lines).
  // Identity is part of scope even if the selected electrician has the same price.
  if (mittiElectrician?.name) {
    const electricalLine = draft.lines.find((l) => l.code === "PIESA");
    if (electricalLine) electricalLine.explanation = `Electrician: ${mittiElectrician.name}; licence: ${mittiElectrician.licence} (declared)`;
  }
  const sig = quoteLineSignature(draft.lines, draft.discountNote);
  let same: { id: string } | undefined;
  for (const q of open ?? []) {
    if (q.status !== "draft" || q.option_code !== INSTALLER_QUOTE_CODE || Number(q.subtotal_inc_gst) !== draft.subtotal || Number(q.veec_discount_inc_gst) !== draft.discount) continue;
    const { data: items } = await admin.from("quote_items").select("code, line_total_inc_gst, description, quantity, unit, unit_price_inc_gst, explanation, is_other").eq("quote_id", q.id);
    if (quoteLineSignature(items ?? [], (q as { discount_note?: string | null }).discount_note) === sig) { same = q; break; }
  }
  if (same) {
    // Re-syncing fixed facts must refresh the hold reasons, not strand the identical-price draft.
    const { error: holdError } = await admin.from("quotes").update({ release_hold_reason: holdReason }).eq("id", same.id).eq("status", "draft");
    if (holdError) throw new Error("Quote hold reasons could not be refreshed.");
    if (mittiElectrician) {
      const { data: snapshot, error: se } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", "mitti_quote_electrician_snapshot").contains("details", { quote_id: same.id }).limit(1).maybeSingle();
      if (se) throw new Error("Could not check the quote electrician snapshot.");
      if (!snapshot) await logEvent(jobId, actorId, "mitti_quote_electrician_snapshot", "Ready Check quote electrician price and identity snapshot retained", { quote_id: same.id, electrician: mittiElectrician }, { internal: true });
    }
    await syncThickerDraft(jobId, actorId, a1Layout, await buildThicker(), holdReason, open ?? []);
    return draft;
  }
  await admin.from("quotes").update({ status: "superseded" }).eq("job_id", jobId).eq("kind", "installation").eq("status", "draft");
  const { data: q, error } = await admin.from("quotes").insert({
    job_id: jobId, kind: "installation", option_label: intakePrice ? "Installer's quote (from intake)" : "Installer's quote (from Ready Check)", option_code: INSTALLER_QUOTE_CODE, status: "draft", sent_at: null,
    release_state: "held", release_hold_reason: holdReason,
    subtotal_inc_gst: draft.subtotal, gst_amount: Math.round((draft.subtotal - draft.subtotal / 1.1) * 100) / 100,
    veec_discount_inc_gst: draft.discount, discount_note: draft.discountNote, customer_total_inc_gst: draft.afterDiscount, created_by: actorId,
  }).select("id").single();
  if (error || !q) throw new Error(error?.message ?? "Quote could not be saved.");
  const { error: ie } = await admin.from("quote_items").insert(draft.lines.map((l) => ({ ...l, quote_id: q.id })));
  if (ie) throw new Error(ie.message);
  await logEvent(jobId, actorId, "installer_quote_drafted", `Installer-supplied owner quote drafted — held: ${holdReason}`, { audit_id: auditId, quote_id: q.id, total: draft.subtotal, discount: draft.discount, release_state: "held" }, { internal: true });
  if (mittiElectrician) await logEvent(jobId, actorId, "mitti_quote_electrician_snapshot", "Ready Check quote electrician price and identity snapshot retained", { quote_id: q.id, electrician: mittiElectrician }, { internal: true });
  await syncThickerDraft(jobId, actorId, a1Layout, await buildThicker(), holdReason, []);
  return draft;
}

type A1Layout = { mainLines: string[]; thickerLines: string[]; thicker: 6 | 7 | null; thickerTotal: number | null };
/** The boss's saved per-area picks (latest price event) on the CURRENT new-wording Ready Check; null on old forms. */
async function a1LayoutForJob(jobId: string): Promise<A1Layout | null> {
  const [{ data: m, error: me }, { data: ev, error: ee }] = await Promise.all([
    admin.from("ceiling_measurements").select("zones").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
    admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "installer_price_set").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (me || ee) throw new Error("The Ready Check or the installer's price could not be read.");
  const zones = Array.isArray((m as { zones?: unknown } | null)?.zones) ? (m as { zones: { layout?: unknown }[] }).zones : [];
  const areas = zones.map((z) => z?.layout).filter(Boolean) as import("./ceiling-layout.core").LayoutArea[];
  const layout = (ev?.details as { layout?: { mainPicks?: import("./ceiling-layout.core").A1Pick[]; thickerPicks?: import("./ceiling-layout.core").A1Pick[]; thickerTotalIncGst?: number | null; thicker?: 6 | 7 | null } } | null)?.layout;
  if (!areas.length || !layout) return null;
  const { a1QuoteLines } = await import("./ceiling-layout.core");
  return { mainLines: a1QuoteLines(areas, layout.mainPicks ?? []), thickerLines: a1QuoteLines(areas, layout.thickerPicks ?? []), thicker: layout.thicker ?? null, thickerTotal: layout.thickerTotalIncGst ?? null };
}

/** Jo 4 Nov follow-up: the installer's line shows one exact line per area (and per removal), never "about". */
function applyA1Wording(draft: { lines: { code: string | null; description: string }[] }, lines: string[]) {
  const line = draft.lines.find((l) => l.code === "INSTALLER_PRICE");
  if (line && lines.length) line.description = lines.join("\n");
}

/** Keeps exactly one held thicker-option draft next to the main draft (same signature → untouched). Never sends. */
async function syncThickerDraft(jobId: string, actorId: string | null, layout: A1Layout | null, t: ReturnType<typeof import("./mitti-installer-quote.core").buildOwnCustomerQuoteDraft> | null, holdReason: string, open: { id: string; status: string; option_code: string | null; subtotal_inc_gst: unknown; veec_discount_inc_gst: unknown; discount_note?: string | null }[]) {
  const { A1_THICKER_CODE, rLabel } = await import("./ceiling-layout.core");
  const existing = open.filter((q) => q.status === "draft" && q.option_code === A1_THICKER_CODE);
  if (!t || !layout?.thicker) {
    if (existing.length) await admin.from("quotes").update({ status: "superseded" }).in("id", existing.map((q) => q.id)).eq("status", "draft");
    return;
  }
  const sig = quoteLineSignature(t.lines, t.discountNote);
  for (const q of existing) {
    if (Number(q.subtotal_inc_gst) !== t.subtotal || Number(q.veec_discount_inc_gst) !== t.discount) continue;
    const { data: items } = await admin.from("quote_items").select("code, line_total_inc_gst, description, quantity, unit, unit_price_inc_gst, explanation, is_other").eq("quote_id", q.id);
    if (quoteLineSignature(items ?? [], q.discount_note) === sig) { await admin.from("quotes").update({ release_hold_reason: holdReason }).eq("id", q.id).eq("status", "draft"); return; }
  }
  if (existing.length) await admin.from("quotes").update({ status: "superseded" }).in("id", existing.map((q) => q.id)).eq("status", "draft");
  const { data: q, error } = await admin.from("quotes").insert({
    job_id: jobId, kind: "installation", option_label: `Thicker option – ${rLabel(layout.thicker)} total`, option_code: A1_THICKER_CODE, status: "draft", sent_at: null,
    release_state: "held", release_hold_reason: holdReason,
    subtotal_inc_gst: t.subtotal, gst_amount: Math.round((t.subtotal - t.subtotal / 1.1) * 100) / 100,
    veec_discount_inc_gst: t.discount, discount_note: t.discountNote, customer_total_inc_gst: t.afterDiscount, created_by: actorId,
  }).select("id").single();
  if (error || !q) throw new Error(error?.message ?? "Thicker option could not be saved.");
  const { error: ie } = await admin.from("quote_items").insert(t.lines.map((l) => ({ ...l, quote_id: q.id })));
  if (ie) throw new Error(ie.message);
  await logEvent(jobId, actorId, "installer_quote_drafted", `Thicker ${rLabel(layout.thicker)} option drafted — held: ${holdReason}`, { quote_id: q.id, total: t.subtotal, discount: t.discount, release_state: "held", option: "thicker" }, { internal: true });
}
