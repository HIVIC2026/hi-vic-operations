// Repeat PIESA after the 30-day window lapses (decision 158, Jo 27/28 Oct 2026: "OFFICE CHOOSES").
// PURE. The office picks who pays (owner / installer / HIVIC); `repeatPiesaPayer` (thirty-day-rule.core) is only a
// suggestion shown to the office — it never decides or charges anything. The owner then accepts; owner-pays must be
// paid before the PIESA is booked; installer-pays is deducted from that installer's payout on the job.

export type RepeatPayer = "owner" | "installer" | "hivic";
export const REPEAT_PAYERS: RepeatPayer[] = ["owner", "installer", "hivic"];
export const REPEAT_PAYER_LABEL: Record<RepeatPayer, string> = { owner: "Owner", installer: "Installer", hivic: "Home Insulation Victoria" };

export const REPEAT_PIESA_CHOSEN_EVENT = "repeat_piesa_payer_chosen";
export const REPEAT_PIESA_ACCEPTED_EVENT = "repeat_piesa_accepted";
export const REPEAT_PIESA_PAID_EVENT = "repeat_piesa_paid";
/** admin_config_events: the office "Repeat safety check price" (inc GST). Latest wins; null = not set. */
export const REPEAT_PIESA_PRICE_EVENT = "repeat_piesa_price_set";

/** Jo 28 Oct 2026 (batch 1 task 6): a job reopened at or after the safety check needs a NEW one; the old check no longer
 *  counts. details `{ key: "reopen:<iso>", had_check }`. With had_check (a PIESA record existed) the reopen acts as the
 *  lapse, keyed by `key` in place of a 30-day deadline, until a PIESA record is created after it. */
export const REPEAT_REOPEN_EVENT = "piesa_superseded_on_reopen";
export const REOPEN_KEY_PREFIX = "reopen:";
export const reopenKey = (iso: string) => `${REOPEN_KEY_PREFIX}${iso}`;
export const isReopenKey = (deadline: string | null | undefined) => !!deadline && deadline.startsWith(REOPEN_KEY_PREFIX);
/** A PIESA record made at or before the latest reopen no longer counts (null reopen = it counts). */
export function piesaSupersededByReopen(recordCreatedAt: string | null | undefined, reopenAt: string | null | undefined): boolean {
  if (!reopenAt) return false;
  return !recordCreatedAt || Date.parse(recordCreatedAt) <= Date.parse(reopenAt);
}

export type RepeatChoice = { payer: RepeatPayer; priceIncGst: number | null; deadline: string; at: string };
export type RepeatFacts = {
  /** Install deadline of the lapsed 30-day window (expired, nothing booked); null when not lapsed. */
  lapsedDeadline: string | null;
  choice: RepeatChoice | null;
  acceptedAt: string | null;
  paidAt: string | null;
};
export type RepeatStage = "none" | "choose" | "owner_accept" | "owner_pay" | "offer";
export type RepeatState = { stage: RepeatStage; payer: RepeatPayer | null; priceIncGst: number | null; deadline: string | null };

/** Only facts for the CURRENT lapsed deadline count; an older choice never carries over to a new lapse. */
export function repeatPiesaState(f: RepeatFacts): RepeatState {
  const choice = f.choice && f.lapsedDeadline && f.choice.deadline === f.lapsedDeadline ? f.choice : null;
  if (!f.lapsedDeadline && !choice) return { stage: "none", payer: null, priceIncGst: null, deadline: null };
  if (!choice) return { stage: "choose", payer: null, priceIncGst: null, deadline: f.lapsedDeadline };
  const base = { payer: choice.payer, priceIncGst: choice.priceIncGst, deadline: choice.deadline };
  if (!f.acceptedAt) return { stage: "owner_accept", ...base };
  if (choice.payer === "owner" && !f.paidAt) return { stage: "owner_pay", ...base };
  return { stage: "offer", ...base };
}

export const REPEAT_PRICE_NOT_SET = "The repeat safety check price isn't set yet, so the owner can't be charged. Add it under Settings › Repeat safety check price first, or choose the installer or Home Insulation Victoria.";

/** Why the office's choice is refused (null = allowed). */
export function chooseRepeatPayerBlocker(s: RepeatState, payer: RepeatPayer, priceIncGst: number | null): string | null {
  if (s.stage === "none") return "The 30-day window hasn't lapsed on this job.";
  if (s.stage !== "choose") return "Who pays for the repeat safety check has already been chosen.";
  if (!REPEAT_PAYERS.includes(payer)) return "Choose the owner, the installer or Home Insulation Victoria.";
  if (payer === "owner" && !(priceIncGst != null && priceIncGst > 0)) return REPEAT_PRICE_NOT_SET;
  return null;
}

