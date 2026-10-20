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

## Source addendum audit (10:50 UTC) — Ceiling Insulation Activity Guide V1.2 (20261001, ESC C/26/5347)
Source handling: no new original attachment arrived (Jo's upload failed with a DNS error). The guide .docx is **not** in this repo; only the official blank PIESA/PIISA .docx forms (`docs/official-forms/`) and existing mappings are. The facts below come from Jo's inspection (printed pages given), not a file I fetched. It is not certified as the latest public ESC revision. Existing approved mappings were left unchanged.

| Guide requirement (printed page) | Current portal | Status |
|---|---|---|
| 3.4.1 p14–15: signed current PIESA no earlier than 30 days before works; given to owner + installer ≥24h before | PIESA window from `workflow_settings`, `job_piesa_deadlines` view; delivery ≥24h not separately enforced at the start-work action in this pass | GAP — ≥24h PIESA delivery check at the start boundary not verified |
| 3.4.1: life-support consent/medical plan BEFORE PIESA begins, installer receives it before work | Existing agreement rule (mem: Activity 48 agreements); not re-tested | NOT_RUN |
| 3.4.2–3 p15–16: owner info-sharing consent ≥24h before install; notification after consent, ≥24h and ≤5 days before | `esc.core.ts` enforces 24h lead / 5-day earliest (Melbourne display); check that consent comes before the notification not verified | PARTIAL |
| p17: notification updates limited; delay beyond 5 days → withdraw/resubmit | `esc.server.ts` marks a changed booking stale and asks for re-notification | PARTIAL — field-specific update rules not mapped |
| 3.5.1 p18: work within 30 days after PIESA, after PIISA, ≥24h after notification; re-checked when the schedule changes | Existing installReadiness/stage guards; boundary/DST/date-only tests not added this pass | GAP — just-inside/outside + Melbourne DST + unknown-timestamp tests NOT written |
| Table 4 p23–25 BEFORE: per-zone illuminated timestamped+geotagged 360° video ≤250MB (photos don't substitute); ruler depth + visible brand/model/R for under-insulated zones; signed PIESA/PIISA + CoES documents; installer front-of-premises photo with photo ID; electrician photos; TPS cable; isolation/solar-off; product packaging | Evidence requirements exist but not modelled per zone with video-vs-photo distinction | GAP — per-zone evidence model not built |
| Table 4 AFTER: per-zone 360° video, new-depth ruler photos, zone plan (dimensions/product/R/area) | Not per zone | GAP |
| 4.2 p21: device-generated capture date/GPS; upload time/place never pass as capture; keep originals; missing metadata → review | Existing rule: upload time/location never labelled as original capture (src/lib AGENTS) | PARTIAL — "missing metadata → review" status not re-tested |
| 4.1: records may be examined up to 6 years after VEEC registration | Retention/delete policy unchanged (per instruction) | UNCHANGED |
| 3.3 p14: $200 inc GST minimum co-payment to AP before VEEC creation, not refunded | Current approved payment policy preserved; no new deposit added | UNCHANGED — check that it matches the guide still open for office/Jo |
| 3.8 / Table 3: before-install vs completion consumer documents | Not re-mapped | NOT_RUN |
| HIVIC operational safeguard: capture original condition before disturbance/removal/covering (capture time ≠ upload date); no unsafe ceiling entry before isolation; earlier-day removal unresolved → office/safety hold | Not enforced at the removal/start action in this pass | GAP |

### Storage blocker (checked read-only, not changed)
- Private `job-files` bucket limit = 209,715,200 bytes (200 MiB) **< 250 MB** guide maximum. Separate portal caps from the bulk work are 50 MB per file / 500 MB total. So a legal-maximum 360° video **cannot be uploaded today**. Raising it is a storage/configuration change outside this task's authority — needs root/Jo approval.
- `partner-files` and `official-form-copies` = 20 MiB.

### Remaining not proven end-to-end (fake I/O required, NOT_RUN)
Native Mitti sync/prefill read-back to the same job/zone; per-zone evidence; server-side prestart/claim enforcement; timing boundary tests. Only the attendance/quote slice above is proven through real code (PGlite + preview UI). No customer, Dad, Deep or trade contact was made.
