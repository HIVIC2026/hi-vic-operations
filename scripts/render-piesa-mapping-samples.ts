// Renders SAMPLE official DEECA PIESAs (mapping piesa-map-2.0.0, NOT approved) for Jo to approve by looking at them.
// Three example jobs, answered on the current A4 Mitti short form (SHORT_PIESA_FIELDS labels), go through the SAME pure
// steps the portal uses — shortAnswersFromEntries → (A5 fixes merge, mergeFixesIntoPiesaSnapshot) → expandPiesa with the
// owner's secure-link confirmation → evaluatePiesa → buildSignedSnapshot → fillOfficialDocxXml (the Word form) and
// officialPiesaPdfText + textToPdf (the PDF the electrician gets). The approval check (officialFormUseBlocker) is NOT called
// and OFFICIAL_TEMPLATES.piesa.approved is never changed: nothing here is stored, signed or sent. No database, no network.
// Decision 336: the electrician's signature is a sample signature PICTURE (scripts/sample-signature-png.ts) embedded the way the
// portal embeds the real Mitti image (fillOfficialDocxParts / textToPdf), and the A4 hazard rows use the decision-336 block.
// Decision 338: case 3 answers the new "Does an electrician need to be on site at the start of the install?" question.
// Output: docs/templates/compliance/piesa-mapping/ (case-N.docx, case-N.pdf, case-N-docx.pdf, PNG pages, README.md).
// PNGs need LibreOffice (Word → PDF) and pdftoppm; without them the .docx/.pdf are still written and the README says so.
// Run: bun scripts/render-piesa-mapping-samples.ts
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { unzipSync, zipSync } from "fflate";
import piesaDocx from "../src/lib/official-docx-piesa.data";
import { fillOfficialDocxParts, readOfficialDocx, xmlProblems, type SignatureInput, type SignatureSlot } from "../src/lib/official-docx.core";
import { sampleSignaturePng } from "./sample-signature-png";
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
  APPLIANCE_PRESENT_LABEL,
  APPLIANCE_Q,
  ONSITE_START_LABEL,
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
  buildPiesaFixesConfirmation,
  fixesConfirmationFromEvents,
  ownerFixesConfirmationForForm,
} from "../src/lib/piesa-fixes-confirm.core";
import {
  officialPiesaPdfHeader,
  officialPiesaPdfText,
  type PdfSignatureMarks,
} from "../src/lib/electrician-piesa-copy.core";
import { textToPdf } from "../src/lib/signed-pdf.server";

const OUT = new URL("../docs/templates/compliance/piesa-mapping/", import.meta.url).pathname;
const T = OFFICIAL_TEMPLATES.piesa;

// ---------- A4 answers by the current short-form label ----------
const L = (id: string) => {
  const f = SHORT_PIESA_FIELDS.find((x) => x.id === id);
  return f?.label ?? null; // retired questions (decisions 323/324) are simply not on the current form
};
type Entry = { label: string; value: string | null };
const e = (id: string, value: string): Entry => ({ label: L(id) ?? `__retired__${id}`, value });

