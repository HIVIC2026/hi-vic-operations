import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { launchCampaignDb, LAUNCH_ID } from "./helpers/pglite-launch-campaign";
import { ownerCalculatorChangeNote, savedPriceFromCalculator } from "../src/lib/launch-campaign.core";
import { renderLaunchCampaignEmail } from "../src/lib/estimate-email";

const route = readFileSync(new URL("../src/routes/estimate_.$token.calculator.tsx", import.meta.url), "utf8");
const server = readFileSync(new URL("../src/lib/launch-campaign.server.ts", import.meta.url), "utf8");
const TOKEN = "a".repeat(43);

describe("owner calculator (opened from an owner token)", () => {
  test("has no register form and never creates an enquiry or job", () => {
    expect(route).toContain("hideRegistration");
    expect(route).not.toMatch(/RegisterInterest|interest\.functions|registerInterest|Register my interest|Demand is high/);
    expect(route).toContain("saveMySpot");
    expect(route).toContain("SPOT_SAVED_HEADING");
    const save = server.slice(server.indexOf("export async function saveCampaignSpot"), server.indexOf("export async function savedSpotForJob"));
    expect(save).not.toMatch(/from\("(jobs|calculator_interests|owners|properties)"\)\.(insert|upsert)/);
    expect(save).toMatch(/from\("jobs"\)\.update\(\{ estimated_area_m2/);
  });

  test.skip("RETIRED by Jo 7 Oct — v8: the short campaign email links only to the owner's campaign page (the calculator link lives there)", () => {
    const e = renderLaunchCampaignEmail({ group: "likely", campaignUrl: `https://estimate.homeinsulationvictoria.com.au/estimate/${TOKEN}/campaign`, unsubscribeUrl: `https://estimate.homeinsulationvictoria.com.au/email/unsubscribe?t=${TOKEN}`, estimatedTotal: 1850, veuDiscount: 1470, grossTotal: 3320, areaM2: 120, firstName: "Sam" } as never);
    expect(e.html).toContain(`/estimate/${TOKEN}/campaign`);
    expect(e.html).not.toContain("/calculator");
  });

  test("Save my spot from the calculator: one row, no new job, double tap safe", async () => {
    const db = await launchCampaignDb();
    const SAVE = `INSERT INTO public.lead_campaign_responses(job_id, estimate_link_id, spot_saved_at, saved_total, saved_area_m2) VALUES ($1,$2,now(),$3,$4) ON CONFLICT (job_id) DO NOTHING`;
    const jobsBefore = (await db.query<{ n: number }>(`SELECT count(*)::int n FROM public.jobs`)).rows[0]!.n;
    await db.query(SAVE, [LAUNCH_ID.job, LAUNCH_ID.link, 2100, 150]);
    await db.query(SAVE, [LAUNCH_ID.job, LAUNCH_ID.link, 2100, 150]);
    const r = await db.query<{ n: number; a: string }>(`SELECT count(*)::int n, max(saved_area_m2)::text a FROM public.lead_campaign_responses`);
    expect(r.rows[0]!.n).toBe(1);
    expect(Number(r.rows[0]!.a)).toBe(150);
    expect((await db.query<{ n: number }>(`SELECT count(*)::int n FROM public.jobs`)).rows[0]!.n).toBe(jobsBefore);
    await db.close();
  });

  test("snapshot is the price shown; size change note wording", () => {
    const shown = { scenarios: [{ by_access: { standard: { estimated_customer_total: 2100, applied_discount: 1680, pre_discount_total: 3780 } } }] };
    expect(savedPriceFromCalculator(shown, 150, "none")).toEqual({ estimateId: null, total: 2100, discount: 1680, gross: 3780, areaM2: 150, insulation: "none" });
    expect(ownerCalculatorChangeNote({ areaM2: 120, insulation: "none" }, { areaM2: 150, insulation: "none" })).toBe("Owner changed ceiling size from 120 to 150 m² on the calculator");
    expect(ownerCalculatorChangeNote({ areaM2: 150, insulation: "none" }, { areaM2: 150, insulation: "none" })).toBeNull();
  });
});
