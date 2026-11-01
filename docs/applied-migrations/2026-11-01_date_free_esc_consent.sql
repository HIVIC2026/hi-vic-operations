-- Pending only: Jo requested no live database changes for Task 5.
ALTER TABLE public.owner_esc_consents ALTER COLUMN scheduled_start DROP NOT NULL;
COMMENT ON COLUMN public.owner_esc_consents.scheduled_start IS 'DEPRECATED: historical booking date only; official ESC owner consent contains no installation date. New consent rows leave this NULL.';
COMMENT ON COLUMN public.owner_esc_consents.scheduled_end IS 'DEPRECATED: installation timing belongs to the ESC notification, not owner consent.';
COMMENT ON COLUMN public.owner_esc_consents.installation_days IS 'DEPRECATED: historical dates only; new consent rows retain the empty default. Installation days belong to the notification.';
COMMENT ON COLUMN public.owner_esc_consents.booking_id IS 'DEPRECATED: consent identifies the owner and premises independently of booking; retained for historical records.';