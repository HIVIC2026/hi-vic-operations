// Decision 329: proves the fixed Word filler on the APPROVED PIISA (piisa-map-2.0.0) — one realistic install, answers keyed
// exactly as the live A3 path hands them to renderOfficialDocx (piisa-declaration.server: parseA3Answers + crew + products +
// p8.date + the typed electronic signature). Fills the bundled official Word form through fillOfficialDocxXml, checks the
// XML is well-formed, reads every box / text field back and renders PNGs with LibreOffice + pdftoppm when installed.
// SAMPLE ONLY: no database, no network, nothing stored or sent; names and numbers are made up.
// Output: docs/templates/samples/piisa-filler/ (piisa-sample.docx, piisa-sample-word.pdf, PNG pages, README.md).
// Run: bun scripts/render-piisa-filler-sample.ts
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { unzipSync, zipSync } from "fflate";
import piisaDocx from "../src/lib/official-docx-piisa.data";
import { fillOfficialDocxXml, readOfficialDocx, xmlProblems } from "../src/lib/official-docx.core";
import { OFFICIAL_TEMPLATES, answerItems, electronicSignature, evaluatePiisa, type OfficialAnswers } from "../src/lib/official-forms.core";

const OUT = new URL("../docs/templates/samples/piisa-filler/", import.meta.url).pathname;
const T = OFFICIAL_TEMPLATES.piisa;

/** One install: Cranbourne, existing batts topped up, solar on the roof, one additional crew member. */
export const PIISA_SAMPLE: OfficialAnswers = {
  jobRef: "HV-SAMPLE-4",
  address: "9 Grevillea Way, Cranbourne VIC 3977",
  startDate: "2026-11-12",
  completionDate: "2026-11-12",
  "p1.powerInformed": "Yes",
  lifeSupport: "No",
  "p2.installDate": "2026-11-12",
  "p2.ap": "Home Insulation Victoria",
  "p2.company": "Bayside Insulation Pty Ltd",
  "p2.lead": "Daniel Moore",
  "p2.leadEec": "EEC-104552",
  "p2.addName#0": "Ruby Tran",
  "p2.addEec#0": "EEC-118870",
  "p3.swms": "Yes",
  "p3.table1": "Yes",
  "p3.isolated": "Yes",
  "p4.present": "Yes",
  "p4.instructions": "Yes",
  "p4.isolator": "Yes",
  "p5.reviewed": "Yes",
  "p5.electricianPresent": "N/A",
  "p5.recessed": "Yes",
  "p5.count": "6",
  "p5.icConfirmed": "Yes",
  "p5.safeToCover": "Yes",
  "p5.rcd": "Yes",
  "p5.tps": "Yes",
  "p5.basic": "Yes",
  "p5.noAccess": "Yes",
  "p6.present": "Yes",
  "p6.height": "60",
  "p6.rValue": "1.5",
  "p6.treatment": ["Topped Up"],
  "p6.suitable": "Yes",
  "p6.reason": "Existing glasswool batts are dry, evenly laid and not foil-backed; topped up to reach the required R-value.",
  "p7.products": "Bradford Gold Hi-Performance Ceiling Batts R5.0 (BCB50) — 118 m²",
  "p8.declaration": true,
  "p8.name": "Daniel Moore",
  "p8.date": "2026-11-12",
  "p8.signature": electronicSignature("Daniel Moore", "2026-11-12"),
};

const has = (cmd: string) => { try { execFileSync("which", [cmd], { stdio: "ignore" }); return true; } catch { return false; } };
const same = (want: unknown, got: unknown) => {
  const norm = (v: unknown) => (v === true ? "true" : v == null || v === "" || v === false ? "" : Array.isArray(v) ? v.map(String).sort().join("|") : String(v).trim());
  const w = norm(want), g = norm(got);
  return w === g || (/^\d{4}-\d{2}-\d{2}$/.test(w) && g === `${w.slice(8)}/${w.slice(5, 7)}/${w.slice(0, 4)}`);
};

