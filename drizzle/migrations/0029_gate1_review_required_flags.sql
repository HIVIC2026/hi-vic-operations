ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS eligibility_review_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS eligibility_flags jsonb NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN public.jobs.eligibility_review_required IS 'Internal Gate 1 REVIEW REQUIRED state (never a customer outcome). Set only by the single Gate 1 categoriser.';
COMMENT ON COLUMN public.jobs.eligibility_flags IS 'Gate 1 safety/operational/data flags (life_support, roof_access_review, measure_required, rollout_hold).';

CREATE OR REPLACE VIEW public.job_overview WITH (security_invoker = true) AS
 SELECT j.id, j.job_number, j.stage, j.next_action, j.eligibility_outcome, j.life_support, j.last_activity_at, j.created_at, j.hold_reason,
    pr.id AS property_id,
    concat_ws(', '::text, pr.address_line, pr.suburb, ((pr.state || ' '::text) || COALESCE(pr.postcode, ''::text))) AS property_address,
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