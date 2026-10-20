-- 0214 — per-ceiling-area evidence requirements (installer two-route repair, 20 Oct 2026).
-- STATUS: authored + practice-tested on PGlite (tests/ready-check-areas-db.test.ts). NOT applied live. Release prerequisite
-- for saving Ready Check ceiling areas. Additive: existing rows keep area_key NULL; no backfill.
-- Job-level uniqueness is unchanged for area_key NULL rows (one row per job+category), so existing inserts behave the same.
ALTER TABLE public.evidence_requirements ADD COLUMN IF NOT EXISTS area_key text;
COMMENT ON COLUMN public.evidence_requirements.area_key IS 'Ready Check ceiling area key (ready_check_observations areas.v1); NULL = job-level requirement';
ALTER TABLE public.evidence_requirements DROP CONSTRAINT IF EXISTS evidence_requirements_job_id_category_key;
CREATE UNIQUE INDEX IF NOT EXISTS evidence_requirements_job_category_area_key ON public.evidence_requirements (job_id, category, (coalesce(area_key, '')));
