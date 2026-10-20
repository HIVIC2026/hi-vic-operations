> HISTORICAL NOTE (21 Oct 2026): "per-area NOT_IMPLEMENTED", "final bounded QA NOT_RUN" and "0214 not applied" statements below are historical. Current status: 2026-10-21-release-reconciliation.md; 0214 is live (2026-10-21-0214-release/applied.md).

# Dad installer access check — 21 Oct 2026

- **date**: "2026-10-21T08:10+11:00"
- **target**: "http://localhost:8080 (local dev preview; single live Lovable Cloud backend)"
- **tested_base_commit**: "fe86d630 + uncommitted fixes (final SHA = next auto-commit)"
- **qa_identity**: {"userId": "1befe5c2-dc86-4503-afef-604295d8e638", "businessId": "6a1cfe8a-9314-4f41-bcd9-4b6d15b25a0f", "business": "TEST ONLY Dad QA Installer", "email": "installer-qa-dad-20261021@hivic-test.example (reserved, non-deliverable)", "marks": "user_metadata.qa_test=true; [TEST PARTNER] business note; role installer; business_admin member", "login": "admin magic-link token verified server-side, session kept in /tmp only; no email sent; no password stored or shown"}
- **pre_test_scope**: {"reachable_jobs": 0, "non_test": 0, "method": "table joins + signed-in RLS reads (jobs/owners/properties/documents/imports/quotes/evidence all 0)"}
- **isolation_review**: ["intakeSourceFor stamps qa_test for qa_test users/[TEST PARTNER] businesses \u2014 now fails closed on lookup error (fix)", "upsertEnquiry qa_test returns post_intake none (no Gate 1 queue)", "workflow guard: qa_test users only act on active qa_test jobs", "offer guard: TEST jobs only to TEST partners", "all 15 external_action_modes off (email/SMS/partner/Xero/Mitti/ESC/VEEC)", "mitti-create, followups, allocation, daily-brief skip qa_test"]
- **fixes**: ["Add Job crashed for every signed-in installer (hook after early return: 'Rendered more hooks') \u2014 moved draftFlight ref above returns", "Installer job page listed sent files with no way to open them \u2014 now opens via existing signed app link after can_access_job", "intakeSourceFor fail-closed"]
- **test_jobs**: {"HV-2928": "38883ecd-6ae4-41a0-b691-5c1c34ad681e", "HV-2929": "86100f7a-e906-4424-83a0-f2f2879c46b8"}
- **post_test_proof**: {"jobs_by_business": "2, both qa_test", "outbox": 0, "customer_email_sends": 0, "sms_messages": 0, "post_intake_work": 0, "invoices": 0, "signed_in_rls_nonTest": 0}
- **verdict**: "Ready for a restricted dummy-job preview on desktop only after the Add Job crash fix is published. NOT full live workflow ready."

## Steps
- A desktop — add customer, not attended, not quoted: **PASS**
- A desktop — attach supporting photo; stored object exists; purpose=supporting: **PASS**
- A desktop — submit -> qa_test job, installer_site_check=no: **PASS**
- A desktop — hard refresh + reopen; next action Ready Check: **PASS**
- B desktop — attended, quoted, 142 m2, none, R5, removal no, $3,450, basis/GST/sent: **PASS**
- B desktop — attach quote.pdf + photo.jpg; purposes quote/supporting stored: **PASS**
- B desktop — hard refresh + reopen shows 142/None/$3,450/removal not required; files labelled: **PASS**
- B desktop — open saved photo/quote (200 image/jpeg, application/pdf, viewer dialog): **PASS**
- B desktop — edit form shows R5/inclusions/basis: **NOT_RUN (selector did not reach edit form in time)**
- A/B mobile — both journeys: **NOT_RUN**
- regressions — visited/unquoted and preliminary/unvisited: **NOT_RUN**
- auth — sign-out/relogin: **NOT_RUN**
- resilience — failed/retried upload/save: **NOT_RUN (covered only by local PGlite suites)**
- isolation — refusal of another business's job in browser: **NOT_RUN**
- Ready Check areas — save per-area (needs migration 0214, not live): **NOT_RUN — release blocker; read section rendered without error**
