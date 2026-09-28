ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS eligibility_decision_source text;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS eligibility_decision_rules jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS life_support_status text;
COMMENT ON COLUMN public.jobs.eligibility_decision_source IS 'admin | system | preliminary (Base44 info only). system = deterministic Gate 1 auto-decision, eligibility_set_by null.';
UPDATE public.jobs SET eligibility_decision_source = 'admin' WHERE eligibility_set_by IS NOT NULL AND eligibility_decision_source IS NULL;
UPDATE public.jobs SET eligibility_decision_source = 'preliminary' WHERE eligibility_set_by IS NULL AND eligibility_outcome IS NOT NULL AND eligibility_decision_source IS NULL;
UPDATE public.jobs SET life_support_status = 'yes' WHERE life_support = true AND life_support_status IS NULL;