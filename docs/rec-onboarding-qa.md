# REC onboarding readiness QA — 2026-10-03

Base ba756b2d → working commit 54644c44 (plus this turn's uncommitted edits; final commit assigned by platform). Not published.
Root `/` → staff sign-in change preserved (untouched).

## Execution methods
- **STRICT-UNIT** — `tests/rec-sign-qa.test.ts`, pure rules from `rec-onboarding.core.ts` with fixed `now` (Melbourne time).
- **STRICT-HARNESS** — same file, `performRecSign` (`src/lib/rec-sign.core.ts`) driven against an in-memory database (enquiry insert/unique conflict/find, conditional draft→submitted update, rollback). The production handler `signRecAgreement` now delegates to this exact function, so the harness exercises the shipped logic; only the Supabase adapter lines are untested.
- **SAMPLE-UI** — Playwright on `?sample=<step>` at 390 px and 1280 px. Sample skips normal validation and disables upload/sign; it proves layout/gates only, not strict completion.
- **CODE-READ** — inspection only.
- Production: read-only index query only (`partner_enquiries_source_key` unique on source_system+enquiry_type+submission_id). No rows written.

## Bugs found and fixed
| ID | Bug | Fix |
|---|---|---|
| B1 | Review: agreement load error was shown as panel text while the "reviewed" box stayed enabled; stale responses could overwrite newer ones; ticking the box refetched the agreement | Generation-guarded load keyed on schedule data (excludes the tick); on failure/version mismatch the box is disabled and unticked, alert + Try again shown |
| B2 | Review could be skipped on relaxed test links (sign did not require `agreement_reviewed`) | `review` added to always-mandatory steps: blocked on Save & continue in every mode, on save to `sign`, and at signing |
| B3 | Staff/unanswered role could sign on a relaxed test link via direct server call | Signing requires `works_under_rec === false`, never relaxed |
| B4 | Signing ignored a zero-row draft update (concurrent tab) and reported success; orphaned office entry after a failed rollback made every retry fail on the unique key | Update must change a row; zero/failed update rolls back the entry it created; conflict re-uses the existing entry; loser of a race sees "already been signed" |
| B5 | Calendar-invalid expiry (e.g. 2027-02-30) accepted | `validCalendarDate` |
| B6 | Any radius 1–100000 accepted by the server | Only the five offered radii (25/50/75/100/all-Victoria) |
| B7 | Arbitrary/duplicate day values accepted | Days must be unique values from the list |
| B8 | Sign button enabled for any text containing "@" while the server rejected it | Client uses the same `validBusinessEmail` |
| B10 | 21 custom rate items passed page validation (only the server schema capped at 20) | Page/sign validation caps at 20 |
| B9 | Sample data pre-ticked "reviewed" | Removed; preview requires an explicit tick |

## Matrix
| Case | Options covered | Method | Result |
|---|---|---|---|
| ABT-1 role | unanswered / business / staff | STRICT-UNIT | PASS |
| ABT-2 licence | true / false / null / undefined / blank licence | STRICT-UNIT | PASS |
| ABT-3 contact | 3 valid + 3 invalid mobiles, 4 invalid emails, blank name | STRICT-UNIT | PASS |
| ABT-4 staff direct sign | staff + unanswered, normal and relaxed link | STRICT-HARNESS | PASS (after B3) |
| ABT-5 staff back-switch, Save hidden on staff | | CODE-READ (unchanged, verified previous turn) | PASS (not re-run) |
| BUS-1 ABN | valid, bad checksum, 10 digits, letters, blank | STRICT-UNIT | PASS |
| BUS-2 REC/legal name missing | | STRICT-UNIT | PASS |
| BUS-3 address | none / free text / label mismatch / bad state / non-AU / interstate valid | STRICT-UNIT | PASS |
| INS-1 cover | 4,999,999.99 / 5m / 20m / null | STRICT-UNIT | PASS |
| INS-2 expiry | today, yesterday, Melbourne-midnight rollover, 5 invalid formats/calendar, leap day | STRICT-UNIT | PASS (after B5) |
| INS-3 certificate missing | | STRICT-UNIT + HARNESS | PASS |
| INS-4 upload MIME/size/quarantine/extraction | | existing `insurance-reading` tests + schema (10 MB max, 3 MIME types) CODE-READ | PARTIAL — real storage upload, byte sniffing, 10 MB boundary, replace/retry NOT TESTED end-to-end |
| COV-1 services unchecked | blocks coverage/availability/sign saves | STRICT-UNIT + SAMPLE-UI | PASS |
| COV-2 radius | all 5 offered, 6 unsupported | STRICT-UNIT | PASS (after B6) |
| COV-3 origin NSW / edited text / exclusions in schedule | | STRICT-UNIT | PASS |
| COV-4 address dropdown races | mouse/Enter/edit/Escape/remount/copy | delayed-response browser harness, previous turn (824f6f04); component unchanged | PASS (not re-run); touch NOT TESTED on real device |
| AVL-1 | 7 days × 6 lead times × accepting yes/no (84 combos), 4 capacity bands | STRICT-UNIT | PASS |
| AVL-2 | no days, bad/duplicate day, bad lead time, unanswered accepting, bad capacity | STRICT-UNIT | PASS (after B7) |
| RAT-1 GST | yes / no / unanswered + schedule labels | STRICT-UNIT | PASS |
| RAT-2 required rates | null/0/−1/100001/NaN/∞ on PIESA, attendance, RCD; decimal 329.95 | STRICT-UNIT | PASS |
| RAT-3 CoES | unanswered, separate w/o fee, separate $45, switch back to included (no stale $45 in agreement) | STRICT-UNIT | PASS |
| EXT-1 reviewer boundaries | 2099-99-99, radius 42, Funday, 21 items, 20 items | STRICT-UNIT | PASS (after B5–B7, B10) |
| RAT-4 custom items | valid, dup description (case), dup id, desc 1/121, unit blank/31, price 0, bad id; schedule line | STRICT-UNIT | PASS; 20-item limit now in validation (EXT-1) |
| BNK-1 | BSB 3 valid/5 invalid, account 2 valid/4 invalid, blank name | STRICT-UNIT | PASS |
| REV-1 load failure fail-closed | | CODE-READ + SAMPLE-UI (loaded path) | Loaded path PASS; failure path browser NOT TESTED (needs a real token; server functions use an internal protocol that can't be safely mocked) |
| REV-2 review always mandatory | unticked stays on page (sample), relaxed sign blocked | SAMPLE-UI + STRICT-HARNESS | PASS (after B2) |
| REV-3 material edits reset review | 7 schedule fields reset; bank does not | STRICT-UNIT | PASS |
| SGN-1 each of 9 acknowledgements | | STRICT-HARNESS | PASS |
| SGN-2 signer name/title/email, version mismatch, already signed, relaxed missing licence, no certificate | | STRICT-HARNESS | PASS |
| SGN-3 full path A: GST yes, CoES included, Mon, accepting | | STRICT-HARNESS | PASS — submitted, 1 office entry linked, signed text = exact agreement |
| SGN-4 full path B: GST no, CoES separate $55, Sat+Sun, not accepting, all-VIC, Varies, 20+ | | STRICT-HARNESS | PASS |
| SGN-5 double click / stale tab after success | | STRICT-HARNESS | PASS |
| SGN-6 concurrent double submit | | STRICT-HARNESS | PASS (after B4) |
| SGN-7 update error / zero-row update rollback | | STRICT-HARNESS | PASS (after B4) |
| SGN-8 orphaned entry retry | | STRICT-HARNESS | PASS (after B4) |
| SGN-9 insert failure leaves draft | | STRICT-HARNESS | PASS |
| PER-1 legacy keys | all 13 + 6 junk keys | STRICT-UNIT | PASS |
| PER-2 resume first incomplete hidden member | | STRICT-UNIT | PASS |
| PER-3 stale two-tab save | server rejects mismatched `updated_at` | CODE-READ | PASS (not executed) |
| PER-4 expired token, rate-limit, save failure, refresh | | CODE-READ | NOT TESTED |
| A11Y-1 all 9 screens 390 + 1280, no horizontal overflow, no page errors | | SAMPLE-UI | PASS (18/18) |
| A11Y-2 screen reader / scroll-to-error / footer overlap on long pages | | — | NOT TESTED |
| OFF-1 submitted app reaches office queue | entry with submission_id + raw_payload linked on the application | STRICT-HARNESS | PASS (logic); real admin list render NOT TESTED |
| OFF-2 success copy | lists checks and next steps conditional on approval; no volume/timing promise | CODE-READ | PASS |

## Independently reproduced evidence (reviewer, base ba756b2d, Node 24 on the pure core)
`stepErrors` returned [] for expiry `2099-99-99` (B5), radius 42 (B6), days `["Funday"]` (B7), 21 distinct custom items (B10). Case EXT-1 in `tests/rec-sign-qa.test.ts` asserts all four now fail and 20 items still pass: **PASS**. Reviewer also confirmed: baseline full fixture complete, Infinity rate rejected, GST no + CoES included omits stale fee — matching RAT-2/RAT-3.

## Submission idempotency vs production unique keys
Read-only `pg_indexes` (confirmed by me and independently by the reviewer): UNIQUE `partner_enquiries(source_system, enquiry_type, submission_id)` and UNIQUE `rec_onboarding_applications(resume_token_hash)`. Signing relies on the first: `submission_id = portal-rec-onboarding-<application id>`, so a duplicate insert returns unique-conflict (23505), which `performRecSign` treats as "entry already exists" → looks it up and re-uses it (SGN-6, SGN-8). The application update is conditional on `status = 'draft'` and must change a row. The harness's fake database enforces the same unique key.

## Commands and results
- `bun test tests/rec-sign-qa.test.ts tests/rec-onboarding.test.ts tests/partner-activation.test.ts tests/insurance-reading.test.ts` → **67 pass, 0 fail, 504 expects** (rerun after EXT-1) (first run 65/1: old test asserted services-only mandatory list; updated for B2).
- `tsgo --noEmit` → no errors.
- Preview build log → `build OK`.
- `python3 /tmp/browser/recqa/smoke.py` → 18/18 screens ok, 0 page errors; review box unticked, sign disabled in preview.
- `python3 /tmp/browser/recqa/gate.py` → review & services stay when unticked; ticked review advances; agreement stays visible after ticking.

## Remaining before sending
Not blockers to the form logic, but should be done before wide release:
1. One real end-to-end submission on an office QA link (real upload of a PDF/JPG, extraction, sign, appears in the office list) — needs your go-ahead because it writes a real record.
2. Full atomicity: signing is now compensated + self-healing, but not a single transaction. A database function would close the last gap (rollback delete failing *and* the applicant never retrying leaves an unsigned office entry). Optional; not applied.
3. Upload boundaries (exact 10 MB, wrong bytes with right extension) and expired-link/rate-limit messages were not exercised live.
