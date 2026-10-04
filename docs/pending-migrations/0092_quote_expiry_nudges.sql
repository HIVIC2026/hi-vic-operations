ALTER TYPE public.quote_status ADD VALUE IF NOT EXISTS 'expired';
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS nudge_day3_at timestamptz,
  ADD COLUMN IF NOT EXISTS nudge_day10_at timestamptz,
  ADD COLUMN IF NOT EXISTS expired_at timestamptz;
COMMENT ON COLUMN public.quotes.sent_at IS 'When an installation quote was sent to the owner; starts the 14-full-day expiry. Null for quotes sent before this existed (never expire).';
CREATE INDEX IF NOT EXISTS quotes_open_sent_idx ON public.quotes(sent_at) WHERE kind = 'installation' AND sent_at IS NOT NULL;