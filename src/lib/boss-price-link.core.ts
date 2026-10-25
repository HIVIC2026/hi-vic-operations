// Decision 288 (Jo 25 Oct 2026): one Ready Check template, no price in Mitti. When an A1 (installer-supplied customer)
// Ready Check is marked Complete and the business owner has not entered a price, the business owner is texted ONE secure
// link straight to the "Your price" card on the job page — whoever did the Ready Check (staff never see a price).
// Pure: the decision, the key, the wording and the link. Sent by boss-price-link.server.ts through the existing guarded
// installer SMS path (TEST job / TEST partner → test-send; real partner → the ONE real sender, type `boss_price_link`,
// no retry; a held attempt never claims the key — decision 165). No I/O.

/** Recorded once per job BEFORE anything is sent (details: { key, audit_id, completed_at, business_id, to }). */
export const BOSS_PRICE_LINK_EVENT = "boss_price_link_sent" as const;
/** The job-page anchor the link opens on (the "Your price" card, InstallerPriceCard). */
export const PRICE_CARD_ANCHOR = "price";

/** One text per job, ever (a second Complete, a re-sync or the 15-minute sweep never texts again). */
export const bossPriceLinkKey = (jobId: string) => `boss-price-link:v1:${jobId}`;

/** The authenticated job page, scrolled to the price card (the boss signs in; the card renders for the business admin only). */
export const bossPriceLink = (base: string, jobId: string) => `${base.replace(/\/+$/, "")}/field/${jobId}#${PRICE_CARD_ANCHOR}`;

/** Decision 288 wording (coordinator, 25 Oct 2026). The sender adds "Home Insulation Victoria: ". */
export function bossPriceLinkText(f: { jobNumber: string; street: string | null; link: string }): string {
  return `${f.jobNumber} Ready Check done at ${f.street?.trim() || "the property"}. Enter your price: ${f.link}`;
}

export type BossPriceLinkFacts = {
  channel: string | null | undefined;
  deleted: boolean;
  formCompleted: boolean;
  /** An `installer_price_set` event exists (or an old form carries a usable total). */
  pricePresent: boolean;
  /** A `boss_price_link_sent` event already exists for this job. */
  alreadySent: boolean;
};
/** Why no text goes now (null = send). A1 only; once per job; never once the price is in. */
export function bossPriceLinkBlocker(f: BossPriceLinkFacts): string | null {
  if (f.channel !== "installer_sourced") return "not an installer-supplied job";
  if (f.deleted) return "job closed";
  if (!f.formCompleted) return "Ready Check not marked Complete";
  if (f.alreadySent) return "already texted";
  if (f.pricePresent) return "price already entered";
  return null;
}
