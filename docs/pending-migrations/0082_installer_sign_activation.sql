-- Installer onboarding: atomic signing, per-worker CII verification, atomic activation and work preferences.
-- Additive only: new nullable columns, one append-only table, one trigger, two service-role functions.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS accepting_new_jobs boolean,
  ADD COLUMN IF NOT EXISTS receives_hivic_leads boolean,
  ADD COLUMN IF NOT EXISTS typical_days text[],
  ADD COLUMN IF NOT EXISTS lead_time text;
COMMENT ON COLUMN public.businesses.accepting_new_jobs IS 'Partner-declared availability for new work. Separate from onboarding approval; false blocks new offers.';
COMMENT ON COLUMN public.businesses.receives_hivic_leads IS 'false = own customers only; Home Insulation Victoria leads are never offered.';

ALTER TABLE public.partner_workers
  ADD COLUMN IF NOT EXISTS certification_status text,
  ADD COLUMN IF NOT EXISTS certification jsonb;
COMMENT ON COLUMN public.partner_workers.certification_status IS 'Installer EEC CII status from office verification only: unverified | verified | rejected. Null for electricians.';

CREATE TABLE public.partner_worker_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid REFERENCES public.rec_onboarding_applications(id),
  worker_id uuid REFERENCES public.partner_workers(id),
  worker_email text NOT NULL,
  status text NOT NULL CHECK (status IN ('verified', 'rejected')),
  certificate_number text,
  issuer text,
  evidence_source text NOT NULL CHECK (evidence_source IN ('certificate_sighted', 'issuer_register_checked')),
  evidence_note text NOT NULL CHECK (length(btrim(evidence_note)) >= 10),
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (application_id IS NOT NULL OR worker_id IS NOT NULL),
  CHECK (status <> 'verified' OR length(btrim(coalesce(certificate_number, ''))) > 0)
);
GRANT SELECT ON public.partner_worker_certifications TO authenticated;
GRANT ALL ON public.partner_worker_certifications TO service_role;
ALTER TABLE public.partner_worker_certifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Office reads worker certifications" ON public.partner_worker_certifications FOR SELECT TO authenticated USING (public.is_admin());
CREATE INDEX partner_worker_certifications_app_idx ON public.partner_worker_certifications(application_id, lower(worker_email));
CREATE INDEX partner_worker_certifications_worker_idx ON public.partner_worker_certifications(worker_id);
CREATE FUNCTION public.guard_worker_certification_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Worker certification records are permanent'; END $$;
CREATE TRIGGER partner_worker_certifications_immutable BEFORE UPDATE OR DELETE ON public.partner_worker_certifications
  FOR EACH ROW EXECUTE FUNCTION public.guard_worker_certification_immutable();

-- An installer can only become (or stay newly) approved with an office-verified CII certification. No override path.
CREATE FUNCTION public.guard_installer_worker_certified() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.trade_role::text = 'installer' AND NEW.approval_status = 'approved'
     AND (TG_OP = 'INSERT' OR OLD.approval_status IS DISTINCT FROM 'approved' OR OLD.certification_status IS DISTINCT FROM NEW.certification_status)
     AND NEW.certification_status IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'worker_cert:unverified';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER partner_workers_installer_certified BEFORE INSERT OR UPDATE ON public.partner_workers
  FOR EACH ROW EXECUTE FUNCTION public.guard_installer_worker_certified();

