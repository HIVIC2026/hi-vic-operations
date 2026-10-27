-- Undo for offer-money-boss-only.sql: every member of the offered business can read its offers again.
DROP POLICY IF EXISTS "Admins or offered business owner read offers" ON public.partner_offers;
CREATE POLICY "Admins or offered business read offers" ON public.partner_offers FOR SELECT TO authenticated
  USING ((SELECT is_admin()) OR is_business_member(business_id));
