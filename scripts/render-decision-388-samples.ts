// Decision 388 (Jo 25 Oct 2026: "we are saving spots, not offering Ready Checks"): re-renders the pre-release owner
// email designs from the live renderers with the Templates page sample data (Helen, $1,610 / $2,188 / $3,798, 137 m²),
// so docs/templates/owner never drifts from the spot-only wording awaiting Jo's approval
// (docs/decision-388-spot-only-wording.md). Writes O1, O2 (some insulation), O2 (questions) and O10, then runs the
// decision 238 (O66–O68) and 386 (O76a–j) renderers. Pure renderers only; nothing is sent.
// Run: bun scripts/render-decision-388-samples.ts
import { writeFileSync } from "node:fs";
import { TEMPLATE_ENTRIES } from "../src/lib/template-hub.core";
import "./render-decision-238-drafts";
import "./render-decision-386-drafts";

const ROOT = new URL("../", import.meta.url).pathname;
const IDS = ["owner:O1", "owner:O2-some", "owner:O2-questions", "owner:O10"] as const;

for (const id of IDS) {
  const e = TEMPLATE_ENTRIES.find((x) => x.id === id);
  if (!e?.design) throw new Error(`No design file for ${id}`);
  const p = e.render();
  if (p.kind !== "email") throw new Error(`${id} is not an email`);
  writeFileSync(`${ROOT}${e.design}`, p.html);
  if (import.meta.main) console.log(`--- ${e.code} ${e.name} — subject: ${p.subject} → ${e.design}`);
}
