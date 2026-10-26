## Installer Add job question correction — 8 October 2026, 11:26 UTC, preview only
- Prior owner price agreement is now optional; required contact/fee/below-R2 disclosures and full owner acceptance gates preserved. Installer legacy bulk bookmarks redirect to current three-choice intake; office batch history remains available. Existing styling and today's performance fixes untouched.
- 41 focused tests / 113 assertions pass; styled sealed phone/desktop click-through passes all three modes, including false owner agreement in the submission payload. Harness build OK; retired scan zero customer-visible failures. Actual supported TEST session had no loaded business choices; signed-in installer question click-through remains unverified.
- Published Add job bundle still contained the mandatory owner-agreement check at read-only inspection; this correction is preview-only, no publish performed. Exact deployed SHA unavailable. Details, files, screenshots and rollback: `docs/ADD_JOB_8OCT_QUESTION_CORRECTION.md`.

## Installer intake, insurance and invitation repairs — 8 October 2026, preview only
- 09:37 Jo explicitly authorised creating the missing HV-2010 Ready Check form. Approved existing TEST office/admin session verified the job remains ready_check_scheduled, is not qa_test, business access enabled, and no current Mitti linkage; called generated admin-guarded createMittiAssessment once. Actual Mitti user search returned no exact match for the assigned installer, so the existing guard rejected creation before template/create/share/owner calls. Follow-up SELECT confirms no linked form. No retry, invitation, account/settings/job-stage change, email/SMS or publish. Blocker: actual installer Mitti membership with the exact assigned portal email; no invented identity or gate bypass. No application code changed.
- 09:29 Jo explicitly authorised Mitti access ON for the installer business behind HV-2010. Existing approved TEST office/admin session called the generated `setPartnerMittiInvited` RPC (existing admin guard, business switch + audit). Before false; authenticated `getPartnerMittiInvited` read-back true with recorded timestamp. Only that business access switch changed; no invitation sent, no onsite form created, no live Mitti/Xero call, cron, account/role change or publish. Existing saved job has no linked form; opening remains unverified. Reversible through the same office switch with invited=false. Screenshot review also identified generic form instructions and mockup payment timeline wording; those have not been corrected in this access-only action.
- 09:25 screenshot follow-up: SELECT-only actual record confirms Ready Check saved and booked; template configured and auto-send on, but originating business `mitti_account_invited=false`, no audit recorded. Existing access gate is the cause; no live Mitti call or settings change performed. Office must confirm real invitation using existing guarded setup. Red duplicate-email disclosure in OnsiteStart replaced by neutral unsuccessful-save/help status; no owner merge/access changes. 23 focused tests/41 assertions and harness build OK; no actual warning-state browser check claimed.
- 09:21 request: distinct Add a job for later and Add an existing job choices. Later entry collects homeowner contacts/permission, booked date/time and optional manual area/method/site notes; creates through existing installer intake guards, records supplied measurements as unverified external/audit facts, attempts only guarded confirmBooking and does not create Mitti forms. Blocked appointment stays unconfirmed; existing-job quote/measurement and approval checks preserved. No live submission/booking tested. 31 focused tests/57 assertions passed; rollback only later-job/core and later branches in onsite intake/route.
- Add job uses separate address, owner name, mobile, email and contact-permission fields; source/paste/CSV removed. Quoted Yes collects area/method/amount/inclusions; No offers Ready Check or returning after visiting without submitting a job. Address typeahead fills suburb/postcode and local rejection clears on correction; Victoria-only rules unchanged.
- Duplicate email: reuse only an owner linked through this originating installer's existing installer-sourced job; no owner updates/global merge. Unrelated/orphan owners remain a friendly office-review blocker. Actual screenshot customer's record was not inspected or changed; complete Start/retry is not verified.
- Insurance View chooses partner-files for exact recorded onboarding paths, otherwise existing job-files paths; business access checks retained, opening/failure states visible. Actual signed file not tested with installer credentials.
- Electrician invite now shows missing fields rather than a silently disabled action; existing never-attempted nominations may issue their first invite with an atomic existing-field claim. Sent/uncertain attempts do not retry; delivery claims stay truthful. Schema CHECK inspected SELECT-only; no new status/schema. No invite sent or live delivery tested. Team's confusing explanatory paragraph removed; staff access preserved.
- **Checks:** 66 focused tests / 152 assertions; isolated address response fixture, ACT→VIC correction, permission, document dialog and invitation validation at 1280/430 passed without overflow/page exceptions. Current session had no usable installer business, so these are sample checks, not authenticated mutation/storage-delivery proof. Automatic harness build OK; retired-term scan 27 existing warnings/0 customer-visible. No records/settings/migrations/integration actions/sends/publish. Narrow rollback: revert only repair hunks in customer-fields/onsite-start/partner.import, installer-owner/partner-file/installer-quote-intake, affected intake/file/invite functions, Team/insurance presentation and associated tests; preserve office/email concurrent changes.

