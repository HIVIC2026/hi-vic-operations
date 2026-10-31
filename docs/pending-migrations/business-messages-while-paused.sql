-- Jo 31 Oct 2026: one named business may still receive trade emails while "Pause all trade messages" is on.
-- Additive, default false: every business stays paused unless the office sets this for that business.
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS messages_while_paused boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.businesses.messages_while_paused IS 'Office-only: this business still gets trade emails while workflow_settings.trade_messages_paused is on (Jo 31 Oct 2026).';
