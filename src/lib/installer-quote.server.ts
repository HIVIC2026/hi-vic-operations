// Automatic DRAFT owner quote for installer-brought jobs (A1): the Ready Check facts + the business owner's portal price
// (decision 278; old forms that still carry a price are the fallback).
// Never sends anything: the office reviews the co-branded preview and sends it (installer-quote.functions.ts).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { type LocationVariables } from "./activity48.core";
import { wholeVeecDiscount } from "./estimate.core";
import { buildInstallerQuoteDraft, quotedPriceFromEntries, piesaChargeIncGst } from "./installer-led.core";
import { installerQuoteReleaseBlockers, payerFromChoice } from "./installer-intake.core";

export const INSTALLER_QUOTE_CODE = "INSTALLER_A1";
type SigLine = { code: string | null; line_total_inc_gst: number | string | null; description?: string | null; quantity?: number | string | null; unit?: string | null; unit_price_inc_gst?: number | string | null; explanation?: string | null; is_other?: boolean | null };
/** Full scope fingerprint: equal amounts with changed inclusions/description/explanation are a DIFFERENT quote. */
export const quoteLineSignature = (lines: SigLine[], discountNote?: string | null) =>
  JSON.stringify([lines.map((l) => [l.code ?? "", Number(l.line_total_inc_gst), (l.description ?? "").trim(), Number(l.quantity ?? 0), l.unit ?? "", Number(l.unit_price_inc_gst ?? 0), (l.explanation ?? "").trim(), !!l.is_other]).map((x) => JSON.stringify(x)).sort(), (discountNote ?? "").trim()]);

/** Current installer quote's electrical billing lines vs the job's CURRENT payer (any path). Null = fine / not applicable. */
export async function quoteBillingBlocker(quoteId: string): Promise<string | null> {
  const { data: q } = await admin.from("quotes").select("option_code, status, job_id").eq("id", quoteId).maybeSingle();
  if (!q || q.option_code !== INSTALLER_QUOTE_CODE || q.status === "accepted") return null;
  const { data: j } = await admin.from("jobs").select("channel, electrician_choice, originating_installer_business_id").eq("id", q.job_id).maybeSingle();
  if (j?.channel !== "installer_sourced") return null;
  const { data: snapshot, error: se } = await admin.from("workflow_events").select("details").eq("job_id", q.job_id).eq("event_type", "mitti_quote_electrician_snapshot").contains("details", { quote_id: quoteId }).limit(1).maybeSingle();
  if (se) return "Quote electrician history could not be checked";
  if (snapshot) {
    const saved = (snapshot.details as unknown as { electrician: import("./usual-electrician.core").MittiElectricianResolution }).electrician;
    const { data: last, error: le } = await admin.from("workflow_events").select("details").eq("job_id", q.job_id).eq("event_type", "mitti_electrician_recorded").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const current = le ? null : last?.details as unknown as import("./usual-electrician.core").MittiElectricianResolution | null;
    if (saved?.choice === "usual") {
      if (!j.originating_installer_business_id) return "Installer has no usual electrician saved";
      const profile = await (await import("./usual-electrician.server")).readUsualElectrician(j.originating_installer_business_id).catch(() => null);
      const usual = profile?.electrician;
      // Decision 303: an approved-REC snapshot carries the REC's onboarded rate, not the declared price — identity must still
      // match. Decision 369: My business no longer records a price, so only the identity is compared (a re-save without a
      // price must not hold an existing quote).
      if (!usual || usual.name !== saved.name || usual.licence !== saved.licence) return "Usual electrician profile changed or is missing — sync the Ready Check and prepare a new quote";
    }
    const { data: lines, error: ie } = await admin.from("quote_items").select("code, line_total_inc_gst").eq("quote_id", quoteId);
    if (ie) return "Quote electrical lines could not be checked";
    return (await import("./mitti-installer-quote.core")).mittiQuoteElectricalBlocker(lines ?? [], saved, current);
  }
  const { data: items } = await admin.from("quote_items").select("code").eq("quote_id", quoteId);
  const { electricalLineBlocker } = await import("./installer-intake.core");
  return electricalLineBlocker((items ?? []).map((i) => i.code), payerFromChoice(j.electrician_choice));
}