/** Why a repeat PIESA can't be offered / booked yet (null = clear). Added to the normal PIESA gate. */
export function repeatPiesaGateBlocker(s: RepeatState): string | null {
  if (s.stage === "choose") return "The office is choosing who pays for the repeat safety check (PIESA).";
  if (s.stage === "owner_accept") return "Waiting for the owner to accept the new safety check (PIESA).";
  if (s.stage === "owner_pay") return "The repeat safety check (PIESA) payment is needed before it's booked.";
  return null;
}

/** What comes off the installer's payout on this job (inc GST); 0 unless the installer pays. */
export function installerRepeatDeduction(s: RepeatState): number {
  return s.payer === "installer" && s.stage !== "none" && s.priceIncGst != null ? s.priceIncGst : 0;
}

const money = (n: number) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
export const REPEAT_ARRANGING_TITLE = "We're arranging the next step";
export const REPEAT_NEEDED_TITLE = "A new safety check (PIESA) is needed";
export const REPEAT_WHY = "Your electrical safety check is valid for 30 days. The 30 days since your last check have passed, so the law needs a fresh check before your insulation can be installed.";
export const REPEAT_REOPEN_WHY = "Your job was reopened, so a new safety check is needed before your insulation can be installed.";

export type OwnerRepeatView = { title: string; body: string; price: string | null; button: "Accept" | null };
/** The owner's job page while a repeat PIESA is in play (null = nothing to show). Never mentions install days. */
export function ownerRepeatView(s: RepeatState): OwnerRepeatView | null {
  if (s.stage === "none") return null;
  if (s.stage === "choose") return { title: REPEAT_ARRANGING_TITLE, body: "Our team is arranging the next step for your install. We'll let you know shortly.", price: null, button: null };
  const ownerPays = s.payer === "owner" && s.priceIncGst != null;
  if (s.stage === "owner_accept") return {
    title: REPEAT_NEEDED_TITLE, body: isReopenKey(s.deadline) ? REPEAT_REOPEN_WHY : REPEAT_WHY,
    price: ownerPays ? `The new safety check costs ${money(s.priceIncGst!)} inc GST. Accepting adds it to your bill. It's paid before the safety check is booked.` : "There's no cost to you for this check.",
    button: "Accept",
  };
  if (s.stage === "owner_pay") return { title: REPEAT_NEEDED_TITLE, body: `Thanks for accepting. Please pay ${money(s.priceIncGst ?? 0)} inc GST for the new safety check. We book it once it's paid.`, price: null, button: null };
  return { title: REPEAT_NEEDED_TITLE, body: "Thanks for accepting. We're arranging your electrician — they'll offer you 3 safety check times.", price: null, button: null };
}

// ---- Owner pays (Jo 28 Oct, decision 233): the repeat price goes on the job's ONE Xero invoice as one line ----
export const REPEAT_XERO_ADDED_EVENT = "xero_invoice_repeat_piesa_added";
export const REPEAT_XERO_HELD_EVENT = "xero_invoice_repeat_piesa_held";
/** Tag printed on the Xero line so a lost response is recognised on the invoice itself (one per lapsed deadline). */
export const repeatLineTag = (deadline: string) => `repeat PIESA ${deadline}`;
export const repeatLineKey = (invoiceId: string, deadline: string, cents: number) => `xero-repeat-piesa:v1:${invoiceId}:${deadline}:${Math.round(cents)}`;
export const repeatLineDescription = (reference: string, deadline: string) => `${reference} – New safety check (PIESA), 30-day window lapsed (${repeatLineTag(deadline)})`;
/** Paid = Xero/card payments on the invoice grew by at least the repeat price since the line went on. */
export function repeatPaidByInvoice(i: { paidCents: number; paidAtAddCents: number; priceCents: number }): boolean {
  return i.priceCents > 0 && i.paidCents - i.paidAtAddCents >= i.priceCents;
}

/** Total (ex GST) to take off an installer's install payout for every repeat PIESA the office charged to the installer. */
export function repeatDeductionEx(choices: { payer?: string; price_inc_gst?: number | null }[], gst: number): number {
  const inc = choices.filter((c) => c.payer === "installer" && typeof c.price_inc_gst === "number" && c.price_inc_gst > 0).reduce((a, c) => a + (c.price_inc_gst as number), 0);
  return inc > 0 ? Math.round((inc / gst) * 100) / 100 : 0;
}
