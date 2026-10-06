import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { runServerJourney } from "../../src/lib/journey.server";
import { renderLaunchCampaignEmail } from "../../src/lib/estimate-email";
const B = "https://estimate.homeinsulationvictoria.com.au";
await runServerJourney({ cleanup: true, afterStep: async (ctx, r) => {
  if (r.key !== "s1_calculator") return;
  const t = ctx.token!;
  for (const g of ["likely", "onsite"] as const) {
    const m = renderLaunchCampaignEmail({ group: g, campaignUrl: `${B}/estimate/${t}/campaign`, unsubscribeUrl: `${B}/email/unsubscribe?t=${"U".repeat(43)}`, firstName: "Jo", estimatedTotal: 3178, veuDiscount: 1120, grossTotal: 4298, areaM2: 120, address: "47 Journey Test Street, Frankston VIC 3199", insulation: "none", reference: ctx.jobNumber });
    writeFileSync(`/tmp/browser/v8/${g}.html`, m.html); console.log(g, m.subject, "|", m.previewText);
  }
  const py = spawnSync("python3", ["/tmp/browser/v8/shoot.py", t, "/tmp/browser/v8/likely.html", "/tmp/browser/v8/onsite.html"], { encoding: "utf8", timeout: 200000 });
  console.log(py.stdout, py.stderr.slice(-600));
  throw new Error("stop after preview");
} });
