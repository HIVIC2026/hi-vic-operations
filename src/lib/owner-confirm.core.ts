// Owner's ONE link for an installer-supplied job the installer has already quoted (Jo, 7 Oct 2026 9:25pm).
// Same measured-quote acceptance path; only the title and wording change. Pure wording + rules only.

/** Tick on Add one job (Jo's wording). */
export const OWNER_AGREED_TICK = "The owner has agreed to my price";

export const CONFIRM_JOB_TITLE = "Confirm your insulation job";
export const CONFIRMED_QUOTE_TITLE = "Your confirmed quote";

/** Jo insists this is clear: quote page, confirm page, safety-check booking, plain-text email, signed summary. */
export const PIESA_FIXES_NOTE =
  "Your electrical safety check may find electrical work that needs fixing before insulation can go in. Any electrical fixes are completely separate from this price. If needed, you'll receive a separate quote for that work to approve. Nothing is done without your OK.";

export type AgreedPrice = { agreed: boolean; installerName: string | null };

/** Title of the owner's price page. */
export function ownerPriceTitle(a: AgreedPrice | null | undefined): string {
  return a?.agreed ? CONFIRM_JOB_TITLE : CONFIRMED_QUOTE_TITLE;
}

/** "As agreed with [installer business name]" — only when the installer said the owner agreed and we know the business. */
export function agreedWithLabel(a: AgreedPrice | null | undefined): string | null {
  return a?.agreed && a.installerName ? `As agreed with ${a.installerName}` : null;
}

/** The owner-agreed tick needs "Quoted? Yes" with a price; it never blocks when unticked. */
export function ownerAgreedBlocker(x: { ownerAgreed?: boolean | null | undefined; quoted?: string | null | undefined; price?: number | null | undefined }): string | null {
  if (!x.ownerAgreed) return null;
  if (x.quoted !== "yes" || !(Number(x.price) > 0)) return "Enter your price (inc GST) to say the owner has agreed to it";
  return null;
}

/** Plain-text email for the owner's link. DRAFT wording: sending stays off until Jo approves it. */
export function ownerPriceEmailText(x: { firstName: string | null; agreed: AgreedPrice | null; total: number; link: string }): { subject: string; text: string } {
  const title = ownerPriceTitle(x.agreed);
  const aud = (v: number) => `$${v.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const as = agreedWithLabel(x.agreed);
  return {
    subject: `${title} — Home Insulation Victoria`,
    text: [
      x.firstName ? `Hi ${x.firstName},` : "Hi,",
      `${title}: ${aud(x.total)} inc GST${as ? ` (${as})` : ""}.`,
      `Sign, pay the safety check and pick your times here: ${x.link}`,
      PIESA_FIXES_NOTE,
      "Home Insulation Victoria",
    ].join("\n\n"),
  };
}

/** Appended to the signed Gate B summary so the owner's signed copy carries the note. */
export function signedSummaryNote(): string {
  return `\n\nPlease note: ${PIESA_FIXES_NOTE}`;
}
