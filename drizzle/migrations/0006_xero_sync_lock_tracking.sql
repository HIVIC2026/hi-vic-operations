ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS sync_lock_at timestamptz;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS xero_tracking_option_id text;