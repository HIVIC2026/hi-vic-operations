// Live check: every hot/warm lead's list price AND rendered email numbers vs an independent from-scratch calculation.
// Usage: bun scripts/check-hot-lead-maths.ts   (read-only)
import { supabaseAdmin as a } from "../src/integrations/supabase/client.server";
import { loadHotLeads } from "../src/lib/hot-leads.server";
import { renderLaunchCampaignEmail } from "../src/lib/estimate-email";

const GHG = { Mild: 0.00576, Cold: 0.00771, Hot: 0.00546 } as Record<string, number>;
const REGIONAL = { Metropolitan: 0.98, Regional: 1.04 } as Record<string, number>;
const money = (n: number) => `$${Math.floor(n).toLocaleString("en-AU")}`;
let checked = 0; const bad: string[] = [];
for (const list of ["likely", "warm"] as const) {
  const { list: rows } = await loadHotLeads(list);
  const { data: locs } = await a.from("veu_location_variables").select("postcode, climate_region, metropolitan_or_regional").in("postcode", [...new Set(rows.map((r) => r.postcode!))]);
  const byPc = new Map((locs ?? []).map((l) => [l.postcode, l]));
  for (const r of rows) {
    const l = byPc.get(r.postcode!);
    if (!l) { bad.push(`${r.jobNumber}: postcode ${r.postcode} not in v25 table`); continue; }
    const veecs = Math.floor(GHG[l.climate_region]! * r.area * 25 * REGIONAL[l.metropolitan_or_regional]!);
    const gross = r.area * 30 + 698;
    const discount = Math.min(veecs * 70, Math.max(0, gross - 200));
    const total = Math.round((gross - discount) * 100) / 100;
    checked++;
    if (Math.abs((r.discount ?? -1) - discount) > 0.001 || Math.abs((r.price ?? -1) - total) > 0.001) bad.push(`${r.jobNumber}: list ${r.discount}/${r.price} vs ${discount}/${total}`);
    const mail = renderLaunchCampaignEmail({ group: "likely", campaignUrl: `https://estimate.homeinsulationvictoria.com.au/estimate/${"A".repeat(43)}/campaign`, unsubscribeUrl: `https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${"U".repeat(43)}`, firstName: "X", estimatedTotal: r.price!, veuDiscount: r.discount!, grossTotal: r.price! + r.discount!, areaM2: r.area });
    for (const want of [money(discount), money(total), money(gross)]) if (!mail.plainText.includes(want) && !mail.html.includes(want)) bad.push(`${r.jobNumber}: email missing ${want}`);
  }
}
console.log(JSON.stringify({ checked, mismatches: bad.length, bad }, null, 1));
process.exit(bad.length ? 1 : 0);
