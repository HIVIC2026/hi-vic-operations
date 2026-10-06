// Exact Jo welcome presentation, shared without changing the legacy output.
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? c));
/** Simple branded email: navy heading, body lines, one green button. */
export type SimpleEmailExtras = {
  /** Trusted escaped markup assembled by a pure renderer, never raw owner input. */
  bodyHtml?: string; afterButtonHtml?: string; footerHtml?: string;
  textLines?: string[]; previewText?: string; testLabel?: boolean;
};
export function simpleEmail(heading: string, lines: string[], button?: { label: string; url: string }, extras: SimpleEmailExtras = {}) {
  const html = `<!doctype html><html><body style="margin:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#22376B;">
${extras.previewText ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(extras.previewText)}</div>` : ""}<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" style="max-width:520px;background:#FBFCFA;border:1px solid #E4E9F5;border-radius:22px;" cellpadding="0" cellspacing="0"><tr><td style="padding:28px 24px;">
<div style="font-size:13px;font-weight:bold;color:#3C51C4;">Home Insulation Victoria</div>
${extras.testLabel === false ? "" : `<div style="display:inline-block;margin-top:6px;background:#FDF2F6;color:#22376B;font-size:11px;font-weight:bold;padding:3px 8px;border-radius:999px;">TEST — only sent to Jo</div>`}
<h1 style="font-size:24px;line-height:1.25;margin:14px 0 12px;">${esc(heading)}</h1>
${extras.bodyHtml ?? lines.map((l) => `<p style="font-size:15px;line-height:1.55;margin:0 0 12px;">${esc(l)}</p>`).join("")}
${button ? `<p style="margin:20px 0 4px;"><a href="${esc(button.url)}" style="display:inline-block;background:#07BF61;color:#ffffff;font-weight:bold;text-decoration:none;padding:14px 22px;border-radius:14px;font-size:16px;">${esc(button.label)}</a></p>` : ""}
${extras.afterButtonHtml ?? ""}${extras.footerHtml ?? ""}</td></tr></table></td></tr></table></body></html>`;
  const text = [heading, "", ...(extras.textLines ?? lines), ...(button ? ["", `${button.label}: ${button.url}`] : []), ...(extras.testLabel === false ? [] : ["", "TEST — only sent to Jo."])].join("\n");
  return { html, text };
}
