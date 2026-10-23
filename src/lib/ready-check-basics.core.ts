// Jo 23 Oct 2026: a Ready Check quote is drafted for "Quotes to check" as soon as the BASIC info is in,
// without waiting for the whole Mitti form. Pure — no database, no network.
// Basics: ceiling area, insulation product, installer's price (A1) or our rate card (A2),
// owner mobile + email + contact permission, and no hard stop. Photos / other answers can follow as notes.

export type ReadyCheckBasicsInput = {
  installerSourced: boolean;
  areaM2: number | null;
  productReady: boolean;
  /** A1 only: the installer's total quoted price inc GST. */
  installerPriceIncGst: number | null;
  ownerMobile: string | null;
  ownerEmail: string | null;
  contactPermission: boolean | null;
  stops: string[];
  formCompleted: boolean;
};

export const BASIC_AREA = "ceiling area";
export const BASIC_PRODUCT = "insulation product";
export const BASIC_PRICE = "price";
export const BASIC_MOBILE = "owner mobile";
export const BASIC_EMAIL = "owner email";
export const BASIC_PERMISSION = "contact permission";
export const NOTE_FORM_NOT_FINISHED = "Mitti form not finished yet — photos and other answers can follow";

const has = (s: string | null | undefined) => !!s && !!s.trim();

export function readyCheckBasics(b: ReadyCheckBasicsInput): { ready: boolean; missing: string[]; stops: string[]; notes: string[] } {
  const missing: string[] = [];
  if (!(b.areaM2 != null && b.areaM2 > 0)) missing.push(BASIC_AREA);
  if (!b.productReady) missing.push(BASIC_PRODUCT);
  if (b.installerSourced && !(b.installerPriceIncGst != null && b.installerPriceIncGst > 0)) missing.push(BASIC_PRICE);
  if (!has(b.ownerMobile)) missing.push(BASIC_MOBILE);
  if (!has(b.ownerEmail)) missing.push(BASIC_EMAIL);
  if (b.contactPermission !== true) missing.push(BASIC_PERMISSION);
  const stops = [...new Set(b.stops)];
  return { ready: !missing.length && !stops.length, missing, stops, notes: b.formCompleted ? [] : [NOTE_FORM_NOT_FINISHED] };
}

/** "Needs finishing: ceiling area, price, owner mobile/email/permission on the Mitti form" (Jo 23 Oct wording). */
export function needsFinishingFromMissing(missing: string[]): string | null {
  if (!missing.length) return null;
  const contact = [missing.includes(BASIC_MOBILE) && "mobile", missing.includes(BASIC_EMAIL) && "email", missing.includes(BASIC_PERMISSION) && "permission"].filter(Boolean) as string[];
  const items = missing.filter((m) => ![BASIC_MOBILE, BASIC_EMAIL, BASIC_PERMISSION].includes(m));
  if (contact.length) items.push(`owner ${contact.join("/")}`);
  return `Needs finishing: ${items.join(", ")} on the Mitti form`;
}