## Actual office redesign (phase 3) — 8 October 2026, preview only
- Actual office navigation and `/admin/jobs/$jobId` compact workspace replaced within Jo's authorised scope; canonical `/admin/operations` supplies Overview and unique category views. Legacy tools/bookmarks, original isolated preview, website Leads bulk queue, exact financial/approved email rendering and guarded audited controls preserved.
- Actual TEST admin reads: **712 unique = 675 Leads + 1 Active + 23 Closed + 13 Needs classification**, stage sum 712, zero duplicates; saved 23/media-review 79, all seven stages and combined flag/source/eligibility/search filters passed. Actual job visible at 1280/430/375 with no overflow/page exceptions. Interrupted read/retry and zero duplicate category RPCs verified. Signed-out protections passed.
- **127 focused tests passed**, five retired skips, 532 assertions; standalone tsgo exit 0, automatic harness build OK, retired scan zero customer-visible failures; isolated desktop/phone fixtures checked. No mutation clicks, business-data/settings changes, sends, integrations or publish.
- **Gaps:** fresh TEST installer mint returned approval unavailable once; no new non-office runtime proof claimed (phase-2 denial remains historical evidence). Existing audited UI does not support manual Check ↔ Save spot movement; no alternate transition invented. Integration health/payment/compliance launch blockers unchanged. Exact touched files, verification and narrow rollback: `docs/OFFICE_REDESIGN_PHASE3.md`.

## Templates hub + preview flags (phase 2) — 8 October 2026
- **8 Oct 08:27–08:33 UTC signed-in verification PASSED:** supported sessions established for existing TEST admin and TEST installer. Actual localhost app routes and generated RPCs loaded real database reads. Latest snapshot **711 unique = 674 Leads + 1 Active + 23 Closed + 13 Needs classification = stage sum 711**, zero duplicate IDs; first snapshot was 710 (live intake changed between reads; this task performed no writes). Spot saved **23**, photos/videos to review **79**; every stage click, installer-source filter, and flag + source + eligibility + search combination matched. Templates Email/Mitti/Compliance selection passed at 1280/430 widths, no overflow or page exceptions; stored reads returned zero communication review versions and six compliance versions, plus Mitti settings and paperwork catalogue. TEST installer redirected to `/field` for both admin pages and all five read RPCs returned `Admin only.`; signed-out visitors redirected to `/auth`. Interrupted operations/Mitti browser reads displayed failure instead of zero/empty settings. 48 focused tests and standalone tsgo passed. Existing compliance database-error swallowing remains a source-known limitation (no actual database failure observed); not launch/integration-health proof. No app code, records/settings/roles changed; no sends/save/approve/connect/cron/publish. Details and docs-only rollback in phase-2 document. This supersedes the earlier auth blocker below.
- **8 Oct 08:22 UTC authorised follow-up:** Jo explicitly approved existing TEST admin/non-admin sign-in. Supported explicit-user session mint returned "approval unavailable in this context"; self mint found no account for the requesting user. No session was established and no existing test password/session was available. Authenticated page/RPC/PostgREST loads, current count reconciliation and non-admin browser/RPC denial remain blocked by tooling, not lack of Jo's consent. Standalone `bunx --package @typescript/native-preview tsgo --noEmit` passed; 48 focused tests across four existing files passed. No app code, records, credentials, roles, settings or approved email HTML changed; no sends/connect/cron/publish. Details in phase-2 document.
- `/admin/templates` (Email / Mitti / Compliance) under one office heading "Templates"; preview gains Spot saved and Photos/videos to review filters. Details, checks, rollback: `docs/TEMPLATES_HUB_PHASE2.md`.
- Earlier verification: 71 focused tests, typecheck/build OK, retired-term scan 0 customer-visible, isolated desktop/phone browser fixtures, signed-out redirects. Authenticated admin/non-admin runtime verification now passed as recorded above. Automation is not all ready; no sends, writes or publishing.
- Narrow review correction from `b477a44…` (8 Oct 08:13 UTC): honest email inventory is **13 inline existing-builder previews + 1 original-tool preview + 5 stored-review entries**, not 19 live-send previews. Stored review bodies/statuses now visible; missing bodies say No preview available. Save-your-spot metadata describes customer purpose/manual leads send; Mitti approval Not recorded, saved IDs separate from live health, displayed ID used by connect action (never clicked). **33 focused tests pass**, desktop/phone fixture checks and signed-out redirects pass; automatic harness build OK, scan 27 existing warnings/0 customer-visible. Root/scoped rules checked: zero missing pre-relocation bullets. No manual typecheck, real reads, sign-in/session mint, authenticated admin/non-admin verification, writes, sends, live calls or publish. Precise inventory, source-read limitations and correction-only rollback are in the phase-2 document.

