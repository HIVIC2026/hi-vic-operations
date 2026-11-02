// The official ESC VEEC assignment form v1.1 as a website-look PDF (approved sample: docs/approved-samples/2026-11-02/veec-form-sample.pdf).
// Wording comes straight from veec-assignment-form.core.ts (Sections 1, 3 and 4 verbatim); Section 2 is the job's filled-in values.
// Server-only, no database. Part C, Section 3 Part A, Section 3 Part B and Section 4 each start their own page and never split.
import type { FieldValue } from "./assignment.core";
import type { PdfBlock, PdfLayoutReport } from "./pdf-look.core";
import { renderPdf } from "./pdf-look.server";
import {
  AP_DECLARATION, AP_DETAILS, CONSUMER_DECLARATION, INSTALLER_DECLARATION, MAX_AREAS, MAX_INSTALLERS, NOT_REMOVED_HELP, PRODUCT_TYPES, SECTION_1_CONSUMER_RIGHTS,
  VEEC_FORM_EDITION, VEEC_FORM_FIELDS, VEEC_FORM_TITLE, BENEFIT_FORMS, CEILING_SPACE_TYPES,
} from "./veec-assignment-form.core";

/** Who has signed so far. `installer.image` = the Lead Installer's drawn Mitti signature (PNG or JPEG); without it the typed name is printed alone. */
export type VeecSignatures = {
  installer?: { name: string; at: string; image?: Uint8Array };
  ap?: { name: string; at: string };
  consumer?: { name: string; at: string };
};

type Values = Record<string, FieldValue>;
const DASH = "–";
const str = (v: FieldValue | undefined) => (v == null || v === false ? "" : String(v).trim());
const has = (v: Values, k: string) => str(v[k]) !== "";
const show = (v: Values, k: string) => str(v[k]) || DASH;
const money = (v: Values, k: string) => { const n = Number(v[k]); return has(v, k) && Number.isFinite(n) ? n.toLocaleString("en-AU", { style: "currency", currency: "AUD" }) : DASH; };
const box = (on: boolean, label: string) => `${on ? "[x]" : "[ ]"} ${label}`;
const fieldLabel = (key: string) => VEEC_FORM_FIELDS.find((d) => d.key === key)?.label ?? key;

const WEEKDAY_DATE: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", year: "numeric" };
/** "Thu 13 Nov 2026": a plain YYYY-MM-DD stays that day; a timestamp is read as Melbourne time. */
export function veecFormDate(iso: string): string {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(day ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-AU", { timeZone: day ? "UTC" : "Australia/Melbourne", ...WEEKDAY_DATE }).format(d).replace(",", "");
}

/** Pixel size of a PNG or JPEG (for the signature's proportions); null when unreadable. */
function imageSize(b: Uint8Array): { w: number; h: number } | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b.length > 24) { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); return { w: v.getUint32(16), h: v.getUint32(20) }; }
  if (b[0] === 0xff && b[1] === 0xd8) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1]!;
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: v.getUint16(i + 7), h: v.getUint16(i + 5) };
      i += 2 + v.getUint16(i + 2);
    }
  }
  return null;
}
const SIG_MAX_H = 26, SIG_MAX_W = 100;
function signatureImage(bytes: Uint8Array) {
  const s = imageSize(bytes);
  const aspect = s && s.w > 0 && s.h > 0 ? s.w / s.h : 3;
  let height = SIG_MAX_H, width = height * aspect;
  if (width > SIG_MAX_W) { width = SIG_MAX_W; height = width / aspect; }
  return { bytes, width, height };
}

/** Declarations: nested bullets sit under the line that introduces them (the official layout). */
const NESTED_AFTER: [string, number][] = [["where electrical hazards were identified", 2], ["the installation of above insulation product(s)", 5], ["where existing insulation is not removed", 3]];
function bulletLevels(items: string[]): number[] {
  const levels: number[] = [];
  let nest = 0;
  for (const t of items) {
    if (nest > 0) { levels.push(1); nest--; continue; }
    levels.push(0);
    nest = NESTED_AFTER.find(([p]) => t.startsWith(p))?.[1] ?? 0;
  }
  return levels;
}

const heading = (id: string, text: string): PdfBlock => ({ id, kind: "heading", text, compact: true });
const sub = (id: string, text: string): PdfBlock => ({ id, kind: "subheading", text, compact: true });
const para = (id: string, text: string): PdfBlock => ({ id, kind: "para", text, compact: true });
const bullets = (id: string, lines: string[]): PdfBlock => ({ id, kind: "bullets", items: lines, levels: bulletLevels(lines), compact: true });
const facts = (id: string, rows: [string, string][], o: { fullAt?: number[]; full?: boolean; boxes?: boolean } = {}): PdfBlock => ({ id, kind: "facts", rows, compact: true, ...o });

