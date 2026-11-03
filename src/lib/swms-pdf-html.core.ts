// Part 7 Task 2 (Jo 2 Nov 2026): the SWMS in the approved website look — docs/approved-samples/2026-11-02/swms-web.html
// (rendered by Jo's pdf1.js into swms-sample.pdf). PURE: no database, no network, no pdf-lib.
// One model (`swmsPdfModel`) feeds two outputs that must never drift from each other:
//   • `swmsPdfHtml`   — the HTML of the sample (same structure and CSS), for the render check and the Templates page;
//   • `swmsPdfBlocks` — the same content as Part 1's block model, drawn by `renderPdf` (pdf-look.server) in the worker,
//                      which cannot run a browser (src/lib/AGENTS.md).
// Every word comes from swms.core (the plan's own wording set via `swmsWordingFor(plan.rule)`) — never retyped here.
import { LOGO_PNG } from "./email-hero-assets";
import { BUSINESS_LINES, PDF_COLOURS, type PdfBlock } from "./pdf-look.core";
import {
  SWMS_RECORD_TASK, SWMS_SIGN_STATEMENT, latestSignatures, swmsComplianceLines, swmsDate, swmsDateTime, swmsHouseSection, swmsRoleLabel,
  swmsWordingFor, type SwmsChange, type SwmsPlan, type SwmsSignature,
} from "./swms.core";

/** Headings and lines of the approved sample (plan Global Constraints: SWMS title/sub; "Changes during the job" box verbatim). */
export const SWMS_PDF_TITLE = "Safe Work Method Statement";
export const SWMS_PDF_SUB = "Ceiling insulation (VEU Activity 48)";
export const SWMS_CHANGES_HEADING = "Changes during the job";
export const SWMS_CHANGES_LINE = "If anything on site changes, or a control isn't working, stop work. Record the change and the new control here before work starts again.";
export const SWMS_CHANGES_HEADS = ["What changed", "New control", "Lead Installer, date and time"] as const;
export const SWMS_CHANGES_NONE = "None recorded";
const H = {
  compliance: "Compliance", house: "Specific to this house", hazards: "Hazards and control measures", signoff: "Worker sign-off",
  task: "Task:", every: "For every hazard below", howImplemented: "How implemented:", responsible: "Responsible:",
  houseNone: "None recorded", notSigned: "NOT SIGNED",
} as const;
const SIGNOFF_HEADS = ["Name", "Signature", "Date"] as const;
const FACT_LABELS = {
  employer: "Direct employer", principal: "Principal contractor", supervisor: "Work supervisor", installDate: "Install date",
  address: "Site location/address", activity: "Work activity", hrcw: "High-risk construction work",
} as const;

export type SwmsPdfModel = {
  eyebrow: string; title: string; sub: string;
  /** The top grid: [label, value, full-width?]. */
  facts: [string, string, boolean][];
  compliance: [string, string][];
  /** "Specific to this house" lines; `step` = a set safety step (bold in the sample). */
  house: { text: string; step: boolean }[];
  task: string; howImplemented: string; responsible: string;
  hazards: { n: number; name: string; control: string }[];
  changesLine: string; changesHeads: readonly string[];
  changes: { what: string; control: string; who: string }[];
  signStatement: string; signoffHeads: readonly string[];
  signoff: { name: string; signature: string; signed: boolean; at: string }[];
};

const val = (v: string | null | undefined) => (v && v.trim() ? v.trim() : "—");