# Home Insulation Victoria portal status

Updated: 5 October 2026

## Isolated operations preview — 8 October 2026
- Built at `/admin/operations-preview`, direct link only; no navigation/workflow/payment/quote/compliance/email-template changes.
- Authenticated admin-only GET reads, business-unit scoped, no customer writes, migrations, sends, live integration calls, cron runs or publishing.
- One pure classifier reconciles Leads / Active jobs / Closed jobs / Needs classification. Saved-only leads wait for capacity without a two-day overdue alert; operational evidence overrides saved spots. On hold stays open.
- **Verification:** Acceptance corrections: 179 focused tests passed across 9 files, including mocked SELECT-only loader scope/query-shape/error tests and evidence, purpose-specific communication recovery, null source, quote handoff, deadline, sending-lock and eligibility regressions. Retired-term scan: 27 existing warnings, zero customer-visible failures. Automatic harness reported `build OK`; no manual build/typecheck run. Unrelated router/page-recovery hunks restored exactly to `ff6c590e`; full presentation-only guard restored with a separate preview rule.
- **Browser:** isolated six-record fixtures at desktop 1280×1800 and phone 390×844; filtering, installer source, expandable details, no horizontal overflow and no browser exceptions. Signed-out actual route redirected to `/auth?next=%2Fadmin%2Foperations-preview` without loading records. Non-admin signed-in denial is source-guard checked, not browser-tested.
- **Reconciliation:** Actual schema/data validation: 123 SELECT statements through a SQL adapter invoking the preview loader/classifier; 708 unique = 671 Leads + 1 Active + 23 Closed + 13 Needs classification = stage total 708; duplicate IDs 0, missing source 0. Earlier progress count 707 was superseded by this later snapshot. Mock UI: 6 = 3 + 1 + 1 + 1. Read errors surface instead of zeros.
- **Limits:** Actual authenticated RPC/database admin read path verified in the 08:27–08:33 UTC follow-up above; the earlier SQL adapter validation alone was not that proof. Connection health, backup availability and full compliance readiness remain unverified. Commencement task currently uses completion evidence to retire the alert; a distinct actual-commencement timestamp is not available in these reads. No database backup claimed; no restoration needed. Later phases: Email/Mitti/Compliance automation and Templates organisation. Baseline and file rollback: `docs/OPERATIONS_PREVIEW_PHASE1.md`.
- Correction files: `operations-preview.core.ts`, `.server.ts`, `OperationsPreview.tsx`, `tests/operations-preview.test.ts`, `tests/operations-preview-loader.test.ts`, `tests/operations-preview.browser.tsx`, `AGENTS.md`, this register, rollback document and `roadmap.md`; only unrelated hunks in `src/router.tsx` and `tests/page-recovery.test.ts` restored. Locked no-size email files untouched.

This is the only current implementation register. `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md` defines workflow rules. **Built** means the current path exists; **Partly built** means a working foundation exists but the approved flow is incomplete; **Not built** means approved or planned only.

## Public and owner

