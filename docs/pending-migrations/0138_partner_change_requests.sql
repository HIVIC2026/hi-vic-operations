-- Partner "Ask us to change something" / "Request a rate change" (Jo, 7 Oct).
-- Partners never edit details or rates directly: the request lands with the office in Needs me.
CREATE TABLE IF NOT EXISTS public.partner_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('details', 'rates', 'area', 'other')),
  message text NOT NULL CHECK (length(btrim(message)) BETWEEN 3 AND 2000),
  requested_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'declined')),
  resolved_by uuid,
  resolved_at timestamptz,
  office_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_change_requests_open ON public.partner_change_requests (status, created_at) WHERE status = 'open';
GRANT SELECT, UPDATE ON public.partner_change_requests TO authenticated;
GRANT ALL ON public.partner_change_requests TO service_role;
ALTER TABLE public.partner_change_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage partner change requests" ON public.partner_change_requests;
CREATE POLICY "Admins manage partner change requests" ON public.partner_change_requests
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
