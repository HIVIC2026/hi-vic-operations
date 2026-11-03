-- PENDING ONLY. Remove the who-books setting; everything goes back to the office booking.
BEGIN;

ALTER TABLE public.businesses DROP COLUMN piesa_booked_by;

COMMIT;
