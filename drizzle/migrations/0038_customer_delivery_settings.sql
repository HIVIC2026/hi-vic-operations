-- lovable-cron-fallback-reviewed: user explicitly requires 10-minute customer email dispatch/follow-up sweep; replaces the existing hourly job (no duplicate)
CREATE TABLE public.customer_delivery_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  provider text NOT NULL DEFAULT 'base44_bridge',
  endpoint_url text,
  hmac_secret text,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.customer_delivery_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.customer_delivery_settings TO service_role;
ALTER TABLE public.customer_delivery_settings ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER customer_delivery_settings_touch BEFORE UPDATE ON public.customer_delivery_settings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
INSERT INTO public.customer_delivery_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hivic-customer-followups') THEN PERFORM cron.unschedule('hivic-customer-followups'); END IF;
  PERFORM cron.schedule('hivic-customer-followups', '*/10 * * * *', $c$SELECT public.customer_followups_tick('https://project--fb35adfe-10bf-4d4c-987d-28567ca1ddeb.lovable.app/api/public/hooks/customer-followups')$c$);
END $$;