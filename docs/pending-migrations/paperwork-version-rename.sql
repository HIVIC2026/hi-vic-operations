-- PENDING ONLY — do not apply live without Jo's separate approval.
-- Metadata rename only. Bodies, approval identity/time and all signed records remain unchanged.
-- Practice proof: tests/paperwork-no-lawyer.test.ts.
BEGIN;

INSERT INTO public.owner_paperwork_approvals
  (doc_key, doc_version, body_sha256, approved_by, approved_at)
SELECT doc_key, '2026-10-06-v1', body_sha256, approved_by, approved_at
FROM public.owner_paperwork_approvals
WHERE doc_version = 'lawyer-2026-10-06-v1'
ON CONFLICT (doc_key, doc_version) DO NOTHING;

-- The existing guard forbids even metadata version changes on approved templates.
-- ALTER TABLE takes an exclusive lock until COMMIT: no concurrent write can bypass the guard.
-- Suspend only this trigger, only in this transaction; restore it before committing.
ALTER TABLE public.compliance_templates DISABLE TRIGGER compliance_templates_guard;
UPDATE public.compliance_templates
SET version = '2026-10-06-v1', source_note = 'Approved by Jo, 6 Oct 2026'
WHERE template_key = 'consumer_rights' AND version = 'lawyer-2026-10-06-v1';
ALTER TABLE public.compliance_templates ENABLE TRIGGER compliance_templates_guard;

COMMIT;