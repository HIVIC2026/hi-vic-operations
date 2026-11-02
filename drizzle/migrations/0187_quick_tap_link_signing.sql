-- Applied to live 2 Nov 2026 with Jo's OK (HV-2730 quick taps fix, PR #124).
-- Quick taps sharing consent (Jo 2 Nov 2026, spec docs/superpowers/specs/2026-11-02-quick-taps-sharing-consent.md).
-- "quick_tap_link" = the owner tapped "Yes, let's go" on their own texted quick-taps link (no 6-digit code).
-- Allowed only for the trade_contact_share OK; link_code sign-ins still need their verified code.
ALTER TABLE public.owner_gate_signatures DROP CONSTRAINT IF EXISTS owner_gate_signatures_method_check;
ALTER TABLE public.owner_gate_signatures ADD CONSTRAINT owner_gate_signatures_method_check
  CHECK (method IN ('link_code','login','office','quick_tap_link'));
ALTER TABLE public.owner_gate_signatures DROP CONSTRAINT IF EXISTS owner_gate_signatures_quick_tap_check;
ALTER TABLE public.owner_gate_signatures ADD CONSTRAINT owner_gate_signatures_quick_tap_check
  CHECK (method <> 'quick_tap_link' OR doc_key = 'trade_contact_share');
