# SIM — fake Melbourne clock scenario report

**Status: PARTIAL, not whole-job end-to-end PASS.**

One continuing in-house job harness now runs real booking, worker verification/selection, form orchestration, crew-save, SWMS, owner PIESA declaration, deposit messages, day-before digest, window reminders, cancellation, certificate delivery and repeat-invoice handlers against isolated test doubles. It captures recipients, channel, purpose/type/key, rendered content and attachments. Pending handback SQL is executed only in disposable PGlite databases.

The harness does **not** yet drive real intake, Save my spot, quick taps, quote generation/signing/code, payments, form completion/evidence and final AP close in one chain. Those prerequisites currently use explicitly labelled fixture changes. They are not proof of the requested whole-job flow. Six explicit `test.todo` entries preserve these gaps instead of reporting PASS.

## Scenario and step table

PASS below means the specified real-handler slice passed, not the complete scenario.

| Scenario | Step | Result |
|---|---|---|
| 1 All clear | Enquiry → Save my spot → quick taps → five-job assignment | NOT RUN in shared harness |
| 1 | Ready Check booking → RC/A3/A4 exist, booked stage, owner email/text; replay no repeat | PASS |
| 1 | Ready Check completion → issued quote → code + four signatures → actual $349 ledger | NOT RUN; fixture prerequisites only |
| 1 | Verified Team electrician selected; A3/A4 handed to them; PIESA booking stage and owner notices | PASS |
| 1 | Immediate notification to electrician on booking | FAIL requirement / GAP identified; not fixed |
| 1 | Actual electrician Complete PIESA handler | NOT RUN; completed-record fixture only |
| 1 | Owner PIESA PDF + Confirm my safety check email before install booking, once | PASS; real bug fixed |
| 1 | Deposit request and paid notice after fixture clearance/payment | PASS; actual Stripe webhook/payment mirror not exercised |
| 1 | Owner PIESA declaration required despite paid deposit; actual declaration unlocks booking | PASS |
| 1 | Installation booked with cleared/ESC-registered Lead Installer + crew → A5, owner notices | PASS |
| 1 | No digest at 13:59; one office email at 14:00 day before; replay none | PASS |
| 1 | Actual installation done, evidence/VEEC/AP → close | NOT RUN |
| 1 | Retained CoES → exact owner email/PDF attachment, document-set record, replay none | PASS; retention/upload boundary itself fixture only |
| 2 Upgrades | PIESA failed/rectification quote/approval/payment/actual A4 completion | NOT RUN; fixture branch prerequisites |
| 2 | No deposit while rectification open; request after completed fixture; Xero paid notice; install | PASS handler slice; actual Xero sync not exercised |
| 3 Deposit unpaid | Day 3/day 7 email + text, once; no install booking permitted without 10% | PASS |
| 3 | Official ten-days-left predicate | PASS; office row ingestion not exercised end to end |
| 3 | Actual To book list never shows install | NOT RUN; shared booking-Team deposit fact tested, existing list test remains separate |
| 4 Owner cancelled | Actual cancelJobFully, portal-only closure of three unused forms, assignments ended, HIV-office email only | PASS |
| 4 | Repeated cancel refused, no extra messages | PASS |
| 5 Swap | Actual crew-save → A5 reassigned and old direct access revoked, actual SWMS new/old signing rules, urgent Needs me candidate | PASS |
| 5 | Day-before swap permits prestart; morning swap blocks until matching ESC acknowledgment | PASS blocker; acknowledgment row is fixture input, full office action not exercised |
| 5 | Usual worker notifications after swap | NOT RUN; sender remains a test dependency |
| 6 Expiry | 20-/10-days-left owner email/SMS plus office EMAIL only, unchanged stage/forms | PASS |
| 6 | Expired repeat: office choice → owner accept → only own invoice paid in full → offer | PASS server handler slice; Xero creation/allocation are captured dependencies |
| 6 | New repeat A3 completion and full subsequent install | NOT RUN |
| 7 No booking | Victorian two-business-day threshold including Melbourne Cup holiday; Needs me candidate, job remains assigned | PASS clock/presentation slice; full office reader not exercised |
| 8 Handback | Pending locked SQL practice transaction refuses another office, ends paired assignments, preserves reason; Needs me candidate | PASS practice SQL/presentation slice; no hosted application |

Whole-scenario verdicts: **1–8 PARTIAL**, not eight complete passes.

## Message assertions

The captured identifiers below are the actual sender's `purpose`, SMS `type`, office `label` or frozen idempotency key—not invented template-hub ids. Matching templates are rendered through existing approved MJML builders. For every tested step the full ordered `[recipient actor, channel, identifier]` list is asserted; recipient addresses and exact booking text have additional concrete checks. This is not an inventory/proof of messages from unexecuted steps.

