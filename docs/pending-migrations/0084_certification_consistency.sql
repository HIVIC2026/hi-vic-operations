-- 0084 certification consistency (follows live drizzle 0082_activation_corrections)
--  * record_worker_certification: resolves the worker by the activated business + email (reused workers keep an
--    older source_application_id), refuses a non-installer role, and takes the same app-row + ABN locks as activation.
--  * activate_partner_application: re-reads each installer's latest office certification under the lock (plan
--    values are ignored), and refuses installer activation with no verified installer.

CREATE OR REPLACE FUNCTION public.activate_partner_application(_app_id uuid, _actor uuid, _override text, _plan jsonb)
RETURNS TABLE(outcome text, business_id uuid, rate_card_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  a public.rec_onboarding_applications%ROWTYPE;
  ex public.partner_activations%ROWTYPE;
  biz uuid;
  card uuid;
  ver integer;
  w jsonb;
  abn_n text := NULLIF(regexp_replace(COALESCE(_plan->>'abn', ''), '\D', '', 'g'), '');
  ex_role text;
  wid uuid;
  cap text := _plan->>'capability';
  b jsonb := _plan->'business';
  now_ts timestamptz := now();
  cst text;
  cid uuid;
  verified_n integer := 0;
BEGIN
  IF _actor IS NULL OR NOT public.has_role(_actor, 'admin') THEN RAISE EXCEPTION 'activate:forbidden'; END IF;
  SELECT * INTO a FROM public.rec_onboarding_applications WHERE id = _app_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'activate:not_found'; END IF;
  SELECT * INTO ex FROM public.partner_activations WHERE application_id = _app_id;
  IF FOUND THEN RETURN QUERY SELECT 'already_activated'::text, ex.business_id, ex.rate_card_id; RETURN; END IF;
  IF a.status <> 'submitted' OR a.partner_enquiry_id IS NULL THEN RAISE EXCEPTION 'activate:not_signed'; END IF;
  IF a.test_mode THEN RAISE EXCEPTION 'activate:test_application'; END IF;
  IF cap NOT IN ('electrician', 'installer') OR jsonb_array_length(COALESCE(_plan->'items', '[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'activate:bad_plan'; END IF;

  -- Serialise every activation for the same ABN (two different applications cannot both create the first business).
  IF abn_n IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('partner_abn:' || abn_n, 0));
    SELECT id INTO biz FROM public.businesses WHERE regexp_replace(COALESCE(abn, ''), '\D', '', 'g') = abn_n ORDER BY created_at LIMIT 1 FOR UPDATE;
  END IF;
  IF biz IS NULL THEN
    -- New business stays inactive 'draft' (allowed by businesses_onboarding_status_check) until the final approval write.
    INSERT INTO public.businesses (name, legal_name, trading_name, abn, business_type, capabilities, onboarding_status, is_active)
    VALUES (b->>'name', b->>'legal_name', b->>'trading_name', abn_n, (b->>'business_type')::business_type, ARRAY[cap], 'draft', false)
    RETURNING id INTO biz;
  END IF;
  -- Reconcile: add this capability without removing others; refresh contact, GST, coverage and preferences from the signed application.
  UPDATE public.businesses SET
    name = COALESCE(NULLIF(btrim(b->>'name'), ''), name),
    capabilities = ARRAY(SELECT DISTINCT x FROM unnest(capabilities || ARRAY[cap]) x ORDER BY x),
    legal_name = COALESCE(b->>'legal_name', legal_name), trading_name = COALESCE(b->>'trading_name', trading_name),
    email = COALESCE(b->>'email', email), phone = COALESCE(b->>'phone', phone), address = COALESCE(b->>'address', address),
    gst_registered = COALESCE((b->>'gst_registered')::boolean, gst_registered),
    service_regions = ARRAY(SELECT DISTINCT x FROM unnest(service_regions || ARRAY(SELECT jsonb_array_elements_text(COALESCE(b->'service_regions', '[]'::jsonb)))) x),
    declared_service_origin = COALESCE(b->>'declared_service_origin', declared_service_origin),
    declared_travel_radius_km = COALESCE((b->>'declared_travel_radius_km')::integer, declared_travel_radius_km),
    declared_excluded_areas = COALESCE(b->>'declared_excluded_areas', declared_excluded_areas),
    free_measureups_for_hivic_quote_leads = CASE WHEN cap = 'installer' THEN (b->>'free_measureups_for_hivic_quote_leads')::boolean ELSE free_measureups_for_hivic_quote_leads END,
    weekly_capacity = COALESCE((b->>'weekly_capacity')::integer, weekly_capacity),
    rec_number = CASE WHEN cap = 'electrician' THEN COALESCE(b->>'rec_number', rec_number) ELSE rec_number END,
    installer_certification = CASE WHEN cap = 'installer' THEN COALESCE(b->'installer_certification', installer_certification) ELSE installer_certification END,
    accepting_new_jobs = (b->>'accepting_new_jobs')::boolean,
    receives_hivic_leads = CASE WHEN cap = 'installer' THEN (b->>'receives_hivic_leads')::boolean ELSE receives_hivic_leads END,
    typical_days = ARRAY(SELECT jsonb_array_elements_text(COALESCE(b->'typical_days', '[]'::jsonb))),
    lead_time = COALESCE(b->>'lead_time', lead_time)
  WHERE id = biz;

  FOR w IN SELECT * FROM jsonb_array_elements(COALESCE(_plan->'workers', '[]'::jsonb)) LOOP
    IF w->>'trade_role' = 'electrician' AND NULLIF(btrim(w->>'licence_number'), '') IS NULL THEN RAISE EXCEPTION 'activate:worker_missing_licence:%', w->>'email'; END IF;
    IF w->>'trade_role' = 'installer' AND NULLIF(btrim(w->>'qualification'), '') IS NULL THEN RAISE EXCEPTION 'activate:worker_missing_qualification:%', w->>'email'; END IF;
    -- Certification status is re-read here, under the application lock, from the append-only office history:
    -- a rejection committed after the office computed the plan is never overwritten by a stale "verified".
    cst := NULL; cid := NULL;
    IF w->>'trade_role' = 'installer' THEN
      SELECT c.status, c.id INTO cst, cid FROM public.partner_worker_certifications c
       WHERE c.application_id = _app_id AND lower(c.worker_email) = lower(w->>'email') ORDER BY c.recorded_at DESC, c.id DESC LIMIT 1;
      cst := COALESCE(cst, 'unverified');
      IF cst = 'verified' THEN verified_n := verified_n + 1; END IF;
      w := w || jsonb_build_object('certification_status', cst, 'certification', COALESCE(w->'certification', '{}'::jsonb) || jsonb_build_object('verification_id', cid));
    END IF;
    wid := NULL; ex_role := NULL;
    SELECT pw.id, pw.trade_role::text INTO wid, ex_role FROM public.partner_workers pw WHERE pw.business_id = biz AND lower(pw.email) = lower(w->>'email') LIMIT 1 FOR UPDATE;
    -- unique(business_id, email): one person cannot hold two trade roles in one business; refuse rather than overwrite.
    IF wid IS NOT NULL AND ex_role <> w->>'trade_role' THEN RAISE EXCEPTION 'activate:worker_role_conflict:%', w->>'email'; END IF;
    IF wid IS NULL THEN
      INSERT INTO public.partner_workers (business_id, trade_role, full_legal_name, email, mobile, licence_number, qualification, source_application_id, certification_status, certification)
      VALUES (biz, (w->>'trade_role')::assignment_role, w->>'full_legal_name', lower(w->>'email'), w->>'mobile', w->>'licence_number', w->>'qualification', _app_id, w->>'certification_status', w->'certification');
    ELSE
      UPDATE public.partner_workers pw SET
        full_legal_name = w->>'full_legal_name', mobile = COALESCE(w->>'mobile', pw.mobile),
        licence_number = COALESCE(w->>'licence_number', pw.licence_number), qualification = COALESCE(w->>'qualification', pw.qualification),
        certification_status = COALESCE(w->>'certification_status', pw.certification_status), certification = COALESCE(w->'certification', pw.certification)
      WHERE pw.id = wid;
    END IF;
  END LOOP;

  IF cap = 'installer' AND verified_n = 0 THEN RAISE EXCEPTION 'activate:no_verified_installer'; END IF;

  INSERT INTO public.business_credentials (business_id, kind, label, number, issuer, expires_at, critical, document_path, verification, verified_by, verified_at, created_by)
  SELECT biz, c->>'kind', c->>'label', c->>'number', c->>'issuer', (c->>'expires_at')::date, COALESCE((c->>'critical')::boolean, true), c->>'document_path', 'verified', _actor, now_ts, _actor
  FROM (SELECT _plan->'credential' AS c) s;

  SELECT COALESCE(max(version), 0) + 1 INTO ver FROM public.rate_cards WHERE public.rate_cards.business_id = biz AND kind = (_plan->>'rate_kind')::rate_card_kind;
  INSERT INTO public.rate_cards (kind, business_id, name, version, is_active) VALUES ((_plan->>'rate_kind')::rate_card_kind, biz, _plan->>'card_name', ver, false) RETURNING id INTO card;
  INSERT INTO public.rate_card_items (rate_card_id, code, description, category, unit, unit_price_ex_gst, r_value, sort, display_unit)
  SELECT card, i->>'code', i->>'description', i->>'category', i->>'unit', (i->>'unit_price_ex_gst')::numeric, (i->>'r_value')::numeric, (i->>'sort')::integer, i->>'display_unit'
  FROM jsonb_array_elements(_plan->'items') i;
  UPDATE public.rate_cards SET is_active = false WHERE public.rate_cards.business_id = biz AND kind = (_plan->>'rate_kind')::rate_card_kind AND is_active AND id <> card;
  UPDATE public.rate_cards SET is_active = true WHERE id = card;

  INSERT INTO public.partner_agreements (business_id, version, body, signer_name, signed_at, ip, user_agent, snapshot, snapshot_sha256)
  VALUES (biz, _plan->'agreement'->>'version', _plan->'agreement'->>'body', _plan->'agreement'->>'signer_name', COALESCE((_plan->'agreement'->>'signed_at')::timestamptz, now_ts),
    _plan->'agreement'->>'ip', _plan->'agreement'->>'user_agent', _plan->'agreement'->'snapshot', _plan->'agreement'->>'snapshot_sha256');

  INSERT INTO public.business_bank_details (business_id, account_name, bsb, account_number, updated_by, updated_at, supplied_at, supplied_by, review_status, reviewed_by, reviewed_at)
  VALUES (biz, _plan->'bank'->>'account_name', _plan->'bank'->>'bsb', _plan->'bank'->>'account_number', _actor, now_ts, COALESCE((_plan->'bank'->>'supplied_at')::timestamptz, now_ts), _actor, 'pending', NULL, NULL)
  ON CONFLICT (business_id) DO UPDATE SET account_name = EXCLUDED.account_name, bsb = EXCLUDED.bsb, account_number = EXCLUDED.account_number,
    updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at, supplied_at = EXCLUDED.supplied_at, supplied_by = EXCLUDED.supplied_by,
    review_status = 'pending', reviewed_by = NULL, reviewed_at = NULL;
  INSERT INTO public.business_bank_detail_events (business_id, actor_id, event_type, details) VALUES (biz, _actor, 'supplied', COALESCE(_plan->'bank_event', '{}'::jsonb));

  INSERT INTO public.partner_activations (application_id, partner_enquiry_id, business_id, partner_type, rate_card_id, activated_by, override_reason, snapshot)
  VALUES (_app_id, a.partner_enquiry_id, biz, a.partner_type, card, _actor, _override, _plan->'snapshot');
  UPDATE public.partner_enquiries SET status = 'approved', approved_at = now_ts, status_changed_by = _actor WHERE id = a.partner_enquiry_id;

  -- Last: approval. Never earlier, so no failure path leaves an approved business behind.
  UPDATE public.businesses SET onboarding_status = 'approved', approved_by = _actor, approved_at = now_ts, is_active = true,
    xero_contact_status = CASE WHEN xero_contact_status = 'not_ready' THEN 'ready' ELSE xero_contact_status END
  WHERE id = biz;
  RETURN QUERY SELECT 'activated'::text, biz, card;
END $$;
REVOKE ALL ON FUNCTION public.activate_partner_application(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_partner_application(uuid, uuid, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.record_worker_certification(
  _app_id uuid, _email text, _status text, _source text, _note text, _number text, _issuer text, _actor uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  a public.rec_onboarding_applications%ROWTYPE;
  e text := lower(btrim(_email));
  abn_n text;
  biz uuid;
  wid uuid;
  wrole text;
  cid uuid;
BEGIN
  IF _actor IS NULL OR NOT public.has_role(_actor, 'admin') THEN RAISE EXCEPTION 'cert:forbidden'; END IF;
  IF _status NOT IN ('verified', 'rejected') THEN RAISE EXCEPTION 'cert:bad_status'; END IF;
  -- Same lock order as activate_partner_application: application row, then the ABN advisory lock.
  SELECT * INTO a FROM public.rec_onboarding_applications WHERE id = _app_id FOR UPDATE;
  IF NOT FOUND OR a.partner_type <> 'installer' THEN RAISE EXCEPTION 'cert:not_found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(a.data->'installers', '[]'::jsonb)) x WHERE lower(btrim(x->>'email')) = e) THEN
    RAISE EXCEPTION 'cert:not_nominated';
  END IF;
  abn_n := NULLIF(regexp_replace(COALESCE(a.data->>'abn', ''), '\D', '', 'g'), '');
  IF abn_n IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('partner_abn:' || abn_n, 0)); END IF;
  -- Resolve the worker by the business this application actually activated (a reused worker keeps an older
  -- source_application_id), then by email; the role must be installer.
  SELECT pa.business_id INTO biz FROM public.partner_activations pa WHERE pa.application_id = _app_id;
  IF biz IS NOT NULL THEN
    SELECT pw.id, pw.trade_role::text INTO wid, wrole FROM public.partner_workers pw
     WHERE pw.business_id = biz AND lower(pw.email) = e LIMIT 1 FOR UPDATE;
    IF wid IS NOT NULL AND wrole <> 'installer' THEN RAISE EXCEPTION 'cert:worker_role_conflict'; END IF;
  END IF;
  INSERT INTO public.partner_worker_certifications (application_id, worker_id, worker_email, status, certificate_number, issuer, evidence_source, evidence_note, recorded_by)
  VALUES (_app_id, wid, e, _status, NULLIF(btrim(_number), ''), NULLIF(btrim(_issuer), ''), _source, _note, _actor) RETURNING id INTO cid;
  IF wid IS NOT NULL THEN
    UPDATE public.partner_workers SET
      certification_status = _status,
      certification = COALESCE(certification, '{}'::jsonb) || jsonb_build_object('verification_id', cid),
      approval_status = CASE WHEN _status = 'rejected' THEN 'rejected' ELSE approval_status END,
      rejection_reason = CASE WHEN _status = 'rejected' THEN 'CII certification rejected by office check' ELSE rejection_reason END,
      approved_at = CASE WHEN _status = 'rejected' THEN NULL ELSE approved_at END,
      approved_by = CASE WHEN _status = 'rejected' THEN NULL ELSE approved_by END
    WHERE id = wid;
  END IF;
  RETURN cid;
END $$;
REVOKE ALL ON FUNCTION public.record_worker_certification(uuid, text, text, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_worker_certification(uuid, text, text, text, text, text, text, uuid) TO service_role;
