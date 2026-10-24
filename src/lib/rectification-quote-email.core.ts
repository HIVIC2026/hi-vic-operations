// Electrical fixes (rectification) quote email (Jo 24 Oct 2026, decisions 95 and 137).
// Design approved: docs/templates/approved/O29-fixes-quote.html — "{First}, your safety check found something to fix
// first"; plain explanation; amber "What they found" list; itemised "Your fixes quote" with total incl. GST; the red
// "⏰ The 30-day clock" box with the actual expiry date; "Checked by our office… Paid in full when you approve…";
// Approve and pay button. FIXES_QUOTE_EMAIL_APPROVED is on (decision 95); sent through approved-owner-emails.server.ts
// behind customer_comms_enabled. Pure.
import * as K from "./email-kit.core";

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
  const intro = `${el} checked your home${i.checkedOn ? ` on ${i.checkedOn}` : ""}. Before insulation can go in safely, ${i.found.length === 1 ? "one thing needs" : "a couple of things need"} fixing. This is common in older homes, and it's the reason the check exists.`;
  const total = K.cents(i.totalIncGst);
  const rows: K.QuoteRow[] = i.lines.map((l) => ({ title: l.description, detail: l.detail ?? null, amount: K.cents(l.lineTotalIncGst) }));
  const checked = "Checked by our office before it reached you. Paid in full when you approve. Once the fixes are done, you'll get your Certificate of Electrical Safety and can book your install day.";
  const body = [
    K.h1(headline, 8),
    K.p(intro),
    i.found.length ? K.amberBox("What they found", `<div style="font-size:14px;color:${K.KIT.NAVY};line-height:1.6;">${i.found.map((f) => `&bull; ${K.esc(f)}`).join("<br>")}</div>`) : "",
    K.quoteTable({ title: "Your fixes quote", rows, totalLabel: "Total incl. GST", total }),
    i.expiresOn ? K.thirtyDayClockBox({ kind: "fixes", expiresOn: i.expiresOn }) : K.thirtyDayClockBox({ kind: "safety_check" }),
    K.note(checked),
    K.button(i.approveUrl, `Approve and pay ${total}`, "6px 0 4px"),
    K.small("Questions about the fixes? Just reply to this email. Nothing is done without your OK."),
  ].join("\n");
  const html = K.emailShell({ body, previewText: intro, testLabel: i.test === true, unsubscribe: null });
  const text = K.plainText([
    headline, "", intro, "",
    ...(i.found.length ? ["WHAT THEY FOUND", ...i.found.map((f) => `• ${f}`), ""] : []),
    "YOUR FIXES QUOTE", ...rows.map((r) => `${r.title}${r.detail ? ` (${r.detail})` : ""}: ${r.amount}`), `Total incl. GST: ${total}`, "",
    K.THIRTY_DAY_CLOCK_TEXT(i.expiresOn), "", checked, "", `Approve and pay ${total}: ${i.approveUrl}`, "", "Questions about the fixes? Just reply to this email. Nothing is done without your OK.",
  ], { testLabel: i.test === true });
  return { subject, html, text };
}