const ELECTRICIAN = [
  e("b3.licence", "A 54321"),
  e("b3.name", "Sam Spark"),
  e("b3.recName", "Spark Electrical Pty Ltd"),
  e("b3.recNo", "REC 23456"),
  e("b3.phone", "0400 111 222"),
  e("b3.declaration", "Yes"),
  e("electricianSignature", "signature captured in Mitti"),
];
/** Decision 336: the sample signature pictures (made up — never a real signature). */
const A4_SIGNATURE_PNG = sampleSignaturePng("Sam Spark A4");
const A5_SIGNATURE_PNG = sampleSignaturePng("Sam Spark A5 fixes");
const hazardRow = (type: string, what: string, where: string, safe: "Yes" | "No", problem?: string, action?: string): Entry[] => [
  { label: APPLIANCE_Q.type, value: type },
  { label: APPLIANCE_Q.what, value: what },
  { label: APPLIANCE_Q.where, value: where },
  { label: APPLIANCE_Q.photo, value: "1 photo" },
  { label: APPLIANCE_Q.safe, value: safe },
  ...(problem ? [{ label: APPLIANCE_Q.problem, value: problem }] : []),
  ...(action ? [{ label: APPLIANCE_Q.action, value: action }] : []),
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
  fixes?: { read: FixesDayRead; completedOn: string; ownerConfirmedAt: string };
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
      ...hazardRow("Exhaust fan", "Bathroom exhaust fan", "Ceiling above the main bathroom", "Yes"),
      e("rectificationNeeded", "No"),
      ...ELECTRICIAN,
    ],
  },
  {
    n: 2,
    slug: "case-2-life-support-fixes",
    title:
      "Life support (medical plan) + solar + 4 non-IC downlights + a flue and a rotten joist; repairs needed, then done on the A5 fixes form with a CoES",
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
      // Decision 336: one Flue and one Other hazard row.
      e("appliancesPresent", "Yes"),
      ...hazardRow("Flue", "Gas heater flue", "Ceiling above the lounge", "No", "The flue has no guard — insulation would touch the hot flue", "Fit a flue guard keeping insulation 50 mm clear before insulation goes in"),
      ...hazardRow("Other hazard", "Rotten ceiling joist", "Hallway, next to the manhole", "No", "The joist is soft and cracked and won't take a person's weight", "Builder to replace the joist before insulation goes in"),
      e("rectificationNeeded", "Yes"),
      e("rectificationWork", `${B2_OPTIONS[0]}, ${B2_OPTIONS[2]}`),
      e("fixesPriceIncGst", "1180"),
      e("fixesWork", `${FIXES_DOWNLIGHT_OPTION}, ${FIXES_RCD_OPTION}`),
      e("fixesDownlightCount", "4"),
      e("fixesRcdCount", "1"),
      e("onsiteStartNeeded", "No"),
      ...ELECTRICIAN,
    ],
    fixes: {
      completedOn: "2026-11-03",
      // Decision 330: the owner confirms the fixes on the secure link the next evening.
      ownerConfirmedAt: "2026-11-04T18:30:00+11:00",
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
      'Repair needed where the only work is "Does an electrician need to be on site at the start of the install?" = Yes (decision 338; electrician present at installation)',
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
      // Decision 338: the on-site attendance is its own question now (the tick list stays empty).
      e("onsiteStartNeeded", "Yes"),
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
  "p2.switch": `Derived: No if any of the three main-switch sub-items is No (the Word form has NO box for this line — kept in the signed record and the PDF, not written on the Word form)`,
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
  "p7.appliances": `A4 "${APPLIANCE_PRESENT_LABEL}" + a row with "${APPLIANCE_Q.type}" = Appliance (decision 336)`,
  "p7.flues": `A4 "${APPLIANCE_PRESENT_LABEL}" + a row with "${APPLIANCE_Q.type}" = Flue or Exhaust fan (the official question names "exhaust fans or heating flues")`,
  "p7.appliance": `A4 "${APPLIANCE_Q.what}" (one row per Appliance / Exhaust fan / Flue item)`,
  "p7.location": `A4 "${APPLIANCE_Q.where}"`,
  "p7.hazard": `A4 "${APPLIANCE_Q.problem}" (only when "${APPLIANCE_Q.safe}" = No), else "None — safe to insulate around"`,
  "p7.actions": `A4 "${APPLIANCE_Q.action}" for each unsafe item ("None required" when all are safe)`,
  "p7.effective": `Derived: Yes when every item is safe as it is, or once repairs are recorded complete`,
  "p7.otherHazard": `A4 Other hazard rows: "${APPLIANCE_Q.what}" (${APPLIANCE_Q.where}): "${APPLIANCE_Q.problem}"`,
  "p7.otherAction": `A4 Other hazard rows: "${APPLIANCE_Q.action}" ("None required" when safe as it is)`,
  b1: `A4 ${q("rectificationNeeded")} + "${ONSITE_START_LABEL}" (decision 338; old forms: the "${FIXES_ONSITE_OPTION}" tick, decision 314)`,
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
  "c.signature": `Decision 336: the A5 "Electrician signature" IMAGE in the box with "Signed in Mitti on DD/MM/YYYY" under it (no image on file → the typed "Name (signed electronically on DD/MM/YYYY)" + flag "Electrician signature image not available")`,
  "c.completionDate": `"today" of the regeneration = A5 "Date of certification"`,
  "c.coes": `A5 "Certificate of Electrical Safety number"`,
  "c.certDate": `A5 "Date of certification"`,
  "o.signature": `Typed electronic signature: the owner's typed name on the latest secure-link confirmation + that date`,
  "o.name": `Latest owner secure-link confirmation (safety check, or the electrical fixes — decision 330): typed full name`,
  "o.date": `Latest owner secure-link confirmation: Melbourne date they confirmed`,
};
for (let i = 1; i <= 7; i++)
  SOURCE[`c.tick${i}`] =
    `A5 "Have you completed all of the repair work listed…" = Yes (all seven ticked together)`;
