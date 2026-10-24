CREATE TABLE public.mitti_template_dumps (id bigserial PRIMARY KEY, template_id text, name text, fetched_at timestamptz DEFAULT now(), definition jsonb, error text);
REVOKE ALL ON public.mitti_template_dumps FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mitti_template_dumps TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.mitti_template_dumps_id_seq TO service_role;
ALTER TABLE public.mitti_template_dumps ENABLE ROW LEVEL SECURITY;
