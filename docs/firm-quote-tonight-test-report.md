# Firm-quote TEST journey — 6 Nov 2026

## Latest approved run — Jo 11:09 UTC, TEST emails now

**STOPPED: firm_quote_flow_live_at is now NULL**, read back after the live Choose installer dialog showed no choices or Give button. The shared presentation requires `ready_check_ready_to_schedule`, but the firm-quote request left HV-3831 at `spot_saved`; this can strand a real owner's requested quote. No further progression or broad sweep was forced.

| Step | Actual result | Email subject |
| --- | --- | --- |
| 1 | PASS for HV-3831: repaired consent from its durable Test Centre snapshot (original true tick, website-v1, 10:35:33.731 UTC), preserving qa_test provenance and original time. Email accepted/sent to jolowexo@hotmail.com only; removal wording and Proceed link present. | [TEST] Test, your preliminary estimate: $3,728 after a $1,470 rebate |
| 2 | PASS: emailed link on estimate.homeinsulationvictoria.com.au; Proceed clicked twice; due Tuesday 17 November; exactly one firm_quote_requested event; no new owner message. | None |
| 3 | FAIL/PARTIAL: Choose installer To release shows HV-3831 and its due tag in By area; Enquiries With photos count is 0 and excludes it after Proceed. Table Choose installer opens a blank dialog, so Ready Check refusal and Give to TEST Photos Insulation could not be exercised. | None |
| 4 | BLOCKED by step 3; no assignment, installer submission or held quote manufactured. | None |
| 5 | BLOCKED by step 3; no office Send and no email 3. | None |
| 6 | NOT RUN after safety stop; no second job created, no request backdated, no sweep called. | None |
| 7 | PASS for HV-3831 only: one preliminary email and no SMS or spot messages; two-job proof NOT RUN because second job was not created. | None |

Email 1 used the existing TEST sender and job reservation, with a one-process quiet-hours override after exact qa_test job/owner preflight and an extra final recipient check restricting provider calls to Jo's inbox. No persisted overnight policy changes and no real records or sends. The existing `group: likely` TEST input selected the firm preliminary renderer rather than the old uncertain-manifest onsite invitation guard. Initial preview held on that old guard; no message was sent during preview.

Permanent consent repair is confined to createTestEnquiry and a rechecking TEST-only helper; checked, unchecked and missing ticks remain distinct, retries insert once, real jobs refuse without writes. 59 checks pass (4 new), retired-terms scan clear, preview build OK. Not published: the safety stop makes a new live run inappropriate until the handover failure is repaired. No passwords exposed or changed; TEST office browser login succeeded normally.

Evidence: `/tmp/browser/firm-now/proceed.png`, `ticked.png`, `enquiries.png`; private browser session and token-bearing email preview are not deliverables.

## Access and repair
- TEST office normal password sign-in succeeded on the published portal using the existing private QA_OFFICE_PASSWORD secret. No password was disclosed, reset, or changed; no Jo approval tap was necessary.
- Explicit-user platform session mint cannot show approval in this context; self mint found no matching account. Neither was bypassed.
- Existing Test Centre role links can sign in as the assigned verified TEST installer; TEST Photos Insulation exists with photos quote method. Not yet assigned/sign-in not exercised.
- Found missing exact TEST-office allowlist entries for the two approved Test Centre photo functions. Added only those entries, retaining handler identity, file/path and qa_test checks.
- Before: two policy tests failed; after: 37 checks passed across three files. Retired-terms scan: zero customer-visible failures. Automatic preview build OK.
- Published permission repair and confirmed successful Test Centre photo attachment on the published portal. Earlier preview retry used the same job; no additional job was created.

## Actual journey
One job: HV-3831, b3a360ef-3efd-44ba-bcd2-c91461b6ac77, source qa_test, reserved TEST owner email, created 10:30:26 UTC after activation. Synthetic ceiling photo clearly marked TEST, private intake_media. Repeated form retries resolved to this same job and recorded ordinary update history; not duplicate jobs.

| Step | Result | Email subject |
| --- | --- | --- |
| 1 enquiry/photo/email 1 | PARTIAL: TEST enquiry/photo and normal eligibility/estimate preparation verified; email blocked | None sent |
| 2 Proceed twice | NOT RUN: email/link flow not delivered | None |
| 3 queues/refusal/Give | NOT RUN: depends on request | None |
| 4 installer quote held | NOT RUN: depends on assignment | None |
| 5 office Send/email 3 | NOT RUN | None sent |
| 6 second TEST job/day-4 twice | NOT RUN: no second job; automatic 8pm–7am Melbourne hold retained; no unscoped sweep invoked | None sent |
| 7 no spot messages | No email attempts for HV-3831; published contact history Email 0/Text 0. Second job absent, so two-job rule not fully tested | None |

## Remaining blocker
Test Centre submitted contact_consent=true and its timestamp/version, but HV-3831 has zero owner_contact_consents records. The source currently persists these only for base44 intake, not qa_test. This is a TEST-centre omission, not evidence that real website consent is missing. Do not manufacture consent, skip consent guards or force delivery. Automatic email 1/day 4 also must respect current Melbourne quiet hours (run is after 9pm).

Switch remains ON at 2026-11-06 10:11:41.818393 UTC, unchanged. No identified failure affecting real owners; no real jobs/owners/installers changed; no emails sent. Full journey remains incomplete.