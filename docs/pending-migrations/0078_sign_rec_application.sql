-- PENDING ROOT REVIEW — NOT APPLIED TO PRODUCTION.
-- Atomic REC agreement signing: one transaction, application row lock, expected-revision CAS,
-- synchronized office-review enquiry, idempotent same-agreement retry, and no deletes ever.
CREATE OR REPLACE FUNCTION public.sign_rec_application(
  _app_id uuid,
  _expected_updated_at timestamptz,
  _agreement_sha256 text,
  _enquiry jsonb,
  _signed jsonb
) RETURNS TABLE(outcome text, partner_enquiry_id uuid, signed_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.rec_onboarding_applications%ROWTYPE;
  pe uuid;
  sid text := 'portal-rec-onboarding-' || _app_id::text;
BEGIN
  SELECT * INTO a FROM public.rec_onboarding_applications WHERE id = _app_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rec_sign:not_found'; END IF;

  IF a.status <> 'draft' THEN
    -- Same agreement already signed (double click / retry after a lost response): idempotent success.
    IF a.agreement_sha256 = _agreement_sha256 AND a.partner_enquiry_id IS NOT NULL THEN
      RETURN QUERY SELECT 'already_signed_same'::text, a.partner_enquiry_id, a.signed_at; RETURN;
    END IF;
    RAISE EXCEPTION 'rec_sign:already_signed';
  END IF;
  IF a.updated_at IS DISTINCT FROM _expected_updated_at THEN RAISE EXCEPTION 'rec_sign:stale'; END IF;
  IF _enquiry->>'submission_id' IS DISTINCT FROM sid THEN RAISE EXCEPTION 'rec_sign:bad_submission'; END IF;
  IF _signed->>'agreement_sha256' IS DISTINCT FROM _agreement_sha256 OR _agreement_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'rec_sign:bad_hash';
  END IF;

  -- The application is locked and still a draft, so no winning submission can reference an
  -- existing row for this submission id: refresh it so it always matches the signed record.
  INSERT INTO public.partner_enquiries AS p (
    source_system, enquiry_type, submission_id, source, name, email, phone, company, service_areas,
    rec_registration_number, esv_licensed_electricians_confirmed, services, estimated_piesa_fee_inc_gst,
    booking_lead_time, weekly_capacity, source_created_at, source_updated_at, raw_payload
  ) VALUES (
    'portal_form', 'electrician_rec', sid, _enquiry->>'source', _enquiry->>'name', _enquiry->>'email', _enquiry->>'phone', _enquiry->>'company',
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(_enquiry->'service_areas', '[]'::jsonb))),
    _enquiry->>'rec_registration_number', (_enquiry->>'esv_licensed_electricians_confirmed')::boolean,
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(_enquiry->'services', '[]'::jsonb))),
    (_enquiry->>'estimated_piesa_fee_inc_gst')::numeric, _enquiry->>'booking_lead_time', _enquiry->>'weekly_capacity',
    (_enquiry->>'source_created_at')::timestamptz, (_enquiry->>'source_updated_at')::timestamptz, _enquiry->'raw_payload'
  )
  ON CONFLICT (source_system, enquiry_type, submission_id) DO UPDATE SET
    source = EXCLUDED.source, name = EXCLUDED.name, email = EXCLUDED.email, phone = EXCLUDED.phone, company = EXCLUDED.company,
    service_areas = EXCLUDED.service_areas, rec_registration_number = EXCLUDED.rec_registration_number,
    esv_licensed_electricians_confirmed = EXCLUDED.esv_licensed_electricians_confirmed, services = EXCLUDED.services,
    estimated_piesa_fee_inc_gst = EXCLUDED.estimated_piesa_fee_inc_gst, booking_lead_time = EXCLUDED.booking_lead_time,
    weekly_capacity = EXCLUDED.weekly_capacity, source_created_at = EXCLUDED.source_created_at,
    source_updated_at = EXCLUDED.source_updated_at, raw_payload = EXCLUDED.raw_payload
  RETURNING p.id INTO pe;

  UPDATE public.rec_onboarding_applications SET
    status = 'submitted', step_key = 'sign',
    agreement_version = _signed->>'agreement_version', agreement_title = _signed->>'agreement_title',
    agreement_text = _signed->>'agreement_text', agreement_sha256 = _agreement_sha256,
    acknowledgements = _signed->'acknowledgements',
    signer_name = _signed->>'signer_name', signer_position = _signed->>'signer_position', signer_email = _signed->>'signer_email',
    signed_at = (_signed->>'signed_at')::timestamptz, signed_ip = _signed->>'signed_ip', signed_user_agent = _signed->>'signed_user_agent',
    partner_enquiry_id = pe
  WHERE id = _app_id;

  RETURN QUERY SELECT 'signed'::text, pe, (_signed->>'signed_at')::timestamptz;
END $$;

REVOKE ALL ON FUNCTION public.sign_rec_application(uuid, timestamptz, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sign_rec_application(uuid, timestamptz, text, jsonb, jsonb) TO service_role;
