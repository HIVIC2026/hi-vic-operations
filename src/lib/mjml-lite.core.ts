// Pure: a tiny, dependency-free compiler for the MJML subset the portal emails use (Jo, 26 Oct 2026: "refine and perfect
// all the email templates"; the designs were built and approved as MJML 5 samples). The live server runs on Cloudflare,
// where the real MJML compiler cannot run, so this file turns the same MJML markup into the same email-safe HTML MJML 5
// produces (single-column sections inside one white card, Outlook conditional tables, inlined classes).
// scripts/check-mjml-lite.ts compiles every sample with real MJML and proves this output matches it.
//
// Supported: <mjml lang> · <mj-head> with <mj-title>, <mj-preview>, <mj-include path="./partials/head.mjml" /> ·
// <mj-body> · <mj-wrapper css-class="card"> · <mj-section> · <mj-column> (one per section) · <mj-text> · <mj-button> ·
// <mj-table> · <mj-divider> · <mj-image>. Attributes resolve like MJML: component default < mj-class (left to right) < inline.
// Anything else throws, so an unsupported tag can never be sent half-rendered.

const HEAD_PRE = "<!doctype html><html lang=\"en-AU\" dir=\"auto\" xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:v=\"urn:schemas-microsoft-com:vml\" xmlns:o=\"urn:schemas-microsoft-com:office:office\"><head>";
const HEAD_POST = "<!--[if !mso]><!--><meta http-equiv=\"X-UA-Compatible\" content=\"IE=edge\"><!--<![endif]--><meta http-equiv=\"Content-Type\" content=\"text/html; charset=UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><style type=\"text/css\">#outlook a{padding:0}body{margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}table, td{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt}img{border:0;height:auto;line-height:100%;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}p{display:block;margin:13px 0}</style><!--[if mso]>\n    <noscript>\n    <xml>\n    <o:OfficeDocumentSettings>\n      <o:AllowPNG/>\n      <o:PixelsPerInch>96</o:PixelsPerInch>\n    </o:OfficeDocumentSettings>\n    </xml>\n    </noscript>\n    <![endif]--><!--[if lte mso 11]>\n    <style type=\"text/css\">\n      .mj-outlook-group-fix { width:100% !important; }\n    </style>\n    <![endif]--><!--[if !mso]><!--><link href=\"https://fonts.googleapis.com/css2?family=Figtree:wght@400;600;700;800&amp;display=swap\" rel=\"stylesheet\" type=\"text/css\"><link href=\"https://fonts.googleapis.com/css2?family=Outfit:wght@700;800&amp;display=swap\" rel=\"stylesheet\" type=\"text/css\"><style type=\"text/css\">@import url(https://fonts.googleapis.com/css2?family=Figtree:wght@400;600;700;800&amp;display=swap);@import url(https://fonts.googleapis.com/css2?family=Outfit:wght@700;800&amp;display=swap);</style><!--<![endif]--><style type=\"text/css\">@media only screen and (min-width:480px){.mj-column-per-100{width:100%!important;max-width:100%}}</style><style media=\"screen and (min-width:480px)\">.moz-text-html .mj-column-per-100{width:100%!important;max-width:100%}</style><style type=\"text/css\">@media only screen and (max-width:479px){table.mj-full-width-mobile{width:100%!important}td.mj-full-width-mobile{width:auto!important}}</style><style type=\"text/css\">:root{color-scheme:light;supported-color-schemes:light}@media only screen and (max-width:479px){.card{border-radius:0!important}}</style><meta name=\"color-scheme\" content=\"light\"><meta name=\"supported-color-schemes\" content=\"light\"><meta name=\"x-apple-disable-message-reformatting\"></head>";

const FONT = "Figtree, Arial, Helvetica, sans-serif";
const DISPLAY = "Outfit, Figtree, Arial, Helvetica, sans-serif";
type Attrs = Record<string, string>;

