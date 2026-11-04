// Approved owner wording shared across emails, pages and answers (Jo 2 Nov 2026).
import { esc } from "./email-kit.core";
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

/** VEU Fix 1: the program box at the bottom of the estimate emails (and own customers' first email). */
export const VEU_FACTSHEET_URL = "https://www.energy.vic.gov.au/__data/assets/pdf_file/0028/585154/Victorian-Energy-Efficiency-Target-scheme-consumer-factsheet.pdf";
export const VEU_BOX_TITLE = "About the Victorian Energy Upgrades program";
export const VEU_BOX_TEXT = "Home Insulation Victoria (DC Construction Solutions Pty Ltd, Accredited Person A003654) creates the rebate certificates for your job. We're not the Victorian Government or the Essential Services Commission. We follow the VEU code of conduct. Ask us for a copy any time.";
export const VEU_BOX_LINK = "Read the Government's VEU consumer factsheet ›";
/** MJML section: light boxed card, small text, the link as a real link (same look as the kit's panel-card). */
export function veuBoxMj(): string {
  const link = `<a href="${esc(VEU_FACTSHEET_URL)}" style="color:#3C51C4;font-weight:700;">${esc(VEU_BOX_LINK)}</a>`;
  return `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px 2px">${esc(VEU_BOX_TITLE)}</mj-text><mj-text mj-class="small" padding="0 18px 6px">${esc(VEU_BOX_TEXT)}</mj-text><mj-text mj-class="small" padding="0 18px 16px">${link}</mj-text></mj-column></mj-section>`;
}
export const veuBoxText = (): string[] => [VEU_BOX_TITLE, VEU_BOX_TEXT, `${VEU_BOX_LINK} ${VEU_FACTSHEET_URL}`];
