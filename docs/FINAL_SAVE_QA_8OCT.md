# Final save QA — 8 October 2026

## Result
- Reproduced background-refetch editor remount and phone Save/menu overlap before editing.
- Stable per-job editor preserves open input and saved feedback; idle forms refresh known fields. Save/file operations lock inputs. Per-file upload retains successes on partial failure.
- Persisted originals already used `canRemove`; retained that rule and verified private View/Download, without a pretend Remove control.
- Ready Check inputs lock while saving, dirty input survives failed/background reads, Retry is explicit, and phone Save clears the fixed menu including safe-area allowance.

## Exact checks
- **11 sealed browser checks passed**: five groups each at 1280×1800 and 390×844, plus phone Save geometry; zero page exceptions.
- `bun test tests/ready-check-draft.test.ts tests/installer-intake-repairs.test.ts tests/installer-progress-truth.test.ts tests/installer-quoted-db.test.ts`: **43 passed, 0 failed, 65 assertions**.
- Preview harness: **build OK**, latest observed entry 2026-10-08T21:34:17Z. No manual build/typecheck run.
- Actual existing TEST installer-owner: intake submit, same-job details save/reopen (118 m², $2,450 inc GST), Saved feedback remained visible, private original preview/exact-byte download; partial Ready Check saved/reopened (117.5 m²). Actual phone screenshot/geometry confirmed Save above menu, no horizontal overflow/page exceptions.
- New job `69c0f4a6-232b-49da-9425-86e28b3004ad` verified `qa_test` in existing TEST business, archived after checks. **Zero outbound records.** TEST data/audit history retained, not erased. Existing business/member settings unchanged.

## Limits
Not a full-repository test pass or release approval. No real customer, Mitti audit creation/signature, worker/compliance approval, send or publication tested. Root review required before publication; existing HV-2010 Mitti membership blocker remains.

## Reproduce isolated checks
Run `PORT=8092 node tests/installer-intake-races.vite.mjs`, then `python3 tests/save-feedback.browser.py`. Screenshots live under `/tmp/browser/final-save/`.