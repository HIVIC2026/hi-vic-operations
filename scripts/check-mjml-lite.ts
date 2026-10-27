// Proves src/lib/mjml-lite.core.ts matches real MJML 5 for every design in docs/templates/mjml.
// Usage: bun scripts/check-mjml-lite.ts <dir-with-real-mjml-dist>   (dist = output of docs/templates/mjml/build.mjs)
// With no argument it only checks every design compiles with mjml-lite (no real MJML needed).
import { readFileSync, readdirSync } from "node:fs";
import { renderMjml } from "../src/lib/mjml-lite.core";

const DIR = new URL("../docs/templates/mjml/", import.meta.url).pathname;
const part = (p: string) => readFileSync(`${DIR}partials/${p}.mjml`, "utf8");
const realDist = process.argv[2];

/** Tag/attribute/text token stream with styles and whitespace normalised (minifier differences ignored). */
function tokens(html: string): string[] {
  const out: string[] = [];
  const re = /<!--([\s\S]*?)-->|<(\/?)([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[1] !== undefined) { out.push(`C${m[1].replace(/\s+/g, "")}`); continue; }
    if (m[5] !== undefined) {
      const t = m[5].replace(/&nbsp;/g, " ").replace(/&#10003;/g, "✓").replace(/&middot;/g, "·").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
      if (t) out.push(`T${t}`);
      continue;
    }
    const [, close, tag, rawAttrs] = m;
    const t = tag.toLowerCase();
    if (close) { if (!["br", "img", "meta", "link", "hr"].includes(t)) out.push(`>${t}`); continue; }
    const attrs = [...rawAttrs.matchAll(/([a-zA-Z:-]+)(?:="([^"]*)")?/g)].map(([, k, v = ""]) =>
      k === "style" ? `${k}=${v.split(";").map((x) => x.trim().replace(/\s/g, "").toLowerCase()).filter(Boolean).sort().join(";")}` : `${k}=${v.replace(/&amp;/g, "&")}`).sort();
    out.push(`<${t} ${attrs.join(" ")}`);
  }
  return out;
}

let bad = 0;
const files = readdirSync(DIR).filter((f) => f.endsWith(".mjml"));
for (const f of files) {
  let s = readFileSync(DIR + f, "utf8");
  for (const p of ["header", "footer-owner", "footer-trade"]) s = s.replace(`<mj-include path="./partials/${p}.mjml" />`, part(p));
  let lite: string;
  try { lite = renderMjml(s); } catch (e) { bad++; console.log(`FAIL ${f}: ${String(e)}`); continue; }
  if (!realDist) continue;
  const a = tokens(readFileSync(`${realDist}/${f.replace(".mjml", ".html")}`, "utf8")), b = tokens(lite);
  const i = a.findIndex((x, k) => x !== b[k]);
  if (i >= 0 || a.length !== b.length) { bad++; console.log(`DIFF ${f} at ${i}\n  real ${a[i]}\n  lite ${b[i]}`); }
}
console.log(bad ? `${bad} of ${files.length} failed` : `OK: ${files.length} designs${realDist ? " match real MJML" : " compile"}`);
process.exit(bad ? 1 : 0);
