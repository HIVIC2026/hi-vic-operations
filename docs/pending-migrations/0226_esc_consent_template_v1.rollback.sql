-- Rollback for 0226_esc_consent_template_v1.sql: retires the ESC template wording and reactivates the most recently
-- approved earlier esc_consent wording (the lawyer-worded row). Compliance templates are permanent records, so the ESC
-- row is kept inactive, never deleted. The two jsonb columns on owner_esc_consents are KEPT: dropping them would erase
-- owner declaration ticks and AP representative details recorded on signed consents; they are nullable and harmless.
BEGIN;

UPDATE public.compliance_templates
   SET is_active = false
 WHERE template_key = 'esc_consent' AND version = 'ESC-Owners-Consent-Template-v1-20260414' AND is_active;

UPDATE public.compliance_templates t
   SET is_active = true
  FROM (
    SELECT id FROM public.compliance_templates
     WHERE template_key = 'esc_consent' AND approved AND version <> 'ESC-Owners-Consent-Template-v1-20260414'
     ORDER BY approved_at DESC NULLS LAST, created_at DESC
     LIMIT 1
  ) prev
 WHERE t.id = prev.id
   AND NOT EXISTS (SELECT 1 FROM public.compliance_templates WHERE template_key = 'esc_consent' AND is_active);

COMMIT;
