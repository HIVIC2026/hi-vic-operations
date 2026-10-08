# Home Insulation Victoria portal status

Updated: 5 October 2026

## Isolated operations preview — 8 October 2026
- Built at `/admin/operations-preview`, direct link only; no navigation/workflow/payment/quote/compliance/email-template changes.
- Authenticated admin-only GET reads, business-unit scoped, no customer writes, migrations, sends, live integration calls, cron runs or publishing.
- One pure classifier reconciles Leads / Active jobs / Closed jobs / Needs classification. Saved-only leads wait for capacity without a two-day overdue alert; operational evidence overrides saved spots. On hold stays open.
- **Verification:** Acceptance corrections: 179 focused tests passed across 9 files, including mocked SELECT-only loader scope/query-shape/error tests and evidence, purpose-specific communication recovery, null source, quote handoff, deadline, sending-lock and eligibility regressions. Retired-term scan: 27 existing warnings, zero customer-visible failures. Automatic harness reported `build OK`; no manual build/typecheck run. Unrelated router/page-recovery hunks restored exactly to `ff6c590e`; full presentation-only guard restored with a separate preview rule.
- **Browser:** isolated six-record fixtures at desktop 1280×1800 and phone 390×844; filtering, installer source, expandable details, no horizontal overflow and no browser exceptions. Signed-out actual route redirected to `/auth?next=%2Fadmin%2Foperations-preview` without loading records. Non-admin signed-in denial is source-guard checked, not browser-tested.
- **Reconciliation:** Actual schema/data validation: 123 SELECT statements through a SQL adapter invoking the preview loader/classifier; 708 unique = 671 Leads + 1 Active + 23 Closed + 13 Needs classification = stage total 708; duplicate IDs 0, missing source 0. Earlier progress count 707 was superseded by this later snapshot. Mock UI: 6 = 3 + 1 + 1 + 1. Read errors surface instead of zeros.
- **Limits:** Actual authenticated RPC/PostgREST admin read path is not end-to-end tested; SQL adapter validation is not that proof. Connection health, backup availability and full compliance readiness remain unverified. Commencement task currently uses completion evidence to retire the alert; a distinct actual-commencement timestamp is not available in these reads. No database backup claimed; no restoration needed. Later phases: Email/Mitti/Compliance automation and Templates organisation. Baseline and file rollback: `docs/OPERATIONS_PREVIEW_PHASE1.md`.
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
