-- Restore the previously applied RPC body exactly (I1/I3 rollback); no row changes.
CREATE OR REPLACE FUNCTION public.allocate_in_house_batch_job(
  _batch uuid, _business uuid, _job uuid, _actor uuid, _installer uuid, _electrician uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE job_row public.jobs%ROWTYPE; partner_name text; existing_name text; approved_template uuid;
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
    OR NOT EXISTS (SELECT 1 FROM public.lead_campaign_responses WHERE job_id=_job AND spot_saved_at IS NOT NULL) THEN
    RETURN jsonb_build_object('sent',false,'reason','Not a saved spot waiting for a Ready Check');
  END IF;
  IF EXISTS (SELECT 1 FROM public.customer_email_optouts WHERE job_id=_job AND opted_out_at IS NOT NULL) THEN
    RETURN jsonb_build_object('sent',false,'reason','Owner opted out');
  END IF;
  -- Partner lock prevents a concurrent office disable; worker/member locks keep selected people current.
  SELECT COALESCE(trading_name,name) INTO partner_name FROM public.businesses
    WHERE id=_business AND in_house AND is_active FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('sent',false,'reason','Partner is not active in-house'); END IF;
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
  IF approved_template IS NOT NULL THEN
    -- Live status CHECK has no 'queued'. A purpose-scoped failed/held entry is inert:
    -- existing retry readers select OTHER explicit purposes. No delivery worker is added by this task.
    INSERT INTO public.customer_email_sends(job_id,purpose,idempotency_key,status,error)
      VALUES (_job,'in_house_partner_will_call','in-house-partner-will-call:' || _job,'failed','queued: awaiting guarded delivery')
      ON CONFLICT(idempotency_key) DO NOTHING;
    INSERT INTO public.workflow_events(job_id,actor_id,event_type,summary,details,internal)
      VALUES (_job,_actor,'in_house_batch_email_queued','Ready Check partner email queued',
        jsonb_build_object('batch_id',_batch,'business_id',_business,'template_id',approved_template,'partner_trading_name',partner_name),true);
  END IF;
  RETURN jsonb_build_object('sent',true);
END $$;
