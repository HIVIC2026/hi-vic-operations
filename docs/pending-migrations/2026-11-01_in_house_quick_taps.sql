-- PENDING Task 1: owner YES under the existing per-job lock; installer-source exemption.
-- No live application authorised. Retains the existing coverage, worker and delivery-intent safeguards.
CREATE OR REPLACE FUNCTION public.allocate_in_house_batch_job(
  _batch uuid, _business uuid, _job uuid, _actor uuid, _installer uuid, _electrician uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE job_row public.jobs%ROWTYPE; partner_name text; existing_name text; approved_template uuid; partner_row public.businesses%ROWTYPE; site_postcode text; coords jsonb; site_lat double precision; site_lng double precision; haversine double precision; covered boolean;
BEGIN
  -- RPC is service-only; the authenticated server boundary checks admin and binds _actor.
  -- Also refuse an invalid/TEST-office actor here, before any mutation.
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role::text='admin')
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role::text='qa_office') THEN
    RAISE EXCEPTION 'Office only';
  END IF;
  -- Lock job before all eligibility/assignment checks: repeat/concurrent sends cannot allocate twice.
  SELECT * INTO job_row FROM public.jobs WHERE id=_job AND deleted_at IS NULL AND source<>'qa_test' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('sent',false,'reason','Job unavailable'); END IF;
  SELECT COALESCE(b.trading_name,b.name) INTO existing_name FROM public.in_house_batches batch
    JOIN public.businesses b ON b.id=batch.business_id WHERE _job=ANY(batch.job_ids) ORDER BY batch.sent_at LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('sent',false,'reason','Already with ' || existing_name); END IF;
  SELECT COALESCE(b.trading_name,b.name) INTO existing_name FROM public.job_assignments a
    LEFT JOIN public.businesses b ON b.id=a.business_id WHERE a.job_id=_job AND a.active AND a.role::text='installer' LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('sent',false,'reason','Already with ' || COALESCE(existing_name,'an installer')); END IF;
  IF EXISTS (SELECT 1 FROM public.job_assignments WHERE job_id=_job AND active AND role::text='electrician') THEN
    RETURN jsonb_build_object('sent',false,'reason','Already has an electrician');
  END IF;
  IF job_row.stage::text NOT IN ('preliminary_estimate_ready','ready_check_ready_to_schedule')
    OR (job_row.channel::text IS DISTINCT FROM 'installer_sourced' AND NOT EXISTS (SELECT 1 FROM public.lead_campaign_responses WHERE job_id=_job AND spot_saved_at IS NOT NULL)) THEN
    RETURN jsonb_build_object('sent',false,'reason','Not a saved spot waiting for a Ready Check');
  END IF;
  IF EXISTS (SELECT 1 FROM public.customer_email_optouts WHERE job_id=_job AND opted_out_at IS NOT NULL) THEN
    RETURN jsonb_build_object('sent',false,'reason','Owner opted out');
  END IF;
  IF job_row.channel::text IS DISTINCT FROM 'installer_sourced' AND NOT COALESCE((
    SELECT details->>'outcome'='pass' AND details->'consent_share'='true'::jsonb
    FROM public.workflow_events WHERE job_id=_job AND event_type='quick_taps_answered'
    ORDER BY created_at DESC,id DESC LIMIT 1
  ),false) THEN
    RETURN jsonb_build_object('sent',false,'reason','Owner has not said yes in quick taps');
  END IF;
  -- Partner lock prevents a concurrent office disable; worker/member locks keep selected people current.
  SELECT COALESCE(trading_name,name) INTO partner_name FROM public.businesses
    WHERE id=_business AND in_house AND is_active FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('sent',false,'reason','Partner is not active in-house'); END IF;
  SELECT * INTO partner_row FROM public.businesses WHERE id=_business FOR SHARE;
  SELECT postcode INTO site_postcode FROM public.properties WHERE id=job_row.property_id;
  covered := COALESCE(partner_row.covers_all_victoria,false) OR COALESCE(site_postcode=ANY(partner_row.service_postcodes),false);
  IF NOT covered AND partner_row.coverage_lat IS NOT NULL AND partner_row.coverage_lng IS NOT NULL AND partner_row.coverage_radius_km>=0 THEN
    SELECT value INTO coords FROM public.property_facts WHERE property_id=job_row.property_id AND fact_key='coordinates' AND is_current
      ORDER BY created_at DESC LIMIT 1;
    IF jsonb_typeof(coords)='array' AND jsonb_array_length(coords)>=2
      AND jsonb_typeof(coords->0)='number' AND jsonb_typeof(coords->1)='number' THEN
      site_lng := (coords->>0)::double precision; site_lat := (coords->>1)::double precision;
      haversine := power(sin(radians(site_lat-partner_row.coverage_lat)/2),2)
        + cos(radians(site_lat))*cos(radians(partner_row.coverage_lat))*power(sin(radians(site_lng-partner_row.coverage_lng)/2),2);
      covered := 6371*2*asin(sqrt(least(1,haversine)))<=partner_row.coverage_radius_km;
    END IF;
  END IF;
  IF NOT COALESCE(covered,false) THEN RETURN jsonb_build_object('sent',false,'reason','Outside ' || partner_name || ' coverage'); END IF;

  PERFORM 1 FROM public.partner_workers w JOIN public.business_members m ON m.business_id=w.business_id AND m.user_id=w.profile_id
    WHERE w.business_id=_business AND w.profile_id=_installer AND w.trade_role='installer' AND w.approval_status='approved'
      AND w.removed_at IS NULL AND m.active FOR SHARE OF w,m;
  IF NOT FOUND THEN RETURN jsonb_build_object('sent',false,'reason','No approved installer worker'); END IF;
  PERFORM 1 FROM public.partner_workers w JOIN public.business_members m ON m.business_id=w.business_id AND m.user_id=w.profile_id
    WHERE w.business_id=_business AND w.profile_id=_electrician AND w.trade_role='electrician' AND w.approval_status='approved'
      AND w.removed_at IS NULL AND (w.licence_expires_on IS NULL OR w.licence_expires_on>=current_date) AND m.active FOR SHARE OF w,m;
  IF NOT FOUND THEN RETURN jsonb_build_object('sent',false,'reason','No approved electrician worker'); END IF;
  PERFORM 1 FROM public.profiles p JOIN public.partner_workers w ON w.profile_id=p.id
    WHERE p.id=_electrician AND w.business_id=_business AND w.trade_role='electrician' AND w.removed_at IS NULL
      AND p.mitti_user_id IS NOT NULL AND p.mitti_checked_at IS NOT NULL
      AND lower(trim(COALESCE(w.email,p.email)))<>''
      AND lower(trim(p.mitti_checked_email))=lower(trim(COALESCE(w.email,p.email))) FOR SHARE OF p;
  IF NOT FOUND THEN RETURN jsonb_build_object('sent',false,'reason','Electrician Mitti access is not current'); END IF;
  INSERT INTO public.in_house_batches(id,business_id,job_ids,sent_by) VALUES (_batch,_business,ARRAY[_job],_actor)
    ON CONFLICT(id) DO UPDATE SET job_ids=array_append(in_house_batches.job_ids,_job)
    WHERE in_house_batches.business_id=_business AND in_house_batches.sent_by=_actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'Batch belongs to a different partner or actor'; END IF;
  INSERT INTO public.job_assignments(job_id,user_id,role,business_id,active,assigned_by) VALUES
    (_job,_installer,'installer',_business,true,_actor),(_job,_electrician,'electrician',_business,true,_actor);
  UPDATE public.jobs SET electrician_choice='preferred' WHERE id=_job AND deleted_at IS NULL AND source<>'qa_test';
  INSERT INTO public.workflow_events(job_id,actor_id,event_type,summary,details,internal)
    VALUES (_job,_actor,'in_house_batch_sent','Ready Check allocated to ' || partner_name,
      jsonb_build_object('batch_id',_batch,'business_id',_business),true);
  SELECT id INTO approved_template FROM public.customer_communication_templates
    WHERE template_key='in_house_partner_will_call' AND status='approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL
    ORDER BY approved_at DESC LIMIT 1;
  -- I1: the send ledger is reserved only by the guarded sender immediately before delivery.
  -- Always retain pending intent, including when the template is still draft.
  INSERT INTO public.workflow_events(job_id,actor_id,event_type,summary,details,internal)
    VALUES (_job,_actor,'in_house_partner_call_email_pending','Ready Check partner call email pending',
      jsonb_build_object('batch_id',_batch,'business_id',_business,'partner_trading_name',partner_name)
      || CASE WHEN approved_template IS NOT NULL THEN jsonb_build_object('template_id',approved_template) ELSE '{}'::jsonb END,true);
  RETURN jsonb_build_object('sent',true);
END $$;
