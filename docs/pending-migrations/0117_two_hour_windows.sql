-- Owner time windows are 2 hours (8–10am, 10am–12, 12–2pm, 2–4pm). New rows only; older half-day rows stay as history.
ALTER TABLE public.ready_check_windows DROP CONSTRAINT IF EXISTS ready_check_windows_two_hours;
ALTER TABLE public.ready_check_windows ADD CONSTRAINT ready_check_windows_two_hours CHECK (ends_at - starts_at = interval '2 hours') NOT VALID;
