// Office review custom emails (Jo, 22 Oct 2026): the office may edit the pre-filled wording and add
// anything they want, then Send. The owner's automatic link (uploads / review result) is always appended
// and the unsubscribe footer always rides along. Pure rendering only — every send still runs the full
// existing guard stack (switch, consent, opt-out, one-offer, TEST routing, logging).

export type CustomMail = { subject: string; html: string; plainText: string; previewText: string; ctas: string[] };
import { genericMail } from './mail-mjml.core';

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The one Qualifies button covers both recorded outcomes. Declared no insulation → no_insulation;
 *  anything else (has insulation / not sure) → below_r2. Keeps the existing recorded outcomes so the
 *  existing reports and the approved Save my spot senders are unchanged. */
export function qualifiesOutcome(declaredInsulation: string | null | undefined): "below_r2" | "no_insulation" {
  return declaredInsulation === "none" ? "no_insulation" : "below_r2";
}

/** The office's edited text plus one automatic link, in a minimal customer shell. Blank paragraphs are
 *  dropped; single newlines inside a paragraph become line breaks; all user text is HTML-escaped. */
export function customReviewMail(opts: { subject: string; text: string; link: { label: string; url: string } | null }): CustomMail {
  const paras = opts.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const plain = [paras.join("\n\n"), opts.link ? `${opts.link.label}: ${opts.link.url}` : null].filter(Boolean).join("\n\n");
  const htmlParas = paras.map((p) => `<p style="margin:0 0 14px;line-height:1.55">${esc(p).replace(/\n/g, "<br/>")}</p>`).join("");
  const html = genericMail({subject:opts.subject,bodyHtml:htmlParas,button:opts.link?{label:opts.link.label,url:opts.link.url}:undefined,preview:plain.slice(0,120)});
  return { subject: opts.subject, html, plainText: plain, previewText: plain.slice(0, 120), ctas: [] };
}
