// Renders SAMPLE official DEECA PIESAs (mapping piesa-map-2.0.0, NOT approved) for Jo to approve by looking at them.
// Three example jobs, answered on the current A4 Mitti short form (SHORT_PIESA_FIELDS labels), go through the SAME pure
// steps the portal uses — shortAnswersFromEntries → (A5 fixes merge, mergeFixesIntoPiesaSnapshot) → expandPiesa with the
// owner's secure-link confirmation → evaluatePiesa → buildSignedSnapshot → fillOfficialDocxXml (the Word form) and
// officialPiesaPdfText + textToPdf (the PDF the electrician gets). The approval check (officialFormUseBlocker) is NOT called
// and OFFICIAL_TEMPLATES.piesa.approved is never changed: nothing here is stored, signed or sent. No database, no network.
// Output: docs/templates/samples/piesa-mapping/ (case-N.docx, case-N.pdf, case-N-docx.pdf, PNG pages, README.md).
// PNGs need LibreOffice (Word → PDF) and pdftoppm; without them the .docx/.pdf are still written and the README says so.
// Run: bun scripts/render-piesa-mapping-samples.ts
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { unzipSync, zipSync } from "fflate";
import piesaDocx from "../src/lib/official-docx-piesa.data";
import { fillOfficialDocxXml } from "../src/lib/official-docx.core";
import {
  B1_OPTIONS,
  B2_OPTIONS,
  OFFICIAL_TEMPLATES,
  answerItems,
  buildSignedSnapshot,
  evaluatePiesa,
  type OfficialAnswers,
} from "../src/lib/official-forms.core";
import { expandPiesa } from "../src/lib/official-expand.core";
import {
  APPLIANCE_Q,
  FIXES_DOWNLIGHT_OPTION,
  FIXES_ONSITE_OPTION,
  FIXES_RCD_OPTION,
  MAINS_PROBLEMS,
  SHORT_PIESA_FIELDS,
  shortAnswersFromEntries,
} from "../src/lib/official-short.core";
import {
  fixesCompletionPlan,
  mergeFixesIntoPiesaSnapshot,
  type FixesDayRead,
  type SnapshotEntry,
} from "../src/lib/fixes-day.core";
import {
  buildPiesaOwnerConfirmation,
  confirmationFromEvents,
  ownerConfirmationForForm,
  type PiesaOwnerConfirmFacts,
} from "../src/lib/piesa-owner-confirm.core";
import {
  officialPiesaPdfHeader,
  officialPiesaPdfText,
} from "../src/lib/electrician-piesa-copy.core";
import { textToPdf } from "../src/lib/signed-pdf.server";

const OUT = new URL("../docs/templates/samples/piesa-mapping/", import.meta.url).pathname;
const T = OFFICIAL_TEMPLATES.piesa;

// ---------- A4 answers by the current short-form label ----------
const L = (id: string) => {
  const f = SHORT_PIESA_FIELDS.find((x) => x.id === id);
  if (!f) throw new Error(`No short PIESA field ${id}`);
  return f.label;
};
type Entry = { label: string; value: string | null };
const e = (id: string, value: string): Entry => ({ label: L(id), value });

const ELECTRICIAN = [
  e("b3.licence", "A 54321"),
  e("b3.name", "Sam Spark"),
  e("b3.recName", "Spark Electrical Pty Ltd"),
  e("b3.recNo", "REC 23456"),
  e("b3.phone", "0400 111 222"),
  e("b3.declaration", "Yes"),
  e("electricianSignature", "signature captured in Mitti"),
];

type Case = {
  n: number;
  slug: string;
  title: string;
  jobNumber: string;
  address: string;
  inspectionDate: string;
  owner: string;
  ownerSignedAt: string;
  a4: Entry[];
  fixes?: { read: FixesDayRead; completedOn: string };
};