-- One transaction: lock the draft, check the exact reviewed revision + agreement hash, upsert the office entry,
-- queue nominated electricians, then mark signed. Replay of the same signature is idempotent; never deletes.
CREATE FUNCTION public.sign_installer_application(
  _app_id uuid, _expected_updated_at timestamptz, _agreement_sha256 text, _enquiry jsonb, _signed jsonb, _nominations jsonb
) RETURNS TABLE(outcome text, partner_enquiry_id uuid, signed_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a public.rec_onboarding_applications%ROWTYPE;
  pe uuid;
  n jsonb;
  sid text := 'portal-installer-onboarding-' || _app_id::text;
BEGIN
  SELECT * INTO a FROM public.rec_onboarding_applications WHERE id = _app_id FOR UPDATE;
  IF NOT FOUND OR a.partner_type <> 'installer' THEN RAISE EXCEPTION 'installer_sign:not_found'; END IF;
  IF a.status <> 'draft' THEN
    IF a.agreement_sha256 = _agreement_sha256 AND a.partner_enquiry_id IS NOT NULL THEN
      RETURN QUERY SELECT 'already_signed_same'::text, a.partner_enquiry_id, a.signed_at; RETURN;
    END IF;
    RAISE EXCEPTION 'installer_sign:already_signed';
  END IF;
  IF a.updated_at IS DISTINCT FROM _expected_updated_at THEN RAISE EXCEPTION 'installer_sign:stale'; END IF;
  IF _enquiry->>'submission_id' IS DISTINCT FROM sid OR _enquiry->>'enquiry_type' IS DISTINCT FROM 'installer' THEN RAISE EXCEPTION 'installer_sign:bad_submission'; END IF;
  IF _signed->>'agreement_sha256' IS DISTINCT FROM _agreement_sha256 OR _agreement_sha256 !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'installer_sign:bad_hash'; END IF;

  INSERT INTO public.partner_enquiries AS p (
    source_system, enquiry_type, submission_id, source, name, email, phone, company, service_areas,
    cii_certification_status, cii_certification_details, services,
    estimated_r5_install_rate_per_sqm_inc_gst, estimated_batts_removal_rate_per_sqm_inc_gst, estimated_loose_fill_removal_rate_per_sqm_inc_gst,
    free_quotes_for_hivic_leads, free_measureups_for_hivic_quote_leads, booking_lead_time, weekly_capacity,
    source_created_at, source_updated_at, raw_payload
  ) VALUES (
    'portal_form', 'installer', sid, _enquiry->>'source', _enquiry->>'name', _enquiry->>'email', _enquiry->>'phone', _enquiry->>'company',
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(_enquiry->'service_areas', '[]'::jsonb))),
    _enquiry->>'cii_certification_status', _enquiry->>'cii_certification_details',
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(_enquiry->'services', '[]'::jsonb))),
    (_enquiry->>'estimated_r5_install_rate_per_sqm_inc_gst')::numeric, (_enquiry->>'estimated_batts_removal_rate_per_sqm_inc_gst')::numeric,
    (_enquiry->>'estimated_loose_fill_removal_rate_per_sqm_inc_gst')::numeric,
    (_enquiry->>'free_quotes_for_hivic_leads')::boolean, (_enquiry->>'free_measureups_for_hivic_quote_leads')::boolean,
    _enquiry->>'booking_lead_time', _enquiry->>'weekly_capacity',
    (_enquiry->>'source_created_at')::timestamptz, (_enquiry->>'source_updated_at')::timestamptz, _enquiry->'raw_payload'
  )
  ON CONFLICT (source_system, enquiry_type, submission_id) DO UPDATE SET
    source = EXCLUDED.source, name = EXCLUDED.name, email = EXCLUDED.email, phone = EXCLUDED.phone, company = EXCLUDED.company,
    service_areas = EXCLUDED.service_areas, cii_certification_status = EXCLUDED.cii_certification_status,
    cii_certification_details = EXCLUDED.cii_certification_details, services = EXCLUDED.services,
    estimated_r5_install_rate_per_sqm_inc_gst = EXCLUDED.estimated_r5_install_rate_per_sqm_inc_gst,
    estimated_batts_removal_rate_per_sqm_inc_gst = EXCLUDED.estimated_batts_removal_rate_per_sqm_inc_gst,
    estimated_loose_fill_removal_rate_per_sqm_inc_gst = EXCLUDED.estimated_loose_fill_removal_rate_per_sqm_inc_gst,
    free_quotes_for_hivic_leads = EXCLUDED.free_quotes_for_hivic_leads, free_measureups_for_hivic_quote_leads = EXCLUDED.free_measureups_for_hivic_quote_leads,
    booking_lead_time = EXCLUDED.booking_lead_time, weekly_capacity = EXCLUDED.weekly_capacity,
    source_created_at = EXCLUDED.source_created_at, source_updated_at = EXCLUDED.source_updated_at, raw_payload = EXCLUDED.raw_payload
  RETURNING p.id INTO pe;

  FOR n IN SELECT * FROM jsonb_array_elements(COALESCE(_nominations, '[]'::jsonb)) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.electrician_nominations e WHERE e.installer_application_id = _app_id AND e.job_id IS NULL AND lower(e.email) = lower(n->>'email')) THEN
      INSERT INTO public.electrician_nominations (installer_application_id, nominated_for, contact_name, email, phone, business_name, licence_number, rec_number, is_primary, consent_confirmed_at, status)
      VALUES (_app_id, 'installer_team', n->>'contact_name', lower(n->>'email'), n->>'phone', n->>'business_name', n->>'licence_number', n->>'rec_number',
        COALESCE((n->>'is_primary')::boolean, false), (_signed->>'signed_at')::timestamptz, 'invite_pending_comms');
    END IF;
  END LOOP;

  UPDATE public.rec_onboarding_applications SET
    status = 'submitted', step_key = 'sign',
    agreement_version = _signed->>'agreement_version', agreement_title = _signed->>'agreement_title',
    agreement_text = _signed->>'agreement_text', agreement_sha256 = _agreement_sha256,
    acknowledgements = _signed->'acknowledgements',
    signer_name = _signed->>'signer_name', signer_position = _signed->>'signer_position', signer_email = _signed->>'signer_email',
    signed_at = (_signed->>'signed_at')::timestamptz, signed_ip = _signed->>'signed_ip', signed_user_agent = _signed->>'signed_user_agent',
    partner_enquiry_id = pe
  WHERE id = _app_id AND status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'installer_sign:stale'; END IF;

  RETURN QUERY SELECT 'signed'::text, pe, (_signed->>'signed_at')::timestamptz;