| Feature | Status | Route or page |
|---|---|---|
| Public rebate calculator | Built | `/`, `/calculator` |
| Secure estimate and owner result | Built | `/estimate/$token` |
| Campaign email/page preview | Built | `/campaign-preview`, `/admin/launch-campaign`; save-spot and video-priority drafts, sending locked |
| One-tap campaign spot saving | Partly built | `/estimate/$token/campaign` — approved copy, area availability and video priority pending |
| Campaign manhole video | Built | `/estimate/$token/video` — upload saves the spot, marks video priority and queues office review |
| Campaign remove-enquiry action | Built | `/estimate/$token/campaign` |
| Campaign missing-link preparation | Not built | Launch campaign preparation |
| Owner My job secure-link page | Partly built | `/my-job/$token`; full journey proof pending |
| No-login owner signing (6-digit code): quote acceptance, safety-check/install time picks, install consent | Built | `/my-job/$token` |
| Owner house progress graphic | Partly built | Shared `OwnerHouse`; not yet on every owner screen/email |
| Save my spot / Ready Check times | Partly built | Four 2-hour windows built; campaign area switch pending |
| Quote acceptance and payment choices | Partly built | Owner quote flow; sign-in retained; full dummy proof pending |
| Combined safety-check/install booking | Partly built | Owner booking flow; full dummy proof pending |
| All done owner screen | Partly built | Owner completion view; full dummy proof pending |

## Installer and electrician portal

| Feature | Status | Route or page |
|---|---|---|
| Trade sign-in and onboarding | Built | `/auth`, onboarding routes |
| Worker invitations and job links | Built | Worker invite/join and `/w/$token` |
| Current My work list and job page | Built | `/field`, `/field/$jobId` |
| Installer single-job intake | Partly built | `/partner/import`; approved copy/privacy updates pending |
| Bulk job upload engine | Partly built | `/partner/bulk-import`; mobile upload/review/done, complete placement and TEST run built; Scenario E pending |
| Bulk Past uploads | Built | `/partner/bulk-import` |
| Bulk electrician choice and private picker | Partly built | Batch/per-job choice, private saved choices and pending invite built; reasoned switch and full Scenario E proof pending |
| Electrician first-tap offer, My work and On the day | Built (preview, TEST logins 6 Oct) | Approved preview designs |
| Installer Ready Check offer/day and Install day | Built (preview, TEST logins 6 Oct) | Approved preview designs |
| Shared trade before-you-start checklist | Built (preview, TEST logins 6 Oct) | Three trade day pages |
| Installer My work redesign | Built (preview, TEST logins 6 Oct) | `/field` installer variant |
| Trade Money and My business | Built (preview, TEST logins 6 Oct) | Approved trade tabs |

## Office operations

| Feature | Status | Route or page |
|---|---|---|
| Office navigation, pipeline and job workspace | Built | `/admin/pipeline`, `/admin/jobs/$jobId` |
| Waiting-list sent-status protection | Built | Requires a real send record |
| Needs me derivation | Built | Office pipeline / Needs me |
| Private Job File viewer/download | Built | Office job workspace |
| Eligibility / Gate 1 audit | Built | Office job and pipeline |
| Allocation foundations | Built | Ready Check, PIESA and install panels |
| AP review and VEEC gates | Built | Office AP queue and job page |
| Service coverage summary | Built | Office service coverage |
| Launch campaign video-priority saved-spots view | Not built | `/admin/launch-campaign` |
| Bulk office-review clearance | Partly built | Holds block confirmation; dedicated office clearance action pending |

## Workflow, money and integrations

| Feature | Status | Route or page |
|---|---|---|
| Base44 signed intake and durable Gate 1 | Built | Intake endpoint and office pipeline |
| Locked three-outcome eligibility | Built | Office job / owner outcome |
| Free Ready Check workflow | Built | Owner, trade and office foundations |
| Quote generation and exception release | Built | Sending remains switch-controlled |
| Customer communication safety locks | Built | All outbound paths; switches off |
| Xero organisation safety routing | Built | Office settings / invoice actions |
| Xero Demo Company TEST calls | Partly built | Code/tests ready; Demo Company reconnect required |
| TEST-only simulated payment | Built | Test Centre / `qa_test` only |
| Mitti template validation and sync | Partly built | Live form IDs required |
| Evidence, official forms and signed copies | Built | Job File and compliance panels |
| Installer and REC onboarding/approval | Built | Partner onboarding and office review |
| Preferred-electrician teaming | Built | Existing nomination/invite flow; private picker expansion pending |
| Trade payout records | Built | Office records; trade Money UI pending |

## Current verification

| Test | Status | Scope |
|---|---|---|
| Role scenarios A–D | Partly built | TEST-only end-to-end rerun required |
| Scenario E Bulk upload | Not built | Rebuild first, then realistic TEST batch, 300 rows, 60+ photos, installer and office runs |
| Owner secure-link run | Partly built | Read-only My job works; quote/time actions retain sign-in |

