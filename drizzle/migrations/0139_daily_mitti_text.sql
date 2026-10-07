-- Daily Mitti links text to trades (Jo, 7 Oct). Default OFF; separate from every other sending switch.
ALTER TABLE public.workflow_settings ADD COLUMN IF NOT EXISTS daily_mitti_text_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.workflow_settings ADD COLUMN IF NOT EXISTS daily_mitti_text_time text NOT NULL DEFAULT '06:30';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_settings_daily_mitti_text_time_chk') THEN
    ALTER TABLE public.workflow_settings ADD CONSTRAINT workflow_settings_daily_mitti_text_time_chk CHECK (daily_mitti_text_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.trade_text_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  job_ids uuid[] NOT NULL DEFAULT '{}',
  melbourne_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('daily', 'update', 'skipped', 'test')),
  send_key text NOT NULL UNIQUE,
  to_number text,
  body text,
  status text NOT NULL CHECK (status IN ('sending', 'sent', 'delivered', 'failed', 'skipped', 'blocked')),
  detail text,
  provider_sid text,
  snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trade_text_log_biz_day ON public.trade_text_log (business_id, melbourne_date);
CREATE INDEX IF NOT EXISTS trade_text_log_jobs ON public.trade_text_log USING gin (job_ids);
GRANT SELECT ON public.trade_text_log TO authenticated;
GRANT ALL ON public.trade_text_log TO service_role;
ALTER TABLE public.trade_text_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Office reads trade texts" ON public.trade_text_log;
CREATE POLICY "Office reads trade texts" ON public.trade_text_log FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
COMMENT ON TABLE public.trade_text_log IS 'One row per daily/update Mitti links text (or skip reason). send_key is unique so a text is never sent twice.';
