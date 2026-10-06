// Reuses the exact partner invitation template shell (installer-partnership-invitation.html):
// its <head>/styles, blue top stripe, logo header and legal footer are sliced verbatim from the
// canonical HTML, never recreated. Body rows copy that template's inline styles.
import { INSTALLER_INVITATION_HTML } from "./installer-invitation.html";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? c));

const SRC = INSTALLER_INVITATION_HTML;
const HEADER_END_MARKER = "TRADE<br>PARTNERS</td></tr></table>\n</td></tr>\n";
const FOOTER_START_MARKER = '<tr><td class="pad" style="padding:21px 40px 27px;">';
const UNSUB_MARKER = /<p style="font-size:14px;line-height:21px;color:#4A5578;margin:12px 0 0;">Prefer not to receive partnership invitations\? Reply “unsubscribe”\.<\/p>/;
const TITLE_RE = /<title>[^<]*<\/title>/;
const PREHEADER_RE = /(<div lang="en-AU" dir="ltr" style="display:none;[^"]*">)[^<]*(<\/div>)/;

function split() {
  const h = SRC.indexOf(HEADER_END_MARKER), f = SRC.indexOf(FOOTER_START_MARKER);
  if (h < 0 || f < 0 || !UNSUB_MARKER.test(SRC) || !TITLE_RE.test(SRC) || !PREHEADER_RE.test(SRC)) throw new Error("Invitation template markers changed; campaign shell cannot be reused safely.");
  return { head: SRC.slice(0, h + HEADER_END_MARKER.length), foot: SRC.slice(f) };
}

/** Same body styles as the invitation template. */
export const inv = {
  pad: (inner: string, padding = "0 40px") => `<tr><td class="pad" style="padding:${padding};">\n${inner}\n</td></tr>\n`,
  tag: (t: string) => `<span class="invitation" style="display:inline-block;background:#FFDDEB;color:#22376B;padding:7px 10px;font-size:11px;line-height:14px;letter-spacing:1.5px;font-weight:800;">${esc(t)}</span>`,
  h1: (t: string) => `<h1 class="headline" style="font-family:Outfit,Figtree,Arial,sans-serif;font-size:43px;line-height:47px;letter-spacing:-1.1px;font-weight:600;margin:18px 0 8px;color:#22376B;">${esc(t)}</h1>`,
  lead: (html: string) => `<p style="font-size:18px;line-height:28px;margin:0 0 15px;font-family:Figtree,Arial,Helvetica,sans-serif;color:#22376B;">${html}</p>`,
  p: (html: string, margin = "0 0 20px") => `<p style="font-size:16px;line-height:24px;color:#4A5578;margin:${margin};">${html}</p>`,
  small: (html: string, center = false) => `<p style="font-size:14px;line-height:21px;${center ? "text-align:center;" : ""}color:#4A5578;margin:12px 0 0;">${html}</p>`,
  rows: (rows: { label: string; value: string; style?: string }[]) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">${rows.map((r) => `<tr><td valign="top" style="padding:10px 0;border-bottom:1px solid #E6EBE7;font-family:Figtree,Arial,Helvetica,sans-serif;color:#22376B;font-size:16px;line-height:23px;${r.style ?? ""}">${esc(r.label)}</td><td valign="top" align="right" style="padding:10px 0;border-bottom:1px solid #E6EBE7;font-family:Figtree,Arial,Helvetica,sans-serif;color:#22376B;font-size:16px;line-height:23px;white-space:nowrap;${r.style ?? ""}">${esc(r.value)}</td></tr>`).join("")}</table>`,
  button: (href: string, label: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr><td align="center" bgcolor="#3C51C4" style="background:#3C51C4;border-radius:8px;mso-padding-alt:18px 20px;">\n<a href="${esc(href)}" style="display:block;padding:18px 18px;border:1px solid #3C51C4;border-radius:8px;font-family:Figtree,Arial,Helvetica,sans-serif;color:#22376B;font-size:15px;line-height:22px;font-weight:800;letter-spacing:.4px;text-decoration:none;color:#FFFFFF;text-align:center;">${esc(label)}</a>\n</td></tr></table>`,
};

/** Render the invitation shell with a custom body. `footerExtraHtml` replaces the partnership unsubscribe line. */
export function invitationShell(opts: { title: string; previewText: string; bodyRows: string; footerExtraHtml: string }) {
  const { head, foot } = split();
  const h = head.replace(TITLE_RE, `<title>${esc(opts.title)}</title>`).replace(PREHEADER_RE, `$1${esc(opts.previewText)}$2`).replace("TRADE<br>PARTNERS", "");
  const f = foot.replace(UNSUB_MARKER, `<p style="font-size:14px;line-height:21px;color:#4A5578;margin:12px 0 0;">${opts.footerExtraHtml}</p>`);
  return h + opts.bodyRows + f;
}
export { esc as invEsc };
