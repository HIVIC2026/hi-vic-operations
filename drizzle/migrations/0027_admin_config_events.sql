CREATE TABLE public.admin_config_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  event_type text NOT NULL,
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.admin_config_events TO authenticated;
GRANT ALL ON public.admin_config_events TO service_role;
ALTER TABLE public.admin_config_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read config events" ON public.admin_config_events FOR SELECT TO authenticated USING (public.is_admin());
CREATE TRIGGER trg_admin_config_events_immutable BEFORE UPDATE OR DELETE ON public.admin_config_events FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();