-- Firm-quote TEST-only exception (Jo approved option A, 7 Nov 2026 8:40am Melbourne).
-- Only change: request_firm_quote_atomic also accepts TEST jobs (source qa_test, created from
-- 2026-11-06 21:30 UTC, owner email @hivic-test.example or jolowexo@hotmail.com) while
-- firm_quote_flow_live_at is NULL. With the switch ON every rule is exactly as 0197.
-- Real website enquiries are still refused while the switch is NULL. Switch value untouched.
CREATE OR REPLACE FUNCTION public.request_firm_quote_atomic(p_job uuid,p_link uuid,p_due_by date)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE j public.jobs; live_at timestamptz; previous_due text;
BEGIN
  SELECT * INTO j FROM public.jobs WHERE id=p_job FOR UPDATE;
  IF NOT FOUND OR j.deleted_at IS NOT NULL OR j.qa_archived_at IS NOT NULL
    OR j.stage IN ('cancelled','complete','on_hold') THEN
    RETURN jsonb_build_object('ok',false,'reason','closed');
  END IF;
  SELECT firm_quote_flow_live_at INTO live_at FROM public.workflow_settings LIMIT 1;
  -- Switch ON: unchanged. Switch NULL: only the TEST exception (Jo 7 Nov 2026, option A) — a qa_test job created
  -- from 2026-11-06 21:30 UTC whose owner email is a TEST address. Real website enquiries stay refused.
  IF NOT (
    (live_at IS NOT NULL AND j.source IN ('base44','qa_test') AND j.created_at >= live_at)
    OR (j.source = 'qa_test' AND j.created_at >= timestamptz '2026-11-06 21:30:00+00'
        AND EXISTS (SELECT 1 FROM public.owners o WHERE o.id=j.owner_id
          AND (lower(trim(COALESCE(o.email,''))) ~ '^[^@[:space:]]+@hivic-test\.example$'
            OR lower(trim(COALESCE(o.email,''))) = 'jolowexo@hotmail.com')))
  ) THEN
    RETURN jsonb_build_object('ok',false,'reason','not_firm_quote');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.documents WHERE job_id=p_job AND kind='intake_media'
    AND storage_path IS NOT NULL AND storage_path<>'' AND
    (mime_type ~* '^(image|video)/' OR storage_path ~* '\.(jpe?g|png|webp|heic|heif|gif|mp4|mov|webm|m4v)([?#].*)?$')) THEN
    RETURN jsonb_build_object('ok',false,'reason','not_firm_quote');
  END IF;
  PERFORM 1 FROM public.customer_estimate_links WHERE id=p_link AND job_id=p_job
    AND purpose='step3_estimate' AND status='active' FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','not_firm_quote'); END IF;
  PERFORM 1 FROM public.lead_campaign_responses WHERE job_id=p_job FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.lead_campaign_responses WHERE job_id=p_job AND opted_out_at IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.customer_email_optouts WHERE job_id=p_job AND opted_out_at IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.owners o JOIN public.sms_optouts s ON s.phone=
      CASE WHEN regexp_replace(o.phone,'[^0-9]','','g') LIKE '04%'
        THEN '+61'||substr(regexp_replace(o.phone,'[^0-9]','','g'),2)
        ELSE '+'||regexp_replace(o.phone,'[^0-9]','','g') END
      WHERE o.id=j.owner_id AND (s.opted_in_at IS NULL OR s.opted_in_at<s.opted_out_at)) THEN
    RETURN jsonb_build_object('ok',false,'reason','opted_out');
  END IF;
  IF EXISTS (SELECT 1 FROM public.quotes WHERE job_id=p_job)
    OR j.stage NOT IN ('new_enquiry','eligibility_review','preliminary_estimate_ready','ready_check_ready_to_schedule') THEN
    RETURN jsonb_build_object('ok',false,'reason','quoted');
  END IF;
  SELECT details->>'due_by' INTO previous_due FROM public.workflow_events
    WHERE job_id=p_job AND event_type='firm_quote_requested' ORDER BY created_at,id LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('ok',true,'dueBy',previous_due,'already',true); END IF;
  IF p_due_by IS NULL THEN RAISE EXCEPTION 'A firm quote due date is required'; END IF;
  -- Same saved-response and guarded queue-stage transaction as Save my spot;
  -- bypass its application confirmation path entirely. Preserve any existing snapshot.
  PERFORM public.save_campaign_spot_atomic(p_job,p_link,'{}'::jsonb,true,
    'Owner requested a firm quote from photos',jsonb_build_object('firm_quote',true,'due_by',p_due_by,'no_customer_messages',true));
  INSERT INTO public.workflow_events(job_id,event_type,summary,details,internal)
    VALUES(p_job,'firm_quote_requested','Owner requested a firm quote from photos',
      jsonb_build_object('firm_quote',true,'due_by',p_due_by),true);
  RETURN jsonb_build_object('ok',true,'dueBy',p_due_by,'already',false);
END $$;
REVOKE ALL ON FUNCTION public.request_firm_quote_atomic(uuid,uuid,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_firm_quote_atomic(uuid,uuid,date) TO service_role;