ALTER TABLE public.workflow_settings ADD COLUMN IF NOT EXISTS sms_message_switches jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE IF NOT EXISTS public.sms_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_type text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  to_number text NOT NULL,
  from_sender text,
  body text NOT NULL,
  status text NOT NULL CHECK (status IN ('sending', 'sent', 'queued', 'delivered', 'undelivered', 'failed', 'blocked', 'sent_unknown')),
  detail text,
  provider_sid text UNIQUE,
  status_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sms_messages_job ON public.sms_messages (job_id);
CREATE INDEX IF NOT EXISTS sms_messages_business ON public.sms_messages (business_id);
CREATE TABLE IF NOT EXISTS public.sms_optouts (
  phone text PRIMARY KEY CHECK (phone ~ '^\+61[0-9]{9}$'),
  opted_out_at timestamptz NOT NULL DEFAULT now(),
  opted_in_at timestamptz,
  source text NOT NULL DEFAULT 'stop_reply',
  last_message text
);
GRANT SELECT ON public.sms_messages, public.sms_optouts TO authenticated;
GRANT ALL ON public.sms_messages, public.sms_optouts TO service_role;
ALTER TABLE public.sms_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_optouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Office reads sms" ON public.sms_messages;
CREATE POLICY "Office reads sms" ON public.sms_messages FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "Office reads sms optouts" ON public.sms_optouts;
CREATE POLICY "Office reads sms optouts" ON public.sms_optouts FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));