export function veecFormBlocks(values: Values, sigs: VeecSignatures | null, o: { jobNumber?: string | null } = {}): PdfBlock[] {
  const v = values;
  const out: PdfBlock[] = [];

  out.push({ id: "head", kind: "header", eyebrow: `OFFICIAL FORM${o.jobNumber ? ` · JOB ${o.jobNumber}` : ""}`, compact: true });
  out.push({ id: "title", kind: "title", text: VEEC_FORM_TITLE.replace(" Template:", ":"), sub: `Essential Services Commission template, ${VEEC_FORM_EDITION}`, compact: true });

  // ---- Section 1 (verbatim)
  const s1 = SECTION_1_CONSUMER_RIGHTS.split("\n");
  out.push({ id: "s1", kind: "group", children: [heading("s1-h", s1[0]!), ...s1.slice(1).map((t, i) => para(`s1-p${i}`, t))] });

  // ---- Section 2 Parts A and B
  out.push({ id: "s2-partA", kind: "group", children: [
    heading("s2-h", "Section 2: Activity and personnel details"), sub("s2a-h", "Part A: Accredited person details"),
    facts("s2a-f", [
      ["Full name", str(v["ap_full_name"]) || AP_DETAILS.fullName || DASH], ["Company name", str(v["ap_company_name"]) || AP_DETAILS.companyName],
      ["Company address", str(v["ap_company_address"]) || AP_DETAILS.companyAddress || DASH], ["Phone number", str(v["ap_phone"]) || AP_DETAILS.phone || DASH],
    ]),
  ] });
  out.push({ id: "s2-partB", kind: "group", children: [
    sub("s2b-h", "Part B: Pre-installation electrical safety assessment details"),
    facts("s2b-f", [
      ["Licensed electrician – full name", show(v, "elec_full_name")], ["Phone number", show(v, "elec_phone")],
      ["Licence number", show(v, "elec_licence")], ["Company name", show(v, "elec_company_name")],
      ["Company address", show(v, "elec_company_address")], ["REC registration number", show(v, "elec_rec_number")],
      ["Certificate details", `${fieldLabel("ces_issued")} ${box(v["ces_issued"] === "Yes", "Yes")} ${box(v["ces_issued"] === "No", "No")}`],
      ["Certificate of Electrical Safety number", show(v, "ces_number")],
    ], { fullAt: [6, 7], boxes: true }),
  ] });

  // ---- Section 2 Part C (own page)
  out.push({ id: "pb-partC", kind: "pageBreak" });
  const installers = Array.from({ length: MAX_INSTALLERS }, (_, i) => i + 1).filter((n) => n === 1 || ["name", "company", "phone", "eec"].some((k) => has(v, `installer_${n}_${k}`)));
  const installerCells = installers.flatMap((n): [string, string][] => {
    const p = `installer_${n}_`; const who = n === 1 ? "Installer" : `Installer ${n}`;
    return [[`${who} – full name`, show(v, `${p}name`)], ["Company name", show(v, `${p}company`)], ["Phone number", show(v, `${p}phone`)], ["EEC certification number", show(v, `${p}eec`)]];
  });
  const partC: PdfBlock[] = [
    sub("s2c-h", "Part C: Installation details"),
    facts("s2c-f", [...installerCells, ["Installation address", show(v, "installation_address")], ["Date installation was completed", has(v, "date_completed") ? veecFormDate(str(v["date_completed"])) : DASH]], { fullAt: [installerCells.length, installerCells.length + 1] }),
  ];
  const areas = Array.from({ length: MAX_AREAS }, (_, i) => i + 1).filter((n) => n === 1 || ["name", "existing_type", "product_brand", "area_m2"].some((k) => has(v, `area_${n}_${k}`)));
  for (const n of areas) {
    const p = `area_${n}_`;
    const yn = (k: string) => v[`${p}${k}`] === true;
    const label = `Area ${n}${has(v, `${p}name`) ? `: ${str(v[`${p}name`])}` : ""}`;
    partC.push(sub(`s2c-a${n}-h`, `Ceiling space details – ${label}`));
    partC.push(facts(`s2c-a${n}-f`, [
      ["Existing ceiling space type", CEILING_SPACE_TYPES.map((t) => box(v[`${p}existing_type`] === t, t)).join(" ")],
      ["If under insulated", [
        `Estimated R-value of existing insulation: ${str(v[`${p}existing_r_value`]) || "n/a"} · Was the existing insulation removed: ${box(v[`${p}removed`] === "Yes", "Yes")} ${box(v[`${p}removed`] === "No", "No")}`,
        `${NOT_REMOVED_HELP}:`,
        box(yn("not_metallic"), fieldLabel("area_1_not_metallic")), box(yn("suitable_condition"), fieldLabel("area_1_suitable_condition")), box(yn("meets_as3999"), fieldLabel("area_1_meets_as3999")),
      ].join("\n")],
    ], { full: true, boxes: true }));
    partC.push(sub(`s2c-p${n}-h`, `Installed product details – Area ${n}`));
    partC.push(facts(`s2c-p${n}-f`, [
      ["Product type", PRODUCT_TYPES.map((t) => box(v[`${p}product_type`] === t, t)).join(" ")],
      ["Product brand", show(v, `${p}product_brand`)], ["Product model", show(v, `${p}product_model`)],
      ["R-value of installed product", show(v, `${p}product_r_value`)], ["Area insulated (m²)", show(v, `${p}area_m2`)],
    ], { fullAt: [0], boxes: true }));
  }
  const benefit = BENEFIT_FORMS.map((t) => box(v["benefit_form"] === t, t)).join(" ");
  partC.push(sub("s2c-co-h", "Co-payment details (includes product and labour/installation costs)"));
  partC.push(facts("s2c-co-f", [
    ["Price of installed product(s) including GST (before VEEC incentive)", money(v, "price_before_incentive")],
    ["Consumer payment for installed product(s) including GST (after VEEC incentive)", money(v, "consumer_payment_after")],
    ["Form of benefit provided", v["benefit_form"] === "Other (please describe)" && has(v, "benefit_other_description") ? `${benefit} – ${str(v["benefit_other_description"])}` : benefit],
    ["Amount of benefit provided for assignment of certificates", money(v, "benefit_amount")],
  ], { full: true, boxes: true }));
  out.push({ id: "s2-partC", kind: "group", children: partC });

  // ---- Section 3 Part A (own page)
  const apName = sigs?.ap?.name ?? "";
  const apLines = AP_DECLARATION.split("\n").slice(3, -3);
  const apIntro = AP_DECLARATION.split("\n")[2]!.replace("<insert name>", str(v["ap_full_name"]) || AP_DETAILS.fullName || "<insert name>");
  out.push({ id: "pb-s3a", kind: "pageBreak" });
  out.push({ id: "s3-partA", kind: "group", children: [
    heading("s3-h", AP_DECLARATION.split("\n")[0]!), sub("s3a-h", AP_DECLARATION.split("\n")[1]!), para("s3a-i", apIntro), bullets("s3a-b", apLines),
    { id: "s3a-sig", kind: "sigRow", compact: true, cells: [
      { label: "Name", weight: 1, ...(apName ? { text: apName } : {}) },
      { label: "Signature", weight: 1, ...(apName ? { name: apName } : {}) },
      { label: "Date", weight: 0.5, ...(sigs?.ap ? { text: veecFormDate(sigs.ap.at) } : {}) },
    ] },
  ] });

  // ---- Section 3 Part B (own page)
  const instLines = INSTALLER_DECLARATION.split("\n");
  const inst = sigs?.installer;
  out.push({ id: "pb-s3b", kind: "pageBreak" });
  out.push({ id: "s3-partB", kind: "group", children: [
    sub("s3b-h", instLines[0]!), para("s3b-i", instLines[1]!), bullets("s3b-b", instLines.slice(2, -1)),
    { id: "s3b-sig", kind: "sigRow", compact: true, cells: [
      { label: inst?.image ? "Installer signature (signed in the Mitti install form)" : "Installer signature", weight: 2,
        ...(inst ? { name: inst.name, ...(inst.image ? { image: signatureImage(inst.image) } : {}) } : {}) },
      { label: "Date", weight: 1, ...(inst ? { text: veecFormDate(inst.at) } : {}) },
    ] },
  ] });

  // ---- Section 4 (own page)
  const cl = CONSUMER_DECLARATION.split("\n");
  const partBAt = cl.findIndex((l) => l.startsWith("Part B:"));
  const con = sigs?.consumer;
  out.push({ id: "pb-s4", kind: "pageBreak" });
  out.push({ id: "s4", kind: "group", children: [
    heading("s4-h", cl[0]!), sub("s4a-h", cl[1]!),
    facts("s4a-f", [["Full name", show(v, "consumer_full_name")], ["Phone number", show(v, "consumer_phone")], ["Email address", show(v, "consumer_email")]], { fullAt: [0] }),
    sub("s4b-h", cl[partBAt]!), para("s4b-i", cl[partBAt + 1]!), bullets("s4b-b", cl.slice(partBAt + 2, -1)),
    { id: "s4-sig", kind: "sigRow", compact: true, cells: [
      { label: con ? "Consumer signature (typed online)" : "Consumer signature", weight: 2, ...(con ? { name: con.name } : {}) },
      { label: "Date", weight: 1, ...(con ? { text: veecFormDate(con.at) } : {}) },
    ] },
  ] });
  return out;
}

/** `sigs` null = the pre-filled unsigned copy; otherwise whoever has signed so far is printed. */
export async function veecFormPdf(values: Values, sigs: VeecSignatures | null, o: { jobNumber?: string | null } = {}): Promise<{ bytes: Uint8Array; layout: PdfLayoutReport }> {
  return renderPdf({ title: VEEC_FORM_TITLE.replace(" Template:", ":"), blocks: veecFormBlocks(values, sigs, o) });
}