| Event | Recipient | Channel | Captured identifier |
|---|---|---|---|
| Each booked visit | Owner | email / SMS | `in_house_booked` / `in_house_booked_owner` |
| Deposit request | Owner | email / SMS | `install_deposit_request` / `install_deposit_request` |
| Day 3 | Owner | email / SMS | `install_deposit_day3` / `install_deposit_reminder` |
| Day 7 | Owner | email / SMS | `install_deposit_day7` / `install_deposit_reminder` |
| Deposit paid | Owner | email / SMS | `install_deposit_paid` / `install_deposit_paid` |
| Deposit paid | Installer office | email only | `install_deposit_paid_office` |
| 14:00 day-before | Installer office | email only | `in-house-install-office:v1:biz:2026-11-16` |
| Cancellation | HIV office | email only | helper `in_house_owner_cancelled`; provider key `in-house-owner-cancelled:job:<cancel-event-id>` |
| 20 days left | Owner | email / SMS | `install_window_reminder_20` / `install_window_reminder` |
| 20 days left | Installer office | email only | `install_window_reminder_20` |
| 10 days left | Owner | email / SMS | `install_window_reminder_10` / `install_window_reminder` |
| 10 days left | Installer office | email only | `install_window_reminder_10` |
| PIESA PDF/declaration | Owner, before install booked | email only | `piesa_copy` |
| CoES copy | Owner | email only | `coes_owner_copy` |

Installer-office SMS is rejected by the capture boundary and asserted absent. This proves only invoked send paths: worker-morning texts and remaining journey paths are not yet integrated. Household/office permission checks use actual Team reader and canonical trade access predicate; owner/HIV access and crew graph are fixture inputs, **not a full RLS proof**.

## Bug found and fixed test-first

**PIESA copy email crashes before installation is booked.**

- Failing test: real `deliverPiesaCopies` with current signed PIESA and owner link, but no installation booking → `TypeError: null is not an object (evaluating 'bk.scheduled_start')`.
- Root cause: Task 5 correctly allows owner delivery before booking, but rendering still dereferenced the absent booking using `bk!`.
- Minimal fix: pass `bk?.scheduled_start ?? null` and `pe.copy?.signatureDate ?? null`. The renderer already accepts null. No template wording, pricing, stages, delivery approvals or switches changed. Installer copy still waits for booked installation.
- Passing proof: one owner email, attached PDF, Confirm my safety check text, recorded delivery and no repeat on replay.

**Gap found, not changed:** there is no immediate selected-electrician booking notice in the invoked in-house path. `notifyInstallerPlanning` is installer planning, not electrician notification, and is intentionally suppressed by inHouseDispatchSkip. Daily Mitti links are a separate morning path. Simply unholding I71 would reintroduce prohibited installer coordination and could text an installer office; no such change was made. The missing full electrician notice remains explicitly NOT RUN/GAP rather than being faked into captured success.

## Tests and comparable suite

- New SIM file: **14 passed, 0 failed, 6 TODO**, 142 assertions on final focused run.
- Related checks (11 files excluding the existing nested reporter anomaly): **84 passed, 0 failed**. Includes CoES, actual A5/SWMS handover, 405-install digest/retry, quiet cancellation, pending handback/registration PGlite, deposits, forms, window, declaration and repeat rules.
- Red-first harness import initially failed; separate real PIESA email test then failed before the production fix and passed after it. Fixture failures (timestamp defaults, White Card state, holiday assumptions, exact date punctuation) were corrected only in the new harness/tests.
- Final full run: **993 files, 10,046 passed / 242 failed, 97 failing files** raw. `owner-accept-speed.test.ts` has the known nested reporter anomaly (outer 1/0, exit 1); individual check confirms its actual 0/1. Normalized: **10,045 passed / 243 failed, 97 failing files**.
- Clean before: **992 files, 10,032 passed / 242 failed, 97 failing files** raw; normalized **10,031/243/97**. Thus **14 new passes, zero new failing files, zero existing lost passes** against the requested 97/243 baseline.
- Baseline process discovered the newly-created SIM file while running: its provisional 5/3 result is excluded from “before”, not treated as a historical regression. All 992 pre-existing files have identical before/final outcomes. Two known stallers were excluded identically (`register-interest-validation`, `save-spot-uncertain-delivery`). Per-file runs are isolated with generous timeouts.
- Automatic build OK. Retired-term scan: zero customer-visible failures.

## Changed files

- `tests/helpers/sim-in-house.ts` — shared scoped-clock state, explicit dependencies and captured provider boundaries.
- `tests/helpers/sim-handback-practice.ts` — disposable PGlite pending transaction runner.
- `tests/sim-in-house-journey.test.ts` — scenario slices, exact messages, replay/access/DST and real crash regression; explicit missing proofs.
- `src/lib/piesa-delivery.server.ts` — nullable booking render fix only.
- `src/lib/AGENTS.md`, `AGENTS.md` — nullable delivery and honest SIM evidence rules.
- `roadmap.md`, `docs/SIM-scenario-results.md` — accurate remaining scope and report.

## Restrictions / remaining work

No settings, secrets, live records, hosted database changes, sends or publication. No new migrations. Existing Task 7 handback migration was proven only in PGlite; all pending migrations remain unapplied. S1 remaining work is unchanged.

To complete SIM, the six TODO groups require more isolated fixtures and actual handler wiring—not user credentials or permission to touch live data. This report does not claim those work items are externally blocked or complete.