async function main() {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const bytes = new Uint8Array(Buffer.from(piisaDocx.replace(/^data:[^,]*,/, ""), "base64"));
  if (createHash("sha256").update(bytes).digest("hex") !== T.sha256) throw new Error("Bundled PIISA Word form does not match the recorded official original.");
  const parts = unzipSync(bytes);
  const original = new TextDecoder().decode(parts["word/document.xml"]!);
  const { xml, filled, missed, notOnForm } = fillOfficialDocxXml(original, "piisa", PIISA_SAMPLE);
  const problems = xmlProblems(xml);
  if (problems.length) throw new Error(`Filled PIISA XML is not well-formed: ${problems.join("; ")}`);
  let lint = "not run (xmllint not installed)";
  if (has("xmllint")) { const f = `${OUT}.check.xml`; writeFileSync(f, xml); try { execFileSync("xmllint", ["--noout", f], { stdio: "ignore" }); lint = "clean"; } catch { throw new Error("xmllint rejected the filled PIISA XML"); } finally { rmSync(f, { force: true }); } }
  writeFileSync(`${OUT}piisa-sample.docx`, zipSync({ ...parts, "word/document.xml": new TextEncoder().encode(xml) }, { level: 0 }));

  let pngs: string[] = [];
  const soffice = has("soffice") ? "soffice" : has("libreoffice") ? "libreoffice" : null;
  if (soffice && has("pdftoppm")) {
    const tmp = `${OUT}.lo/`;
    mkdirSync(tmp, { recursive: true });
    execFileSync(soffice, ["--headless", "--convert-to", "pdf", "--outdir", tmp, `${OUT}piisa-sample.docx`], { stdio: "ignore", env: { ...process.env, HOME: tmp } });
    execFileSync("cp", [`${tmp}piisa-sample.pdf`, `${OUT}piisa-sample-word.pdf`]);
    rmSync(tmp, { recursive: true });
    execFileSync("pdftoppm", ["-png", "-r", "80", `${OUT}piisa-sample-word.pdf`, `${OUT}piisa-sample-word`]);
    pngs = readdirSync(OUT).filter((f) => f.startsWith("piisa-sample-word-") && f.endsWith(".png")).sort();
  }

  const shown = readOfficialDocx(xml, "piisa", original);
  const mismatches = Object.keys(shown).filter((id) => !same(PIISA_SAMPLE[id], shown[id])).map((id) => `\`${id}\`: answer ${JSON.stringify(PIISA_SAMPLE[id] ?? null)}, Word form shows ${JSON.stringify(shown[id] ?? null)}`);
  const ev = evaluatePiisa(PIISA_SAMPLE, { piesaCompletionDate: "2026-10-27", piesaReceivedAt: "2026-10-28T09:00:00+11:00", electricianRequiredAtStart: false, conductiveExistingInsulation: false, conductivityEvidence: "sample-photo" });
  const items = answerItems("piisa");
  const show = (v: unknown) => (v == null || v === "" ? "_blank_" : v === true ? "ticked" : v === false ? "not ticked" : Array.isArray(v) ? v.join(" / ") : String(v));
  const out = [
    `# Official PIISA through the fixed Word filler (${T.mappingVersion}, approved) — sample`,
    "",
    "SAMPLE ONLY: one realistic install, answers keyed exactly as the live A3 path hands them to `renderOfficialDocx` (`piisa-declaration.server`). Made by `bun scripts/render-piisa-filler-sample.ts`; nothing stored or sent; names and numbers made up.",
    "",
    `Form: ${T.title} (${T.publication}), original \`${T.originalFile}\`, SHA-256 \`${T.sha256}\`.`,
    "",
    `Files: \`piisa-sample.docx\` (the filled official Word form), \`piisa-sample-word.pdf\` (that file printed by LibreOffice)${pngs.length ? `, ${pngs.map((p) => `\`${p}\``).join(", ")}` : ""}.`,
    "",
    "## Why the PIISA needed the same fix",
    "",
    'The approved PIISA uses the same Word filler (`official-docx.core.ts`) as the PIESA. The f001aeba filler, given these exact answers and read back the same way: life support **No** printed unanswered (no "No" box is ever ticked — a space run sits between the box and the word); Part 5 electrician present **N/A** printed unanswered; Part 6 "average height" showed **1.5** (the R-value overwrote the height field) and the R-value line stayed blank; "Topped Up" was not ticked (`p6.treatment` not placed — the box text is "Removed and/or" / "Topped Up" across runs); the Part 8 signature box was blank; and all 18 ticks were written as a run inside another run (`<w:r><w:r>`, not valid Word XML). Now every box and text field is placed through the form\'s layout map and read back below.',
    "",
    "## Read back from the filled Word file",
    "",
    `- Filler: ${filled.length} items placed; not placed: ${missed.length ? missed.map((m) => `\`${m}\``).join(", ") : "none"}; no field on the Word form: ${notOnForm.length ? notOnForm.map((m) => `\`${m}\``).join(", ") : "none"}.`,
    `- Word XML: well-formed (tags balanced, no run nested in a run); xmllint ${lint}.`,
    mismatches.length ? "- Word form vs answers — DIFFERENCES:" : "- Word form vs answers: every box and text field matches the answers.",
    ...mismatches.map((m) => `  - ${m}`),
    `- Printed-rule blockers (\`evaluatePiisa\`): ${ev.blockers.length ? ev.blockers.map((b) => `\`${b.rule}\``).join(", ") : "none"}.`,
    "",
    "| Official item | Answer | Word form shows |",
    "|---|---|---|",
    ...items.flatMap((i) => (i.row ? Array.from({ length: i.row.rows }, (_, r) => `${i.id}#${r}`) : [i.id])).filter((id) => PIISA_SAMPLE[id] != null || shown[id] != null).map((id) => `| \`${id}\` | ${show(PIISA_SAMPLE[id]).replace(/\|/g, "\\|")} | ${show(shown[id]).replace(/\|/g, "\\|")} |`),
    "",
  ];
  writeFileSync(`${OUT}README.md`, `${out.join("\n")}\n`);
  console.log(`PIISA sample: placed ${filled.length}, missed [${missed.join(", ")}], mismatches ${mismatches.length}, blockers ${ev.blockers.map((b) => b.rule).join(", ") || "none"}; written to ${OUT}`);
}

if (import.meta.main) await main();