export function swmsPdfModel(plan: SwmsPlan, sigs: SwmsSignature[], changes: SwmsChange[]): SwmsPdfModel {
  const w = swmsWordingFor(plan.rule);
  const by = latestSignatures(sigs);
  const lead = plan.signers.find((s) => s.role === "lead")?.name ?? null;
  const house = swmsHouseSection(plan);
  return {
    eyebrow: `SAFETY PLAN · JOB ${plan.jobNumber}`, title: SWMS_PDF_TITLE, sub: SWMS_PDF_SUB,
    facts: [
      [FACT_LABELS.employer, val(plan.businessName), false], [FACT_LABELS.principal, plan.principalContractor, false],
      [FACT_LABELS.supervisor, val(lead), false], [FACT_LABELS.installDate, swmsDate(plan.installDate), false],
      [FACT_LABELS.address, val(plan.address), true], [FACT_LABELS.activity, plan.workActivity, true],
      [FACT_LABELS.hrcw, plan.highRiskWork.join("; "), true],
    ],
    compliance: swmsComplianceLines(plan),
    house: house.map((t) => ({ text: t, step: t.startsWith("Safety step: ") })),
    task: SWMS_RECORD_TASK, howImplemented: w.howImplemented, responsible: `${val(lead)} (${swmsRoleLabel(plan.rule, "lead")})`,
    hazards: plan.hazards.map((h, i) => ({ n: i + 1, name: h.name, control: `${h.control}.` })),
    changesLine: SWMS_CHANGES_LINE, changesHeads: SWMS_CHANGES_HEADS,
    changes: changes.map((c) => ({ what: val(c.what), control: val(c.control), who: `${val(c.by)}, ${swmsDateTime(c.at)}` })),
    signStatement: `${SWMS_SIGN_STATEMENT}.`, signoffHeads: SIGNOFF_HEADS,
    signoff: plan.signers.map((s) => {
      const g = by.get(s.key);
      return { name: `${s.name} (${swmsRoleLabel(plan.rule, s.role)})`, signature: g ? `✓ signed — typed "${g.typedName}"` : H.notSigned, signed: !!g, at: g ? swmsDateTime(g.signedAt) : "—" };
    }),
  };
}

// ── HTML (the sample's structure and CSS) ─────────────────────────────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Open Sans files as the sample loads them; the render test passes an absolute file:// base. */
export const SWMS_HTML_FONT_BASE = "node_modules/@fontsource/open-sans/files/";

function css(fontBase: string): string {
  const face = (wgt: number) => `@font-face{font-family:"Open Sans";font-weight:${wgt};src:url(${fontBase}open-sans-latin-${wgt}-normal.woff2)}`;
  return [
    face(400), face(600), face(700), face(800),
    "@page{size:600px 849px;margin:0 40px 46px}",
    `:root{--ink:${PDF_COLOURS.navy};--blue:${PDF_COLOURS.blue};--green:${PDF_COLOURS.green};--dgreen:#07a554;--box:${PDF_COLOURS.box};--muted:${PDF_COLOURS.muted};--line:#e3e8f2}`,
    "*{box-sizing:border-box;margin:0;padding:0}",
    'body{padding-right:3px;font-family:"Open Sans";color:var(--ink);font-size:10.3px;line-height:1.33;-webkit-print-color-adjust:exact}',
    ".band{height:8px;background:var(--blue);margin:0 -40px 18px}",
    ".head{display:flex;justify-content:space-between;align-items:flex-start}",
    ".biz{font-size:10px;color:var(--muted);text-align:right;line-height:1.5}",
    ".doc{margin-top:12px;font-weight:700;font-size:10.5px;letter-spacing:.14em;color:var(--blue)}",
    "h1{font-weight:800;font-size:19px;line-height:1.15;margin:4px 0 2px}",
    ".sub{font-size:10.5px;color:var(--muted);margin-bottom:12px}",
    "h2{font-weight:700;font-size:13px;margin:10px 0 5px;padding-bottom:4px;border-bottom:1.5px solid var(--ink)}",
    ".grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--box)}",
    ".grid div{padding:5px 10px;border-bottom:1px solid var(--line);border-right:1px solid var(--line)}",
    ".grid div:nth-child(2n){border-right:0}",
    ".grid .full{grid-column:1/3;border-right:0}",
    ".grid span{display:block;font-size:9px;font-weight:700;letter-spacing:.08em;color:var(--muted);text-transform:uppercase}",
    "ul{padding-left:16px;margin-top:2px} li{margin-bottom:1px}",
    ".logoimg{height:46px}",
    ".hz{border:1px solid var(--line);border-radius:10px;background:var(--box);padding:7px 11px;margin-bottom:6px;break-inside:avoid}",
    ".hz b{margin-bottom:2px;font-weight:700;display:block;font-size:11px}",
    ".hz .n{display:inline-block;width:16px;height:16px;border-radius:50%;background:var(--blue);color:#fff;font-size:9.5px;text-align:center;line-height:16px;margin-right:6px;font-weight:700}",
    ".once{border-left:4px solid var(--blue);background:#fff;padding:6px 11px;margin:6px 0 10px;border-radius:0 8px 8px 0}",
    ".house li{margin-bottom:2px}",
    ".step{color:var(--ink);font-weight:700}",
    "table.sg{width:100%;border-collapse:collapse;margin-top:6px;font-size:10.5px}",
    "table.sg th{text-align:left;font-size:9px;letter-spacing:.08em;color:var(--muted);text-transform:uppercase;border-bottom:1.5px solid var(--ink);padding:4px 6px}",
    "table.sg td{padding:6px;border-bottom:1px solid var(--line)}",
    ".ok{color:var(--green);font-weight:700}",
    ".keep{break-inside:avoid}",
    "p{margin-bottom:5px}",
  ].join("\n");
}

