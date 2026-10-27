-- Persistent simulated Mitti for TEST calls made by the running portal (Jo 27 Oct). Server (service role) only.
CREATE TABLE IF NOT EXISTS public.mitti_sim_audits (
  id text PRIMARY KEY CHECK (id LIKE 'sim\_%'),
  template_id text NOT NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  header_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  completed boolean NOT NULL DEFAULT false,
  request jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  modified_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.mitti_sim_audits FROM anon, authenticated;
GRANT ALL ON public.mitti_sim_audits TO service_role;
ALTER TABLE public.mitti_sim_audits ENABLE ROW LEVEL SECURITY;
-- No policies: browsers and signed-in users can never read or write simulated forms.
