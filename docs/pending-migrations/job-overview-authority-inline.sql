-- PENDING ONLY: one access-filtered definer read per query; existing view ACL/owner retained.
CREATE OR REPLACE FUNCTION public.job_authority_latest()
RETURNS TABLE(job_id uuid, status text, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT ON (oa.job_id) oa.job_id,
    CASE WHEN oa.status = 'accepted' AND oa.expires_at < now() THEN 'expired'
      ELSE oa.status::text END AS status,
    oa.expires_at
  FROM public.owner_authorities oa
  WHERE (SELECT public.is_admin()) OR public.can_access_job(oa.job_id)
  ORDER BY oa.job_id, oa.version DESC
$$;
REVOKE ALL ON FUNCTION public.job_authority_latest() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_authority_latest() TO authenticated, service_role;

CREATE OR REPLACE VIEW public.job_overview WITH (security_invoker = true) AS
 SELECT j.id, j.job_number, j.stage, j.next_action, j.eligibility_outcome, j.life_support, j.last_activity_at, j.created_at, j.hold_reason,
    pr.id AS property_id,
    public.format_property_address(pr.address_line, pr.suburb, pr.state, pr.postcode) AS property_address,
    o.id AS owner_id, o.full_name AS owner_name, o.phone AS owner_phone, o.email AS owner_email,
    ea.user_id AS electrician_id, ep.full_name AS electrician_name,
    ia.user_id AS installer_id, ip.full_name AS installer_name,
    d.piesa_date, d.install_deadline, d.days_remaining, d.urgency, d.piesa_expired,
    ( SELECT (p.effective_status)::text FROM invoice_status p WHERE p.job_id = j.id AND p.kind = 'installation'::quote_kind ORDER BY p.created_at DESC LIMIT 1) AS payment_status,
    CASE WHEN la.job_id IS NOT NULL THEN la.status
      WHEN (SELECT public.is_admin()) OR public.can_access_job(j.id) THEN 'not_requested'
      ELSE NULL::text END AS authority_status,
    la.expires_at AS authority_expires_at,
    job_deposit_cleared(j.id) AS deposit_cleared,
    j.channel, j.commercial_model, j.originating_installer_user_id,
    ob.name AS originating_business_name,
    j.source,
    j.eligibility_review_required,
    j.eligibility_flags
   FROM jobs j
     LEFT JOIN public.job_authority_latest() la ON la.job_id = j.id
     JOIN properties pr ON pr.id = j.property_id
     JOIN owners o ON o.id = j.owner_id
     LEFT JOIN job_assignments ea ON ea.job_id = j.id AND ea.active AND ea.role = 'electrician'::assignment_role
     LEFT JOIN profiles ep ON ep.id = ea.user_id
     LEFT JOIN job_assignments ia ON ia.job_id = j.id AND ia.active AND ia.role = 'installer'::assignment_role
     LEFT JOIN profiles ip ON ip.id = ia.user_id
     LEFT JOIN job_piesa_deadlines d ON d.job_id = j.id
     LEFT JOIN businesses ob ON ob.id = j.originating_installer_business_id;
