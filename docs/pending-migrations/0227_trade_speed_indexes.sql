-- Speed (decision 280, Jo 25 Oct: live site "unbearably slow"). Trade screens read by BUSINESS, but every index on these
-- tables leads with job_id or user_id, so each My work / Money / job page load scanned the whole table:
--   job_assignments  (business_id, active)  — My work: this business's active and ended assignments (boss view)
--   partner_offers   (business_id, status)  — My work: this business's pending offers; Money: its accepted offers
--   bookings         (business_id, status)  — Money, job page and My work month strip: this business's completed visits
--   business_members (user_id)              — every trade server call: which business this sign-in belongs to
-- Indexes only: no data, view, wording, pile or workflow change. Re-runnable. Undo: 0227_trade_speed_indexes.rollback.sql.
CREATE INDEX IF NOT EXISTS job_assignments_business_active_idx ON public.job_assignments USING btree (business_id, active);
CREATE INDEX IF NOT EXISTS partner_offers_business_status_idx ON public.partner_offers USING btree (business_id, status);
CREATE INDEX IF NOT EXISTS bookings_business_status_idx ON public.bookings USING btree (business_id, status);
CREATE INDEX IF NOT EXISTS business_members_user_idx ON public.business_members USING btree (user_id);
