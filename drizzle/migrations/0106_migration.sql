-- Optional "Top up to R5.0" supplier rate ($/m2 inc GST, or total if not GST registered):
-- topping up over existing insulation that stays in place so the total reaches at least R5.0.
-- Same rules as R6/R7: blank = not offered; office approval adds it to a NEW rate card version.
ALTER TABLE public.installer_rate_requests
  ADD COLUMN topup_r5_rate numeric(10,2) CHECK (topup_r5_rate IS NULL OR (topup_r5_rate > 0 AND topup_r5_rate <= 100000));