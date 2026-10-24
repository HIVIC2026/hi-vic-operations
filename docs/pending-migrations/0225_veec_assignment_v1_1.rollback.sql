-- Rollback for 0225: compliance_templates rows are permanent (guard trigger refuses DELETE), so the v1.1 row is left
-- inactive and unapproved (exactly how 0225 inserted it) and the superseded annotation is removed from the two drafts.
UPDATE public.compliance_templates SET is_active = false, approved = false, approved_by = NULL, approved_at = NULL
WHERE template_key = 'consumer_declaration' AND version = 'ESC-Activity48-VEEC-Assignment-v1.1-20261001';
UPDATE public.compliance_templates
SET source_note = nullif(regexp_replace(coalesce(source_note, ''), '( \| )?Superseded by ESC-Activity48-VEEC-Assignment-v1\.1-20261001 \(decisions 118a/119, 24 Oct 2026\); kept as history\.', '', 'g'), '')
WHERE version IN ('Activity48-VEEC-Assignment-v16-DRAFT', 'DEECA-PIISA-March-2026-DRAFT');