const CASES: Case[] = [
  {
    n: 1,
    slug: "case-1-all-clear",
    title: "All clear — no life support, no repairs",
    jobNumber: "HV-SAMPLE-1",
    address: "14 Wattle Street, Bentleigh VIC 3204",
    inspectionDate: "2026-10-27",
    owner: "Helen Nguyen",
    ownerSignedAt: "2026-10-27T19:40:00+11:00",
    a4: [
      e("jobRef", "HV-SAMPLE-1"),
      e("address", "14 Wattle Street, Bentleigh VIC 3204"),
      e("customerOf", "Home Insulation Victoria"),
      e("noPriceTalk", "Yes"),
      e("inspectionDate", "2026-10-27"),
      e("lifeSupportRecord", "No (owner said no on the website)"),
      e("lifeSupportPresent", "No"),
      e("mainsSafe", "Yes"),
      e("solarPresent", "No"),
      e("ceilingSafe", "Yes"),
      e("downlightsPresent", "Yes"),
      e("downlightCount", "8"),
      e("downlightsNonIc", "No"),
      e("appliancesPresent", "Yes"),
      { label: APPLIANCE_Q.what, value: "Bathroom exhaust fan, ceiling above the main bathroom" },
      { label: APPLIANCE_Q.photo, value: "1 photo" },
      { label: APPLIANCE_Q.safe, value: "Yes" },
      e("rectificationNeeded", "No"),
      ...ELECTRICIAN,
    ],
  },
  {
    n: 2,
    slug: "case-2-life-support-fixes",
    title:
      "Life support (medical plan) + solar + 4 non-IC downlights; repairs needed, then done on the A5 fixes form with a CoES",
    jobNumber: "HV-SAMPLE-2",
    address: "7 Banksia Court, Frankston VIC 3199",
    inspectionDate: "2026-10-28",
    owner: "Robert Ellis",
    ownerSignedAt: "2026-10-28T20:15:00+11:00",
    a4: [
      e("jobRef", "HV-SAMPLE-2"),
      e("address", "7 Banksia Court, Frankston VIC 3199"),
      e("customerOf", "Home Insulation Victoria"),
      e("noPriceTalk", "Yes"),
      e("inspectionDate", "2026-10-28"),
      e("lifeSupportRecord", "Yes (owner said yes on the website)"),
      e("lifeSupportPresent", "Yes"),
      e("lifeSupportConsent", "Yes – received Medical Plan"),
      e("lifeSupportAttachment", "1 photo"),
      // Two ticks, joined by ", " exactly as mitti.core reads a Mitti multi-select.
      e("mainsSafe", "No"),
      e("mainsProblems", `${MAINS_PROBLEMS[5]}, ${MAINS_PROBLEMS[6]}`),
      e("solarPresent", "Yes"),
      e("solarSafe", "Yes"),
      e("ceilingSafe", "Yes"),
      e("downlightsPresent", "Yes"),
      e("downlightCount", "4"),
      e("downlightsNonIc", "Yes"),
      e("downlightsNonIcCount", "4"),
      e("appliancesPresent", "No"),
      e("rectificationNeeded", "Yes"),
      e("rectificationWork", `${B2_OPTIONS[0]}, ${B2_OPTIONS[2]}`),
      e("fixesPriceIncGst", "1180"),
      e("fixesWork", `${FIXES_DOWNLIGHT_OPTION}, ${FIXES_RCD_OPTION}`),
      e("fixesDownlightCount", "4"),
      e("fixesRcdCount", "1"),
      ...ELECTRICIAN,
    ],
    fixes: {
      completedOn: "2026-11-03",
      read: {
        jobNumber: "HV-SAMPLE-2",
        electricianName: "Sam Spark",
        licence: "A 54321",
        recName: "Spark Electrical Pty Ltd",
        recNo: "REC 23456",
        phone: "0400 111 222",
        done: "Yes",
        notDone: null,
        coesNumber: "CES 7781234",
        certDate: "2026-11-03",
        coesFiles: [{ mediaId: "sample-coes-file", capturedAt: null, lat: null, lng: null }],
        workPhotos: [
          {
            mediaId: "sample-work-photo",
            capturedAt: "2026-11-03T10:12:00+11:00",
            lat: -38.1433,
            lng: 145.1228,
          },
        ],
        signature: {
          present: true,
          name: "Sam Spark",
          signedAt: "2026-11-03T11:02:00+11:00",
          mediaId: "sample-signature",
        },
      },
    },
  },
  {
    n: 3,
    slug: "case-3-electrician-at-start",
    title:
      'Repair needed where the only tick is "Be on site at the start of the install day" (electrician present at installation)',
    jobNumber: "HV-SAMPLE-3",
    address: "22 Ironbark Road, Bendigo VIC 3550",
    inspectionDate: "2026-10-29",
    owner: "Priya Shah",
    ownerSignedAt: "2026-10-30T08:05:00+11:00",
    a4: [
      e("jobRef", "HV-SAMPLE-3"),
      e("address", "22 Ironbark Road, Bendigo VIC 3550"),
      e("customerOf", "Home Insulation Victoria"),
      e("noPriceTalk", "Yes"),
      e("inspectionDate", "2026-10-29"),
      e("lifeSupportRecord", "No (owner said no on the website)"),
      e("lifeSupportPresent", "No"),
      e("mainsSafe", "No"),
      e("mainsProblems", MAINS_PROBLEMS[3]),
      e("solarPresent", "No"),
      e("ceilingSafe", "Yes"),
      e("downlightsPresent", "No"),
      e("appliancesPresent", "No"),
      e("rectificationNeeded", "Yes"),
      e("rectificationWork", B2_OPTIONS[5]),
      e(
        "rectificationOther",
        "Old main switch cannot be locked off. Electrician to attend at the start of the install day to isolate the mains, lock out and tag.",
      ),
      e("fixesPriceIncGst", "220"),
      e("fixesWork", FIXES_ONSITE_OPTION),
      ...ELECTRICIAN,
    ],
  },
];

