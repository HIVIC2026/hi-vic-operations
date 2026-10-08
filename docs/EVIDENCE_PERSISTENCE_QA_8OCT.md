# Evidence persistence follow-up — 8 October 2026

## Repair

`confirmEvidenceUpload` keeps its authenticated job-role/responsibility, prestart, stored-byte/type and location checks. It now calls `persistEvidenceConfirmation`, which checks both evidence-file insertion and requirement-status persistence before returning success. Read errors and zero-row status updates also reject. The existing interface retains the stored path for Retry confirmation.

The schema has a UUID primary key but no unique storage-path constraint. New confirmations derive a deterministic UUID from the bucket/path; concurrent insert conflicts re-read and verify the existing record. Legacy random-ID rows are found by path first. A log/advancement failure cannot cause a blind duplicate file insert on retry. A retry does not reset verified, rejected or not-required review state. No schema migration or live data alteration was needed.

New records describe browser location as `device_at_upload`, not original-media capture. `captured_at` is null; normal `uploaded_at` remains the upload timestamp. Location checks still apply, but neither they nor tests prove physical-device or original-media provenance. Product-review/native schema changes are untouched.

## Verification

- 105 tests passed, 0 failed, 394 assertions across ten separately executed files. Combined execution initially had a process-global mock collision; all files passed independently, consistent with the project's isolated-test convention.
- Seven new helper tests execute its actual query path against local PGlite PostgreSQL with injected file insert/status/read/downstream failures, concurrent confirmations, legacy paths and review preservation. No fake device evidence, signing or approvals.
- Latest preview harness build: OK. No manual production build or separate manual typecheck was run; a separately reported typecheck result is not claimed.
- Authenticated existing TEST PDF: exact-byte private download and visible evidence panel checked on desktop and phone, no runtime errors or overflow. The PDF remains Awaiting verification. No new live uploads or job edits in this follow-up.

## TEST cleanup readback

- Earlier save fixture `69c0f4a6-232b-49da-9425-86e28b3004ad`: qa_test, archived, zero outbox records.
- Evidence fixture `769e2675-5695-48e6-ab04-d90857e05ac5`: qa_test, deliberately retained active, one file/one distinct path, no verified requirements, zero outbox records. Its older PDF row carries the prior implementation's capture timestamp; it is not original capture proof and was not rewritten. GPS was not fabricated.
- No new fixtures or cleanup mutations in this follow-up; existing history and unverified evidence retained.

No publication, native activation, audit creation, signature, approval, communication or payment action. Publication still requires root review; native activation separately awaits restored-signature final published readback.