# Urgent installer intake QA — 8 October 2026

## Reported live failure
Published request at 22:20:30.256 UTC (09:20 Sydney) has response status 0. The original import remained draft with a linked TEST job HV-2111 and recorded facts/events through 22:20:51.324 UTC. No application exception was present in published logs. This establishes an interrupted request with partial persistence, not a rejected price/R-value or missing installer permission. The exact transport/cancellation cause cannot be established from retained telemetry; it is not claimed fixed.

Using the existing authorized TEST session, the original import was retried with its exact original payload on the published application. It returned HV-2111 and finalized the same import. No duplicate job was created by this retry. A separate live reproduction returned HV-2112 successfully.

The existing compare-and-swap claim and exact-attempt fence are retained. Older resumed drafts omit new removal fields until edited, so original partial-save retries still match. Interrupted browser errors now explain that details are kept and offer Retry submission; no silent retry is introduced.

## Consolidated confirmation — 22:37 UTC
Jo's “Ok fix” and conditional release approval belong to this same repair, not a second redesign. Read-only readback confirms the original import was finalized on its original job at 22:29:20.894 UTC. The separate 22:24:11 import `046ca953-5cfc-4303-abbb-97284157b357` was the recorded HV-2112 reproduction, not the recovered original.

The final original event was evidence acknowledgement at 22:20:51.324 UTC. Confirmation follows the documents lookup; retained records cannot distinguish an interruption at that lookup from final confirmation or response delivery. No exact timeout/disconnect cause is asserted, and no speculative cancellation patch was added.

Fresh focused checks: 37 pure/input/claim tests passed; the 11 persistence tests passed when run independently (48 total, 123 assertions). A combined run hit a PGlite WASM null-reference runner error; the isolated rerun passed. Diff whitespace check passed. Reviewed revision: `4be2376776c19b0394a04c26f744a6e3127a8736`. Publication is authorized only after focused actual TEST/harness checks and root diff review pass; root approval remains outstanding. No additional login provisioning or live mutations were performed during this confirmation.

## Implemented files
- `src/lib/intake-quote-details.core.ts`: proposed R parsing and provisional quoted-removal validation/readback.
- `src/components/trade/intake-quote-fields.tsx`: shared R5.0/R6.0/R7.0/Other and quote-removal fields.
- `src/components/trade/installer-intake-flow.tsx`: creation, review, draft persistence and Retry button. _Superseded (decision 185, 24 Oct 2026): the 4-step installer intake and `/installer-preview` are removed; Add a job is the basics-only `AddJobFlow` at `/partner/import`._
- `src/components/trade/intake-details-editor.tsx`: same-job edits, saved removal facts and shared inputs.
- `src/lib/installer-intake.core.ts`: strict R-prefixed normalization with existing range/readiness rules retained.
- `src/lib/add-job-flow.core.ts`: actionable interrupted-confirmation message.
- `src/lib/partner-import.server.ts`, `pilot.functions.ts`: server validation and append-only removal declaration.
- `src/lib/installer-intake.server.ts`, `installer-quote.functions.ts`: removal readback/update, material-change quote invalidation and unknown-removal release hold.
- `tests/intake-quote-details.test.ts`, `tests/installer-intake-edit-db.test.ts`: concrete input and actual persistence regressions.
- `AGENTS.md`, `roadmap.md`: architecture and release status.

Removal is an explanatory portion of the supplied installer total, never a new additive quote line. It is not verified measurement or product evidence. No new schema or policy was added. Legacy jobs without the new declaration retain existing behavior.

## Verification
- 35 focused tests / 108 assertions passed across input, existing intake, actual PGlite update boundary and import-claim suites.
- Actual existing TEST session: new zero-file quoted intake HV-2113, dropdown R5/R6/R7 and custom R5.5, removal Yes with 120 m²/$0; saved editor change to $500 and reopen; total remained $3,450; No saved/reopened with cleared active values.
- Desktop 1280×1800 and phone 390×844 checked. No page exceptions or horizontal overflow.
- Deliberately aborted TEST browser request showed the actionable message and Retry submission; retry produced HV-2114. This injected failure is not represented as reproduction of the original network cause.
- Retired-term scan: 0 customer-visible failing matches.
- Harness compile/type validation: latest build OK at 22:29:02 UTC. No separate production bundle was run; production readiness remains subject to root review.
- Verified implementation revision: `03729831f5fbe2cfe6c7c62c60c5ab9b4e4dbd5e` (before this documentation update).

## Cleanup and limits
TEST-only archive condition proved on PGlite (live row unaffected) before cleanup. Extra QA jobs HV-2112/HV-2113/HV-2114 archived, not deleted. Jo's recovered HV-2111 remains visible. Append-only events retained. No password resets, new users, new login links, messages, Xero actions, native audits/signatures, AP approvals or portal publication.

Dad's requested text is still blocked pending his identity/mobile and the intended inspection link/job.