// ---------- where each official answer comes from (A4 = the electrician's Mitti form) ----------
const q = (id: string) => `"${L(id)}"`;
export const SOURCE: Record<string, string> = {
  jobRef: `A4 ${q("jobRef")} (portal prefill)`,
  address: `A4 ${q("address")} (portal prefill)`,
  inspectionDate: `A4 ${q("inspectionDate")}`,
  lifeSupport: `A4 ${q("lifeSupportPresent")}`,
  lifeSupportConsent: `A4 "Have you received written consent or a medical plan?…" ("No – not received" = stop, left blank + flagged)`,
  lifeSupportAttachment: `A4 ${q("lifeSupportAttachment")} (photo)`,
  "p2.mains": `A4 ${q("mainsSafe")} Yes → Yes; No → No only if "${MAINS_PROBLEMS[0]}" ticked`,
  "p2.switch": `Derived: No if any of the three main-switch sub-items is No`,
  "p2.switchAccessible": `A4 mains Yes/No + tick "${MAINS_PROBLEMS[1]}"`,
  "p2.switchIsolates": `A4 mains Yes/No + tick "${MAINS_PROBLEMS[2]}"`,
  "p2.switchSecured": `A4 mains Yes/No + tick "${MAINS_PROBLEMS[3]}"`,
  "p2.tested": `A4 mains Yes/No + tick "${MAINS_PROBLEMS[4]}"`,
  "p2.rcdPresent": `A4 mains Yes/No + tick "${MAINS_PROBLEMS[5]}"`,
  "p2.rcdTested": `A4 mains Yes/No + tick "${MAINS_PROBLEMS[6]}"`,
  "p3.present": `A4 ${q("solarPresent")}`,
  "p3.instructions": `A4 ${q("solarSafe")} + solar problem ticks`,
  "p3.isolator": `A4 solar safe + solar problem ticks`,
  "p3.conduit": `A4 solar safe + solar problem ticks`,
  "p3.protected": `A4 solar safe + solar problem ticks`,
  "p4.conduit": `A4 ${q("ceilingSafe")} + ceiling problem ticks`,
  "p4.supported": `A4 ceiling safe + ceiling problem ticks`,
  "p4.treatment": `A4 ceiling safe + ceiling problem ticks`,
  "p4.tps": `A4 ceiling safe + ceiling problem ticks (never "N/A")`,
  "p4.terminations": `A4 ceiling safe + ceiling problem ticks`,
  "p4.plugBases": `A4 ceiling safe + ceiling problem ticks`,
  "p4.foil": `A4 ceiling safe + ceiling problem ticks`,
  "p5.nonTps": `A4 ceiling safe (Yes → No) + ceiling problem ticks`,
  "p5.splitConduit": `A4 ceiling safe (Yes → No) + ceiling problem ticks`,
  "p5.damaged": `A4 ceiling safe (Yes → No) + ceiling problem ticks`,
  "p6.recessed": `A4 ${q("downlightsPresent")}`,
  "p6.count": `A4 ${q("downlightCount")}`,
  "p6.prohibited": `A4 ${q("downlightsNonIc")}`,
  "p7.appliances": `A4 ${q("appliancesPresent")} (one question for both)`,
  "p7.flues": `A4 ${q("appliancesPresent")} (SAME answer as appliances)`,
  "p7.appliance": `A4 "${APPLIANCE_Q.what}" (one row per "Add an appliance or flue")`,
  "p7.location": `A4 "${APPLIANCE_Q.what}" (SAME text as the Appliance column)`,
  "p7.hazard": `Fixed wording from "${APPLIANCE_Q.safe}"`,
  "p7.actions": `Fixed wording (none / see Part B2)`,
  "p7.effective": `Derived: Yes when every item is safe as it is, or once repairs are recorded complete`,
  "p7.otherHazard": `NOT ASKED on A4 — always blank`,
  "p7.otherAction": `NOT ASKED on A4 — always blank`,
  b1: `A4 ${q("rectificationNeeded")} + "${FIXES_ONSITE_OPTION}" tick (decision 314)`,
  b2: `A4 ${q("rectificationWork")} (only when B1 = rectification required)`,
  "b2.other": `A4 ${q("rectificationOther")}`,
  "b3.licence": `A4 ${q("b3.licence")}`,
  "b3.name": `A4 ${q("b3.name")}`,
  "b3.recName": `A4 ${q("b3.recName")}`,
  "b3.recNo": `A4 ${q("b3.recNo")}`,
  "b3.phone": `A4 ${q("b3.phone")}`,
  "b3.declaration": `A4 declaration tick`,
  "c.licence": `Copied from B3 once repairs are recorded (A5 fills blanks only)`,
  "c.name": `Copied from B3 once repairs are recorded`,
  "c.recName": `Copied from B3 once repairs are recorded`,
  "c.recNo": `Copied from B3 once repairs are recorded`,
  "c.phone": `Copied from B3 once repairs are recorded`,
  "c.signature": `NEVER written to the form (lives in the signed record)`,
  "c.completionDate": `"today" of the regeneration = A5 "Date of certification"`,
  "c.coes": `A5 "Certificate of Electrical Safety number"`,
  "c.certDate": `A5 "Date of certification"`,
  "o.signature": `NEVER written to the form (typed name on the secure link)`,
  "o.name": `Owner's secure-link confirmation: typed full name`,
  "o.date": `Owner's secure-link confirmation: Melbourne date they confirmed`,
};
for (let i = 1; i <= 7; i++)
  SOURCE[`c.tick${i}`] =
    `A5 "Have you completed all of the repair work listed…" = Yes (all seven ticked together)`;
