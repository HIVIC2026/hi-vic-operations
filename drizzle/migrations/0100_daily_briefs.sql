CREATE TABLE IF NOT EXISTS public.daily_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_date date NOT NULL UNIQUE,
  content jsonb NOT NULL,
  delivery_status text NOT NULL DEFAULT 'portal_only' CHECK (delivery_status IN ('portal_only','queued','sent')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.daily_briefs TO authenticated;
GRANT ALL ON public.daily_briefs TO service_role;
ALTER TABLE public.daily_briefs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read daily briefs" ON public.daily_briefs;
CREATE POLICY "Admins read daily briefs" ON public.daily_briefs FOR SELECT TO authenticated USING (public.is_admin());