END $$;
REVOKE ALL ON FUNCTION public.sign_installer_application(uuid, timestamptz, text, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sign_installer_application(uuid, timestamptz, text, jsonb, jsonb, jsonb) TO service_role;

-- One transaction for partner activation (REC and installer). Business approval is the LAST write, so a failure
-- anywhere leaves no approved/active business, no half rate card and no activation row. Retry-safe.
CREATE FUNCTION public.activate_partner_application(_app_id uuid, _actor uuid, _override text, _plan jsonb)
RETURNS TABLE(outcome text, business_id uuid, rate_card_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a public.rec_onboarding_applications%ROWTYPE;
  ex public.partner_activations%ROWTYPE;
  biz uuid;
  card uuid;
  ver integer;
  w jsonb;
  cap text := _plan->>'capability';
  b jsonb := _plan->'business';
  now_ts timestamptz := now();
BEGIN
  IF _actor IS NULL OR NOT public.has_role(_actor, 'admin') THEN RAISE EXCEPTION 'activate:forbidden'; END IF;
  SELECT * INTO a FROM public.rec_onboarding_applications WHERE id = _app_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'activate:not_found'; END IF;
  SELECT * INTO ex FROM public.partner_activations WHERE application_id = _app_id;
  IF FOUND THEN RETURN QUERY SELECT 'already_activated'::text, ex.business_id, ex.rate_card_id; RETURN; END IF;
  IF a.status <> 'submitted' OR a.partner_enquiry_id IS NULL THEN RAISE EXCEPTION 'activate:not_signed'; END IF;
  IF a.test_mode THEN RAISE EXCEPTION 'activate:test_application'; END IF;
  IF cap NOT IN ('electrician', 'installer') OR jsonb_array_length(COALESCE(_plan->'items', '[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'activate:bad_plan'; END IF;

  IF _plan->>'abn' IS NOT NULL THEN SELECT id INTO biz FROM public.businesses WHERE abn = _plan->>'abn' ORDER BY created_at LIMIT 1 FOR UPDATE; END IF;
  IF biz IS NULL THEN
    INSERT INTO public.businesses (name, legal_name, trading_name, abn, business_type, capabilities, onboarding_status, is_active)
    VALUES (b->>'name', b->>'legal_name', b->>'trading_name', _plan->>'abn', (b->>'business_type')::business_type, ARRAY[cap], 'pending', false)
    RETURNING id INTO biz;
  END IF;
  -- Reconcile: add this capability without removing others; refresh contact, GST, coverage and preferences from the signed application.
  UPDATE public.businesses SET
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
    INSERT INTO public.partner_workers AS pw (business_id, trade_role, full_legal_name, email, mobile, licence_number, qualification, source_application_id, certification_status, certification)
    VALUES (biz, (w->>'trade_role')::assignment_role, w->>'full_legal_name', w->>'email', w->>'mobile', w->>'licence_number', w->>'qualification', _app_id, w->>'certification_status', w->'certification')
    ON CONFLICT (business_id, email) DO UPDATE SET
      full_legal_name = EXCLUDED.full_legal_name, mobile = COALESCE(EXCLUDED.mobile, pw.mobile),
      licence_number = COALESCE(EXCLUDED.licence_number, pw.licence_number), qualification = COALESCE(EXCLUDED.qualification, pw.qualification),
      certification_status = COALESCE(EXCLUDED.certification_status, pw.certification_status), certification = COALESCE(EXCLUDED.certification, pw.certification);
  END LOOP;

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
