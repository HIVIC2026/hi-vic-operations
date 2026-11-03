-- PENDING ONLY. Jo applies this. Who books the safety check (PIESA) for an installer's own jobs; existing installers stay on 'office'.
BEGIN;

ALTER TABLE public.businesses ADD COLUMN piesa_booked_by text NOT NULL DEFAULT 'office' CHECK (piesa_booked_by in ('office','electrician','either'));

COMMIT;
