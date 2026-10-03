-- 0088: the original one-pending-offer-per-job rule (0023) blocked PIESA batch offers.
-- Keep it for installer offers; PIESA/rectification offers may be open to a small group, one per business.
CREATE UNIQUE INDEX IF NOT EXISTS partner_offers_one_pending_installer ON public.partner_offers(job_id) WHERE status = 'pending' AND kind = 'installer';
CREATE UNIQUE INDEX IF NOT EXISTS partner_offers_one_pending_per_business ON public.partner_offers(job_id, business_id, kind) WHERE status = 'pending';
DROP INDEX IF EXISTS public.partner_offers_one_pending;
