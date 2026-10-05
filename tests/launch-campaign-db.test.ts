import { describe, expect, test } from "bun:test";
import { launchCampaignDb, LAUNCH_ID } from "./helpers/pglite-launch-campaign";

describe("launch campaign migration", () => {
  test("stores one response per job and enforces desk-check outcomes", async () => {
    const db = await launchCampaignDb();
    await db.query(`INSERT INTO public.lead_campaign_responses(job_id, estimate_link_id, video_requested, desk_check_status) VALUES ($1,$2,true,'pending')`, [LAUNCH_ID.job, LAUNCH_ID.link]);
    await expect(db.query(`INSERT INTO public.lead_campaign_responses(job_id, estimate_link_id) VALUES ($1,$2)`, [LAUNCH_ID.job, LAUNCH_ID.link])).rejects.toThrow();
    await expect(db.query(`UPDATE public.lead_campaign_responses SET desk_check_status='not_eligible', desk_checked_at=now() WHERE job_id=$1`, [LAUNCH_ID.job])).rejects.toThrow();
    await db.query(`UPDATE public.lead_campaign_responses SET desk_check_status='looks_eligible', desk_checked_at=now(), desk_checked_by=$2 WHERE job_id=$1`, [LAUNCH_ID.job, LAUNCH_ID.admin]);
    const result = await db.query<{ desk_check_status: string }>(`SELECT desk_check_status FROM public.lead_campaign_responses WHERE job_id=$1`, [LAUNCH_ID.job]);
    expect(result.rows[0]?.desk_check_status).toBe("looks_eligible");
    await db.close();
  });

  test("video saves rank first and Ready Check availability defaults off", async () => {
    const db = await launchCampaignDb();
    await db.query(`INSERT INTO public.customer_delivery_settings(id) VALUES (1)`);
    await db.query(`INSERT INTO public.lead_campaign_responses(job_id, estimate_link_id, spot_saved_at, queue_priority, video_requested, media_received_at, desk_check_status) VALUES ($1,$2,now(),'video',true,now(),'pending')`, [LAUNCH_ID.job, LAUNCH_ID.link]);
    const response = await db.query<{ queue_priority: string; spot_saved_at: string | null }>(`SELECT queue_priority,spot_saved_at FROM public.lead_campaign_responses WHERE job_id=$1`, [LAUNCH_ID.job]);
    expect(response.rows[0]?.queue_priority).toBe("video");
    expect(response.rows[0]?.spot_saved_at).not.toBeNull();
    const setting = await db.query<{ ready_check_available_postcodes: string[] }>(`SELECT ready_check_available_postcodes FROM public.customer_delivery_settings WHERE id=1`);
    expect(setting.rows[0]?.ready_check_available_postcodes).toEqual([]);
    await db.close();
  });
});