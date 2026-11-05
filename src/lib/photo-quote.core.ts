// Photo-quote installers (No Gap, Jo 5 Nov 2026; spec docs/superpowers/specs/2026-11-05-photo-quote-installers-design.md).
// Pure rules only: how an installer quotes, whether the owner sent photos/videos, the photo quote form checks, the
// 2-business-day time limit and every piece of wording people read. No reads, no writes.
import { mediaType } from "./group-b-media.core";
import { insulationProduct } from "./insulation-product.core";
import { addVicBusinessDays, melbourneToday } from "./melbourne-time.core";

export type QuoteMethod = "ready_check" | "photos";
export const QUOTE_METHODS: readonly QuoteMethod[] = ["ready_check", "photos"];

/** A missing column, null or anything but "photos" is a Ready Check installer (the default). */
export function quoteMethodOf(b: { quote_method?: string | null } | null | undefined): QuoteMethod {
  return b?.quote_method === "photos" ? "photos" : "ready_check";
}

export type OwnerMediaDoc = { kind: string; mime_type: string | null; storage_path: string | null };
/** At least one owner photo or video (`documents.kind = 'intake_media'`, photo/video mime or file name). */
export function hasOwnerMedia(docs: readonly OwnerMediaDoc[]): boolean {
  return docs.some((d) => d.kind === "intake_media" && !!d.storage_path && mediaType(d.mime_type, d.storage_path));
}

/** Recorded (internal) just before a "From photos" allocation, with the allocation's batch id, so a job keeps the method
 *  it was given under even if the installer's setting changes later. No event for the batch = Ready Check. */
export const PHOTO_QUOTE_GIVE_EVENT = "in_house_quote_method";
/** The installer sent the photo quote (Task 5). */
export const PHOTO_QUOTE_SUBMITTED_EVENT = "photo_quote_submitted";

/** A missing `businesses.quote_method` column (pending SQL not run yet) reads as Ready Check; other errors are real. */
export function isMissingQuoteMethodColumn(e: { code?: string | null; message?: string | null } | null | undefined): boolean {
  return !!e && (e.code === "42703" || /quote_method[^]*does not exist|column [^ ]*quote_method/i.test(e.message ?? ""));
}

/** Days the installer has to send a photo quote, counted from the Melbourne day the job was given. */
export const PHOTO_QUOTE_BUSINESS_DAYS = 2;

export const PHOTO_QUOTE_WORDS = {
  settingLabel: "How they quote",
  methodLabel: { ready_check: "Ready Check", photos: "From photos" } as Record<QuoteMethod, string>,
  noPhotos: (installer: string) => `${installer} quotes from photos. This owner hasn't sent any.`,
  boxTitle: "Quote from photos",
  fields: { underR2: "Existing insulation under R2?", removeM2: "Sqm to remove", installM2: "Sqm to install", product: "Product" },
  send: "Send for quote",
  overR2: "Over R2 isn't eligible. Use Can't do this one.",
  footnote: (installer: string) => `Your quote uses what ${installer} worked out from your photos.`,
  quoteGone: "The quote has gone. Email us if something's wrong.",
  alreadySent: "This photo quote was already sent. Email us if something's wrong.",
  notReady: "This job isn't waiting for a photo quote.",
  paperworkStep: "Photo quote",
  overdueFlag: "Photo quote not sent after 2 business days",
  giveEmailDue: "Quote each one from the owner's photos within 2 business days.",
  aiReply: (installer: string) => `${installer} is preparing your quote from the photos you sent, so there's no Ready Check visit.`,
  cantDoReasons: ["Photos not clear enough", "Looks over R2", "Other"] as const,
} as const;

export type PhotoQuoteInput = { underR2: boolean | null; removeM2: number | null; installM2: number | null; product: string | null };

/** Sqm kept to 1 decimal place; null for anything that isn't a finite number. */
export function sqm1(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
}

/** Everything stopping "Send for quote", in form order. Empty = can be sent. */
export function photoQuoteProblems(i: PhotoQuoteInput): string[] {
  const out: string[] = [];
  if (i.underR2 === null || i.underR2 === undefined) out.push("Say if the existing insulation is under R2");
  else if (i.underR2 === false) out.push(PHOTO_QUOTE_WORDS.overR2);
  const remove = sqm1(i.removeM2), install = sqm1(i.installM2);
  if (remove === null) out.push("Enter the sqm to remove (0 if none)");
  else if (remove < 0) out.push("Sqm to remove can't be less than 0");
  if (install === null || install <= 0) out.push("Enter the sqm to install");
  if (remove !== null && install !== null && install > 0 && remove > install) out.push("Sqm to remove can't be more than sqm to install");
  if (!insulationProduct(i.product)) out.push("Pick the product");
  return out;
}

/** The Melbourne date (YYYY-MM-DD) the photo quote is due: 2 Victorian business days after the day it was given. */
export function photoQuoteDueBy(givenAtIso: string): string {
  return addVicBusinessDays(givenAtIso, PHOTO_QUOTE_BUSINESS_DAYS);
}

/** Overdue once the Melbourne day is after the due day. */
export function photoQuoteOverdue(givenAtIso: string, now: Date): boolean {
  return melbourneToday(now) > photoQuoteDueBy(givenAtIso);
}

export type GiveEventRow = { event_type: string; created_at: string; details: { batch_id?: unknown; business_id?: unknown } | null };
export type PhotoGive = { batchId: string; businessId: string; givenAt: string };
/** The job's current give, if it was a "From photos" give: the latest `in_house_batch_sent` to a business that is still the
 *  job's active installer, matched by batch id + business to a PHOTO_QUOTE_GIVE_EVENT. Anything else (no give, handed back,
 *  a Ready Check give, a method record from an older batch) → null, i.e. Ready Check. */
export function photoGiveFrom(events: readonly GiveEventRow[], activeInstallerBusinessIds: readonly string[]): PhotoGive | null {
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const sent = events.filter((e) => e.event_type === "in_house_batch_sent" && activeInstallerBusinessIds.includes(str(e.details?.business_id) ?? ""))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const batchId = str(sent?.details?.batch_id), businessId = str(sent?.details?.business_id);
  if (!sent || !batchId || !businessId) return null;
  const photo = events.some((e) => e.event_type === PHOTO_QUOTE_GIVE_EVENT && str(e.details?.batch_id) === batchId && str(e.details?.business_id) === businessId);
  return photo ? { batchId, businessId, givenAt: sent.created_at } : null;
}
