import { describe, expect, test } from "bun:test";
import { launchCampaignDb, LAUNCH_ID } from "./helpers/pglite-launch-campaign";
import { savedPriceFromEstimate, savedPriceLabel } from "../src/lib/launch-campaign.core";
import { officeStatus, type JobFacts } from "../src/lib/office-status.core";

const SAVE = `INSERT INTO public.lead_campaign_responses(job_id, estimate_link_id, spot_saved_at, saved_total, saved_veu_discount)
  VALUES ($1,$2,now(),$3,$4) ON CONFLICT (job_id) DO NOTHING RETURNING id`;

describe("save my spot", () => {
  test("double tap: second save is a no-op, not an error, and keeps the first price", async () => {
    const db = await launchCampaignDb();
    const a = await db.query(SAVE, [LAUNCH_ID.job, LAUNCH_ID.link, 1850, 1470]);
    const b = await db.query(SAVE, [LAUNCH_ID.job, LAUNCH_ID.link, 9999, 1]);
    expect(a.rows.length).toBe(1);
    expect(b.rows.length).toBe(0);
    const r = await db.query<{ n: number; saved_total: string }>(`SELECT count(*)::int n, max(saved_total)::text saved_total FROM public.lead_campaign_responses`);
    expect(r.rows[0]).toEqual({ n: 1, saved_total: "1850.00" });
    await db.close();
  });

  test("two devices at once both succeed with one row", async () => {
    const db = await launchCampaignDb();
    const results = await Promise.allSettled([db.query(SAVE, [LAUNCH_ID.job, LAUNCH_ID.link, 1850, 1470]), db.query(SAVE, [LAUNCH_ID.job, LAUNCH_ID.link, 1850, 1470])]);
    expect(results.every((x) => x.status === "fulfilled")).toBe(true);
    const r = await db.query<{ n: number }>(`SELECT count(*)::int n FROM public.lead_campaign_responses WHERE spot_saved_at IS NOT NULL`);
    expect(r.rows[0]?.n).toBe(1);
    await db.close();
  });

  test("queue_rank is numeric: video = 1, none = 0; sorts video first then oldest", async () => {
    const db = await launchCampaignDb();
    const j2 = "00000000-0000-4000-8000-0000000000b2", j3 = "00000000-0000-4000-8000-0000000000b3";
    await db.exec(`INSERT INTO public.jobs(id) VALUES ('${j2}'),('${j3}'); INSERT INTO public.customer_estimate_links(job_id) VALUES ('${j2}'),('${j3}');`);
    const link = async (j: string) => (await db.query<{ id: string }>(`SELECT id FROM public.customer_estimate_links WHERE job_id=$1`, [j])).rows[0]!.id;
    await db.query(`INSERT INTO public.lead_campaign_responses(job_id, estimate_link_id, spot_saved_at) VALUES ($1,$2,now() - interval '3 days')`, [LAUNCH_ID.job, LAUNCH_ID.link]);
    await db.query(`INSERT INTO public.lead_campaign_responses(job_id, estimate_link_id, spot_saved_at) VALUES ($1,$2,now() - interval '5 days')`, [j2, await link(j2)]);
    await db.query(`INSERT INTO public.lead_campaign_responses(job_id, estimate_link_id, spot_saved_at, queue_priority) VALUES ($1,$2,now(),'video')`, [j3, await link(j3)]);
    const r = await db.query<{ job_id: string; queue_rank: number }>(`SELECT job_id, queue_rank FROM public.lead_campaign_responses ORDER BY queue_rank DESC, spot_saved_at ASC`);
    expect(r.rows.map((x) => [x.job_id, x.queue_rank])).toEqual([[j3, 1], [j2, 0], [LAUNCH_ID.job, 0]]);
    await db.close();
  });

  test("estimate changed after saving: saved price stays, change is flagged", () => {
    const row = (id: string, total: number) => ({ id, area_m2: 120, insulation_declared: "none", scenarios: [{ by_access: { standard: { estimated_customer_total: total, applied_discount: 1470, pre_discount_total: total + 1470 } } }] });
    const saved = savedPriceFromEstimate(row("e1", 1850.6))!;
    expect(saved).toEqual({ estimateId: "e1", total: 1850.6, discount: 1470, gross: 3320.6, areaM2: 120, insulation: "none" });
    const same = savedPriceLabel({ ...saved, savedAt: "2026-10-05T01:00:00Z" }, { estimateId: "e1", total: 1850.6 })!;
    expect(same.text).toBe("Saved at $1,850 (rebate $1,470) on 5 Oct 2026");
    expect(same.changeNote).toBeNull();
    const moved = savedPriceLabel({ ...saved, savedAt: "2026-10-05T01:00:00Z" }, savedPriceFromEstimate(row("e2", 2100)))!;
    expect(moved.text).toBe("Saved at $1,850 (rebate $1,470) on 5 Oct 2026");
    expect(moved.changeNote).toBe("Estimate has changed since");
  });

  const camp = (extra: Partial<NonNullable<JobFacts["campaign"]>> = {}) => ({ spotSavedAt: "2026-10-04T00:00:00Z", optedOutAt: null, videoRequested: false, mediaReceivedAt: null, deskCheckStatus: "not_needed", createdAt: "2026-10-01T00:00:00Z", ...extra });
  for (const stage of ["preliminary_estimate_ready", "ready_check_awaiting_acceptance", "ready_check_awaiting_payment", "ready_check_ready_to_schedule"]) {
    test(`status at ${stage}`, () => {
      const f = (c: JobFacts["campaign"]): JobFacts => ({ id: "j", stage, createdAt: "2026-10-01T00:00:00Z", lastActivityAt: null, enteredStageAt: "2026-10-02T00:00:00Z", ownerContactedAt: "2026-10-02T00:00:00Z", campaign: c });
      const now = Date.parse("2026-10-05T00:00:00Z");
      expect(officeStatus(f(camp()), now)).toMatchObject({ label: "Spot saved", action: "Choose installer", waitingOn: "Us" });
      expect(officeStatus(f(camp({ videoRequested: true, mediaReceivedAt: "2026-10-04T01:00:00Z", deskCheckStatus: "pending", queuePriority: "video" })), now)?.label).toBe("Spot saved · video sent");
      expect(officeStatus(f(camp({ spotSavedAt: null, optedOutAt: "2026-10-04T00:00:00Z" })), now)?.label).not.toMatch(/Spot saved/);
    });
  }
});
