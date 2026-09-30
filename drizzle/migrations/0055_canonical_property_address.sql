CREATE OR REPLACE FUNCTION public.format_property_address(
  _address_line text,
  _suburb text,
  _state text,
  _postcode text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  result text := btrim(COALESCE(_address_line, ''));
  suburb_part text := NULLIF(btrim(COALESCE(_suburb, '')), '');
  state_part text := NULLIF(upper(btrim(COALESCE(_state, ''))), '');
  postcode_part text := NULLIF(btrim(COALESCE(_postcode, '')), '');
BEGIN
  IF suburb_part IS NOT NULL AND result !~* ('(^|[,[:space:]])' || regexp_replace(suburb_part, '([.\\+*?\[\](){}|^$])', '\\\1', 'g') || '([,[:space:]]|$)') THEN
    result := concat_ws(', ', NULLIF(result, ''), suburb_part);
  END IF;
  IF state_part IS NOT NULL AND result !~* ('(^|[,[:space:]])' || regexp_replace(state_part, '([.\\+*?\[\](){}|^$])', '\\\1', 'g') || '([,[:space:]]|$)') THEN
    result := concat_ws(', ', NULLIF(result, ''), state_part);
  END IF;
  IF postcode_part IS NOT NULL AND result !~ ('(^|[^0-9])' || regexp_replace(postcode_part, '([.\\+*?\[\](){}|^$])', '\\\1', 'g') || '([^0-9]|$)') THEN
    result := concat_ws(' ', NULLIF(result, ''), postcode_part);
  END IF;
  RETURN NULLIF(regexp_replace(result, '[[:space:]]+', ' ', 'g'), '');
END;
$$;

GRANT EXECUTE ON FUNCTION public.format_property_address(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.format_property_address(text, text, text, text) TO service_role;

CREATE OR REPLACE VIEW public.job_overview WITH (security_invoker = true) AS
 SELECT j.id, j.job_number, j.stage, j.next_action, j.eligibility_outcome, j.life_support, j.last_activity_at, j.created_at, j.hold_reason,
    pr.id AS property_id,
    public.format_property_address(pr.address_line, pr.suburb, pr.state, pr.postcode) AS property_address,
    o.id AS owner_id, o.full_name AS owner_name, o.phone AS owner_phone, o.email AS owner_email,
    ea.user_id AS electrician_id, ep.full_name AS electrician_name,
    ia.user_id AS installer_id, ip.full_name AS installer_name,
    d.piesa_date, d.install_deadline, d.days_remaining, d.urgency, d.piesa_expired,
    ( SELECT (p.effective_status)::text FROM invoice_status p WHERE p.job_id = j.id ORDER BY p.created_at DESC LIMIT 1) AS payment_status,
    job_authority_status(j.id) AS authority_status,
    job_authority_expires_at(j.id) AS authority_expires_at,
    job_deposit_cleared(j.id) AS deposit_cleared,
    j.channel, j.commercial_model, j.originating_installer_user_id,
    ob.name AS originating_business_name,
    j.source,
    j.eligibility_review_required,
    j.eligibility_flags
   FROM jobs j
     JOIN properties pr ON pr.id = j.property_id
     JOIN owners o ON o.id = j.owner_id
     LEFT JOIN job_assignments ea ON ea.job_id = j.id AND ea.active AND ea.role = 'electrician'::assignment_role
     LEFT JOIN profiles ep ON ep.id = ea.user_id
     LEFT JOIN job_assignments ia ON ia.job_id = j.id AND ia.active AND ia.role = 'installer'::assignment_role
     LEFT JOIN profiles ip ON ip.id = ia.user_id
     LEFT JOIN job_piesa_deadlines d ON d.job_id = j.id
     LEFT JOIN businesses ob ON ob.id = j.originating_installer_business_id;