/** The sample's HTML for this plan. `logoDataUrl` defaults to the bundled logo (public/email-preview/hi-vic-logo.png = LOGO_PNG). */
export function swmsPdfHtml(plan: SwmsPlan, sigs: SwmsSignature[], changes: SwmsChange[], opts: { logoDataUrl?: string; fontBase?: string } = {}): string {
  const m = swmsPdfModel(plan, sigs, changes);
  const logo = opts.logoDataUrl ?? `data:image/png;base64,${LOGO_PNG}`;
  const cell = ([label, text, full]: [string, string, boolean]) => `<div${full ? ' class="full"' : ""}><span>${esc(label)}</span>${esc(text)}</div>`;
  const L: string[] = [];
  L.push('<!DOCTYPE html><html><head><meta charset="utf-8"><title>', esc(`${m.title} — Job ${plan.jobNumber}`), "</title><style>", css(opts.fontBase ?? SWMS_HTML_FONT_BASE), "</style></head><body>");
  L.push('<div class="band"></div>');
  L.push(`<div class="head"><img class="logoimg" src="${logo}" alt="Home Insulation Victoria"><div class="biz">${BUSINESS_LINES.map(esc).join("<br>")}</div></div>`);
  L.push(`<div class="doc">${esc(m.eyebrow)}</div>`, `<h1>${esc(m.title)}</h1>`, `<p class="sub">${esc(m.sub)}</p>`);
  L.push(`<div class="grid">${m.facts.map(cell).join("")}</div>`);
  L.push(`<h2>${H.compliance}</h2>`, `<div class="grid">${m.compliance.map(([l, v]) => cell([l, v, true])).join("")}</div>`);
  L.push(`<h2>${H.house}</h2>`);
  L.push(m.house.length ? `<ul class="house">${m.house.map((h) => `<li${h.step ? ' class="step"' : ""}>${esc(h.text)}</li>`).join("")}</ul>` : `<p>${H.houseNone}</p>`);
  L.push(`<h2>${H.hazards}</h2>`, `<p><b>${H.task}</b> ${esc(m.task)}</p>`);
  // "Responsible: John Smith (Lead Installer)" stays one run of text (the brief reads it as one string), so the whole line is bold.
  L.push(`<div class="once"><b>${H.every}</b><br><b>${H.howImplemented}</b> ${esc(m.howImplemented)}<br><b>${H.responsible} ${esc(m.responsible)}</b></div>`);
  for (const h of m.hazards) L.push(`<div class="hz"><b><span class="n">${h.n}</span>${esc(h.name)}</b>${esc(h.control)}</div>`);
  const rows = m.changes.length ? m.changes.map((c) => `<tr><td>${esc(c.what)}</td><td>${esc(c.control)}</td><td>${esc(c.who)}</td></tr>`).join("") : `<tr><td>${SWMS_CHANGES_NONE}</td><td>–</td><td>–</td></tr>`;
  L.push(`<div class="keep"><h2>${SWMS_CHANGES_HEADING}</h2><p>${esc(m.changesLine)}</p><table class="sg"><tr>${m.changesHeads.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>${rows}</table></div>`);
  L.push(`<div class="keep"><h2>${H.signoff}</h2><p>${esc(m.signStatement)}</p><table class="sg"><tr>${m.signoffHeads.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>${
    m.signoff.map((s) => `<tr><td>${esc(s.name)}</td><td${s.signed ? ' class="ok"' : ""}>${esc(s.signature)}</td><td>${esc(s.at)}</td></tr>`).join("")}</table></div>`);
  L.push("</body></html>");
  return L.join("");
}