/** Component defaults (mail/src/partials/head.mjml `mj-attributes`). */
const DEFAULTS: Record<string, Attrs> = {
  "mj-text": { "font-family": FONT, color: "#22376B", "font-size": "16px", "line-height": "25px", padding: "0 12px 14px", align: "left" },
  "mj-button": { "font-family": FONT, "background-color": "#057D40", color: "#FFFFFF", "font-size": "17px", "font-weight": "700", "line-height": "22px", "border-radius": "14px", "inner-padding": "16px 20px", padding: "6px 12px 18px", width: "100%", align: "center", border: "none" },
  "mj-table": { "font-family": FONT, color: "#22376B", "font-size": "15px", "line-height": "22px", padding: "0 12px 10px", cellpadding: "0", cellspacing: "0", align: "left", width: "100%", "table-layout": "auto", border: "none" },
  "mj-divider": { "border-color": "#E4E9F5", "border-width": "1px", "border-style": "solid", padding: "6px 12px 18px", align: "center", width: "100%" },
  "mj-image": { padding: "0", align: "center", "font-size": "13px", height: "auto" },
  "mj-column": { padding: "0" },
  "mj-section": { padding: "0" },
};

/** Named classes (mj-class). */
const CLASSES: Record<string, Attrs> = {
  h1: { "font-family": DISPLAY, "font-size": "27px", "line-height": "34px", "font-weight": "800", padding: "18px 12px 10px" },
  h2: { "font-family": DISPLAY, "font-size": "19px", "line-height": "26px", "font-weight": "700", padding: "10px 12px 6px" },
  hi: { "font-size": "17px", "line-height": "26px", "font-weight": "600", padding: "18px 12px 0" },
  lead: { "font-size": "17px", "line-height": "26px" },
  small: { "font-size": "13px", "line-height": "20px", color: "#5A6785" },
  eyebrow: { "font-size": "12px", "line-height": "16px", "font-weight": "700", "letter-spacing": "1.2px", "text-transform": "uppercase", padding: "0 12px 6px" },
  center: { align: "center" },
  "big-green": { "font-family": DISPLAY, "font-size": "36px", "line-height": "42px", "font-weight": "800", color: "#057D40", align: "center", padding: "0 12px 4px" },
  "big-blue": { "font-family": DISPLAY, "font-size": "40px", "line-height": "46px", "font-weight": "800", color: "#3C51C4", align: "center", padding: "0 12px 4px" },
  panel: { padding: "6px 0", "inner-background-color": "#F2F4FC", "inner-border-radius": "18px" },
  "panel-mint": { padding: "6px 0", "inner-background-color": "#E9FBF1", "inner-border": "2px solid #07BF61", "inner-border-radius": "18px" },
  "panel-card": { padding: "6px 0", "inner-background-color": "#FFFFFF", "inner-border": "1px solid #E4E9F5", "inner-border-radius": "18px" },
  "panel-amber": { padding: "6px 0", "inner-background-color": "#FFF7EA", "inner-border": "1px solid #F3D9A8", "inner-border-radius": "18px" },
  "panel-red": { padding: "6px 0", "inner-background-color": "#FDECEA", "inner-border": "1px solid #F4C7C2", "inner-border-radius": "18px" },
  "pad-top": { "padding-top": "18px" },
  "btn-ghost": { "background-color": "#FFFFFF", color: "#3C51C4", border: "2px solid #3C51C4" },
};

/** `mj-style inline="inline"` rules, applied the way MJML's inliner does (class styles first, the element's own after). */
const INLINE_CLASSES: Record<string, string> = {
  tick: "display:inline-block;width:20px;height:20px;line-height:20px;border-radius:10px;background:#07BF61;color:#FFFFFF;font-size:12px;font-weight:700;text-align:center",
  plus: "display:inline-block;width:20px;height:20px;line-height:20px;border-radius:10px;background:#FFF1DB;color:#8A5200;font-size:14px;font-weight:700;text-align:center",
  num: "display:inline-block;width:22px;height:22px;line-height:22px;border-radius:11px;background:#22376B;color:#FFFFFF;font-size:12px;font-weight:700;text-align:center",
  muted: "color:#5A6785",
  strike: "text-decoration:line-through",
};
const LINK_STYLE = "color:#3C51C4";
/** css-class → ARIA heading level (mj-html-attributes). */
const HEADING_LEVEL: Record<string, string> = { "email-heading": "1", "email-sub": "2" };

const CARD_W = 600, INNER_W = 568; // 600 card − 2 × 16px wrapper padding
const MSO_CELL = `<table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:${INNER_W}px;" width="${INNER_W}" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;">`;

