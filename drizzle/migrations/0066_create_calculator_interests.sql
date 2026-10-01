-- Public calculator "Register my interest" leads.
-- Captured from the client calculator page so a homeowner's details are never lost.
-- Nothing here creates a job or sends a message: the office works the list by hand.

CREATE TABLE public.calculator_interests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  full_name text NOT NULL,
  mobile text NOT NULL,
  email text NOT NULL,
  address_line text NOT NULL,
  suburb text NOT NULL DEFAULT '',
  postcode text NOT NULL,
  ceiling_m2 numeric NOT NULL,
  insulation_declared text NOT NULL CHECK (insulation_declared IN ('none','present','unknown')),
  consent_version text NOT NULL,
  consented_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','booked','closed')),
  admin_notes text,
  followed_up_by uuid REFERENCES auth.users(id),
  followed_up_at timestamptz,
  source text NOT NULL DEFAULT 'calculator'
);

CREATE INDEX calculator_interests_created_idx ON public.calculator_interests (created_at DESC);
CREATE INDEX calculator_interests_status_idx ON public.calculator_interests (status, created_at DESC);

GRANT INSERT ON public.calculator_interests TO anon;
GRANT SELECT, UPDATE ON public.calculator_interests TO authenticated;
GRANT ALL ON public.calculator_interests TO service_role;

ALTER TABLE public.calculator_interests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can register interest" ON public.calculator_interests
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "admins can read interests" ON public.calculator_interests
  FOR SELECT TO authenticated USING (public.is_admin());

CREATE POLICY "admins can update interests" ON public.calculator_interests
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Existence-only duplicate check (24h) so a double submit does not create two leads.
-- Returns a boolean only; no row data is exposed to the caller.
CREATE OR REPLACE FUNCTION public.calculator_interest_is_duplicate(_email text, _mobile text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.calculator_interests
    WHERE (lower(email) = lower(_email) OR mobile = _mobile)
      AND created_at > now() - interval '24 hours'
  )
$$;

GRANT EXECUTE ON FUNCTION public.calculator_interest_is_duplicate(text, text) TO anon, authenticated;

CREATE TRIGGER calculator_interests_touch_updated_at
  BEFORE UPDATE ON public.calculator_interests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();