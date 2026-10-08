# Evidence upload QA — 8 October 2026

## Bounded changes
- Evidence reads throw errors rather than replacing failures with an empty list. Loading/failure views omit misleading counts; Retry is explicit, including background read failures.
- Shared row catches upload and file-open failures, displays server/storage reasons, serializes uploads, disables opening while a URL is loading, and resets the file input after every attempt.
- Success requires `confirmEvidenceUpload` to return `ok: true`; undefined/failure cannot claim success. After storage success, confirmation retry reuses that stored file without another upload. Known byte-validation rejection clears that pending reference because the existing server deletes the rejected object.
- Allowed types reuse existing upload safety rules; empty files are refused. Storage size-limit errors are displayed without inventing a new limit. No gate, location rule, product-review control, server function or database schema changed.

## Actual results
- **10 sealed evidence phone/desktop groups passed**: read failure/retry without false counts, invalid/empty file, raw storage size failure and identical-file retry, undefined confirmation/retry without second upload, URL busy/error/retry, location refusal with no fake GPS; zero page exceptions.
- **11 retained save-feedback phone/desktop groups passed** after evidence edits.
- **53 focused tests passed, 0 failed, 111 assertions**: 46 across Ready Check/intake/progress/file-only quote/upload safety and 7 geo checks. Not a full-repository suite.
- Existing authorized TEST owner opened unarchived `HV-1785`, job `769e2675-5695-48e6-ab04-d90857e05ac5`, in the approved TEST business. No account/job created or unarchived.
- Actual measurement upload of clearly marked `TEST-evidence-retry.pdf`: one storage request intentionally aborted by browser instrumentation; visible Retry and empty input verified; identical file selected again, upload confirmed, private file URL opened and downloaded bytes matched exactly.
- Readback: `source=qa_test`, stage still `ready_check_ready_to_schedule`, evidence `uploaded` (not verified), GPS null, `location_source=not_required`; zero job outbox records. The TEST evidence file and append-only history remain, not erased or represented as compliance approval.
- Preview harness build OK; no manual build/typecheck invoked.

## Not tested / release limits
No genuine onsite photo/video capture, GPS permission success, statutory product approval, real audit/signature, external delivery, native template edit or portal publication. Size failure was sealed storage fault injection, not a real oversize upload. Root review remains required. Existing HV-2010 Mitti membership blocker remains separate.

Reproduce sealed checks with `node tests/evidence-upload.vite.mjs` and `python3 tests/evidence-upload.browser.py`. Temporary scripts/logs/screenshots: `/tmp/browser/evidence/`.