## External actions only Jo can complete

- Reconnect Xero with the Demo Company available.
- Supply/approve the Mitti Ready Check, PIESA and PIISA template IDs.
- Decide whether owner quote signing may happen without sign-in.
## Owner paperwork gates A–D (5 Oct)
| Feature | Status | Where |
|---|---|---|
| One gate rule set for every journey (web, installer single, bulk J1, bulk J2) | Built | `owner-gates.core.ts`, enforced in `stageEntryBlockers`, Ready Check / safety-check offer start, trade contact release |
| Gate A: contact + privacy consent (also records owner contact consent, unblocking emails) | Built (DRAFT wording) | `/my-job/$token` Paperwork card |
| Gate A: consent to share name/address/phone with trades | Built (DRAFT wording) | `/my-job/$token` |
| Gate A: confirm details + owner/tenant | Built (DRAFT wording) | `/my-job/$token` |
| Gate A: tenant landlord details | Built (DRAFT wording) | `/my-job/$token` |
| Gate A: landlord consent | Partly built — office records it; landlord-signed flow and wording not built | office job page Paperwork strip |
| Gate A: life support question | Built (DRAFT wording); a Yes switches job life support on | `/my-job/$token` |
| Gate A: bulk J2 "installer visited with my permission" | Built (DRAFT wording) | `/my-job/$token` |
| Gate B: customer agreement + consumer rights | Partly built — existing signing; HIV agreement wording not loaded (only DRAFT consumer rights) | quote acceptance |
| Gate B: cooling-off notice | Partly built — slot only, wording/rules pending lawyer | `/my-job/$token` |
| Gate B: payment option / instalment terms acknowledgement | Built (DRAFT wording) | `/my-job/$token` |
| Gate C: ESC consent (Reg 23A), PIESA copy delivered | Built (existing records, now listed in gate) | — |
| Gate C: life support plan (when relevant) | Built (DRAFT wording) | `/my-job/$token` |
| Gate C: PIESA owner declaration via Mitti | Not built — joins Gate C once mapping approved | — |
| Gate B: owner VEEC assignment ("Your rebate") at quote acceptance, Jo wording jo-2026-10-05 (approved) | Built | `/my-job/$token` |
| Gate D: completed official form uses the Gate B signature after installer + AP sign; material change → owner reconfirms by code | Built (owner reconfirm screen on the link not built; server function `ownerReconfirmVariationFn` ready) | — |
| Gate D: "re-sign after install" setting (default off) | Built (no settings toggle on screen yet) | `workflow_settings.owner_resign_after_install` |
| Draft legal templates (consumer declaration, consumer rights, ESC consent, installer declaration) set back to not approved | Built | `/admin/owner-paperwork` |
| Code-verified no-login signing, typed name + tick, stored version/text/time/IP/verified contact, PDF in job file | Built | `owner_gate_signatures` (permanent) |
| Signed copy emailed to owner | Built — queued only for real jobs; sending off | outbox |
| Logged-in signing of new gate documents | Partly built — server function `signPaperworkFn` exists; no portal screen yet | — |
| DRAFT slots block real jobs; TEST jobs may sign DRAFT | Built | — |
| Owner paperwork settings page (version, Draft/Approved, approver) | Built | `/admin/owner-paperwork` |
| Office job page Paperwork strip A/B/C/D | Built | `/admin/jobs/$jobId` |
| Needs me flags jobs blocked on Gate A/B | Built | `/admin/needs-me` |
| Scenario F tests (all journeys) | Built — passing | `tests/owner-gates-scenario-f.test.ts`, `tests/owner-paperwork-db.test.ts` |

## Walkthrough
- Page-by-page role walkthrough: Partly built — see docs/WALKTHROUGH.md (route and menu access fixed; end-to-end actions pending).

## Partner onboarding profile
- Tidy partner profile on approval (one business per ABN, normalised ABN/mobile/email, licences, insurance, rates, map point + radius, capacity): Built — Partners › Applications › open application › Partner profile.
- Approval review flags (CII, licence expiry, unusual rates, insurance <60 days): Built, information only.
- Test applications list and Started, not finished list: Built.
- Approval message: queued only, not built/sent (wording with Jo).

