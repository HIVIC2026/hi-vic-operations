ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS assignment_id uuid REFERENCES public.job_assignments(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES public.businesses(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.bookings.assignment_id IS 'The immutable trade assignment used when this booking was confirmed.';
COMMENT ON COLUMN public.bookings.business_id IS 'The assigned trade business recorded when this booking was confirmed.';

CREATE INDEX IF NOT EXISTS bookings_ready_check_job_status_idx
  ON public.bookings(job_id, status)
  WHERE kind = 'ready_check';