const escAttr = (s: string) => s.replace(/&(?![a-zA-Z]+;|#\d+;|#x[0-9a-fA-F]+;)/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const tidyFonts = (s: string) => s.replace(/,\s+/g, ",");

type Node = { tag: string; attrs: Attrs; children: Node[]; raw?: string };
const LEAF = new Set(["mj-text", "mj-button", "mj-table", "mj-title", "mj-preview"]);
const VOID = new Set(["mj-divider", "mj-image", "mj-include"]);
const KNOWN = new Set(["mjml", "mj-head", "mj-body", "mj-wrapper", "mj-section", "mj-column", ...LEAF, ...VOID]);

function parseAttrs(s: string): Attrs {
  const out: Attrs = {};
  for (const m of s.matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

/** Parses the supported MJML subset. Leaf tags keep their inner HTML verbatim. */
export function parseMjml(src: string): Node {
  const s = src.replace(/<!--[\s\S]*?-->/g, "");
  const root: Node = { tag: "#root", attrs: {}, children: [] };
  const stack: Node[] = [root];
  const re = /<(\/?)(mj[a-z-]*)\b([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const [, close, tag, rawAttrs, selfClose] = m;
    if (!KNOWN.has(tag)) throw new Error(`mjml-lite: unsupported <${tag}>`);
    const top = stack[stack.length - 1];
    if (close) {
      if (top.tag !== tag) throw new Error(`mjml-lite: </${tag}> closes <${top.tag}>`);
      stack.pop();
      continue;
    }
    const node: Node = { tag, attrs: parseAttrs(rawAttrs), children: [] };
    top.children.push(node);
    if (LEAF.has(tag) && !selfClose) {
      const end = s.indexOf(`</${tag}>`, re.lastIndex);
      if (end < 0) throw new Error(`mjml-lite: <${tag}> is not closed`);
      node.raw = s.slice(re.lastIndex, end).trim();
      re.lastIndex = end + tag.length + 3;
    } else if (!selfClose && !VOID.has(tag)) stack.push(node);
  }
  if (stack.length !== 1) throw new Error(`mjml-lite: <${stack[stack.length - 1].tag}> is not closed`);
  return root;
}

function resolve(n: Node): Attrs {
  const a: Attrs = { ...(DEFAULTS[n.tag] ?? {}) };
  for (const c of (n.attrs["mj-class"] ?? "").split(/\s+/).filter(Boolean)) {
    const cls = CLASSES[c];
    if (!cls) throw new Error(`mjml-lite: unknown mj-class "${c}"`);
    Object.assign(a, cls);
  }
  for (const [k, v] of Object.entries(n.attrs)) if (k !== "mj-class") a[k] = v;
  return a;
}

const sides = (a: Attrs) => ["top", "right", "bottom", "left"].map((s) => (a[`padding-${s}`] ? `;padding-${s}:${a[`padding-${s}`]}` : "")).join("");
const cellStyle = (a: Attrs) => `font-size:0px;padding:${a.padding}${sides(a)};word-break:break-word`;
const cssClassAttr = (a: Attrs) => (a["css-class"] ? ` class="${a["css-class"]}"` : "");
function padX(p: string): number {
  const v = p.split(/\s+/).map((x) => parseFloat(x) || 0);
  const [t, r = t, , l = r] = v;
  void t;
  return r + l;
}

function textRow(n: Node): string {
  const a = resolve(n);
  const st = [
    `font-family:${tidyFonts(a["font-family"])}`, `font-size:${a["font-size"]}`,
    a["font-style"] && `font-style:${a["font-style"]}`, a["font-weight"] && `font-weight:${a["font-weight"]}`,
    a["letter-spacing"] && `letter-spacing:${a["letter-spacing"]}`, `line-height:${a["line-height"]}`,
    `text-align:${a.align}`, a["text-decoration"] && `text-decoration:${a["text-decoration"]}`,
    a["text-transform"] && `text-transform:${a["text-transform"]}`, `color:${a.color}`,
  ].filter(Boolean).join(";");
  const level = (a["css-class"] ?? "").split(/\s+/).map((c) => HEADING_LEVEL[c]).find(Boolean);
  const aria = level ? ` role="heading" aria-level="${level}"` : "";
  return `<tr><td align="${a.align}"${cssClassAttr(a)} style="${cellStyle(a)}"><div style="${st}"${aria}>${n.raw ?? ""}</div></td></tr>`;
}

function buttonRow(n: Node): string {
  const a = resolve(n);
  const href = a.href ? ` href="${escAttr(a.href)}"` : "";
  const tdStyle = `border:${a.border};border-radius:${a["border-radius"]};cursor:auto;mso-padding-alt:${a["inner-padding"]};background:${a["background-color"]}`;
  const aStyle = `display:inline-block;background:${a["background-color"]};color:${a.color};font-family:${tidyFonts(a["font-family"])};font-size:${a["font-size"]};font-weight:${a["font-weight"]};line-height:${a["line-height"]};margin:0;text-decoration:none;text-transform:none;padding:${a["inner-padding"]};mso-padding-alt:0px;border-radius:${a["border-radius"]}`;
  return `<tr><td align="${a.align}"${cssClassAttr(a)} style="${cellStyle(a)}"><table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:separate;width:${a.width};line-height:100%"><tbody><tr><td align="center" bgcolor="${a["background-color"]}" role="presentation" style="${tdStyle}" valign="middle"><a${href} style="${aStyle}" target="_blank">${n.raw ?? ""}</a></td></tr></tbody></table></td></tr>`;
}

function tableRow(n: Node): string {
  const a = resolve(n);
  const st = `color:${a.color};font-family:${tidyFonts(a["font-family"])};font-size:${a["font-size"]};line-height:${a["line-height"]};table-layout:${a["table-layout"]};width:${a.width};border:${a.border}`;
  return `<tr><td align="${a.align}"${cssClassAttr(a)} style="${cellStyle(a)}"><table cellpadding="${a.cellpadding}" cellspacing="${a.cellspacing}" width="${a.width.replace(/px$/, "")}" border="0" style="${st}">${n.raw ?? ""}</table></td></tr>`;
}

function dividerRow(n: Node): string {
  const a = resolve(n);
  const line = `border-top:${a["border-style"]} ${a["border-width"]} ${a["border-color"]};font-size:1px;margin:0px auto;width:100%`;
  const w = INNER_W - padX(a.padding);
  return `<tr><td align="${a.align}"${cssClassAttr(a)} style="${cellStyle(a)}"><p style="${line}"></p><!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" style="border-top:${a["border-style"]} ${a["border-width"]} ${a["border-color"]};font-size:1px;margin:0px auto;width:${w}px;" role="presentation" width="${w}px" ><tr><td style="height:0;line-height:0;"> &nbsp;
</td></tr></table><![endif]--></td></tr>`;
}

function imageRow(n: Node): string {
  const a = resolve(n);
  if (!a.alt) throw new Error("mjml-lite: <mj-image> needs alt");
  const w = parseInt(a.width ?? String(INNER_W - padX(a.padding)), 10);
  return `<tr><td align="${a.align}"${cssClassAttr(a)} style="${cellStyle(a)}"><table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-spacing:0px"><tbody><tr><td style="width:${w}px"><img alt="${escAttr(a.alt)}" src="${escAttr(a.src ?? "")}" style="border:0;display:block;outline:none;text-decoration:none;height:auto;width:100%;font-size:${a["font-size"]}" width="${w}" height="${a.height}"></td></tr></tbody></table></td></tr>`;
}

const ROW: Record<string, (n: Node) => string> = { "mj-text": textRow, "mj-button": buttonRow, "mj-table": tableRow, "mj-divider": dividerRow, "mj-image": imageRow };

function section(n: Node): string {
  const cols = n.children.filter((c) => c.tag === "mj-column");
  if (cols.length !== 1 || n.children.length !== 1) throw new Error("mjml-lite: each <mj-section> holds exactly one <mj-column>");
  const s = resolve(n), c = resolve(cols[0]);
  const rows = cols[0].children.map((k) => {
    const r = ROW[k.tag];
    if (!r) throw new Error(`mjml-lite: <${k.tag}> cannot go in a column`);
    return r(k);
  }).join("");
  const inner = c["inner-background-color"] || c["inner-border"] || c["inner-border-radius"]
    ? ` style="${[c["inner-background-color"] && `background-color:${c["inner-background-color"]}`, c["inner-border"] && `border:${c["inner-border"]}`, c["inner-border-radius"] && `border-radius:${c["inner-border-radius"]}`, "border-collapse:separate"].filter(Boolean).join(";")}"`
    : "";
  return `<div style="margin:0px auto;max-width:${INNER_W}px"><table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%"><tbody><tr><td style="direction:ltr;font-size:0px;padding:${s.padding};text-align:center"><!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:${INNER_W}px;" ><![endif]--><div class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%"><table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%"><tbody><tr><td style="vertical-align:top;padding:${c.padding}"><table border="0" cellpadding="0" cellspacing="0" role="presentation"${inner} width="100%"><tbody>${rows}</tbody></table></td></tr></tbody></table></div><!--[if mso | IE]></td></tr></table><![endif]--></td></tr></tbody></table></div>`;
}

/** Applies the inlined classes and link colour, as MJML's inliner (juice) does. */
function inlineClasses(html: string): string {
  return html.replace(/<(span|a|div|td|strong|p|b)\b([^>]*)>/g, (all, tag: string, rest: string) => {
    const cls = /\bclass="([^"]*)"/.exec(rest)?.[1];
    const styles: string[] = [];
    if (tag === "a") styles.push(LINK_STYLE);
    if (cls) for (const c of cls.split(/\s+/)) if (INLINE_CLASSES[c]) styles.push(INLINE_CLASSES[c]);
    if (!styles.length) return all;
    const own = /\bstyle="([^"]*)"/.exec(rest);
    const merged = mergeStyles(styles.join(";"), own?.[1] ?? "");
    return own ? `<${tag}${rest.replace(own[0], `style="${merged}"`)}>` : `<${tag}${rest} style="${merged}">`;
  });
}
function mergeStyles(base: string, own: string): string {
  const map = new Map<string, string>();
  for (const d of `${base};${own}`.split(";")) {
    const i = d.indexOf(":");
    if (i < 1) continue;
    const k = d.slice(0, i).trim().toLowerCase();
    map.delete(k);
    map.set(k, d.slice(i + 1).trim());
  }
  return [...map].map(([k, v]) => `${k}:${v}`).join(";");
}

/** Compiles the MJML subset to the email HTML. Throws on anything outside the subset. */
export function renderMjml(src: string): string {
  const root = parseMjml(src);
  const mjml = root.children[0];
  if (!mjml || mjml.tag !== "mjml") throw new Error("mjml-lite: missing <mjml>");
  const head = mjml.children.find((c) => c.tag === "mj-head");
  const body = mjml.children.find((c) => c.tag === "mj-body");
  if (!head || !body) throw new Error("mjml-lite: needs <mj-head> and <mj-body>");
  if (!head.children.some((c) => c.tag === "mj-include" && c.attrs.path === "./partials/head.mjml")) throw new Error("mjml-lite: <mj-head> must include ./partials/head.mjml");
  const title = head.children.find((c) => c.tag === "mj-title")?.raw ?? "";
  const preview = head.children.find((c) => c.tag === "mj-preview")?.raw ?? "";
  const wrapper = body.children[0];
  if (body.children.length !== 1 || wrapper.tag !== "mj-wrapper") throw new Error("mjml-lite: <mj-body> holds one <mj-wrapper>");
  const sections = wrapper.children.map((c) => {
    if (c.tag !== "mj-section") throw new Error(`mjml-lite: <${c.tag}> cannot go in <mj-wrapper>`);
    return section(c);
  });
  const glue = `<!--[if mso | IE]></td></tr></table></td></tr><tr><td class="" width="${CARD_W}px" >${MSO_CELL}<![endif]-->`;
  const lang = mjml.attrs.lang ?? "en-AU";
  const pre = HEAD_PRE.replace('lang="en-AU"', `lang="${escAttr(lang)}"`);
  const bodyHtml = `<body style="word-spacing:normal;background-color:#F2F4FC">${preview ? `<div style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden">${preview}</div>` : ""}<div aria-label="${escAttr(title)}" aria-roledescription="email" role="article" lang="${escAttr(lang)}" dir="auto" style="word-spacing:normal;background-color:#F2F4FC"><!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="card-outlook" role="presentation" style="width:${CARD_W}px;" width="${CARD_W}" bgcolor="#FFFFFF" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]--><div class="card" style="background:#FFFFFF;background-color:#FFFFFF;margin:0px auto;max-width:${CARD_W}px;border-radius:24px;overflow:hidden"><table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;background-color:#FFFFFF;width:100%;border-collapse:separate"><tbody><tr><td style="border-radius:24px;direction:ltr;font-size:0px;padding:26px 16px 22px;text-align:center"><!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" width="${CARD_W}px" >${MSO_CELL}<![endif]-->${sections.join(glue)}<!--[if mso | IE]></td></tr></table></td></tr></table><![endif]--></td></tr></tbody></table></div><!--[if mso | IE]></td></tr></table><![endif]--></div></body></html>`;
  return pre + `<title>${title}</title>` + HEAD_POST + inlineClasses(bodyHtml);
}