## Installer Add job rebuild (8 Oct 2026, preview only, baseline 9eed1235)
- One phone-first flow `src/components/trade/add-job-flow.tsx` (pure rules `src/lib/add-job-flow.core.ts`) for the three existing choices: Customer -> Job details -> Review & save. Customer asked once; consent never restored from the phone draft; Edit on the review summary returns to the step; one import draft per attempt (no second draft on back/forward/retry); explicit Cancel / Discard draft.
- Existing job: quoted/site-check asked once in Job details; "Yes skips our Ready Check" removed (measure-up stays unverified). Quoted No offers the existing Ready Check now / Ready Check later modes carrying the customer, or "come back after visiting" (nothing saved).
- Save labels: "Save job and prepare Ready Check form" / "Save job for later" / "Add job". Saved screen shows job number, booking outcome (`booking` now returned by `startOnsiteReadyCheckFor`, no new writes) and form state Available/Preparing/Unavailable from the server's structured state only. Duplicate-email failures show the neutral office line; nothing claimed saved.
- "+ Add another electrician" only when "My electrician" is chosen; adding still requires the explicit "Send them the invite" tap. Later jobs still save with Home Insulation Victoria arranging the electrician (unchanged).
- Removed `onsite-start.tsx` and `later-job.tsx` (replaced). `/partner/add` still redirects; `?mode=onsite|later|existing` works.
- Verified: `tests/add-job-flow.test.ts` (12) + affected intake/electrician/owner-confirm tests (60 total pass); tsgo exit 0; retired-term scan 0 customer-visible. Isolated fixture `tests/add-job-flow.browser.html` (all server calls stubbed, external network blocked) at 375/390/430/1280: hints + focus, consent required, values/consent carried through Edit and Back, double-tap = one save call, one draft, duplicate message, open/preparing/unavailable form, blocked later appointment, no overflow, no page errors. Full-suite run shows 72 failures in practice-database/email files that pass when run alone (parallel timing), not this change.
- NOT verified: real signed-in installer save, real booking, real Mitti form creation, real upload/extraction, real invite delivery. Job page timeline contradictions (eligibility done vs waiting owner, form "coming soon") remain separate work.
- Rollback: restore `partner.import.tsx`, `customer-fields.tsx`, the two deleted components and the `job-intake.tsx` add-button condition from 9eed1235; remove `add-job-flow.*`, the `booking` field, fixture/stub aliases and three test path edits.

