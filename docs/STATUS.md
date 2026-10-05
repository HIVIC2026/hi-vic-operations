# Home Insulation Victoria portal status

Updated: 5 October 2026

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
| Electrician first-tap offer, My work and On the day | Not built | Approved preview designs |
| Installer Ready Check offer/day and Install day | Not built | Approved preview designs |
| Shared trade before-you-start checklist | Not built | Three trade day pages |
| Installer My work redesign | Not built | `/field` installer variant |
| Trade Money and My business | Not built | Approved trade tabs |

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
| Gate D: final VEEC assignment | Built (existing) | — |
| Code-verified no-login signing, typed name + tick, stored version/text/time/IP/verified contact, PDF in job file | Built | `owner_gate_signatures` (permanent) |
| Signed copy emailed to owner | Built — queued only for real jobs; sending off | outbox |
| Logged-in signing of new gate documents | Partly built — server function `signPaperworkFn` exists; no portal screen yet | — |
| DRAFT slots block real jobs; TEST jobs may sign DRAFT | Built | — |
| Owner paperwork settings page (version, Draft/Approved, approver) | Built | `/admin/owner-paperwork` |
| Office job page Paperwork strip A/B/C/D | Built | `/admin/jobs/$jobId` |
| Needs me flags jobs blocked on Gate A/B | Built | `/admin/needs-me` |
| Scenario F tests (all journeys) | Built — passing | `tests/owner-gates-scenario-f.test.ts`, `tests/owner-paperwork-db.test.ts` |
