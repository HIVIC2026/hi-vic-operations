// Electrical fixes (rectification) quote email (Jo 24 Oct 2026, decisions 95 and 137).
// Design: docs/templates/mjml/owner_O29.mjml (MJML email refresh, Jo 27 Oct 2026) — "{First}, your safety check found something to fix
// first"; plain explanation; "What they found" list; itemised "Your fixes quote" with total incl. GST; the amber
// "⏰ The 30-day clock" box with the actual expiry date; "Our office checked this quote… You pay in full when you approve…";
// Approve and pay button. FIXES_QUOTE_EMAIL_APPROVED is on (decision 95); sent through approved-owner-emails.server.ts
// behind customer_comms_enabled. Pure.
import * as K from "./email-kit.core";
import { esc, mjEmail } from "./mail-mjml.core";
import { mjThirtyDayClock, thirtyDayClockHtml } from "./safety-check-emails.core";

/** Jo 24 Oct 2026, decision 95 (O29 electrical fixes quote): approved. Delivery still behind customer_comms_enabled. */
export const FIXES_QUOTE_EMAIL_APPROVED = true as boolean;

export type FixesQuoteEmailInput = {
  firstName: string | null; electricianName: string | null;
  /** "Wednesday 5 November" */
  checkedOn: string | null;
  /** Hazards found, in the owner's words. */
  found: string[];
  lines: { description: string; detail?: string | null; lineTotalIncGst: number }[];
  totalIncGst: number;
  /** "5 December": 30 days after the safety check. */
  expiresOn: string | null;
  approveUrl: string; test?: boolean;
};

export function renderFixesQuoteEmail(i: FixesQuoteEmailInput) {
  if (!Number.isFinite(i.totalIncGst) || i.totalIncGst <= 0) throw new Error("Fixes quote total is unavailable.");
  if (!/^https:\/\//.test(i.approveUrl)) throw new Error("Owner link is unavailable.");
  const first = K.cleanName(i.firstName) ?? "there";
  const el = i.electricianName?.trim() || "Your electrician";
  const subject = `${first}, your safety check found something to fix first`;
  const headline = subject;
  const intro = `${el} checked your home${i.checkedOn ? ` on ${i.checkedOn}` : ""}. ${i.found.length === 1 ? "One thing needs" : "A couple of things need"} fixing before insulation can go in safely. This is common in older homes, and it's why the check exists.`;
  const total = K.cents(i.totalIncGst);
  const preview = `Your fixes quote is ${total}. Please approve it soon so you stay inside the 30 days.`;
  const rows = i.lines.map((l) => ({ title: l.description, detail: l.detail ?? null, amount: K.cents(l.lineTotalIncGst) }));
  const checked = "Our office checked this quote before it reached you. You pay in full when you approve. Once the fixes are done, you'll get your Certificate of Electrical Safety and can book your install day.";
  const questions = "Questions about the fixes? Just reply to this email. Nothing is done without your OK.";
  const rowHtml = rows.map((r, n) => {
    const bt = n === 0 ? "" : "border-top:1px solid #E4E9F5;";
    return `<tr><td valign="top" style="${bt}padding:${n === 0 ? "0 12px 12px 0" : "12px 12px 12px 0"};"><strong>${esc(r.title)}</strong>${r.detail ? `<br /><span class="muted" style="font-size:13px;line-height:19px;">${esc(r.detail)}</span>` : ""}</td><td align="right" valign="top" style="${bt}padding:${n === 0 ? "0 0 12px" : "12px 0"};white-space:nowrap;">${esc(r.amount)}</td></tr>`;
  }).join("");
  const totalRow = `<tr><td valign="middle" style="border-top:2px solid #22376B;padding:12px 12px 6px 0;font-size:18px;"><strong>Total incl. GST</strong></td><td align="right" valign="middle" style="border-top:2px solid #22376B;padding:12px 0 6px;white-space:nowrap;font-size:18px;color:#3C51C4;"><strong>${esc(total)}</strong></td></tr>`;
  const body = [
    `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading">${esc(headline)}</mj-text><mj-text>${esc(intro)}</mj-text></mj-column></mj-section>`,
    i.found.length ? `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px 10px">What they found</mj-text><mj-table padding="0 18px 6px">${i.found.map((f) => `<tr><td width="32" valign="top" style="padding:2px 0 12px;"><span class="plus">!</span></td><td style="padding:0 0 12px;">${esc(f)}</td></tr>`).join("")}</mj-table></mj-column></mj-section>` : "",
    `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px 10px">Your fixes quote</mj-text><mj-table padding="0 18px 12px">${rowHtml}${totalRow}</mj-table></mj-column></mj-section>`,
    mjThirtyDayClock(thirtyDayClockHtml(i.expiresOn)),
    `<mj-section><mj-column><mj-text padding="18px 12px 14px">${esc(checked)}</mj-text><mj-button href="${esc(i.approveUrl)}">Approve and pay ${esc(total)}</mj-button><mj-text mj-class="small" padding="0 12px 0">${esc(questions)}</mj-text></mj-column></mj-section>`,
  ].join("");
  const html = mjEmail({ subject, preview, body, unsubscribe: null, testLabel: i.test === true });
  const text = K.plainText([
    headline, "", intro, "",
    ...(i.found.length ? ["WHAT THEY FOUND", ...i.found.map((f) => `• ${f}`), ""] : []),
    "YOUR FIXES QUOTE", ...rows.map((r) => `${r.title}${r.detail ? ` (${r.detail})` : ""}: ${r.amount}`), `Total incl. GST: ${total}`, "",
    K.THIRTY_DAY_CLOCK_TEXT(i.expiresOn), "", checked, "", `Approve and pay ${total}: ${i.approveUrl}`, "", questions,
  ], { testLabel: i.test === true });
  return { subject, html, text };
}
