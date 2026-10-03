-- Keep the staged installer signing function compatible with the production nomination constraint.
-- The live function already contains this value; this migration records the correction for clean rebuilds.

CREATE OR REPLACE FUNCTION public.sign_installer_application(
  _app_id uuid, _expected_updated_at timestamptz, _agreement_sha256 text,
  _enquiry jsonb, _signed jsonb, _nominations jsonb
) RETURNS TABLE(outcome text, partner_enquiry_id uuid, signed_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
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
      VALUES (_app_id, 'installer', n->>'contact_name', lower(n->>'email'), n->>'phone', n->>'business_name', n->>'licence_number', n->>'rec_number',
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