export async function draftInstallerQuoteFromReadyCheck(jobId: string, actorId: string | null, formEntries: { label: string; value: string | null }[], auditId: string, intakePrice?: { totalIncGst: number; includes: string; areaM2?: number; separateLines?: { code: string; description: string; amountIncGst: number }[]; exclusions?: string | null }) {
  const { data: job } = await admin.from("jobs").select("channel, stage, deleted_at, qa_archived_at, ap_fee_override_inc_gst, electrician_choice, properties(postcode)").eq("id", jobId).single();
  if (!job || job.channel !== "installer_sourced") return null;
  if ((await import("./mitti.core")).isClosedOrArchivedJob(job)) return null; // HV-1351: no draft, no hold, no events
  // Decision 278: price, inclusions and electrician come from the business owner's portal entry (`installer_price_set`,
  // latest wins) FIRST; the Mitti answers are read only on old forms that still carry them.
  const priced = intakePrice ? { entries: formEntries, fromPriceCard: false } : await (await import("./installer-price.server")).entriesAndPriceSource(jobId, formEntries);
  const entries = priced.entries as { label: string; value: string | null }[];
  // Jo 27 Oct 2026 (HV-3197, "Ignore it"): the price card is the only price — a Mitti difficult-access charge/fee neither
  // shows on the installer line nor holds the quote. Old forms with no price-card entry keep the form's access answers.
  const fromPriceCard = priced.fromPriceCard;
  // Fee awareness is an office quote-SEND prerequisite (Jo, 8 Oct 2026): the draft is still prepared, but held.
  const { data: feeConfirmation } = await admin.from("workflow_events").select("id, details").eq("job_id", jobId).eq("event_type", "installer_owner_fee_awareness").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: open } = await admin.from("quotes").select("id, status, subtotal_inc_gst, veec_discount_inc_gst, option_code, discount_note").eq("job_id", jobId).eq("kind", "installation").in("status", ["draft", "issued", "accepted"]);
  // A sent quote is never touched. An ACCEPTED quote is never changed either, but when its facts were corrected
  // (reconfirmation open) a replacement draft may be prepared so the owner can reconfirm at the corrected figures.
  const { reconfirmationOpen } = await import("./installer-intake.server");
  if ((open ?? []).some((q) => q.status === "issued")) return null;
  if ((open ?? []).some((q) => q.status === "accepted") && !(await reconfirmationOpen(jobId))) return null;

  // Jo 23 Oct hard stops (contact No, R2+, life support, built in last 5 years): no quote at all.
  const answers = await import("./ready-check-answers.core");
  const stops = !intakePrice ? answers.readyCheckStopReasons(entries) : [];
  if (stops.length) {
    await (await import("./ready-check-quote.server")).recordNeedsOffice(jobId, actorId, null, stops);
    return { ready: false, blockers: stops, lines: [], subtotal: 0, discount: 0, afterDiscount: 0, discountNote: null };
  }
  const mittiElectrician = !intakePrice ? await (await import("./usual-electrician.server")).mittiElectricianForJob(jobId, actorId, entries, auditId) : null;
  const mittiProduct = !intakePrice ? await (await import("./insulation-product.server")).mittiProductForJob(jobId, actorId, entries, auditId) : null;

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
  const accessFee = !intakePrice && !fromPriceCard ? answers.difficultAccessFee(entries) : { amountIncGst: null, reason: null };
  const apFee = job.ap_fee_override_inc_gst != null ? Number(job.ap_fee_override_inc_gst) : rs ? Number(rs.ap_management_inc_gst) : null;
  const draftInput = {
    price: intakePrice ? { ok: true, issues: [], price: { included: [intakePrice.exclusions ? `${intakePrice.includes} (excludes: ${intakePrice.exclusions})` : intakePrice.includes], otherDescription: "", totalIncGst: Math.round(intakePrice.totalIncGst * 100) / 100, agreedWithOwner: false } } : quotedPriceFromEntries(entries, m?.removal_required ?? null), measuredM2: m2, wholeVeec,
    // CURRENT recorded payer: HIV = standard; own electrician (billed through us, Jo 26 Oct) or undecided = held until the Ready Check gives the price.
    separateLines: intakePrice?.separateLines ?? [],
    piesaIncGst: piesaChargeIncGst(job.electrician_choice ?? null, rs ? Number(rs.piesa_assessment_inc_gst) : null), apFeeIncGst: apFee,
    caps: {
      metropolitan: loc ? (loc as unknown as LocationVariables).metropolitan_or_regional === "Metropolitan" : null,
      minCopay: rs ? Number(rs.minimum_customer_copayment_inc_gst) : 200,
    },
  };
  const draft = mittiElectrician ? (await import("./mitti-installer-quote.core")).buildMittiInstallerQuote(draftInput, mittiElectrician) : buildInstallerQuoteDraft(draftInput);
  const payer = payerFromChoice(job.electrician_choice);
  if (!mittiElectrician && payer === "undecided") draft.blockers.unshift("Electrician not decided yet — the owner's electrician cost must be known before the quote");
  if (!mittiElectrician && payer === "undecided") draft.ready = false;
  // Jo 23 Oct: insulation product on the owner quote; incomplete product holds the quote.
  if (mittiProduct) {
    const { applyMittiProduct } = await import("./mitti-installer-quote.core");
    applyMittiProduct(draft, mittiProduct, m2);
  }
  if (!intakePrice) {
    const { applyMittiRemoval } = await import("./mitti-installer-quote.core");
    applyMittiRemoval(draft, answers.removalTotalM2(entries));
    if (!fromPriceCard) (await import("./mitti-installer-quote.core")).applyMittiAccessFeeIncluded(draft, answers.a1DifficultAccessIncluded(entries) || !!accessFee.amountIncGst, accessFee.amountIncGst);
  }
  if (!draft.ready) {
    if (mittiProduct && !mittiProduct.ready) await (await import("./ready-check-quote.server")).recordNeedsOffice(jobId, actorId, null, mittiProduct.reasons);
    if (mittiElectrician?.needsProfile) {
      await (await import("./ready-check-quote.server")).recordNeedsOffice(jobId, actorId, null, mittiElectrician.reasons);
      await (await import("./usual-electrician-reminder.server")).maybeRemindUsualElectrician(jobId, auditId);
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
    // Jo 27 Oct 2026 (HV-3129): a held quote never keeps showing an older price. When the electrician's price is known
    // (held only for other reasons) the held draft is rebuilt with the latest figures. When it is not known (own
    // electrician with no agreed price, undecided, not onboarded) no owner quote is drafted (decision 113, never a
    // guessed $349) and any open draft is withdrawn, so the installer sees only their own price.
    if (electricianPriceKnown(mittiElectrician, draftInput.piesaIncGst) && heldFiguresBuildable(draft, { measuredM2: m2, wholeVeec })) {
      setPiesaExplanation(draft, mittiElectrician);
      await writeHeldInstallerDraft({ jobId, actorId, auditId, open: open ?? [], draft, holdReason: heldDraftHoldReason(draft.blockers), intakePrice: !!intakePrice, mittiElectrician });
    } else if ((open ?? []).some((q) => q.status === "draft" && q.option_code === INSTALLER_QUOTE_CODE)) {
      const { error: se } = await admin.from("quotes").update({ status: "superseded" }).eq("job_id", jobId).eq("kind", "installation").eq("status", "draft").eq("option_code", INSTALLER_QUOTE_CODE);
      if (se) throw new Error("The old quote could not be withdrawn.");
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
  setPiesaExplanation(draft, mittiElectrician);
  await writeHeldInstallerDraft({ jobId, actorId, auditId, open: open ?? [], draft, holdReason, intakePrice: !!intakePrice, mittiElectrician });
  return draft;
}

type InstallerDraft = ReturnType<typeof buildInstallerQuoteDraft>;
type MittiElectrician = import("./usual-electrician.core").MittiElectricianResolution | null;

/** Jo 27 Oct 2026: the electrician's price is known when the Ready Check electrician is ready with a price, or (no
 *  Ready Check electrician) the job's payer gives the standard line. Not onboarded / no agreed price / undecided = unknown. */
export function electricianPriceKnown(mittiElectrician: MittiElectrician, piesaIncGst: number | null): boolean {
  if (mittiElectrician) return mittiElectrician.ready && mittiElectrician.priceIncGst != null && Number.isFinite(mittiElectrician.priceIncGst);
  return piesaIncGst != null && Number.isFinite(piesaIncGst);
}

/** A held quote can be rebuilt only with a real installer price, a positive total, a known measured area and a known
 *  whole-VEEC discount — a held preview never shows without the rebate. */
export function heldFiguresBuildable(draft: Pick<InstallerDraft, "lines" | "subtotal">, rebate: { measuredM2: number | null; wholeVeec: { veecs: number; raw: number } | null }): boolean {
  const installer = Number(draft.lines.find((l) => l.code === "INSTALLER_PRICE")?.line_total_inc_gst);
  const area = rebate.measuredM2 != null && Number.isFinite(rebate.measuredM2) && rebate.measuredM2 > 0;
  return Number.isFinite(installer) && installer > 0 && draft.subtotal > 0 && area && rebate.wholeVeec != null;
}

/** Hold reason for a draft built on the held path: its blockers, then the office-review line. With no blockers the
 *  generic hold ("Quote held for office review", as in quotes.server) is used so a held draft never looks sendable. */
export function heldDraftHoldReason(blockers: string[]): string {
  const reasons = blockers.filter((b) => b.trim().length > 0);
  return [...(reasons.length ? reasons : ["Quote held for office review"]), "Waiting for office review before sending"].join(" · ");
}

/** Identity is part of scope even if the selected electrician has the same price. */
function setPiesaExplanation(draft: InstallerDraft, mittiElectrician: MittiElectrician) {
  if (!mittiElectrician?.name) return;
  const electricalLine = draft.lines.find((l) => l.code === "PIESA");
  if (electricalLine) electricalLine.explanation = `Electrician: ${mittiElectrician.name}; licence: ${mittiElectrician.licence} (declared)`;
}

/** The one held-draft write for both the ready and the held paths: identical lines → only the hold reason is refreshed;
 *  otherwise older drafts are superseded and a new held draft is inserted. Never sends anything. */
async function writeHeldInstallerDraft(p: {
  jobId: string; actorId: string | null; auditId: string; draft: InstallerDraft; holdReason: string; intakePrice: boolean; mittiElectrician: MittiElectrician;
  open: { id: string; status: string; subtotal_inc_gst: number | string | null; veec_discount_inc_gst: number | string | null; option_code: string | null; discount_note?: string | null }[];
}) {
  const { jobId, actorId, auditId, draft, holdReason, mittiElectrician } = p;
  // Dedup only on identical figures AND identical lines (a payer change can keep totals but change scope/lines).
  const sig = quoteLineSignature(draft.lines, draft.discountNote);
  let same: { id: string } | undefined;
  for (const q of p.open) {
    if (q.status !== "draft" || q.option_code !== INSTALLER_QUOTE_CODE || Number(q.subtotal_inc_gst) !== draft.subtotal || Number(q.veec_discount_inc_gst) !== draft.discount) continue;
    const { data: items } = await admin.from("quote_items").select("code, line_total_inc_gst, description, quantity, unit, unit_price_inc_gst, explanation, is_other").eq("quote_id", q.id);
    if (quoteLineSignature(items ?? [], q.discount_note) === sig) { same = q; break; }
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
    return;
  }
  await admin.from("quotes").update({ status: "superseded" }).eq("job_id", jobId).eq("kind", "installation").eq("status", "draft");
  const { data: q, error } = await admin.from("quotes").insert({
    job_id: jobId, kind: "installation", option_label: p.intakePrice ? "Installer's quote (from intake)" : "Installer's quote (from Ready Check)", option_code: INSTALLER_QUOTE_CODE, status: "draft", sent_at: null,
    release_state: "held", release_hold_reason: holdReason,
    subtotal_inc_gst: draft.subtotal, gst_amount: Math.round((draft.subtotal - draft.subtotal / 1.1) * 100) / 100,
    veec_discount_inc_gst: draft.discount, discount_note: draft.discountNote, customer_total_inc_gst: draft.afterDiscount, created_by: actorId,
  }).select("id").single();
  if (error || !q) throw new Error(error?.message ?? "Quote could not be saved.");
  const { error: ie } = await admin.from("quote_items").insert(draft.lines.map((l) => ({ ...l, quote_id: q.id })));
  if (ie) throw new Error(ie.message);
  await logEvent(jobId, actorId, "installer_quote_drafted", `Installer-supplied owner quote drafted — held: ${holdReason}`, { audit_id: auditId, quote_id: q.id, total: draft.subtotal, discount: draft.discount, release_state: "held" }, { internal: true });
  if (mittiElectrician) await logEvent(jobId, actorId, "mitti_quote_electrician_snapshot", "Ready Check quote electrician price and identity snapshot retained", { quote_id: q.id, electrician: mittiElectrician }, { internal: true });
}
