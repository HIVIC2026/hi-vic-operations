-- 5 Nov 2026 live run (Jo approved 10:03): electricians never log in, so allocate_team_electrician v2
-- (2026-11-03_allocate_team_electrician_v2.sql) writes job_assignments.user_id = NULL for them — but the live column was
-- still NOT NULL, so every "Save electrician" failed with
--   null value in column "user_id" of relation "job_assignments" violates not-null constraint
-- APPLIED LIVE 5 Nov 2026 10:04 Melbourne by Jo's go-live session. Undo (only while no NULL rows exist):
--   ALTER TABLE public.job_assignments ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.job_assignments ALTER COLUMN user_id DROP NOT NULL;
