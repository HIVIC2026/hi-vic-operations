// New job flow Part 8: read-only check that the 2 Nov Mitti paste landed on the LIVE templates (A1, A2, A3, A5).
// One GET per template through the existing Mitti bridge. Writes nothing to Mitti or the database. TEST routing never applies
// (these are the real template IDs). Exit code 0 = all four pass, 1 = something missing/renamed/still there, 2 = unreadable/unreachable.
// Usage: bun scripts/mitti-part8-health.ts                    (live)
//        bun scripts/mitti-part8-health.ts A1=saved-a1.json    (offline: use a saved template JSON for that key)
import { readFileSync } from "node:fs";
import { PART8_TEMPLATES, checkPart8Template } from "../src/lib/mitti-part8-health.core";

const offline = new Map(process.argv.slice(2).map((a) => a.split("=") as [string, string]).filter(([k, v]) => k && v));
let api: { getTemplateDefinition: (id: string) => Promise<unknown> } | null = null;
let worst = 0;
for (const spec of PART8_TEMPLATES) {
  let def: unknown;
  try {
    const file = offline.get(spec.key);
    if (file) def = JSON.parse(readFileSync(file, "utf8"));
    else {
      if (!api) { const [{ mittiApi }, { realMittiCall }] = await Promise.all([import("../src/lib/mitti.core"), import("../src/lib/mitti.server")]); api = mittiApi(realMittiCall); }
      def = await api.getTemplateDefinition(spec.templateId);
    }
  } catch (e) {
    console.log(`${spec.key} (${spec.name}): COULD NOT READ - ${(e as Error).message}`);
    worst = 2; continue;
  }
  const r = checkPart8Template(def, spec);
  if (r.unreadable) { console.log(`${spec.key} (${spec.name}): UNREADABLE - Mitti's reply had no readable questions; this does not prove anything is missing.`); worst = 2; continue; }
  console.log(`${spec.key} (${spec.name}): ${r.ok ? "OK" : "NOT OK"}`);
  for (const l of r.missing) { const n = r.renamed.find((x) => x.expected === l); console.log(`  missing: "${l}"${n ? `  <- found a different name: "${n.found}"` : ""}`); }
  for (const t of r.textMissing) console.log(`  text not found: "${t.length > 70 ? t.slice(0, 70) + "..." : t}"`);
  for (const c of r.unexpected) console.log(`  still offered (should be deleted): "${c}"`);
  if (!r.ok && worst < 1) worst = 1;
}
console.log(worst === 0 ? "ALL FOUR PASS" : worst === 1 ? "SOMETHING TO FIX (see above)" : "COULD NOT CHECK EVERYTHING (see above)");
process.exit(worst);
