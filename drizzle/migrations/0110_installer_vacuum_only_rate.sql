-- Optional "Dust / vermin vacuum only" supplier rate ($/m2 inc GST, or total if not GST registered):
-- vacuuming dust or vermin droppings from the ceiling space without removing insulation.
-- Same rules as R6/R7/top-up: blank = not offered (quoted separately); office approval adds it to a NEW rate card version.
ALTER TABLE public.installer_rate_requests
  ADD COLUMN vacuum_only_rate numeric(10,2) CHECK (vacuum_only_rate IS NULL OR (vacuum_only_rate > 0 AND vacuum_only_rate <= 100000));