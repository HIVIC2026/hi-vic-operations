-- 0226_esc_consent_template_v1.sql (Jo 24 Oct 2026, decision 123): the owner's ESC information-sharing consent uses the
-- ESC "Owner's Consent Form Template - to Share Information with the Essential Services Commission" Version 1
-- (14 April 2026) VERBATIM (Sections 1–3), replacing the lawyer-worded esc_consent wording, which stays as history.
-- Source: docs/official-forms/ESC-Owners-Consent-Form-Template-v1-20260414.docx
--         SHA-256 e6458b32666a01a5a3d06718cf0ee33b601077761c6f14f77d20bee5d7753151
-- The only edit to the template text is the ESC's own placeholder <insert name of accredited person>, filled with the
-- accredited person's name. <insert name> in Part B is filled at signing with the office user's name.
-- Also adds two jsonb columns on owner_esc_consents so the four owner declaration ticks and the AP representative's
-- details (first/last name, role, phone, email) are stored with the consent (the snapshot is immutable).
-- Idempotent; one transaction. Proven on PGlite: tests/esc-consent-template-db.test.ts.
-- ROLLBACK: 0226_esc_consent_template_v1.rollback.sql. NEVER run live without the README procedure.
BEGIN;

ALTER TABLE public.owner_esc_consents ADD COLUMN IF NOT EXISTS owner_declarations jsonb;
ALTER TABLE public.owner_esc_consents ADD COLUMN IF NOT EXISTS ap_rep jsonb;
COMMENT ON COLUMN public.owner_esc_consents.owner_declarations IS 'Section 2 declaration lines the owner ticked (key -> true), recorded at owner signing.';
COMMENT ON COLUMN public.owner_esc_consents.ap_rep IS 'Section 3 Part A accredited person representative details (first_name, last_name, role, phone, email) recorded at AP signing.';

-- One active esc_consent at a time (compliance_templates_one_active): retire the previous wording first, keep the row.
UPDATE public.compliance_templates
   SET is_active = false
 WHERE template_key = 'esc_consent' AND is_active AND version <> 'ESC-Owners-Consent-Template-v1-20260414';

INSERT INTO public.compliance_templates (template_key, version, body, form_fields, required, approved, approved_by, approved_at, is_active, source_note, created_by)
SELECT 'esc_consent',
       'ESC-Owners-Consent-Template-v1-20260414',
$body$Section 1: Information to be shared
Owner details
First Name:
Last name:
Installation address:
Phone number:
Email address:
Section 2: Declaration by owner
I declare that:
I am the owner of the property listed above, or I am authorised to provide consent on behalf of the owner.
the details listed above are complete and accurate.
I consent to DC Construction Solutions Pty Ltd trading as Home Insulation Victoria (VEU Accredited Person A003654) sending the information set out in section 1 of this form to the Essential Services Commission (commission)
I consent to the commission sharing the information set out in section 1 of this form with the Victorian WorkCover Authority (WorkSafe) and/or Energy Safe Victoria (ESV)
Owner signature:  Date:
Section 3 – Accredited person details and declaration
Part A: Accredited person details
Accredited person details
Accredited person name:
First name:
Last name:
Role:
Phone number:
Email address:
Part B: Declaration by accredited person
I <insert name>, am the authorised representative of DC Construction Solutions Pty Ltd trading as Home Insulation Victoria (VEU Accredited Person A003654) and declare that I have explained to the property owner the purpose for which this written consent is being obtained.
Accredited person signature:  Date:$body$,
       $ff$[
  {"key":"owner_first_name","label":"First Name","type":"text","required":true,"help":"Section 1 – owner details (prefilled from the job)"},
  {"key":"owner_last_name","label":"Last name","type":"text","required":true,"help":"Section 1 – owner details (prefilled from the job)"},
  {"key":"installation_address","label":"Installation address","type":"text","required":true,"help":"Section 1 – prefilled from the property"},
  {"key":"owner_phone","label":"Phone number","type":"text","required":true,"help":"Section 1 – prefilled from the owner contact"},
  {"key":"owner_email","label":"Email address","type":"text","required":true,"help":"Section 1 – prefilled from the owner contact"},
  {"key":"ap_name","label":"Accredited person name","type":"text","required":true,"help":"Section 3 Part A – fixed: DC Construction Solutions Pty Ltd trading as Home Insulation Victoria (VEU Accredited Person A003654)"},
  {"key":"ap_first_name","label":"First name","type":"text","required":true,"help":"Section 3 Part A – prefilled from the signing office user"},
  {"key":"ap_last_name","label":"Last name","type":"text","required":true,"help":"Section 3 Part A – prefilled from the signing office user"},
  {"key":"ap_role","label":"Role","type":"text","required":true,"help":"Section 3 Part A – the office user's role at Home Insulation Victoria"},
  {"key":"ap_phone","label":"Phone number","type":"text","required":true,"help":"Section 3 Part A – prefilled from the signing office user"},
  {"key":"ap_email","label":"Email address","type":"text","required":true,"help":"Section 3 Part A – prefilled from the signing office user"}
]$ff$::jsonb,
       true,
       true,
       '950fa0b6-dc44-49af-a754-6a65f26a661e'::uuid,
       now(),
       true,
       'ESC Owner''s Consent Form Template - to Share Information with the Essential Services Commission, Version 1 – 14 April 2026 (Regulation 23A(d), Victorian Energy Efficiency Target Regulations 2018). File docs/official-forms/ESC-Owners-Consent-Form-Template-v1-20260414.docx, SHA-256 e6458b32666a01a5a3d06718cf0ee33b601077761c6f14f77d20bee5d7753151. Sections 1–3 verbatim; <insert name of accredited person> filled with the AP name. Jo chose this wording on 24 Oct 2026 (decision 123) and approved it as admin 950fa0b6-dc44-49af-a754-6a65f26a661e.',
       '950fa0b6-dc44-49af-a754-6a65f26a661e'::uuid
 WHERE NOT EXISTS (SELECT 1 FROM public.compliance_templates WHERE template_key = 'esc_consent' AND version = 'ESC-Owners-Consent-Template-v1-20260414');

-- Re-running after a rollback: the row exists but is inactive; make it the active wording again.
UPDATE public.compliance_templates
   SET is_active = true
 WHERE template_key = 'esc_consent' AND version = 'ESC-Owners-Consent-Template-v1-20260414' AND NOT is_active;

COMMIT;
