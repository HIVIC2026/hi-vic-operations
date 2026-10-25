// "Spot saved" confirmation (text + email), sent once when an owner first saves their spot.
// Email design APPROVED by Jo 24 Oct 2026 (decision 70): docs/templates/owner/O10-spot-saved.html — "Smart move,
// {First}. Your spot is saved." + green "Your {rebate} rebate is waiting."; demand line; two-figure price box; three
// "What happens next" steps; See my job; the Save my spot included / not included cards (+ the existing-insulation card
// for those owners); friend card. The text keeps its earlier approved wording (task scope: emails only).
// PURE: no I/O. No phone number or "call us" anywhere.
import { dedupeAddress, shortAddress } from "./address";
import { EXISTING_PRELIMINARY, REMOVAL_BUDGET_EMAIL_NOTE, removalNote, type EstimateRemoval } from "./estimate-removal.core";
import * as K from "./email-kit.core";

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

// Decision 70 wording.
export const SPOT_SAVED_BATCH_TEXT = "Demand is high and installer capacity is limited, so we book homes in the order spots were saved. You've locked in your place, so there's nothing more you need to do right now.";
export const spotSavedTeamText = (suburb: string | null) => `When a certified installer is free near ${suburb?.trim() ? suburb.trim() : "you"}, we'll text and email you their times for your free Ready Check.`;

/** "12 Smith St, Ballarat VIC 3350" -> { short: "12 Smith St, Ballarat", suburb: "Ballarat" } */
export function addressBits(addressLine: string | null, suburb: string | null) {
  const sub = suburb?.trim() || null;
  const line = addressLine?.trim() || null;
  return { suburb: sub, short: shortAddress(line, sub) };
}

export function renderSpotSavedSms(i: SpotSavedInput) {
  const name = i.firstName?.trim() ? `, ${i.firstName.trim()}` : "";
  const where = i.suburb?.trim() ? ` in ${i.suburb.trim()}` : "";
  return `Spot saved${name}! 🎉 Smart move: your ${wholeDollars(i.rebate)} rebate is waiting. Demand is high and capacity is limited, but your place in line is locked in. We'll text you as soon as an installer is free${where}. Your job: ${i.myJobUrl} – Home Insulation Victoria`;
}

export function renderSpotSavedEmail(i: SpotSavedInput) {
  const rebate = wholeDollars(i.rebate);
  const name = i.firstName?.trim() || null;
  const subject = `Spot saved. Your ${rebate} rebate is waiting`;
  const est = i.estimate && i.estimate.gross > 0 ? i.estimate : null;
  const removal = i.removal && i.removal.kind !== "excluded" ? i.removal : null;
  const smartMove = `Smart move${name ? `, ${name}` : ""}. Your spot is saved.`;
  const rebateLine = `Your ${rebate} rebate is waiting.`;
  const steps: K.Step[] = [
    { title: "An installer offers you times", detail: spotSavedTeamText(i.suburb) },
    { title: "Tap the time that suits you", detail: "Or suggest other days. No phone tag." },
    { title: "Free Ready Check, then your exact price", detail: "They measure your ceiling and check your insulation. You get your final quote. No payment, no obligation." },
  ];
  const estNote = est ? `Estimate incl. GST for ${K.m2(est.areaM2)}. Confirmed at your free Ready Check.` : null;
  // Decision 70: the Save my spot cards, plus the existing-insulation card when the saved estimate carries removal.
  const some = !!removal;
  const removalCard = est && removal ? K.existingInsulationCard({ areaM2: est.areaM2, ratePerM2: removal.kind === "included" && removal.areaM2 > 0 ? Math.round(removal.amount / removal.areaM2) : 15, upTo: removal.kind === "included" ? Math.round(15 * est.areaM2) : Math.round(15 * est.areaM2) }) : "";
  const body = [
    K.h1(smartMove, 6),
    K.greenLead(rebateLine),
    K.p(SPOT_SAVED_BATCH_TEXT),
    est ? K.twoFigureBox({ rebate: i.rebate, price: est.customer, note: estNote! }) : "",
    K.sectionTitle("What happens next", "24px 0 12px"),
    K.numberedSteps(steps),
    K.button(i.myJobUrl, "See my job", "6px 0 4px"),
    K.spacer(8),
    est ? K.includedAndNotIncluded({ price: est.customer, rebate: i.rebate, someInsulation: some }) : K.small(SPOT_SAVED_NOT_INCLUDED, "10px 0 0"),
    removalCard,
    removal?.kind === "unknown" ? K.small(REMOVAL_BUDGET_EMAIL_NOTE, "10px 0 0") : "",
    removal?.kind === "included" ? K.small(`Removal of existing insulation: $${removal.amount.toLocaleString("en-AU", { maximumFractionDigits: 2 })} inc GST (${removal.areaM2.toLocaleString("en-AU")} m² included in this estimate; scope confirmed at your free Ready Check.)`, "10px 0 0") : "",
    i.referralUrl ? K.friendCard(i.referralUrl, "spot") : "",
  ].join("\n");
  const html = K.emailShell({ body, previewText: rebateLine, unsubscribe: i.optOutUrl });
  const text = K.plainText([
    smartMove, rebateLine, "", SPOT_SAVED_BATCH_TEXT, "",
    ...(est ? [`VEU rebate: ${rebate}`, `You pay about: ${K.whole(est.customer)}`, estNote!, ""] : []),
    "WHAT HAPPENS NEXT", ...steps.map((s, n) => `${n + 1}. ${s.title}: ${s.detail}`), "",
    `See my job: ${i.myJobUrl}`, "",
    ...(est ? [...K.includedAndNotIncludedText({ price: est.customer, rebate: i.rebate, someInsulation: some }), ""] : []),
    SPOT_SAVED_NOT_INCLUDED,
    ...(removal ? ["", ...(removal.kind === "included" ? [`Removal of existing insulation: $${removal.amount.toLocaleString("en-AU", { maximumFractionDigits: 2 })} inc GST (${removal.areaM2.toLocaleString("en-AU")} m² included in this estimate; scope confirmed at your free Ready Check.)`] : []), removalNote(removal), EXISTING_PRELIMINARY, ...(removal.kind === "unknown" ? [REMOVAL_BUDGET_EMAIL_NOTE] : [])] : []),
    ...(est ? [`Try a different size: ${est.calculatorUrl}`] : []),
    ...(i.referralUrl ? ["", "HAVE A FRIEND WHO NEEDS A SPOT SAVED?", "Send them our free eligibility checker. It takes a minute.", `Send to a friend: ${i.referralUrl}`] : []),
  ], { unsubscribe: i.optOutUrl });
  void dedupeAddress;
  return { subject, html, text };
}
