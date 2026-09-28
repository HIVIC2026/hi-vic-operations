CREATE TYPE public.job_channel AS ENUM ('hivic_sourced','installer_sourced');
CREATE TYPE public.commercial_model AS ENUM ('hivic_invoices_owner','installer_invoices_owner','not_configured');

ALTER TABLE public.jobs
  ADD COLUMN channel public.job_channel NOT NULL DEFAULT 'hivic_sourced',
  ADD COLUMN originating_installer_business_id uuid REFERENCES public.businesses(id),
  ADD COLUMN originating_installer_user_id uuid REFERENCES public.profiles(id),
  ADD COLUMN commercial_model public.commercial_model NOT NULL DEFAULT 'hivic_invoices_owner',
  ADD COLUMN commercial_model_set_by uuid REFERENCES public.profiles(id),
  ADD COLUMN commercial_model_set_at timestamptz;

CREATE INDEX jobs_channel_idx ON public.jobs(channel);
CREATE INDEX jobs_orig_installer_idx ON public.jobs(originating_installer_user_id);

-- Source and attribution are permanent once the job exists.
CREATE OR REPLACE FUNCTION public.guard_job_source()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
begin
  if new.channel is distinct from old.channel
     or new.originating_installer_business_id is distinct from old.originating_installer_business_id
     or new.originating_installer_user_id is distinct from old.originating_installer_user_id then
    raise exception 'job source and originating installer are permanent and cannot be changed';
  end if;
  return new;
end $$;
CREATE TRIGGER jobs_guard_source BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.guard_job_source();

CREATE OR REPLACE FUNCTION public.check_job_source()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
begin
  if new.channel = 'installer_sourced' and (new.originating_installer_user_id is null or new.originating_installer_business_id is null) then
    raise exception 'installer-sourced jobs require an originating installer and business';
  end if;
  if new.channel = 'hivic_sourced' and (new.originating_installer_user_id is not null or new.originating_installer_business_id is not null) then
    raise exception 'HI VIC-sourced jobs cannot carry an originating installer';
  end if;
  return new;
end $$;
CREATE TRIGGER jobs_check_source BEFORE INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.check_job_source();

CREATE OR REPLACE VIEW public.job_overview WITH (security_invoker = true) AS
 SELECT j.id, j.job_number, j.stage, j.next_action, j.eligibility_outcome, j.life_support, j.last_activity_at, j.created_at, j.hold_reason,
    pr.id AS property_id,
    concat_ws(', '::text, pr.address_line, pr.suburb, (pr.state || ' '::text) || COALESCE(pr.postcode, ''::text)) AS property_address,
    o.id AS owner_id, o.full_name AS owner_name, o.phone AS owner_phone, o.email AS owner_email,
    ea.user_id AS electrician_id, ep.full_name AS electrician_name,
    ia.user_id AS installer_id, ip.full_name AS installer_name,
    d.piesa_date, d.install_deadline, d.days_remaining, d.urgency, d.piesa_expired,
    ( SELECT p.effective_status::text FROM invoice_status p WHERE p.job_id = j.id ORDER BY p.created_at DESC LIMIT 1) AS payment_status,
    job_authority_status(j.id) AS authority_status,
    job_authority_expires_at(j.id) AS authority_expires_at,
    job_deposit_cleared(j.id) AS deposit_cleared,
    j.channel,
    j.commercial_model,
    j.originating_installer_user_id,
    ob.name AS originating_business_name
   FROM jobs j
     JOIN properties pr ON pr.id = j.property_id
     JOIN owners o ON o.id = j.owner_id
     LEFT JOIN job_assignments ea ON ea.job_id = j.id AND ea.active AND ea.role = 'electrician'::assignment_role
     LEFT JOIN profiles ep ON ep.id = ea.user_id
     LEFT JOIN job_assignments ia ON ia.job_id = j.id AND ia.active AND ia.role = 'installer'::assignment_role
     LEFT JOIN profiles ip ON ip.id = ia.user_id
     LEFT JOIN job_piesa_deadlines d ON d.job_id = j.id
     LEFT JOIN businesses ob ON ob.id = j.originating_installer_business_id;