# Installer Add job — two-route attendance/quote (Jo "Ok fix", 20 Oct 2026)

Preview/code only. Nothing published, sent, or written to Mitti/Xero/VEEC. No schema migration (uses existing `jobs.installer_site_check` / `installer_site_check_date`).

## IMPLEMENTED
- "Have you measured and quoted?" replaced by two independent questions: "Have you attended and assessed this property?" (Yes/No, optional past visit date) and "Have you prepared a quote?" (Yes/Not yet) — Add job, details editor, saved receipt, refresh-recovered receipt.
- Attendance stored only from the explicit answer (`installer_site_check` yes/no, null = unknown); date only if explicit and not in the future; `installer_attendance_answer` event records reporter/source. Price, area or files never set it.
- Unconditional clearing keyed on quote status removed: `applicableIntakeDetails`, `intakeQuotePayload`, `pickIntakeChanges`, `removalPayload`, server intake/edit serialisation. Area, proposed R and removal answer/area kept for visited-not-quoted; only amount/inclusions/removal charge are commercial.
- Not visited: no measure-up recorded; any size is kept as a preliminary estimate on the attendance event. Quoted + not visited shows "preliminary estimate, Ready Check still required".
- Next-action text for all four combinations; visited-not-quoted never books a second visit automatically.

## PASSED (run individually, bun test)
installer-two-route 8/0 (new), installer-intake-edit-db 16/0 (4 new PGlite cases: visited+not quoted retains area/product/removal across quote switches and reload; unknown stays unknown with price/area/file; future date rejected; repeat save no duplicate event), installer-ui-repairs 17/0, installer-payer-quote-db 12/0, installer-intake-review 17/0, installer-payer-fees 8/0, add-job-flow 15/0, add-job-confirmations 4/0, add-job-next-steps 5/0, installer-intake 14/0, installer-intake-repairs 13/0, intake-quote-details 7/0, installer-quote 5/0, installer-led 17/0, installer-journey 4/0, installer-quoted-db 1/0, installer-job-facts-db 1/0, jobfile-financial-privacy 8/0, qa-role-login 5/0. tsgo typecheck clean; preview build OK; retired-terms scan 0 customer-visible.
- Updated stale expectations caused by the intended change: fixture `jobs` tables gained the existing attendance columns; not-quoted payload now keeps proposed R; receipt includes `attended`; source assertion for attendance serialisation.
- Browser (Playwright, /installer-preview sample adapter, desktop 1280 + mobile 390): both questions render; Yes/Not yet shows site facts without quote fields; area 118 kept when switching to No/Yes (preliminary note shown) and back; no page errors.

## FAILED
- installer-progress.test.ts: import error `intakeProgressApplies` not exported — the export is absent at the starting HEAD too (pre-existing, unrelated).

## NOT_RUN / NOT IMPLEMENTED (scoped out this pass, gates unchanged)
- Item 3 extended quote facts (gross before VEU, GST treatment, method, exclusions, removal included vs separately priced, extras, net/gross ambiguity hold), per-zone mixed ceilings in Add job.
- Item 4 combined owner-quote arithmetic changes (existing canonical path untouched; no fee changes).
- Items 5–6 unified evidence model statuses/deadline enforcement at action boundaries, Mitti mapping/prefill read-back test, before-removal original-condition gate; official Activity 48 deadline mappings not verified here — downstream gates held as they were.
- Item 7 "Site conditions differ" handling and job-detail readiness panels.
- Bulk review attendance column update (bulk already uses explicit `site_check`; not re-verified in UI).
- Authenticated real installer browser journey with TEST identity on preview; live check (not published).
