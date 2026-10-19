-- Public calculator sign-ups stay open, but a signed-out visitor may only add a fresh, well-formed sign-up:
-- no office fields (status/notes/follow-up), source 'calculator', bounded lengths, sane ceiling size.
DROP POLICY IF EXISTS "anyone can register interest" ON public.calculator_interests;
CREATE POLICY "anyone can register interest" ON public.calculator_interests FOR INSERT TO anon
  WITH CHECK (
    status = 'new' AND source = 'calculator'
    AND admin_notes IS NULL AND followed_up_by IS NULL AND followed_up_at IS NULL
    AND length(btrim(full_name)) BETWEEN 1 AND 200
    AND length(btrim(mobile)) BETWEEN 6 AND 30
    AND length(email) BETWEEN 3 AND 320 AND position('@' in email) > 1
    AND length(btrim(address_line)) BETWEEN 1 AND 300
    AND length(suburb) <= 120
    AND postcode ~ '^([0-9]{4})?$'
    AND ceiling_m2 >= 0 AND ceiling_m2 <= 2000
    AND length(consent_version) BETWEEN 1 AND 100
  );