for (const i of [1, 2, 4])
  SOURCE[`o.tick${i}`] =
    `Owner's secure-link confirmation of the safety check (ONE tick "The assessment was completed on <date>")`;
SOURCE["o.tick3"] =
  `Ticked only when no repair work was needed before installation, when the owner confirmed on/after the fixes were certified, or from the owner's post-fix confirmation (decision 330); otherwise blank + flagged "Owner hasn't confirmed the electrical fixes"`;

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

function ownerFixesConfirmation(c: Case) {
  if (!c.fixes) return null;
  const facts = {
    recordId: `sample-post-rectification-${c.n}`,
    fixesDate: c.fixes.completedOn,
    completedAt: `${c.fixes.completedOn}T12:00:00+11:00`,
    electrician: { name: "Sam Spark", recName: "Spark Electrical Pty Ltd" },
    confirmation: null,
  };
  const details = buildPiesaFixesConfirmation({ facts, name: c.owner, authority: "owner", signedAt: c.fixes.ownerConfirmedAt, ipHash: null, uaHash: null });
  return ownerFixesConfirmationForForm(fixesConfirmationFromEvents([{ details }], facts.recordId));
}

function run(c: Case) {
  let snapshot: SnapshotEntry[] = c.a4.filter((x) => !x.label.startsWith("__retired__")).map((x) => ({ ...x }));
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
  // The regenerated PIESA right after the A5 form (the owner has not confirmed the fixes yet) …
  const beforeOwnerFixes = c.fixes ? expandPiesa(short, { lifeSupportDeclared: null, today, ownerConfirmation: owner }) : null;
  // … and once the owner has confirmed them on the secure link (decision 330).
  const expanded = expandPiesa(short, {
    lifeSupportDeclared: null,
    today,
    ownerConfirmation: owner,
    ownerFixesConfirmation: ownerFixesConfirmation(c),
  });
  const ev = evaluatePiesa(expanded.answers);
  const initialEv = c.fixes ? evaluatePiesa(initial.answers) : null;
  return { short, expanded, ev, initial: c.fixes ? initial : null, initialEv, beforeOwnerFixes, today };
}

const DATA_PREFIX =
  "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,";
function fillDocx(answers: OfficialAnswers, signatures: Partial<Record<SignatureSlot, SignatureInput>>) {
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
  // Decision 336: the same package filler the portal uses (signature pictures + relationships + content types).
  const r = fillOfficialDocxParts(parts, "piesa", answers, signatures);
  return {
    bytes: zipSync(r.parts, { level: 0 }),
    filled: r.filled,
    missed: r.missed,
    xml: r.xml,
    original: new TextDecoder().decode(doc),
    parts: r.parts,
    embedded: r.embedded,
    notEmbedded: r.notEmbedded,
    rels: r.rels,
    types: r.types,
  };
}