// ── Part 1 block model (the filed PDF) ────────────────────────────────────────────────────────────────────────────────
/** The same content as Part 1 blocks: compact grid for the facts and compliance, boxes for the "once" line and each hazard
 *  (each stays whole; the hazards section flows between them), three-cell fact rows for the changes and sign-off tables
 *  (those two sections keep together, as the sample's `.keep` boxes). */
export function swmsPdfBlocks(m: SwmsPdfModel): PdfBlock[] {
  const facts = (id: string, rows: [string, string][]): PdfBlock => ({ id, kind: "facts", rows });
  const three = (id: string, cells: [string, string][]): PdfBlock => ({ id, kind: "facts", rows: cells });
  const sections: PdfBlock[] = [
    { id: "swms-header", kind: "header", eyebrow: m.eyebrow },
    { id: "swms-title", kind: "title", text: m.title, sub: m.sub },
    { id: "swms-facts", kind: "facts", compact: true, fullFrom: m.facts.findIndex(([, , full]) => full), rows: m.facts.map(([l, v]) => [l, v]) },
    { id: "swms-compliance", kind: "section", title: H.compliance, children: [{ id: "swms-compliance-grid", kind: "facts", compact: true, full: true, rows: m.compliance }] },
    { id: "swms-house", kind: "section", title: H.house, children: [
      m.house.length ? { id: "swms-house-lines", kind: "bullets", items: m.house.map((h) => (h.step ? "" : h.text)), leads: m.house.map((h) => (h.step ? h.text : "")) } : { id: "swms-house-none", kind: "para", text: H.houseNone },
    ] },
    { id: "swms-hazards", kind: "section", title: H.hazards, keepTogether: false, children: [
      { id: "swms-task", kind: "para", lead: H.task, text: m.task },
      { id: "swms-once", kind: "box", children: [
        { id: "swms-once-1", kind: "para", lead: H.every, text: "" },
        { id: "swms-once-2", kind: "para", lead: H.howImplemented, text: m.howImplemented },
        { id: "swms-once-3", kind: "para", lead: H.responsible, text: m.responsible },
      ] },
      { id: "swms-hazards-gap", kind: "spacer", height: 6 },
      ...m.hazards.map((h): PdfBlock => ({ id: `swms-hz-${h.n}`, kind: "box", children: [{ id: `swms-hz-${h.n}-name`, kind: "para", lead: `${h.n}. ${h.name}`, text: "" }, { id: `swms-hz-${h.n}-control`, kind: "para", text: h.control }] })),
    ] },
    { id: "swms-changes", kind: "section", title: SWMS_CHANGES_HEADING, children: [
      { id: "swms-changes-line", kind: "para", text: m.changesLine },
      ...(m.changes.length
        ? m.changes.map((c, i) => three(`swms-change-${i + 1}`, [[m.changesHeads[0]!, c.what], [m.changesHeads[1]!, c.control], [m.changesHeads[2]!, c.who]]))
        : [three("swms-change-none", [[m.changesHeads[0]!, SWMS_CHANGES_NONE], [m.changesHeads[1]!, "–"], [m.changesHeads[2]!, "–"]])]),
    ] },
    { id: "swms-signoff", kind: "section", title: H.signoff, children: [
      { id: "swms-sign-statement", kind: "para", text: m.signStatement },
      ...m.signoff.map((s, i) => facts(`swms-sign-${i + 1}`, [[m.signoffHeads[0]!, s.name], [m.signoffHeads[1]!, s.signature], [m.signoffHeads[2]!, s.at]])),
    ] },
  ];
  return sections;
}
