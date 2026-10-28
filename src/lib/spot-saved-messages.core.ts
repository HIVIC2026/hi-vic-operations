// "Spot saved" confirmation (text + email), sent once when an owner first saves their spot.
// Email design APPROVED by Jo 24 Oct 2026 (decision 70), refreshed as MJML 27 Oct 2026 (docs/templates/mjml/owner_O10):
// "Smart move, {First}. Your spot is saved." + "Your {rebate} rebate is waiting"; demand line; rebate and price boxes;
// "What happens next" steps with See my job; the Save my spot included / not included cards (+ the existing-insulation
// card for those owners); friend card. The text message keeps its earlier approved wording (task scope: emails only).
// Decision 388 (Jo 25 Oct 2026): both are sent BEFORE the spot is released, so they are spot-only — no Ready Check,
// installer times, measuring, quote timing or speed ("as soon as"). Changed directly (the email has no approval flag);
// the text is held (`spot_saved` wordingApproved=false in sms.core) until Jo approves docs/decision-388-spot-only-wording.md.
// PURE: no I/O. No phone number or "call us" anywhere.
import { shortAddress } from "./address";
import { EXISTING_PRELIMINARY, REMOVAL_BUDGET_EMAIL_NOTE, removalNote, type EstimateRemoval } from "./estimate-removal.core";
import * as K from "./email-kit.core";
import { mjEmail } from "./mail-mjml.core";
import { includedCardsText, mjExistingInsulation, mjIncludedCards, mjLinkCard, mjSmallEnd } from "./jo-outcome-email.core";
import { SPOT_FREE, SPOT_IN_TOUCH, SPOT_ORDER, SPOT_PRICE_NOTE, SPOT_REGISTERED } from "./spot-only-copy.core";

/** Jo 23 Oct 2026: shown to everyone in both Spot saved confirmations. */
export const SPOT_SAVED_NOT_INCLUDED = "Not included: if the electrical safety check finds anything that needs fixing, that work is extra and will be quoted separately.";
export const wholeDollars = (n: number) => `$${Math.floor(n).toLocaleString("en-AU")}`;

export type SpotSavedInput = { firstName: string | null; rebate: number; suburb: string | null; shortAddress: string | null; myJobUrl: string; optOutUrl: string;
  /** Owner's referral link to the public eligibility checker (Jo, 7 Oct): shown as a "Send to a friend" card. */
  referralUrl?: string | null;
  /** Saved-spot snapshot: when present the email shows the two-figure price box and the included / not included cards. */
  estimate?: { gross: number; customer: number; areaM2: number; address: string | null; calculatorUrl: string } | null;
  /** Removal fact from the owner's saved estimate (removalFromScenario), same as Save my spot. Excluded = nothing shown. */
  removal?: EstimateRemoval | null };

// Decision 70 layout, decision 388 wording.
export const SPOT_SAVED_BATCH_TEXT = `${SPOT_REGISTERED} ${SPOT_ORDER} You've locked in your place, so there's nothing more you need to do right now.`;
/** Kept for callers; the suburb is no longer used (no promise about installers near the owner). */
export const spotSavedTeamText = (_suburb: string | null) => `${SPOT_IN_TOUCH.replace(/\.$/, "")}, with your next step.`;

/** "12 Smith St, Ballarat VIC 3350" -> { short: "12 Smith St, Ballarat", suburb: "Ballarat" } */
export function addressBits(addressLine: string | null, suburb: string | null) {
  const sub = suburb?.trim() || null;
  const line = addressLine?.trim() || null;
  return { suburb: sub, short: shortAddress(line, sub) };
}

export function renderSpotSavedSms(i: SpotSavedInput) {
  const name = i.firstName?.trim() ? `, ${i.firstName.trim()}` : "";
  return `Spot saved${name}! 🎉 Smart move: your ${wholeDollars(i.rebate)} rebate is waiting. ${SPOT_REGISTERED} ${SPOT_ORDER} ${SPOT_IN_TOUCH} Your job: ${i.myJobUrl} – Home Insulation Victoria`;
}

/** O10 step 2 (MJML refresh, Jo 27 Oct 2026). */
const SPOT_SAVED_STEP_2 = "When your spot is released, we'll tell you your next step.";
const SPOT_SAVED_PREVIEW = "You've locked in your place. There's nothing more you need to do right now.";
const mjSmall = (text: string, padding = "10px 12px 0") => `<mj-section><mj-column><mj-text mj-class="small" padding="${padding}">${K.esc(text)}</mj-text></mj-column></mj-section>`;

