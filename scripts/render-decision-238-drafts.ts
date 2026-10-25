// Renders the decision 238 DRAFT estimate follow-up emails (O66 day 2, O67 day 7, O68 day 21) into
// docs/templates/owner with the fixed O1 sample data (Helen, $1,610 / $2,188 / $3,798, 137 m²), and prints the text
// for Jo's approval. Pure renderer only; nothing is sent. Approved (decisions 242/357): ESTIMATE_FOLLOWUP_APPROVED is true. Run: bun scripts/render-decision-238-drafts.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { ESTIMATE_FOLLOWUP_STEPS, TEMPLATE_CODE, renderEstimateFollowupEmail } from "../src/lib/estimate-followup.core";

const DIR = new URL("../docs/templates/owner/", import.meta.url).pathname;
const EST = "https://estimate.homeinsulationvictoria.com.au/estimate/tok";
const FILE = { day_2: "O66-estimate-reminder-day-2.html", day_7: "O67-estimate-reminder-day-7.html", day_21: "O68-estimate-closing-day-21.html" } as const;

mkdirSync(DIR, { recursive: true });
for (const step of ESTIMATE_FOLLOWUP_STEPS) {
  const m = renderEstimateFollowupEmail({
    step, firstName: "Helen", rebate: 1610, price: 2188, fullPrice: 3798, basis: "Based on what you told us: 137 m² ceiling, no existing insulation.",
    saveUrl: `${EST}/campaign`, calculatorUrl: `${EST}/calculator`, unsubscribeUrl: null,
  });
  writeFileSync(`${DIR}${FILE[step]}`, m.html);
  if (import.meta.main) console.log(`--- ${TEMPLATE_CODE[step]} (${step}) — subject: ${m.subject}\n${m.text}\n`);
}
