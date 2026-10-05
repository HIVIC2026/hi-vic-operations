-- Installer-requested R6.0 / R7.0 supply & install rates (inc GST, or total if not GST registered).
-- Requests never change agreed rates by themselves: office approval adds them to a NEW rate card version.
CREATE TABLE public.installer_rate_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  r6_rate numeric(10,2) CHECK (r6_rate IS NULL OR (r6_rate > 0 AND r6_rate <= 100000)),
  r7_rate numeric(10,2) CHECK (r7_rate IS NULL OR (r7_rate > 0 AND r7_rate <= 100000)),
  gst_registered boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','withdrawn')),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  rate_card_id uuid REFERENCES public.rate_cards(id)
);
CREATE INDEX installer_rate_requests_business_idx ON public.installer_rate_requests(business_id, requested_at DESC);
CREATE UNIQUE INDEX installer_rate_requests_one_pending ON public.installer_rate_requests(business_id) WHERE status = 'pending';
GRANT SELECT ON public.installer_rate_requests TO authenticated;
GRANT ALL ON public.installer_rate_requests TO service_role;
ALTER TABLE public.installer_rate_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_all ON public.installer_rate_requests FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY member_read ON public.installer_rate_requests FOR SELECT TO authenticated USING (public.is_business_member(business_id));