for (let i = 1; i <= 4; i++)
  SOURCE[`o.tick${i}`] =
    `Owner's secure-link confirmation (ONE tick "The assessment was completed on <date>" → all four official ticks)`;

// ---------- pipeline (pure; mirrors mitti.server PIESA sync and fixes-day.server regenerateOfficialPiesa) ----------
function ownerConfirmation(c: Case) {
  const facts: PiesaOwnerConfirmFacts = {
    piesaRecordId: `sample-piesa-record-${c.n}`,
    completedDate: c.inspectionDate,
    completedAt: `${c.inspectionDate}T15:00:00+11:00`,
    outcome: null,
    rectificationRequired: false,
    electricianOnInstallDay: false,
    electrician: { name: "Sam Spark", recName: "Spark Electrical Pty Ltd" },
    signedCopy: null,
    confirmation: null,
  };
  const details = buildPiesaOwnerConfirmation({
    facts,
    name: c.owner,
    authority: "owner",
    signedAt: c.ownerSignedAt,
    codeId: null,
    ipHash: null,
    uaHash: null,
  });
  return ownerConfirmationForForm(confirmationFromEvents([{ details }], facts.piesaRecordId));
}

function run(c: Case) {
  let snapshot: SnapshotEntry[] = c.a4.map((x) => ({ ...x }));
  let today = c.inspectionDate;
  const owner = ownerConfirmation(c);
  const initial = expandPiesa(shortAnswersFromEntries("piesa", snapshot), {
    lifeSupportDeclared: null,
    today,
    ownerConfirmation: owner,
  });
  if (c.fixes) {
    const plan = fixesCompletionPlan(c.fixes.read, { completed: true, today: c.fixes.completedOn });
    if (plan.kind !== "done")
      throw new Error(
        `Case ${c.n}: A5 sample is not a complete fixes form: ${JSON.stringify(plan)}`,
      );
    snapshot = mergeFixesIntoPiesaSnapshot(snapshot, c.fixes.read, plan);
    today = plan.certDate; // regenerateOfficialPiesa passes today = certification date
  }
  const short = shortAnswersFromEntries("piesa", snapshot);
  const expanded = expandPiesa(short, {
    lifeSupportDeclared: null,
    today,
    ownerConfirmation: owner,
  });
  const ev = evaluatePiesa(expanded.answers);
  const initialEv = c.fixes ? evaluatePiesa(initial.answers) : null;
  return { short, expanded, ev, initial: c.fixes ? initial : null, initialEv, today };
}