export function renderSpotSavedEmail(i: SpotSavedInput) {
  const rebate = wholeDollars(i.rebate);
  const name = i.firstName?.trim() || null;
  const subject = `Spot saved. Your ${rebate} rebate is waiting`;
  const est = i.estimate && i.estimate.gross > 0 ? i.estimate : null;
  const removal = i.removal && i.removal.kind !== "excluded" ? i.removal : null;
  const smartMove = `Smart move${name ? `, ${name}` : ""}. Your spot is saved.`;
  const rebateLine = `Your ${rebate} rebate is waiting`;
  const steps: K.Step[] = [
    { title: "Your place is kept", detail: SPOT_FREE },
    { title: "We'll be in touch", detail: SPOT_SAVED_STEP_2 },
  ];
  const estNote = est ? `Estimate incl. GST for ${K.m2(est.areaM2)}. ${SPOT_PRICE_NOTE.replace(/^This is an estimate\. /, "")}` : null;
  // Decision 70: the Save my spot cards, plus the existing-insulation card when the saved estimate carries removal.
  const some = !!removal;
  const removalCard = est && removal ? mjExistingInsulation(est.areaM2, removal.kind === "included" && removal.areaM2 > 0 ? Math.round(removal.amount / removal.areaM2) : 15, Math.round(15 * est.areaM2)) : "";
  const removalLine = removal?.kind === "included" ? `Removal of existing insulation: $${removal.amount.toLocaleString("en-AU", { maximumFractionDigits: 2 })} inc GST (${removal.areaM2.toLocaleString("en-AU")} m² included in this estimate; the scope and price are confirmed before you agree to anything.)` : null;
  const body = [
    `<mj-section><mj-column><mj-text mj-class="hi">${K.esc(smartMove)}</mj-text><mj-text mj-class="h1" css-class="email-heading" padding="4px 12px 10px">${K.esc(rebateLine)}</mj-text><mj-text>${K.esc(SPOT_SAVED_BATCH_TEXT)}</mj-text></mj-column></mj-section>`,
    est ? `<mj-section><mj-column mj-class="panel-mint"><mj-text mj-class="eyebrow center" padding="18px 12px 6px">VEU rebate</mj-text><mj-text mj-class="big-green" padding="0 12px 18px">You save ${K.esc(K.whole(i.rebate))}</mj-text></mj-column></mj-section>`
      + `<mj-section><mj-column mj-class="panel"><mj-text mj-class="eyebrow center" padding="18px 12px 6px">You pay about</mj-text><mj-text mj-class="big-blue">${K.esc(K.whole(est.customer))}</mj-text><mj-text mj-class="small center" padding="0 16px 18px">${K.esc(estNote!)}</mj-text></mj-column></mj-section>` : "",
    `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px 10px">What happens next</mj-text><mj-table padding="0 18px 4px">${steps.map((st, n) => `<tr><td width="34" valign="top" style="padding:1px 0 ${n === steps.length - 1 ? 12 : 14}px;"><span class="num">${n + 1}</span></td><td style="padding:0 0 ${n === steps.length - 1 ? 12 : 14}px;"><strong>${K.esc(st.title)}</strong><br /><span class="muted">${K.esc(st.detail ?? "")}</span></td></tr>`).join("")}</mj-table><mj-button href="${K.esc(i.myJobUrl)}" padding="0 18px 16px">See my job</mj-button></mj-column></mj-section>`,
    est ? `${mjIncludedCards({ price: est.customer, rebate: i.rebate, someInsulation: some })}${mjSmallEnd(K.esc(K.INCLUDED_CLOSING))}` : mjSmall(SPOT_SAVED_NOT_INCLUDED),
    removalCard,
    removal?.kind === "unknown" ? mjSmall(REMOVAL_BUDGET_EMAIL_NOTE) : "",
    removalLine ? mjSmall(removalLine) : "",
    i.referralUrl ? mjLinkCard("Have a friend who needs a spot saved?", "Send them our free eligibility checker. It takes a minute.", K.friendShareHref(i.referralUrl), "Send to a friend") : "",
  ].join("\n");
  const html = mjEmail({ subject, preview: SPOT_SAVED_PREVIEW, body, unsubscribe: i.optOutUrl });
  const text = K.plainText([
    smartMove, `${rebateLine}.`, "", SPOT_SAVED_BATCH_TEXT, "",
    ...(est ? [`VEU rebate: You save ${rebate}`, `You pay about: ${K.whole(est.customer)}`, estNote!, ""] : []),
    "WHAT HAPPENS NEXT", ...steps.map((s, n) => `${n + 1}. ${s.title}: ${s.detail}`), "",
    `See my job: ${i.myJobUrl}`, "",
    ...(est ? [...includedCardsText({ price: est.customer, rebate: i.rebate, someInsulation: some }), "", K.INCLUDED_CLOSING, ""] : []),
    SPOT_SAVED_NOT_INCLUDED,
    ...(removal ? ["", ...(removalLine ? [removalLine] : []), removalNote(removal), EXISTING_PRELIMINARY, ...(removal.kind === "unknown" ? [REMOVAL_BUDGET_EMAIL_NOTE] : [])] : []),
    ...(est ? [`Try a different size: ${est.calculatorUrl}`] : []),
    ...(i.referralUrl ? ["", "HAVE A FRIEND WHO NEEDS A SPOT SAVED?", "Send them our free eligibility checker. It takes a minute.", `Send to a friend: ${i.referralUrl}`] : []),
  ], { unsubscribe: i.optOutUrl });
  return { subject, html, text };
}
