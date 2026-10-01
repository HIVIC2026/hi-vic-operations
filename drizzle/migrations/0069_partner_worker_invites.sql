CREATE TABLE public.partner_worker_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  created_by uuid,
  invitee_name text NOT NULL,
  invitee_contact text,
  trade_role public.assignment_role NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  worker_id uuid REFERENCES public.partner_workers(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  is_test boolean NOT NULL DEFAULT false,
  declarations jsonb,
  signed_name text,
  signed_ip text,
  signed_user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.partner_worker_invites TO authenticated;
GRANT ALL ON public.partner_worker_invites TO service_role;
ALTER TABLE public.partner_worker_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Business admins and office read invites" ON public.partner_worker_invites
  FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_business_member(business_id, true));
CREATE INDEX partner_worker_invites_business_idx ON public.partner_worker_invites(business_id);