ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS mitti_template_id text,
  ADD COLUMN IF NOT EXISTS mitti_assignee_email text,
  ADD COLUMN IF NOT EXISTS mitti_assignee_user_id text,
  ADD COLUMN IF NOT EXISTS mitti_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS mitti_modified_at timestamptz,
  ADD COLUMN IF NOT EXISTS mitti_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mitti_last_error text,
  ADD COLUMN IF NOT EXISTS mitti_prefill_count integer,
  ADD COLUMN IF NOT EXISTS mitti_raw_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS mitti_validation_issues jsonb NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN public.assessments.mitti_raw_snapshot IS 'Normalized label/value snapshot of the stored Mitti audit (audit evidence). Mitti sync never completes the assessment.';

ALTER TABLE public.rectification_items
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'portal',
  ADD COLUMN IF NOT EXISTS external_key text,
  ADD COLUMN IF NOT EXISTS needs_office_pricing boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS rectification_items_job_external_key_uq
  ON public.rectification_items (job_id, external_key) WHERE external_key IS NOT NULL;