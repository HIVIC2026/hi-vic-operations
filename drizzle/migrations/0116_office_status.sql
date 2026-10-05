-- 0116 office status: editable time limits, On hold revisit date, Needs me snoozes (additive only).
ALTER TABLE public.workflow_settings ADD COLUMN IF NOT EXISTS office_time_limits jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN public.workflow_settings.office_time_limits IS 'Office status time limits; keys override code defaults (days/hours). Empty = defaults.';
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS hold_revisit_at date;

CREATE TABLE IF NOT EXISTS public.office_snoozes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  rule_key text NOT NULL,
  snoozed_until timestamptz NOT NULL,
  snooze_count integer NOT NULL DEFAULT 1 CHECK (snooze_count >= 1),
  reason text,
  snoozed_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, rule_key),
  CONSTRAINT office_snooze_second_needs_reason CHECK (snooze_count < 2 OR length(btrim(coalesce(reason, ''))) >= 3)
);
GRANT SELECT, INSERT, UPDATE ON public.office_snoozes TO authenticated;
GRANT ALL ON public.office_snoozes TO service_role;
ALTER TABLE public.office_snoozes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage office snoozes" ON public.office_snoozes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
