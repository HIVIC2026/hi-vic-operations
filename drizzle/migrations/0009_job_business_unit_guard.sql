-- Business-unit barrier: only Home Insulation Victoria ('hivic') jobs may ever be automated in Xero.
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS business_unit text;
UPDATE public.jobs SET business_unit = 'hivic' WHERE business_unit IS NULL;
ALTER TABLE public.jobs ALTER COLUMN business_unit SET NOT NULL;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_business_unit_format CHECK (business_unit ~ '^[a-z][a-z0-9_]*$');
COMMENT ON COLUMN public.jobs.business_unit IS 'Immutable business unit. Xero automation runs only when exactly ''hivic''. Set explicitly by every creation path.';

CREATE OR REPLACE FUNCTION public.guard_job_source()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
begin
  if new.channel is distinct from old.channel
     or new.originating_installer_business_id is distinct from old.originating_installer_business_id
     or new.originating_installer_user_id is distinct from old.originating_installer_user_id then
    raise exception 'job source and originating installer are permanent and cannot be changed';
  end if;
  if new.business_unit is distinct from old.business_unit then
    raise exception 'job business_unit is permanent and cannot be changed (was %, attempted %)', old.business_unit, new.business_unit;
  end if;
  return new;
end $function$;