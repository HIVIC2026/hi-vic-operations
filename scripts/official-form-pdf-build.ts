// Build-time helpers shared by scripts/official-form-blank-pdf.ts and tests/official-pdf-blank.test.ts: the LibreOffice
// conversion (throwaway profile with a font replacement table) and the "build copy" layout tweaks. Needs LibreOffice and
// poppler. Never import this under src/.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

/**
 * LibreOffice font replacement table for the conversion profile (fonts the DEECA forms name but this machine lacks; the
 * default fallback is Inter, which is wider and wraps the footer "OFFICIAL" label to "OFFICIA / L"). Metric-compatible
 * faces where one exists (Carlito = Calibri, Caladea = Cambria, Liberation Sans = Arial).
 */
export const FONT_REPLACEMENTS: [string, string][] = [
  ["Aptos", "Carlito"], // the "OFFICIAL" classification label in every footer
  ["Calibri", "Carlito"],
  ["Cambria", "Caladea"],
  ["Arial Bold", "Liberation Sans"], // "Bold Body Text" style, e.g. PIISA Table 1 "WorkSafe guidance:"
  ["VIC SemiBold", "Liberation Sans"],
  ["Tahoma", "DejaVu Sans"],
  ["Lucida Handwriting", "DejaVu Sans"],
];

function profileXcu(): string {
  const pair = ([from, to]: [string, string], i: number) =>
    `<item oor:path="/org.openoffice.Office.Common/Font/Substitution/FontPairs"><node oor:name="_${i}" oor:op="replace">` +
    `<prop oor:name="Always" oor:op="fuse"><value>true</value></prop><prop oor:name="OnScreenOnly" oor:op="fuse"><value>false</value></prop>` +
    `<prop oor:name="ReplaceFont" oor:op="fuse"><value>${from}</value></prop><prop oor:name="SubstituteFont" oor:op="fuse"><value>${to}</value></prop></node></item>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Common/Font/Substitution"><prop oor:name="Replacement" oor:op="fuse"><value>true</value></prop></item>
${FONT_REPLACEMENTS.map(pair).join("\n")}
</oor:items>
`;
}

/** Converts `dir/file` (.docx) to PDF with a throwaway profile in `dir` carrying FONT_REPLACEMENTS. */
export function soffice(dir: string, file: string): Uint8Array {
  mkdirSync(join(dir, "profile/user"), { recursive: true });
  writeFileSync(join(dir, "profile/user/registrymodifications.xcu"), profileXcu());
  const r = spawnSync("soffice", ["--headless", `-env:UserInstallation=file://${dir}/profile`, "--convert-to", "pdf", "--outdir", dir, join(dir, file)], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`soffice failed on ${file}: ${r.stderr || r.stdout}`);
  return new Uint8Array(readFileSync(join(dir, file.replace(/\.docx$/, ".pdf"))));
}

/** The words of a PDF in content-stream order (pdftotext -raw), ignoring layout. */
export function rawWords(pdfFile: string): string[] {
  const r = spawnSync("pdftotext", ["-raw", "-nopgbrk", pdfFile, "-"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`pdftotext failed: ${r.stderr}`);
  return r.stdout.split(/\s+/).filter(Boolean);
}

const once = (xml: string, from: string, to: string, what: string, at: "first" | "last" = "first"): string => {
  const i = at === "first" ? xml.indexOf(from) : xml.lastIndexOf(from);
  if (i < 0) throw new Error(`build-copy tweak: ${what} not found`);
  return xml.slice(0, i) + to + xml.slice(i + from.length);
};

/** relativeHeight given to the footer "OFFICIAL" label: above the PIESA last-page white "Group 4" panel (251689470). */
const LABEL_Z = "251690000";

/**
 * Build-copy layout tweaks (Jo/controller ruling 3 Nov, fix round 2). Position and stacking of anchored boxes only:
 * no wording, table or content changes. The untouched DEECA .docx stays in the repo; only the converted copy changes.
 *  - Footer (default + even) "OFFICIAL" classification label: from page-centre to the left margin, so it no longer
 *    prints over "VEU Pre-installation …" on the same footer line; and stacked above the last-page white panel.
 *  - Last-page logo frame (xVicLogo): fixed at 768 pt from the top of the page (Word style says 782 pt) so the logos
 *    sit clear above the footer line.
 */
export function buildCopyFooter(xml: string): string {
  const anchor = xml.indexOf("<wp:anchor ");
  if (anchor < 0 || xml.indexOf("<wp:anchor ", anchor + 1) >= 0) throw new Error("build-copy tweak: expected exactly one anchored box in the footer");
  let x = once(xml, '<wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH>', '<wp:positionH relativeFrom="margin"><wp:align>left</wp:align></wp:positionH>', "footer label centre position");
  x = x.replace(/(<wp:anchor [^>]*relativeHeight=")\d+(")/, `$1${LABEL_Z}$2`);
  return x;
}

export function buildCopyDocument(xml: string): string {
  const logo = '<w:pStyle w:val="xVicLogo"/><w:framePr w:wrap="around"/>';
  if (xml.lastIndexOf(logo) < xml.lastIndexOf("energy.vic.gov.au/veu")) throw new Error("build-copy tweak: last-page logo frame not after the closing web address");
  return once(xml, logo, '<w:pStyle w:val="xVicLogo"/><w:framePr w:wrap="around" w:vAnchor="page" w:hAnchor="margin" w:xAlign="right" w:y="15360"/>', "last-page logo frame", "last");
}

/** Applies the build-copy tweaks to unzipped .docx parts (footer1 = even, footer2 = default; footer3 = first page, untouched). */
export function buildCopy(parts: Record<string, Uint8Array>, enc: (s: string) => Uint8Array, dec: (b: Uint8Array) => string): Record<string, Uint8Array> {
  const out = { ...parts };
  for (const f of ["word/footer1.xml", "word/footer2.xml"]) out[f] = enc(buildCopyFooter(dec(parts[f]!)));
  out["word/document.xml"] = enc(buildCopyDocument(dec(parts["word/document.xml"]!)));
  return out;
}
