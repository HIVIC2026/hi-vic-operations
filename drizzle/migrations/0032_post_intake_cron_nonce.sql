-- Scheduler auth without storing any long-lived secret: each tick mints a single-use nonce, sends it to the
-- worker route, and the route consumes it via a service-role-only function. Nonces expire after 5 minutes.
CREATE TABLE public.cron_nonces (
  nonce text PRIMARY KEY,
  purpose text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.cron_nonces TO service_role;
ALTER TABLE public.cron_nonces ENABLE ROW LEVEL SECURITY; -- no policies: invisible to anon/authenticated

CREATE OR REPLACE FUNCTION public.consume_cron_nonce(_nonce text, _purpose text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ok boolean;
BEGIN
  DELETE FROM public.cron_nonces WHERE created_at < now() - interval '10 minutes';
  DELETE FROM public.cron_nonces WHERE nonce = _nonce AND purpose = _purpose AND created_at > now() - interval '5 minutes' RETURNING true INTO ok;
  RETURN coalesce(ok, false);
END $$;
REVOKE ALL ON FUNCTION public.consume_cron_nonce(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_cron_nonce(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.post_intake_tick(_url text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE n text := encode(extensions.gen_random_bytes(32), 'hex');
BEGIN
  INSERT INTO public.cron_nonces (nonce, purpose) VALUES (n, 'post_intake');
  RETURN net.http_post(url := _url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-hivic-cron-nonce', n), body := '{}'::jsonb, timeout_milliseconds := 55000);
END $$;
REVOKE ALL ON FUNCTION public.post_intake_tick(text) FROM PUBLIC, anon, authenticated;