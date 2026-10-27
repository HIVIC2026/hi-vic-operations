-- Jo 27 Oct 2026 (decision 411): installer worker role (Lead installer / Crew). NULL = "Role needed".
ALTER TABLE public.partner_workers ADD COLUMN IF NOT EXISTS worker_role text;
ALTER TABLE public.partner_workers DROP CONSTRAINT IF EXISTS partner_workers_worker_role_check;
ALTER TABLE public.partner_workers ADD CONSTRAINT partner_workers_worker_role_check CHECK (worker_role IS NULL OR worker_role IN ('lead','crew'));
ALTER TABLE public.partner_worker_invites ADD COLUMN IF NOT EXISTS worker_role text;
ALTER TABLE public.partner_worker_invites DROP CONSTRAINT IF EXISTS partner_worker_invites_worker_role_check;
ALTER TABLE public.partner_worker_invites ADD CONSTRAINT partner_worker_invites_worker_role_check CHECK (worker_role IS NULL OR worker_role IN ('lead','crew'));
COMMENT ON COLUMN public.partner_workers.worker_role IS 'Installer role: lead or crew; NULL = role needed (decision 411).';
