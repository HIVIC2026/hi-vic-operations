// Jo 23 Oct 2026: a Ready Check quote is drafted for "Quotes to check" as soon as the BASIC info is in,
// without waiting for the whole Mitti form. Pure — no database, no network.
// Basics: ceiling area, insulation product, the business owner's price (A1, entered in the portal — decision 278; old
// forms may still carry it) or our rate card (A2), owner mobile + email + contact permission, and no hard stop.
// Photos / other answers can follow as notes.

export type ReadyCheckBasicsInput = {
  installerSourced: boolean;
  areaM2: number | null;
  productReady: boolean;
  /** A1 only: the business owner's total price inc GST (portal `installer_price_set` first, old-form answer as fallback). */
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

/** Decision 278: the A1 price is a basic that comes from the PORTAL (the business owner's "Your price" card), never the
 *  Mitti form. While it is the only basic missing, the job's next step says so; it is never listed as a Mitti item. */
export const PRICE_NEXT_ACTION = "Needs finishing: your price on the job page";
export const isPriceNextAction = (nextAction: string | null | undefined): boolean => (nextAction ?? "").trim() === PRICE_NEXT_ACTION;

/** "Needs finishing: ceiling area, owner mobile/email/permission on the Mitti form" (Jo 23 Oct wording); price (A1) is
 *  reported on its own once the form items are in (decision 278). */
export function needsFinishingFromMissing(missing: string[]): string | null {
  if (!missing.length) return null;
  const contact = [missing.includes(BASIC_MOBILE) && "mobile", missing.includes(BASIC_EMAIL) && "email", missing.includes(BASIC_PERMISSION) && "permission"].filter(Boolean) as string[];
  const items = missing.filter((m) => ![BASIC_MOBILE, BASIC_EMAIL, BASIC_PERMISSION, BASIC_PRICE].includes(m));
  if (contact.length) items.push(`owner ${contact.join("/")}`);
  if (!items.length) return missing.includes(BASIC_PRICE) ? PRICE_NEXT_ACTION : null;
  return `Needs finishing: ${items.join(", ")} on the Mitti form`;
}

/** Labels the portal pre-fills on every form it creates: a value there is not an installer answer. */
const PREFILLED = ["Portal Job Number", "Site address", "Site address (please edit street number if incorrect address shows)", "Property Address", "Homeowner name", "Owner name", "Homeowner phone", "Owner phone", "Owner mobile", "Homeowner mobile", "Homeowner email", "Owner email", "Property type", "Life support equipment at property?", "Office life support result", "Was the ceiling or roof built or replaced in the last 5 years?"].map((l) => l.toLowerCase());
/** Decision 279: "the form has answers" = the installer typed, ticked, photographed or signed anything beyond the pre-fill. */
export function formHasInstallerAnswers(entries: { label: string; value: unknown }[]): boolean {
  return entries.some((e) => {
    const v = e.value;
    const filled = v != null && String(v).trim() !== "" && String(v).trim().toLowerCase() !== "false";
    return filled && !PREFILLED.includes(String(e.label ?? "").trim().toLowerCase());
  });
}
