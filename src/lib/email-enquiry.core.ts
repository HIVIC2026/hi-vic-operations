// Decision 255 (Jo 24 Oct 2026): a new sender with no job who emails an enquiry (or a price / rebate question) gets an
// enquiry created from the email and a reply DRAFT that carries that enquiry's own homeowner page link — never the
// calculator. PURE: what the email itself tells us (name, email, phone, a complete Victorian street address), with
// nothing guessed. Persistence lives in email-enquiry.server.ts (existing guarded intake `upsertEnquiry`, source
// 'email'); the reply wording lives in email-reply.core.ts.
import { addressFragments } from "./outlook-guess.core";
import { splitAddress, tidyPersonName } from "./name-address-tidy.core";

export const EMAIL_ENQUIRY_CREATED_EVENT = "email_enquiry_created";
/** jobs.source for a real enquiry created from an email (TEST mode creates a qa_test job instead). */
export const EMAIL_ENQUIRY_SOURCE = "email";
/** The source sentence recorded with every enquiry created from an email (decision 255). */
export const EMAIL_ENQUIRY_CONSENT_SENTENCE =
  "Enquiry created from the owner's own email to us. Their email is consent to reply to that email only; it is not VEU or marketing consent, which their homeowner page captures as for every enquiry.";

const STREET_TYPES = "street|st|road|rd|avenue|ave|av|drive|dr|court|ct|crescent|cres|cr|place|pl|parade|pde|lane|ln|way|close|cl|grove|gr|boulevard|blvd|terrace|tce|highway|hwy|circuit|cct|square|sq|rise|walk|esplanade|esp|parkway|pkwy|mews|glade|heights|hts|ridge|vale|loop|promenade|chase";
const NOT_SUBURB = /^(vic|victoria|australia|and|the|my|our|in|at|near|please|thanks|it|its|is)$/i;

/** The newest part of an email: everything above the first quoted-reply marker ("On … wrote:", "From:", "-----Original"). */
export function latestText(body: string): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const cut = lines.findIndex((l) => /^\s*(>|-{2,}\s*original message|_{5,}|from:\s.+|on .{4,120} wrote:\s*$|sent from my)/i.test(l));
  return (cut >= 0 ? lines.slice(0, cut) : lines).join("\n").trim();
}

export type EmailAddressFound = { street: string; suburb: string; postcode: string };

/** A COMPLETE Victorian street address written in the email: number + street name + street type + suburb + a
 *  Victorian postcode ("14 Example Street, Ringwood 3134", "3/22 Long Rd Box Hill VIC 3128"). Anything less — no
 *  postcode, no suburb, two different addresses — is null: the reply asks for it instead of guessing. */
export function completeVicAddress(text: string): EmailAddressFound | null {
  const re = new RegExp(`(?:^|[^\\w/])(\\d{1,4}[a-z]?(?:\\s*/\\s*\\d{1,4}[a-z]?)?\\s+(?:[a-z'-]+\\s+){1,3}?(?:${STREET_TYPES})\\.?)[ \\t]*,?[ \\t]+([a-z][a-z' -]{1,40}?)[ \\t]*,?[ \\t]+(?:(?:vic|victoria)\\.?[ \\t]*,?[ \\t]+)?([38]\\d{3})\\b`, "gi");
  const found = new Map<string, EmailAddressFound>();
  for (const m of text.matchAll(re)) {
    const suburbRaw = m[2]!.trim().replace(/\s+(vic|victoria)$/i, "");
    if (!suburbRaw || suburbRaw.split(/\s+/).some((w) => NOT_SUBURB.test(w)) || suburbRaw.split(/\s+/).length > 3) continue;
    const split = splitAddress(m[1]!.replace(/\s*\/\s*/, "/"), suburbRaw, m[3]!);
    if (!split.street || !split.suburb || !/^[38]\d{3}$/.test(split.postcode)) continue;
    // Same street fragment the copier's guesser reads; a second, different address means we can't tell which home.
    const key = `${addressFragments(split.street)[0] ?? split.street.toLowerCase()}|${split.postcode}`;
    found.set(key, { street: split.street, suburb: split.suburb, postcode: split.postcode });
  }
  return found.size === 1 ? [...found.values()][0]! : null;
}

/** One Australian phone number written in the email (mobile or landline), tidied; null when none or more than one. */
export function phoneIn(text: string): string | null {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:^|[^\d+(])((?:\+?61[\s-]?\(?|\(?0)[2-478]\)?(?:[\s-]?\d){8})(?!\d)/g)) {
    const digits = m[1]!.replace(/\D/g, "").replace(/^61/, "0");
    if (/^0[2-478]\d{8}$/.test(digits)) out.add(digits);
  }
  if (out.size !== 1) return null;
  const d = [...out][0]!;
  return d.startsWith("04") ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : `(${d.slice(0, 2)}) ${d.slice(2, 6)} ${d.slice(6)}`;
}

export type EmailEnquiryPlan = {
  /** Display name tidied (decision 216); empty when the From has no usable name (the Fix details pile asks the office). */
  fullName: string;
  email: string;
  phone: string | null;
  address: EmailAddressFound | null;
};

/** What the enquiry created from this email will hold. Null when there is no sender address to create it for. */
export function planEmailEnquiry(m: { from: string | null; fromName: string | null; subject: string | null; body: string }): EmailEnquiryPlan | null {
  const email = (m.from ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  const display = (m.fromName ?? "").replace(/["']/g, "").trim();
  const fullName = display && !display.includes("@") ? tidyPersonName(display) : "";
  const text = `${m.subject ?? ""}\n${latestText(m.body)}`;
  return { fullName, email, phone: phoneIn(text), address: completeVicAddress(text) };
}