const DATA_PREFIX =
  "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,";
function fillDocx(answers: OfficialAnswers) {
  const bytes = new Uint8Array(
    Buffer.from(
      piesaDocx.startsWith(DATA_PREFIX)
        ? piesaDocx.slice(DATA_PREFIX.length)
        : piesaDocx.replace(/^data:[^,]*,/, ""),
      "base64",
    ),
  );
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== T.sha256)
    throw new Error("Bundled PIESA Word form does not match the recorded official original.");
  const parts = unzipSync(bytes);
  const doc = parts["word/document.xml"];
  if (!doc) throw new Error("Official Word form has no document body.");
  const { xml, filled, missed } = fillOfficialDocxXml(
    new TextDecoder().decode(doc),
    "piesa",
    answers,
  );
  return {
    bytes: zipSync({ ...parts, "word/document.xml": new TextEncoder().encode(xml) }, { level: 0 }),
    filled,
    missed,
    xml,
  };
}

// ---------- what the filled Word form actually SHOWS (read back from the XML, not from the filler's own report) ----------
const nrm = (x: string) =>
  x
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .trim();
function wordAudit(xml: string, a: OfficialAnswers): string[] {
  const boxes: { on: boolean; label: string }[] = [];
  const re = /<w:checkBox>([\s\S]*?)<\/w:checkBox>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const checked = /<w:checked w:val="(\d)"\/>/.exec(m[1]!) ?? /<w:checked\/>/.exec(m[1]!);
    const def = /<w:default w:val="(\d)"\/>/.exec(m[1]!);
    const on = checked ? (checked[1] ?? "1") === "1" : def?.[1] === "1";
    const rest = xml
      .slice(m.index + m[0].length, m.index + m[0].length + 4000)
      .split("<w:checkBox>")[0]!
      .split("</w:p>")[0]!;
    boxes.push({
      on,
      label: [...rest.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
        .map((t) => t[1])
        .join("")
        .replace(/þ/g, "")
        .trim(),
    });
  }
  const items = answerItems("piesa");
  const yn = items.filter((i) => i.kind === "yesno" || i.kind === "yesno_na");
  const want = (v: string) => yn.filter((i) => show(a[i.id]) === v).length;
  const shown = (l: string) => boxes.filter((b) => b.on && nrm(b.label) === nrm(l)).length;
  const out = [
    `Yes/No questions answered Yes: ${want("Yes")} — "Yes" boxes ticked on the Word form: ${shown("Yes")}.`,
    `Yes/No questions answered No: ${want("No")} — "No" boxes ticked on the Word form: ${shown("No")}.`,
  ];
  const b1Shown = boxes.filter(
    (b) => b.on && B1_OPTIONS.some((o) => nrm(b.label).startsWith(nrm(o).slice(0, 40))),
  ).length;
  out.push(
    `B1 outcome answered: ${show(a["b1"]) ? "one option" : "none"} — B1 boxes ticked on the Word form: ${b1Shown}.`,
  );
  const b2Shown = boxes.filter(
    (b) => b.on && B2_OPTIONS.some((o) => nrm(b.label) === nrm(o)),
  ).length;
  out.push(
    `B2 repair items answered: ${Array.isArray(a["b2"]) ? a["b2"].length : 0} — B2 boxes ticked on the Word form: ${b2Shown}.`,
  );
  const ticks = items.filter((i) => i.kind === "tick" && a[i.id] === true).length;
  const tickShown = boxes.filter(
    (b) => b.on && items.some((i) => i.kind === "tick" && nrm(i.label) === nrm(b.label)),
  ).length;
  out.push(
    `Declaration ticks answered: ${ticks} — declaration boxes ticked on the Word form: ${tickShown}.`,
  );
  const nested = (xml.match(/<w:r><w:r>/g) ?? []).length;
  if (nested)
    out.push(
      `${nested} tick marks were written as a run inside another run (\`<w:r><w:r>\`) — not valid Word XML; LibreOffice opens it, Word may report unreadable content.`,
    );
  return out;
}

