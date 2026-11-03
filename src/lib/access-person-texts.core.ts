// Part 4 Task 15 (Jo 2 Nov 2026, answer 7): when the home is rented and someone OTHER than the owner lets the trades in
// (the tenant or the property manager, from the owner's quick-taps answers — rental-answers.core `accessPersonOf`), that
// person gets the PIESA and install "You're booked" texts and the day-before texts. Visit-time texts ONLY: never the
// owner's quote, price, consent, payment, rebate or compliance messages. The owner still gets every job message.
// Owner-occupied homes, the owner letting us in, or an access mobile that is the owner's own number → nothing extra.
// DRAFT wording: the owner's approved texts (decisions #38/#46 and #25) with the access person's first name; Jo approves
// it as a picture, so every send stays behind ACCESS_PERSON_TEXTS_APPROVED = false. PURE: no I/O.
import { bookedShort, type BookedFacts } from "./owner-booked-notice.core";
import { installerName, type TradeContact } from "./owner-will-call.core";
import type { AccessPerson } from "./rental-answers.core";
import { toAuE164 } from "./sms.core";

/** Off until Jo approves the rendered texts (JO-APPROVAL-LIST). The two SMS types are also `wordingApproved: false`. */
export const ACCESS_PERSON_TEXTS_APPROVED = false as boolean;
export const ACCESS_PERSON_BOOKED_SMS_TYPE = "access_person_booked" as const;
export const ACCESS_PERSON_TOMORROW_SMS_TYPE = "access_person_tomorrow" as const;
/** One office note per booking + reason when a text is held (no office phone). */
export const ACCESS_TEXT_HELD_EVENT = "access_person_text_held";

/** One text per person per visit; a changed time is a new booking row, so a new key sends again. */
export const accessPersonKey = {
  booked: (bookingId: string, e164: string) => `access-booked:v1:${bookingId}:${e164}`,
  tomorrow: (bookingId: string, e164: string) => `access-tomorrow:v1:${bookingId}:${e164}`,
};

export type AccessVisitKind = "piesa" | "install";
type Held = { held: string };
const clean = (v: string | null | undefined) => (v ?? "").trim().replace(/\s+/g, " ");
/** "Tina Lee" → "Tina"; nothing usable → "there". */
const firstName = (full: string | null | undefined) => clean(full).split(" ")[0] || "there";
const NOT_ACCESS_VISIT: Held = { held: "Not an access-person visit" };

/** True only when a tenant or property manager lets us in AND their mobile is a real Australian mobile that is not the
 *  owner's own number (then the owner's texts already cover it). */
export function accessPersonNeedsTexts(a: AccessPerson | null, ownerMobile: string | null): boolean {
  if (!a || a.who === "owner") return false;
  const theirs = toAuE164(a.mobile);
  if (!theirs) return false;
  return theirs !== toAuE164(ownerMobile);
}

const WHAT: Record<AccessVisitKind, string> = { piesa: "your electrical safety check (PIESA)", install: "your insulation install" };

/** DRAFT: the owner's "You're booked" text (#38 PIESA / #46 install) with the access person's first name. Only the office
 *  phone is needed (the text never names a worker's mobile); none → held, exactly like the owner's text. The owner's balance,
 *  30-day rule and paperwork never appear here. */
export function accessPersonBookedText(f: BookedFacts, a: AccessPerson): string | Held {
  if (f.kind !== "piesa" && f.kind !== "install") return NOT_ACCESS_VISIT;
  const name = installerName(f.business);
  const phone = clean(f.business.officePhone);
  if (!phone) return { held: `No office phone for ${name}` };
  return `Home Insulation Victoria: Hi ${firstName(a.name)}, you're booked for ${WHAT[f.kind]}: ${bookedShort(f.startIso)}. ${clean(f.whoName)} from ${name} is coming. Need to change it? Call ${name} on ${phone}.`;
}

/** DRAFT: the owner's day-before text (#25) with the access person's first name. */
export function accessPersonTomorrowText(f: { kind: "piesa" | "install" | "ready_check"; time: string; business: TradeContact }, a: AccessPerson): string | Held {
  if (f.kind !== "piesa" && f.kind !== "install") return NOT_ACCESS_VISIT;
  const name = installerName(f.business);
  const phone = clean(f.business.officePhone);
  if (!phone) return { held: `No office phone for ${name}` };
  const tail = f.kind === "install" ? " Reminder: power will be off while they work in the ceiling." : "";
  return `Home Insulation Victoria: Hi ${firstName(a.name)}, see you tomorrow at ${f.time} for ${WHAT[f.kind]} (${name}, ${phone}).${tail}`;
}
