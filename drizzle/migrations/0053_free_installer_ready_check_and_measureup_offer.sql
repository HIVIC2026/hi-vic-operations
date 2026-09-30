ALTER TABLE public.partner_enquiries
  ADD COLUMN IF NOT EXISTS free_measureups_for_hivic_quote_leads boolean;

COMMENT ON COLUMN public.partner_enquiries.free_measureups_for_hivic_quote_leads IS
  'Installer willingness to provide free eligibility measure-ups for HI VIC pre-qualified quote leads; distinct from free quoting.';

ALTER TABLE public.ready_check_acceptances
  DROP CONSTRAINT IF EXISTS ready_check_acceptances_ready_check_amount_inc_gst_check;

ALTER TABLE public.ready_check_acceptances
  ADD CONSTRAINT ready_check_acceptances_ready_check_amount_inc_gst_check
  CHECK (ready_check_amount_inc_gst IN (0.00, 99.00));

COMMENT ON COLUMN public.ready_check_acceptances.ready_check_amount_inc_gst IS
  '0.00 for the current free Ready Check; legacy 99.00 records remain valid and immutable.';