const has = (cmd: string) => {
  try {
    execFileSync("which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
function pngs(pdf: string, prefix: string): string[] {
  if (!has("pdftoppm")) return [];
  execFileSync("pdftoppm", ["-png", "-r", "80", pdf, `${OUT}${prefix}`]);
  return readdirSync(OUT)
    .filter((f) => f.startsWith(`${prefix}-`) && f.endsWith(".png"))
    .sort();
}

const show = (v: unknown) =>
  v == null || v === "" ? "" : v === true ? "ticked" : Array.isArray(v) ? v.join(" / ") : String(v);
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

async function main() {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const soffice = has("soffice") ? "soffice" : has("libreoffice") ? "libreoffice" : null;
  const results = [];
  for (const c of CASES) {
    const r = run(c);
    const docx = fillDocx(r.expanded.answers);
    writeFileSync(`${OUT}${c.slug}.docx`, docx.bytes);
    const snap = buildSignedSnapshot({
      key: "piesa",
      answers: r.expanded.answers,
      signer: { userId: "sample-electrician", name: "Sam Spark", role: "electrician" },
      enteredDate: r.today,
      serverTimestamp: `${r.today}T12:00:00.000Z`,
      jobFacts: {},
      acknowledgementIds: [],
      signature: `sample:${c.jobNumber}`,
    });
    writeFileSync(
      `${OUT}${c.slug}.pdf`,
      await textToPdf(
        `${officialPiesaPdfHeader(c.jobNumber)} (SAMPLE - mapping not approved)`,
        officialPiesaPdfText(snap),
      ),
    );
    const pdfPngs = pngs(`${OUT}${c.slug}.pdf`, `${c.slug}-pdf`);
    let docxPngs: string[] = [];
    if (soffice) {
      const tmp = `${OUT}.lo-${c.n}/`;
      mkdirSync(tmp, { recursive: true });
      execFileSync(
        soffice,
        ["--headless", "--convert-to", "pdf", "--outdir", tmp, `${OUT}${c.slug}.docx`],
        { stdio: "ignore", env: { ...process.env, HOME: tmp } },
      );
      execFileSync("cp", [`${tmp}${c.slug}.pdf`, `${OUT}${c.slug}-word.pdf`]);
      rmSync(tmp, { recursive: true });
      docxPngs = pngs(`${OUT}${c.slug}-word.pdf`, `${c.slug}-word`);
    }
    results.push({ c, r, docx, pdfPngs, docxPngs });
  }

  // ---------- README ----------
  const out: string[] = [];
  out.push(
    `# Official PIESA mapping samples (${T.mappingVersion}) — for Jo's approval`,
    "",
    `SAMPLES ONLY. The mapping is **not approved** (\`OFFICIAL_TEMPLATES.piesa.approved = false\`), so the portal produces no official PIESA yet. These files were made by \`bun scripts/render-piesa-mapping-samples.ts\` with the portal's own pure steps (A4 answers → \`shortAnswersFromEntries\` → A5 merge → \`expandPiesa\` with the owner's secure-link confirmation → \`evaluatePiesa\` → Word form fill / PDF), skipping only the approval check. Nothing was stored or sent. Names, numbers and addresses are made up.`,
    "",
    `Form: ${T.title} (${T.publication}), original \`${T.originalFile}\`, SHA-256 \`${T.sha256}\`.`,
    "",
    "For each case:",
    "",
    "- `*.docx` — the official DEECA Word form filled by the portal (what the office downloads). `*-word.pdf` + `*-word-N.png` — that Word file printed by LibreOffice, so you can look at it without Word.",
    "- `*.pdf` + `*-pdf-N.png` — the PDF the portal attaches to the electrician's email / /field download (decision 317): the same answers as plain text in the form's order.",
    "",
  );
  out.push(
    "## Problems these samples show (checked against branch installer-mitti-workflow @ e41d5081, 25 Oct 2026)",
    "",
    "Do not approve the mapping until these are fixed or accepted. The per-case read-back below re-checks the Word form on every run.",
    "",
    "**Wrong answers (mapping):**",
    "",
    '1. Two or more ticks in one A4 tick-list are lost. Mitti joins a multi-select with ", " (`mitti.core`), but `expandPiesa` splits only on " | ". Case 2 ticked two mains problems (RCDs missing + RCDs not tested): the official form says **Yes** to both RCD questions. The same applies to the solar and ceiling problem lists. B2 repair ticks become one combined entry (case 2), so no B2 box can match. A single tick works.',
    '2. The owner\'s ONE secure-link tick ("The assessment was completed on <date>") fills all four official owner declarations, including "any electrical rectification works were completed on the above date". That is ticked in case 1 (no works) and in case 2, where the owner confirmed on 28 Oct, before the fixes on 3 Nov. The regenerated form keeps that earlier confirmation. `o.date` is the date the owner confirmed, not the assessment date.',
    '3. `p7.appliances` and `p7.flues` both come from one A4 question, so they always get the same answer. `p7.location` repeats the "What is it and where is it?" text. `p7.hazard` and `p7.actions` are fixed wording. `p7.otherHazard`/`p7.otherAction` (other hazards, e.g. rotten joist) are never asked on A4, so they are always blank. `p4.tps` can never be N/A.',
    '4. Case 3 ("Be on site at the start of the install day" only): B1 = "not possible … under parts 2 and 3". The B2 tick and the electrician\'s "Other" description (what he will do on the day) are not on the official form. A4 still requires a B2 tick even when the only job is being on site.',
    '5. Signatures: `c.signature` and `o.signature` are never written (by design, they live in the signed record). `evaluatePiesa` therefore reports `REQ:o.signature` (and `REQ:c.signature` after fixes) on EVERY PIESA. The Mitti sync shows this as an "Official form: Required: \\"Signature\\"." review issue on every job. The Word form\'s signature boxes print blank.',
    "",
    "**Word form filler (`official-docx.core.ts`), whatever the answers:**",
    "",
    '6. A "No" answer never ticks a box. In the form, the No box is followed by a space run before the word "No", and the filler only looks at the first run. Every No on the official Word form prints as unanswered (see each case\'s read-back).',
    "7. B1 (the assessment outcome) and B2 boxes are never ticked: a tab run sits between the box and the option text. The Word form never shows the outcome.",
    '8. Main switch: the form has no box for "Is the main switch for the premises:". That answer and the three sub-items all land on the first sub-row, so "able to isolate…" and "able to be secured…" print blank.',
    "9. Part 7 table: Appliance, Location and Hazard all write into the first cell. The Appliance column shows the hazard wording, and Location/Hazard stay blank (case 1).",
    '10. The Section C declaration box carries `w:checked="0"` in the original form. The filler only changes `w:default`, so `c.tick7` never shows as ticked (case 2).',
    "11. Each tick mark is written as a run inside another run (`<w:r><w:r>…`). That is not valid Word XML: LibreOffice opens it, but Word may say the file has unreadable content. These samples were not opened in Word here.",
    "",
    "**Smaller:**",
    "",
    '12. The plain-text PDF swaps every non-ASCII character for "-" ("don-t", "owner-s", "If -Yes-"). It also doubles colons ("Licence no::") and prints every empty table row (10 appliance rows × 3, 14 other-hazard rows × 2) as "-" lines.',
    '13. The published A4 template (`tests/fixtures/mitti-piesa/a4-published-2026-10-25.json`) does not have the decision 305/308/312 questions yet, and it still asks the retired "Can the repair work be done before installation?". On the live form today, case 3\'s "Be on site at the start of the install day" tick cannot be answered.',
    "",
  );
  out.push(
    "## Every official question: where it comes from, and what each case got",
    "",
    `| Official item | Comes from | ${results.map(({ c }) => `Case ${c.n}`).join(" | ")} |`,
    `|---|---|${results.map(() => "---").join("|")}|`,
  );
  const val = (a: OfficialAnswers, id: string, rows?: number) =>
    rows
      ? Array.from({ length: rows }, (_, i) => show(a[`${id}#${i}`]))
          .filter(Boolean)
          .join(" / ")
      : show(a[id]);
  for (const it of answerItems("piesa")) {
    const label = `\`${it.id}\` ${it.label.slice(0, 80)}${it.label.length > 80 ? "…" : ""}`;
    out.push(
      `| ${cell(label)} | ${cell(SOURCE[it.id] ?? "?")} | ${results.map(({ r }) => cell(val(r.expanded.answers, it.id, it.row?.rows)) || "_blank_").join(" | ")} |`,
    );
  }
  out.push("");
  for (const { c, r, docx, pdfPngs, docxPngs } of results) {
    out.push(
      `## Case ${c.n} — ${c.title}`,
      "",
      `Job ${c.jobNumber}, ${c.address}. Inspection ${c.inspectionDate}. Owner ${c.owner} confirmed on the secure link (${c.ownerSignedAt}).${c.fixes ? ` A5 fixes form completed ${c.fixes.completedOn}, CoES ${c.fixes.read.coesNumber}.` : ""}`,
      "",
      `Files: \`${c.slug}.docx\`, \`${c.slug}-word.pdf\` (${docxPngs.length} pages: ${docxPngs.map((p) => `\`${p}\``).join(", ") || "not rendered"}), \`${c.slug}.pdf\` (${pdfPngs.length} pages: ${pdfPngs.map((p) => `\`${p}\``).join(", ") || "not rendered"}).`,
      "",
      "A4 answers given:",
      "",
    );
    for (const x of c.a4)
      out.push(`- ${cell(x.label.split("\n")[0]!)} → **${cell(x.value ?? "")}**`);
    if (c.fixes)
      out.push(
        "",
        "A5 fixes form: completed Yes, CoES number, date of certification, CoES file, geotagged work photo, signature — merged with `mergeFixesIntoPiesaSnapshot`.",
      );
    out.push(
      "",
      `Word form: the filler reports ${docx.filled.length} items placed; not placed: ${docx.missed.length ? docx.missed.map((m) => `\`${m}\``).join(", ") : "none"}. Read back from the filled Word file:`,
      "",
    );
    for (const l of wordAudit(docx.xml, r.expanded.answers)) out.push(`- ${l}`);
    out.push(
      "",
      `Flagged by the expansion (\`expanded.flagged\`): ${r.expanded.flagged.length ? "" : "none"}`,
    );
    for (const f of r.expanded.flagged) out.push(`- ${f}`);
    out.push(
      "",
      `Printed-rule blockers (\`evaluatePiesa\`): ${r.ev.blockers.length ? "" : "none"}`,
    );
    for (const b of r.ev.blockers) out.push(`- \`${b.rule}\` ${b.message}`);
    if (r.ev.nextActions.length) {
      out.push("", "Next actions:");
      for (const b of r.ev.nextActions) out.push(`- \`${b.rule}\` ${b.message}`);
    }
    if (r.initial && r.initialEv) {
      out.push("", "Before the A5 fixes form (the PIESA as first synced) — flags:");
      for (const f of r.initial.flagged) out.push(`- ${f}`);
      out.push("", "…and blockers:");
      for (const b of r.initialEv.blockers) out.push(`- \`${b.rule}\` ${b.message}`);
    }
    out.push("");
  }
  writeFileSync(`${OUT}README.md`, `${out.join("\n")}\n`);
  for (const { c, r, docx } of results)
    console.log(
      `case ${c.n}: placed ${docx.filled.length}, missed [${docx.missed.join(", ")}], flagged ${r.expanded.flagged.length}, blockers ${r.ev.blockers.map((b) => b.rule).join(", ") || "none"}`,
    );
  console.log(`written to ${OUT}`);
}

if (import.meta.main) await main();
