-- Rollback for quick-tap-link-signing.sql. Fails if any quick_tap_link signature exists (signed records are permanent).
ALTER TABLE public.owner_gate_signatures DROP CONSTRAINT IF EXISTS owner_gate_signatures_quick_tap_check;
ALTER TABLE public.owner_gate_signatures DROP CONSTRAINT IF EXISTS owner_gate_signatures_method_check;
ALTER TABLE public.owner_gate_signatures ADD CONSTRAINT owner_gate_signatures_method_check
  CHECK (method IN ('link_code','login','office'));