## Add job next steps (Jo, 8 Oct 10:14 UTC) — preview only
- Each choice, the review and the result screen show what happens next (Jo's wording, `MODE_CHOICES`/`outcomeFor` in `add-job-flow.core.ts`).
- Onsite: success only when the form is actually open (auto-opens); otherwise "Getting your form ready…" (polls) or "Job saved — form not ready yet" with the real reason and who it waits on.
- Later: "Visit booked" + Upcoming visits only when the booking is confirmed; otherwise "visit not confirmed yet".
- Visit day page: installer-sourced Ready Check without a form gets "Get my Ready Check form", using the existing guarded `onsiteFormStatus` (no new backend).
- Existing: "Sent to Home Insulation Victoria — nobody has been contacted yet".
- Follow-up gaps: no automatic owner outreach for installer-sourced quotes (office does it; homeowner email automation stays locked); installer "quote accepted" notice is queued (`owner-quote-accepted-v1`) but only delivered when partner notifications are switched on; no phone/Google/Outlook calendar sync; Mitti exact-email membership still required.

## 8 Oct 2026 — Installer single intake (preview, not published)
One Add a job intake for installer customers; office intake review panel on the job page; auto-drafted installer quotes are now always held drafts (never marked sent); intake-route PIESA deferral; rebate gate requires verified evidence. No migration. Pending: actual TEST-installer click-through, Ready Check save/resume on the installer job page, install-day order enforcement wired into PIISA tools.

## Ready Check draft + Add job resume (build 4963c8f1 follow-up)
- Installer job page (installer-sourced jobs): durable partial Ready Check save/resume in existing `ready_checks` (draft) + `ready_check_observations`; blanks stay unknown; never submits, verifies or signs. Shows missing answers, missing/rejected/awaiting-review assessment evidence, commercial status and coordination separately. Electrician-owned evidence stays read-only to installers (existing rule, not widened).
- Pre-start works lock now also lists missing original-condition Ready Check answers for installer-intake jobs.
- Add job: typed details, step and coordination resume per user+business; consent and acknowledgements never restored; quote files resume from the private server draft; retry after a lost response returns the same job.
- Verified: sealed fixtures at 390px and 1280px (56 click checks, screenshots, no overflow/runtime errors); focused tests 82 pass; typecheck clean. NOT verified: authenticated TEST RPC, live save, installer-test run (no TEST session minted this turn).

## Correctness fixes (8 Oct, 13:19 request)
- Add job submit claim: a fresh claim is busy for everyone (same user + partial job included); every attempt wins the claim by exact compare-and-swap; job link, confirm and release are fenced on the exact claim timestamp; failed partial release keeps job_id; a retry with different details onto a partial job is refused. PGlite persistence tests: `tests/import-claim-db.test.ts`.
- Final evidence gate for installer-intake jobs uses the Ready Check `insulation.existing` answer: none → empty-ceiling media only (existing R-value item not applicable); present (incl. mixed) → both verified; unknown/not recorded → fails closed.
- Corrected accepted quotes: a replacement quote can now be drafted while reconfirmation is open; accepting it supersedes the old accepted quote only if no invoice exists on it (otherwise office must cancel that invoice first).
- PIISA send and install evidence uploads now check the live original-condition Ready Check answers, not only the day-before pre-start snapshot.
- 9 Oct 2026: installer Add job reordered (customer → organise → measured/quoted → review), electrician payer + fee declaration, own-REC PIESA excluded (pending regulator confirmation). Fixture-verified on /installer-preview 390/1280; authenticated TEST run not performed.
- 9 Oct 2026: PIISA clearer labels added as accepted aliases on the same seven stable native IDs (prior labels still accepted); stop messages now lead with "🛑 STOP WORK — INSTALLATION CANNOT PROCEED." plus the corrective action, with no calendar delay (proceed only after correction and reconfirmed clearance). Native non-answer STOP instruction items are not mapped. Crew picker shows each chosen staff member's checked certificate; native prefill refuses unapproved staff. No named-staff native mapping until company-isolated template IDs are supplied.

## 9 Oct 2026 — installer release corrections (preview only, not published)
- Server owner-quote drafting (`installer-quote.server.ts`, bulk upload) now uses the CURRENT recorded electrician payer: own electrician = no HIV PIESA line + separate-invoice note; HIV = standard PIESA; undecided = no quote (held). Dedup compares quote lines, not only totals.
- Installer can change who arranges the electrician later on the same job (HIV / own / to be arranged) before an electrician accepts and before an invoice is raised; validated before any write; drafts superseded, sent quotes withdrawn, accepted quotes flagged for owner reconfirmation; earlier fee declaration stops counting.
- Office intake panel shows the latest owner fee declaration (who, when, payer, exact wording, version, source, note). Office records now store payer + exact wording; legacy payer-less records count only for HIV-arranged electricians.
- Proven on PGlite: `tests/installer-payer-quote-db.test.ts` (13 checks on real drafted quote_items). Not run: `installer-test --runs 3` (needs service-role writes to live TEST records incl. membership/profile updates).
- Known unrelated failures in concurrent Mitti template checks (`tests/ready-check-variants.test.ts`, 3) and a 60s+ REC matrix timeout (`tests/rec-sign-qa.test.ts`).

## Installer screens consistency (9 Oct 2026)
- Installer My work: Jobs tabs Action needed (default) / In progress / Done from the existing work-place classifier (`installerTab`, `installer-progress.core.ts`); "Moving automatically" no longer shown to installers (electrician home unchanged). Done = actual `complete`/`cancelled` stage only; ended-assignment history is a read-only summary (job number, suburb, reason) with no owner/address/price/link.
- Installer-supplied (intake) job page replaces the legacy InstallerJourney with `installerProgress`: Job review → Quote → Electrical safety → Installation → Evidence review → VEEC submission, each done only from its own record (office eligibility event, accepted quote without open reconfirmation, current signed-off PIESA pass, completed install booking, ready_for_veec approval event, veec_lodgements status). Submitted vs registered distinct. Non-intake installer jobs keep the legacy tracker.
- ~~Owner-direct electrical billing (9 Oct 2026, provisional)~~ retired by Jo 26 Oct 2026: every safety check and electrical fix is billed through Home Insulation Victoria. `electricalBillingSource` (`installer-led.core.ts`) now always returns "hivic".
