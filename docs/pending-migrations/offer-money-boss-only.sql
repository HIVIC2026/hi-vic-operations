-- APPLIED to the live database 27 Oct 2026 (Jo said yes). Policy read back afterwards.
-- Decision 412 (Jo 27 Oct 2026): job offer records carry money (electrician pay, installer $/m²), so only the office
-- and a business's OWNER (business_admin) may read them directly. Workers read offers only through the server
-- (tradeOffer, which strips money for them). Every portal read of partner_offers uses the server key, so no screen changes.
DROP POLICY IF EXISTS "Admins or offered business read offers" ON public.partner_offers;
CREATE POLICY "Admins or offered business owner read offers" ON public.partner_offers FOR SELECT TO authenticated
  USING ((SELECT is_admin()) OR is_business_member(business_id, true));
