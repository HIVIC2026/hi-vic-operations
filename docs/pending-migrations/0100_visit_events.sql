-- Step 12 Part 1: permanent visit events (cancellations, no-shows, arrivals, evidence rejections).
-- Additive only: one new append-only table. No existing rows are read or changed.
CREATE TABLE IF NOT EXISTS public.visit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings(id),
  business_id uuid REFERENCES public.businesses(id),
  visit_kind public.booking_kind,
  event text NOT NULL CHECK (event IN ('owner_cancelled','owner_rescheduled','owner_late_change','owner_no_show','trade_cancelled','trade_no_show','trade_arrived','evidence_rejected','no_show_cleared')),
  counts_against text NOT NULL DEFAULT 'none' CHECK (counts_against IN ('owner','trade','none')),
  clears_event_id uuid REFERENCES public.visit_events(id),
  reason text,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT visit_events_clear_needs_target CHECK ((event = 'no_show_cleared') = (clears_event_id IS NOT NULL))
);
-- One of each booking-level event per booking (makes the timer and double taps idempotent).
CREATE UNIQUE INDEX IF NOT EXISTS visit_events_one_per_booking ON public.visit_events(booking_id, event) WHERE booking_id IS NOT NULL AND event <> 'evidence_rejected';
CREATE UNIQUE INDEX IF NOT EXISTS visit_events_one_clear ON public.visit_events(clears_event_id) WHERE clears_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS visit_events_business_recent ON public.visit_events(business_id, created_at);
CREATE INDEX IF NOT EXISTS visit_events_job ON public.visit_events(job_id, created_at);

GRANT SELECT ON public.visit_events TO authenticated;
GRANT ALL ON public.visit_events TO service_role;
ALTER TABLE public.visit_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read visit events" ON public.visit_events;
CREATE POLICY "Admins read visit events" ON public.visit_events FOR SELECT TO authenticated USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.guard_visit_events() RETURNS trigger LANGUAGE plpgsql AS $$
begin raise exception 'visit_events is append-only'; end $$;
DROP TRIGGER IF EXISTS visit_events_append_only ON public.visit_events;
CREATE TRIGGER visit_events_append_only BEFORE UPDATE OR DELETE ON public.visit_events FOR EACH ROW EXECUTE FUNCTION public.guard_visit_events();
