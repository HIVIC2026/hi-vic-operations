ALTER TABLE public.journey_runs
  ADD COLUMN path text,
  ADD COLUMN run_group uuid,
  ADD COLUMN status text,
  ADD CONSTRAINT journey_runs_status_check CHECK (status IN ('passed', 'failed', 'blocked'));

CREATE INDEX journey_runs_run_group_path_idx ON public.journey_runs (run_group, path);