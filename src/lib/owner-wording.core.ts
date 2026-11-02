// Approved owner wording shared across emails, pages and answers (Jo 2 Nov 2026).
export const REST_ON_INSTALL_DAY = "the rest on install day";
export const REST_DUE_SENTENCE = "The rest of your payment is due on install day.";
export const restDueWithAmount = (amount: string) => `The rest of your payment, ${amount}, is due on install day.`;
/** Complaint line for "You're in!" and "All done" (VEU Fix 4, decision 34). */
export const COMPLAINT_LINE = "Something not right? Reply to this email or write to info@homeinsulationvictoria.com.au and we'll look into it. If it's still not sorted, you can contact the Essential Services Commission (esc.vic.gov.au) or Consumer Affairs Victoria.";

/** Business contact for owners: the OFFICE phone only, never a worker's mobile. No person fields, by design. */
export type BusinessContact = { name: string; tradingName: string | null; officePhone: string | null; email: string | null };
export const AP_CERTIFICATES_LINE = "Rebate certificates created by Home Insulation Victoria (Accredited Person A003654).";
const clean = (v: string | null | undefined): string | null => (v ?? "").trim() || null;
/** Pure: a `businesses` row -> contact. Missing row -> null. Blank strings count as missing. */
export function businessContactFromRow(row: { name: string; trading_name: string | null; phone: string | null; email: string | null } | null | undefined): BusinessContact | null {
  if (!row) return null;
  return { name: row.name, tradingName: clean(row.trading_name), officePhone: clean(row.phone), email: clean(row.email) };
}
/** "Name · office phone · email", or null when phone or email is missing (the caller holds the message). */
export function contactLine(b: BusinessContact): string | null {
  const phone = clean(b.officePhone);
  const email = clean(b.email);
  if (!phone || !email) return null;
  return `${clean(b.tradingName) || b.name.trim()} · ${phone} · ${email}`;
}
