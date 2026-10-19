-- =============================================================================
-- P1 — PRODUCTION EMAIL + SAVED-SPOT DIAGNOSTIC (READ ONLY)
-- Home Insulation Victoria  ·  Supabase project: wvuffpykgnqliikhodzl
-- Prepared: 2026-10-19
-- -----------------------------------------------------------------------------
-- PURPOSE: verify the ACTUAL production state. This file only SELECTs — it changes
-- nothing. Run it in the Supabase SQL editor (production project) and read the rows.
-- It answers the client's questions:
--   • Is the email master switch / adapter actually ON?
--   • Have any emails actually been sent since activation?
--   • Which templates / purposes have been used?
--   • Which enquiries are sent / pending / failed / need manual review?
--   • Why do two dashboard numbers (61 vs 56) differ for "saved spots"?
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) MASTER SWITCH + AUTOMATIC WORKFLOW SWITCHES + OFFER DISPATCH
-- -----------------------------------------------------------------------------
SELECT id,
       customer_comms_enabled                                            AS master_switch,
       auto_send_quote, auto_send_installer, auto_send_rec, auto_send_mitti,
       offer_dispatch_mode
FROM workflow_settings
WHERE id = 1;

-- -----------------------------------------------------------------------------
-- 2) DELIVERY ADAPTER (Base44 bridge) — is it enabled, and is it correctly set up?
-- -----------------------------------------------------------------------------
SELECT id,
       provider,
       enabled                                                          AS bridge_enabled,
       jobs_created_after                                               AS backlog_cutoff,
       CASE WHEN endpoint_url IS NULL OR endpoint_url = '' THEN 'MISSING' ELSE 'set' END  AS endpoint,
       CASE WHEN hmac_secret  IS NULL OR length(hmac_secret)  < 32  THEN 'MISSING/short' ELSE 'set' END AS secret
FROM customer_delivery_settings
WHERE id = 1;

-- -----------------------------------------------------------------------------
-- 3) ACTUAL EMAIL SENDS — counts by status (customer_email_sends is the send log)
--    status values seen in code: sent · sending · delivered_unrecorded ·
--    sending_unknown · failed · bounced · undelivered
-- -----------------------------------------------------------------------------
SELECT status, count(*) AS n
FROM customer_email_sends
GROUP BY status
ORDER BY n DESC;

-- -----------------------------------------------------------------------------
-- 4) TEMPLATES / PURPOSES ACTUALLY USED (which email types have fired)
-- -----------------------------------------------------------------------------
SELECT purpose, count(*) AS sends,
       count(*) FILTER (WHERE status = 'sent')      AS sent,
       count(*) FILTER (WHERE status = 'failed')     AS failed
FROM customer_email_sends
GROUP BY purpose
ORDER BY sends DESC;

-- -----------------------------------------------------------------------------
-- 5) DELIVERY RECORDS (job_communications) — outbound customer messages and their
--    delivery status. Use this to see real delivery/failure at the message level.
-- -----------------------------------------------------------------------------
SELECT delivery_status, count(*) AS n
FROM job_communications
WHERE direction = 'outbound'
GROUP BY delivery_status
ORDER BY n DESC;

SELECT purpose, delivery_status, count(*) AS n
FROM job_communications
WHERE direction = 'outbound'
GROUP BY purpose, delivery_status
ORDER BY purpose, n DESC;

-- -----------------------------------------------------------------------------
-- 6) ENQUIRIES / JOBS NEEDING ATTENTION (the "what must staff do manually" view)
--    a) Jobs whose outbound communication FAILED or was UNDELIVERED (retry needed)
-- -----------------------------------------------------------------------------
SELECT j.job_number, j.stage, jc.purpose, jc.delivery_status, jc.created_at
FROM job_communications jc
JOIN jobs j ON j.id = jc.job_id
WHERE jc.direction = 'outbound'
  AND jc.delivery_status IN ('failed', 'undelivered')
ORDER BY jc.created_at DESC
LIMIT 200;

-- -----------------------------------------------------------------------------
-- 6b) Leads with NO confirmed outbound send yet (awaiting automation / manual)
-- -----------------------------------------------------------------------------
SELECT j.id, j.job_number, j.stage, j.source, j.created_at
FROM jobs j
WHERE j.source <> 'qa_test'
  AND j.stage IN ('new_enquiry','eligibility_review','preliminary_estimate_ready',
                 'ready_check_awaiting_acceptance','ready_check_awaiting_payment',
                 'ready_check_ready_to_schedule')
  AND NOT EXISTS (
        SELECT 1 FROM job_communications jc
        WHERE jc.job_id = j.id AND jc.direction = 'outbound'
          AND jc.delivery_status = 'sent'
      )
ORDER BY j.created_at DESC
LIMIT 200;

-- -----------------------------------------------------------------------------
-- 7) SAVED-SPOTS 61 vs 56 EXPLAINED
--    A = launch-campaign "Spots saved (total)"  -> every response that ever saved a spot
--    B = operations "Spots saved (awaiting installer)" -> still in a Leads stage
--    The gap = spots that have since moved to an active/closed job (correct, not a bug).
-- -----------------------------------------------------------------------------
SELECT
  (SELECT count(*)
   FROM lead_campaign_responses lcr
   JOIN jobs j ON j.id = lcr.job_id
   WHERE lcr.spot_saved_at IS NOT NULL
     AND lcr.opted_out_at  IS NULL
     AND j.source <> 'qa_test')                                            AS A_total_saved,
  (SELECT count(*)
   FROM lead_campaign_responses lcr
   JOIN jobs j ON j.id = lcr.job_id
   WHERE lcr.spot_saved_at IS NOT NULL
     AND lcr.opted_out_at  IS NULL
     AND j.source <> 'qa_test'
     AND j.stage IN ('new_enquiry','eligibility_review','preliminary_estimate_ready',
                    'ready_check_awaiting_acceptance','ready_check_awaiting_payment',
                    'ready_check_ready_to_schedule'))                       AS B_open_awaiting_installer;

-- Detail: the saved spots that are NO LONGER in a Leads stage (the 61-56 gap)
SELECT j.job_number, j.stage, lcr.spot_saved_at
FROM lead_campaign_responses lcr
JOIN jobs j ON j.id = lcr.job_id
WHERE lcr.spot_saved_at IS NOT NULL
  AND lcr.opted_out_at  IS NULL
  AND j.source <> 'qa_test'
  AND j.stage NOT IN ('new_enquiry','eligibility_review','preliminary_estimate_ready',
                     'ready_check_awaiting_acceptance','ready_check_awaiting_payment',
                     'ready_check_ready_to_schedule')
ORDER BY j.stage, lcr.spot_saved_at
LIMIT 200;
