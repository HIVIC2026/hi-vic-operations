// Jo 24 Oct 2026 (decisions 123 and 170): the ESC recommends giving the property owner a copy of the executed consent
// form, so once the AP representative has signed Part B the owner is emailed "Your signed consent form" in the approved
// design (docs/templates/mjml/owner_O63.mjml). Wording approved by Jo (decision 170); delivery still goes
// only through the guarded owner-email path (customer_comms_enabled, consent, opt-outs) and TEST jobs use test-send.
// The executed PDF from the job file is attached when it can be read (same Resend `attachments` path as the O62 VEEC
// copy); the form text also travels in the body and the owner is pointed to the copy on their job page. Pure.
import * as K from "./email-kit.core";
import { mjEmail, esc } from "./mail-mjml.core";

/** Jo 24 Oct 2026 (decision 170): wording approved. */
export const CONSENT_COPY_EMAIL_APPROVED = true as boolean;

export type ConsentCopyInput = {
  firstName: string | null; installationDays: string[]; address: string; templateVersion: string;
  /** The executed form, rendered by consent.core renderConsentBody (one line per form line). */
  formText: string; sha256: string; myJobUrl: string | null; test?: boolean;
  /** True when the executed PDF is attached to this email. */
  attached?: boolean;
};

export const CONSENT_COPY_SUBJECT = "Your signed consent form";
/** Attachment filename the owner sees. */
export const consentCopyFilename = (jobNumber: string | null) => `Owner-consent-form-${(jobNumber || "signed").replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`;

const KV_TD = "padding:7px 0;border-top:1px solid #E4E9F5;color:#5A6785;width:40%;";
const KV_TD2 = "padding:7px 0 7px 12px;border-top:1px solid #E4E9F5;";
/** The design's label fix (notes/owner_O63.json): "First Name" shows as "First name" like the other labels. */
const tidyLabel = (l: string) => (l === "First Name" ? "First name" : l);
type FormBlock = { kind: "eyebrow" | "sub" | "para"; text: string } | { kind: "kv"; rows: [string, string][] } | { kind: "ticks"; rows: { on: boolean; text: string }[] };

/** Reads the executed form text (one line per form line) into the design's blocks: section eyebrows, sub-headings,
 *  label/answer rows, declaration ticks and plain paragraphs. Wording is kept as it is. */
function formBlocks(lines: string[]): FormBlock[] {
  const out: FormBlock[] = [];
  const push = (b: FormBlock) => {
    const last = out[out.length - 1];
    if (b.kind === "kv" && last?.kind === "kv") last.rows.push(...b.rows);
    else if (b.kind === "ticks" && last?.kind === "ticks") last.rows.push(...b.rows);
    else out.push(b);
  };
  let prev = "";
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    const sig = /^(.*? signature): (.*?)\s+Date: (.*)$/.exec(l);
    const kv = /^([^:.]{1,40}): (.*)$/.exec(l);
    const tick = /^\[( |x)\] (.*)$/.exec(l);
    if (/^Section \d/.test(l)) push({ kind: "eyebrow", text: l });
    else if (/^Part [A-Z]:/.test(l) || l === "Owner details") push({ kind: "sub", text: l });
    else if (prev.startsWith("Part ") && prev.endsWith(`: ${l}`)) { /* repeat of the Part heading */ }
    else if (tick) push({ kind: "ticks", rows: [{ on: tick[1] === "x", text: tick[2]! }] });
    else if (sig) push({ kind: "kv", rows: [[sig[1]!, sig[2]!], ["Date", sig[3]!]] });
    else if (kv) push({ kind: "kv", rows: [[tidyLabel(kv[1]!), kv[2]!]] });
    else push({ kind: "para", text: l });
    prev = l;
  }
  return out;
}

function formHtml(blocks: FormBlock[]): string {
  return blocks.map((b, n) => {
    const bottom = n === blocks.length - 1 ? 16 : null;
    if (b.kind === "eyebrow") return `<mj-text mj-class="eyebrow" padding="10px 18px ${bottom ?? 6}px">${esc(b.text)}</mj-text>`;
    if (b.kind === "sub") return `<mj-text font-weight="700" font-size="15px" padding="0 18px ${bottom ?? 4}px">${esc(b.text)}</mj-text>`;
    if (b.kind === "para") return `<mj-text font-size="14px" line-height="20px" padding="0 18px ${bottom ?? 8}px">${esc(b.text)}</mj-text>`;
    if (b.kind === "ticks") return `<mj-table padding="0 18px ${bottom ?? 4}px" font-size="14px" line-height="20px">${b.rows.map((r) => `<tr><td width="28" valign="top" style="padding:2px 0 10px;">${r.on ? `<span class="tick">&#10003;</span>` : `<span class="muted">&#9744;</span>`}</td><td style="padding:0 0 10px;">${esc(r.text)}</td></tr>`).join("")}</mj-table>`;
    if (b.kind !== "kv") return "";
    const kv = b.rows;
    return `<mj-table padding="0 18px ${bottom ?? 10}px" font-size="14px" line-height="20px">${kv.map(([k, v]) => `<tr><td style="${KV_TD}" valign="top">${esc(k)}</td><td style="${KV_TD2}" valign="top"><strong>${esc(v)}</strong></td></tr>`).join("")}</mj-table>`;
  }).join("");
}

export function renderConsentCopyEmail(i: ConsentCopyInput) {
  const first = K.cleanName(i.firstName) ?? "there";
  const headline = CONSENT_COPY_SUBJECT;
  const address = i.address.trim();
  const hi = `Hi ${first},`;
  const body = `Here's your copy of the owner's consent form you signed for the ceiling insulation at ${address}. ${i.attached ? "The signed form is attached as a PDF." : "The full form is below. Just reply if you'd like a PDF copy."}`;
  const preview = `Your copy of the owner's consent form for ${address.replace(/\s+VIC\s+\d{4}$/i, "")}.${i.attached ? " The PDF is attached." : ""}`;
  const formLines = i.formText.split("\n").map((l) => l.trimEnd());
  const blocks = formBlocks(formLines);
  const meta = `${i.templateVersion ? `Form ${i.templateVersion} · ` : ""}Record reference ${i.sha256.slice(0, 12)}`;
  const html = mjEmail({
    subject: CONSENT_COPY_SUBJECT, preview,
    body: [
      `<mj-section><mj-column><mj-text mj-class="hi">${esc(hi)}</mj-text><mj-text mj-class="h1" css-class="email-heading" padding="4px 12px 10px">${esc(headline)}</mj-text><mj-text>${esc(body)}</mj-text>${i.myJobUrl ? `<mj-button href="${esc(i.myJobUrl)}">See my job</mj-button>` : ""}</mj-column></mj-section>`,
      `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px ${blocks.length ? 4 : 16}px">Your signed form</mj-text>${formHtml(blocks)}</mj-column></mj-section>`,
      `<mj-section><mj-column><mj-text mj-class="small" padding="14px 12px 6px">${esc(meta)}</mj-text><mj-text mj-class="small" padding="0 12px">Questions? Just reply to this email.</mj-text></mj-column></mj-section>`,
    ].join(""),
    unsubscribe: null, testLabel: i.test === true,
  });
  const text = K.plainText([
    hi, "", headline, "", body, ...(i.myJobUrl ? [`See my job: ${i.myJobUrl}`] : []), "",
    "YOUR SIGNED FORM", ...formLines.map((l) => l.replace(/^First Name: /, "First name: ")), "", meta, "", "Questions? Just reply to this email.",
  ], { testLabel: i.test === true });
  return { subject: CONSENT_COPY_SUBJECT, html, text };
}