// ---------- what the filled Word form actually SHOWS (read back from the XML, not from the filler's own report) ----------
const nrm = (x: string) =>
  x
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .trim();
const same = (want: unknown, got: unknown) => {
  const w = want === true ? true : Array.isArray(want) ? want.map(String).sort().join("|") : want == null || want === "" ? null : String(want);
  const g = got === false ? null : got === true ? true : Array.isArray(got) ? got.map(String).sort().join("|") : got == null || got === "" ? null : String(got);
  if (typeof w === "string" && typeof g === "string") return nrm(w) === nrm(g) || /^\d{4}-\d{2}-\d{2}$/.test(w) && g === `${w.slice(8)}/${w.slice(5, 7)}/${w.slice(0, 4)}`;
  return w === g;
};
function wordAudit(xml: string, a: OfficialAnswers, original: string): { lines: string[]; mismatches: string[] } {
  const shown = readOfficialDocx(xml, "piesa", original);
  const items = answerItems("piesa");
  const count = (pred: (k: string, v: unknown) => boolean) => Object.entries(shown).filter(([k, v]) => pred(k, v)).length;
  const kindOf = (id: string) => items.find((i) => i.id === id.split("#")[0])?.kind;
  const mismatches: string[] = [];
  for (const id of Object.keys(shown)) if (!same(a[id], shown[id]) && !(id === "c.signature" && /^Signed in Mitti on \d{2}\/\d{2}\/\d{4}$/.test(String(shown[id] ?? "")))) mismatches.push(`\`${id}\`: answer ${JSON.stringify(a[id] ?? null)}, Word form shows ${JSON.stringify(shown[id] ?? null)}`);
  for (const id of Object.keys(a)) if (!(id in shown) && a[id] != null && a[id] !== "" && id !== "p2.switch" && id !== "lifeSupportAttachment") mismatches.push(`\`${id}\`: answered but has no place on the Word form`);
  const yn = (v: string) => `${items.filter((i) => (i.kind === "yesno" || i.kind === "yesno_na") && i.id !== "p2.switch" && a[i.id] === v).length} answered ${v} — Word form shows ${count((k, x) => (kindOf(k) === "yesno" || kindOf(k) === "yesno_na") && x === v)} ticked "${v}" boxes`;
  const lines = [
    `Yes/No: ${yn("Yes")}; ${yn("No")}.`,
    `B1 outcome: ${show(a["b1"]) ? "answered" : "not answered"} — Word form shows ${shown["b1"] ? `"${String(shown["b1"]).slice(0, 60)}…"` : "no B1 box ticked"}.`,
    `B2 repair items: ${Array.isArray(a["b2"]) ? a["b2"].length : 0} answered — Word form shows ${Array.isArray(shown["b2"]) ? shown["b2"].length : 0} B2 boxes ticked.`,
    `Declaration ticks: ${items.filter((i) => i.kind === "tick" && a[i.id] === true).length} answered — Word form shows ${count((k, x) => kindOf(k) === "tick" && x === true)} ticked.`,
    `Signatures: Part B3 ${/r:embed="rIdHivSignature1"/.test(xml) ? "electrician's signature PICTURE (from A4) + \"Signed in Mitti on …\"" : "no picture"}; Section C ${shown["c.signature"] ? `"${shown["c.signature"]}"` : "blank"}${(xml.match(/r:embed="rIdHivSignature\d+"/g) ?? []).length > 1 ? " under the A5 signature PICTURE" : ""}; owner ${shown["o.signature"] ? `"${shown["o.signature"]}"` : "blank"} (typed — owners sign on the secure link).`,
    `Part 7 other hazards on the Word form: ${Array.from({ length: 14 }, (_, r) => r).filter((r) => shown[`p7.otherHazard#${r}`]).map((r) => `"${shown[`p7.otherHazard#${r}`]}" → "${shown[`p7.otherAction#${r}`] ?? ""}"`).join("; ") || "none"}; actions line: ${shown["p7.actions"] ? `"${shown["p7.actions"]}"` : "blank"}.`,
    `Part 7 rows on the Word form: ${Array.from({ length: 10 }, (_, r) => r).filter((r) => shown[`p7.appliance#${r}`]).map((r) => `Appliance "${shown[`p7.appliance#${r}`]}" / Location "${shown[`p7.location#${r}`] ?? ""}" / Hazard "${shown[`p7.hazard#${r}`] ?? ""}"`).join("; ") || "none"}.`,
  ];
  const problems = xmlProblems(xml);
  lines.push(problems.length ? `Word XML problems: ${problems.join("; ")}` : "Word XML: well-formed (tags balanced, no run nested in a run" + (has("xmllint") ? ", `xmllint` clean" : "") + ").");
  return { lines, mismatches };
}
function xmllintOk(xml: string): boolean {
  if (!has("xmllint")) return true;
  const f = `${OUT}.check.xml`;
  writeFileSync(f, xml);
  try { execFileSync("xmllint", ["--noout", f], { stdio: "ignore" }); return true; } catch { return false; } finally { rmSync(f, { force: true }); }
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
    // Decision 336: the A4 signature picture in Part B3; the A5 one in Section C once the fixes form is signed.
    const signatures: Partial<Record<SignatureSlot, SignatureInput>> = {
      "b3.signature": { images: [{ bytes: A4_SIGNATURE_PNG, contentType: "image/png", signedOn: c.inspectionDate }], fallbackText: null },
      ...(c.fixes && r.expanded.answers["c.signature"] ? { "c.signature": { images: [{ bytes: A5_SIGNATURE_PNG, contentType: "image/png", signedOn: c.fixes.completedOn }] } } : {}),
    };
    const docx = fillDocx(r.expanded.answers, signatures);
    if (docx.embedded.length !== Object.keys(signatures).length) throw new Error(`Case ${c.n}: not every signature picture was embedded.`);
    for (const e of docx.embedded) if (!docx.xml.includes(`r:embed="${e.rId}"`) || !docx.rels.includes(`Id="${e.rId}"`) || !(e.part in docx.parts)) throw new Error(`Case ${c.n}: signature picture ${e.rId} is not wired up.`);
    if (xmlProblems(docx.xml).length || !xmllintOk(docx.xml)) throw new Error(`Case ${c.n}: the filled Word XML is not well-formed.`);
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
    const marks: PdfSignatureMarks = { "b3.signature": { signedOn: c.inspectionDate }, ...(signatures["c.signature"] ? { "c.signature": { signedOn: c.fixes!.completedOn } } : {}) };
    writeFileSync(
      `${OUT}${c.slug}.pdf`,
      await textToPdf(
        `${officialPiesaPdfHeader(c.jobNumber)} (SAMPLE - mapping not approved)`,
        officialPiesaPdfText(snap, marks),
        { "b3.signature": { bytes: A4_SIGNATURE_PNG, contentType: "image/png" }, "c.signature": { bytes: A5_SIGNATURE_PNG, contentType: "image/png" } },
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
    `SAMPLES ONLY. The mapping is **not approved** (\`OFFICIAL_TEMPLATES.piesa.approved = false\`), so the portal produces no official PIESA yet. These files were made by \`bun scripts/render-piesa-mapping-samples.ts\` with the portal's own pure steps (A4 answers → \`shortAnswersFromEntries\` → A5 merge → \`expandPiesa\` with the owner's secure-link confirmations (safety check, decision 296; electrical fixes, decision 330) → \`evaluatePiesa\` → Word form fill / PDF), skipping only the approval check. Nothing was stored or sent. Names, numbers and addresses are made up.`,
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
    "## What decision 329 fixed (wrong on f001aeba, 25 Oct 2026; re-checked against the Word file on every run)",
    "",
    "Each case below reads the filled Word file back (`readOfficialDocx`) and compares EVERY box and text field with the answers; the run stops if the Word XML is not well-formed. Before → after:",
    "",
    '1. **Multi-select ticks.** Before: Mitti joins ticks with ", " but `expandPiesa` split on " | ", so two ticks were lost (case 2: both RCD questions said **Yes**) and B2 became one combined entry no box matched. After: ticks are matched against the known option wording, longest first (`splitSelections`, official-forms.core) — never comma-split, because the option labels contain commas; an unknown piece is flagged, never guessed. Case 2: RCDs present **No**, RCDs tested **No**, two B2 boxes ticked. Same for the solar, ceiling and B2 lists.',
    '2. **Owner declarations.** Before: the ONE secure-link tick filled all four owner declarations, including "any electrical rectification works were completed on the above date" before the fixes were done. After: the P6 tick fills declarations 1, 2 and 4; declaration 3 is ticked only when no repair work was needed before installation, when the owner confirmed on/after the fixes were certified, or from the owner\'s post-fix confirmation (decision 330: one tick "The electrical fixes were completed on <date>" + typed name on the same secure link, asked when the A5 form is complete). Without it, declaration 3 stays blank and the expansion flags "Owner hasn\'t confirmed the electrical fixes" (nothing else is held). `o.name` / `o.date` = the latest owner confirmation used.',
    '3. **Signatures.** Before: `c.signature` / `o.signature` were never written, so `evaluatePiesa` reported `REQ:o.signature` (and `REQ:c.signature`) on every PIESA. After: the typed electronic signature "Name (signed electronically on DD/MM/YYYY)" — the A5 signer + the A5 signature date for Section C, the owner\'s typed name + confirmation date for the owner block. Neither REQ appears any more.',
    '4. **"No" boxes.** Before: a space run sits between the No box and the word "No"; the filler read only the first run, so no "No" was ever ticked. After: each box\'s own following text is read across space/tab runs.',
    "5. **B1 / B2 / declaration boxes.** Before: a tab run between the box and its wording — never ticked. After: ticked (see each case).",
    '6. **Main switch.** Before: "Is the main switch for the premises:" has no box on the Word form, so it and its three sub-items all landed on the first sub-row. After: each item claims its own Yes/No pair; the overall main-switch line is derived and stays in the signed record / PDF only (the Word form has nothing to tick).',
    "7. **Part 7 table.** Before: Appliance, Location and Hazard all wrote into the first cell. After: rows × columns in order — each in its own cell (case 1).",
    '8. **Section C declaration.** Before: the original box carries `w:checked="0"`, the filler only changed `w:default`, so `c.tick7` never showed. After: every box is set through both `w:default` and `w:checked`.',
    "9. **Invalid Word XML.** Before: each tick was a run inside another run (`<w:r><w:r>`). After: no glyph run is inserted at all (the box state carries the tick); the filled XML is checked for balanced tags / no nested runs (and `xmllint` where installed).",
    '10. **Plain-text PDF.** Before: every non-ASCII character became "-" ("don-t"), colons doubled ("Licence no::"), and every empty table row printed. After: characters the PDF font can draw are kept (’ “ ” – — • ²), others map to the closest plain text (✓ → [x]); no second colon; empty table rows are skipped and answered rows carry their row number.',
    "",
    "The same Word filler fills the approved PIISA: it had the same No / tick / nested-run faults. See `docs/templates/compliance/piisa-filler/` for one realistic install filled through the fixed filler.",
    "",
  );
  out.push(
    "## Decisions 336 and 338 (Jo 25 Oct 2026)",
    "",
    '1. **"WHERE IS THE ELECTRICIAN\'S SIGNATURE?"** The Word form now shows the electrician\'s ACTUAL signature picture captured in Mitti: the A4 "Electrician signature" straight after the Part B3 declaration (the official form prints no B3 signature box, so it sits in its own line there), and the A5 "Electrician signature" in the Section C "Signature" box — each with "Signed in Mitti on DD/MM/YYYY" under it. The picture is a real inline image (its own media part, an image relationship and the content type; the XML is checked well-formed). The PDF draws the same pictures. The samples use a made-up signature picture (`scripts/sample-signature-png.ts`). Owner blocks stay typed e-signatures (secure link). No image on file → the typed name and the office flag "Electrician signature image not available".',
    '2. **Exact hazard rows.** The A4 block asks "What type is it?" (Appliance / Exhaust fan / Flue / Other hazard), "What is it?", "Where is it?", the photo, "Can insulation be safely installed around it as it is?", and when No "What is the problem?" + "What needs to be done to make it safe?". Part 7 is filled row by row from those answers (case 1: an exhaust fan; case 2: a flue and a rotten joist as an "other hazard"). Older forms keep the old standard wording.',
    '3. **On site at the start (decision 338).** "Be on site at the start of the install day" left the tick list and is its own Yes/No question, "Does an electrician need to be on site at the start of the install?" (case 3 = Yes, nothing ticked). Old forms with the tick read the same way.',
    "",
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
    for (const x of c.a4.filter((y) => !y.label.startsWith("__retired__")))
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
    const audit = wordAudit(docx.xml, r.expanded.answers, docx.original);
    for (const l of audit.lines) out.push(`- ${l}`);
    out.push("", audit.mismatches.length ? "Word form vs answers — DIFFERENCES:" : "Word form vs answers: every box and text field matches the answers.");
    for (const m of audit.mismatches) out.push(`- ${m}`);
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
    if (r.beforeOwnerFixes) {
      out.push("", `Right after the A5 form, before the owner confirms the fixes (decision 330) — flags:`);
      for (const f of r.beforeOwnerFixes.flagged) out.push(`- ${f}`);
      out.push(`- (owner declaration 3 then: ${r.beforeOwnerFixes.answers["o.tick3"] === true ? "ticked" : "blank"}; o.date ${show(r.beforeOwnerFixes.answers["o.date"]) || "blank"})`);
    }
    if (r.initial && r.initialEv) {
      out.push("", "Before the A5 fixes form (the PIESA as first synced) — flags:");
      for (const f of r.initial.flagged) out.push(`- ${f}`);
      out.push("", "…and blockers:");
      for (const b of r.initialEv.blockers) out.push(`- \`${b.rule}\` ${b.message}`);
    }
    out.push("");
  }
  out.push(
    "## Still can't be filled from A4",
    "",
    "These official items have no matching A4 question, so the portal cannot fill them truthfully. Proposal for each (Jo to decide; nothing changed):",
    "",
    '- `p4.tps` N/A — A4 can only say Yes/No. Proposal: add "There are no TPS cables in the ceiling" as a choice so N/A can be ticked.',
    '- B1 third outcome (case 3) — "Does an electrician need to be on site at the start of the install?" = Yes (decision 338) gives B1 "not possible … under parts 2 and 3"; B2 is only for rectification required, so nothing is printed in B2. Proposal: accept (the attendance is recorded and lined up automatically, decision 327).',
    '- `p2.switch` — the Word form prints no box; the derived answer lives only in the signed record and the PDF. Proposal: accept (the form\'s own note says the overall answer follows the sub-items).',
    '- `lifeSupportAttachment` — the consent / medical plan photo is kept as a job file, not printed on the Word form. Proposal: accept; attach the photo with the PIESA copy.',
    '- The published A4 template (`tests/fixtures/mitti-piesa/a4-published-2026-10-25.json`) still lacks the decision 305/308/312/323 questions, the decision 336 hazard-row questions and the decision 338 on-site question, and asks the retired "Can the repair work be done before installation?". Proposal: republish A4 from the current prompt before approving the mapping.',
    "",
  );
  writeFileSync(`${OUT}README.md`, `${out.join("\n")}\n`);
  for (const { c, r, docx } of results)
    console.log(
      `case ${c.n}: placed ${docx.filled.length}, missed [${docx.missed.join(", ")}], flagged ${r.expanded.flagged.length}, blockers ${r.ev.blockers.map((b) => b.rule).join(", ") || "none"}`,
    );
  console.log(`written to ${OUT}`);
}

if (import.meta.main) await main();
