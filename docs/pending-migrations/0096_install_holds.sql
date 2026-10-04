-- Step 9 Part A: installer daily m2 capacity + install holds. Additive only; rerun-safe.
-- A hold is NOT an appointment: no contact release, not an owner booking, never allows installation.
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS daily_capacity_m2 numeric;
DO $$ BEGIN
  ALTER TABLE public.businesses ADD CONSTRAINT businesses_daily_capacity_m2_positive CHECK (daily_capacity_m2 IS NULL OR (daily_capacity_m2 > 0 AND daily_capacity_m2 <= 10000));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN public.businesses.daily_capacity_m2 IS 'Optional m2 per day per lead installer. NULL = no limit.';

CREATE TABLE IF NOT EXISTS public.install_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  installer_business_id uuid REFERENCES public.businesses(id),
  area_m2 numeric NOT NULL DEFAULT 0 CHECK (area_m2 >= 0),
  target_week_start date NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released', 'converted')),
  reason text NOT NULL,
  over_capacity boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  release_reason text
);
CREATE UNIQUE INDEX IF NOT EXISTS install_holds_one_active_per_job ON public.install_holds (job_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS install_holds_business_week ON public.install_holds (installer_business_id, target_week_start) WHERE status = 'active';

GRANT SELECT ON public.install_holds TO authenticated;
GRANT ALL ON public.install_holds TO service_role;
ALTER TABLE public.install_holds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Office reads install holds" ON public.install_holds;
CREATE POLICY "Office reads install holds" ON public.install_holds FOR SELECT TO authenticated USING (public.is_admin());

-- Place or move the job's single active hold, locked per job so two calls can't create two holds.
CREATE OR REPLACE FUNCTION public.place_install_hold(_job uuid, _business uuid, _area numeric, _week date, _reason text, _over boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  IF _reason IS NULL OR length(trim(_reason)) = 0 THEN RAISE EXCEPTION 'A reason is required for an install hold.'; END IF;
  PERFORM 1 FROM public.jobs WHERE id = _job FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found.'; END IF;
  SELECT id INTO _id FROM public.install_holds WHERE job_id = _job AND status = 'active';
  IF _id IS NULL THEN
    INSERT INTO public.install_holds (job_id, installer_business_id, area_m2, target_week_start, reason, over_capacity)
    VALUES (_job, _business, coalesce(_area, 0), _week, _reason, coalesce(_over, false)) RETURNING id INTO _id;
  ELSE
    UPDATE public.install_holds SET installer_business_id = _business, area_m2 = coalesce(_area, 0), target_week_start = _week,
      reason = _reason, over_capacity = coalesce(_over, false), updated_at = now() WHERE id = _id;
  END IF;
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.place_install_hold(uuid, uuid, numeric, date, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_install_hold(uuid, uuid, numeric, date, text, boolean) TO service_role;
