# Final bounded preview performance / QA continuation

Target exclusively `http://localhost:8080`; baseline `5f862f3437fa4a207905a0c8af7ad1f2ca348f92`. Code and full raw evidence are in the adjacent JSON; report edits have a later harness-managed revision. No publication, live SQL application/schema migration, real job/customer writes, role/credential changes, communications switches or sends. Existing TEST Office/Alpha sessions were issued via the approved no-email QA mechanism only; no Dad, Lorraine, Deep or real Jo login.

## Result and outstanding blockers

Code-only read waterfalls and duplicate work reduced; **consistent <1s Office page readiness NOT achieved**. Enquiries still require costly repeated canonical SQL-view evaluation. A minimal unapplied SQL proposal returns existing page_rows facts in the same RPC result; no view/filter/count/classifier/grant changes. Client continues its current facts read until separate approval/integration. A deeper plan redesign may still be needed; no speculative <1s promise.

Live first-save/Ready Check owner flow remains **NOT_RUN**, not PASS. No exact existing candidate was proved safe across owner/token/consent/matching TEST business and complete reversible linked-row snapshot. HV-2111 has non-reserved `hivic.test` owner and must not be used for sending-path tests; the vetted reserved-email Alpha candidates have no active customer estimate links. `prepareQaAccess` can create/change owner auth/contact when absent and is outside no-auth-change permission; archive does not restore linked campaign/window/contact/referral state. No broad journey, raw privileged fixture writes, unsafe inbox substitution, or golden-fixture mutation performed. Existing TEST sessions are now available; session absence is **not** the remaining blocker.

## This continuation's changes

- Office page details and authoritative index facts now start together (removed awaited array operand), preserving explicit errors and missing-row refusal. Dropped only two unused facts columns. This does **not** eliminate canonical view work.
- Expanded canonical read-only allowlist and exact route inventory; all nine Enquiries views, quote-board query, payout query, seven job record groups. Static `/field` routes now use authorized installer persona rather than inheriting excluded REC specs.
- Browser phone 390x844; desktop 1280x1800. Meaningful content readiness and separately recorded actual read-only tab/disclosure controls. Communications section links are navigation links, not role=tab. Tab failures cannot be PASS. Missing viewports/fixtures and redirect destinations remain explicit.
- Two newly measured phone overflows fixed in layout classes only: Compliance grid min-width/wrapping and Partner enquiries wrapping tab bar. No content, prices, approvals or controls changed; fresh DOM overflow checks return no overflowing elements. Root instruction budget restored below 5120 bytes by moving two domain-specific rules unchanged into src/lib instructions.

## Timing evidence (milliseconds)

Direct backend SELECT-only loader method, first invocation / two subsequent invocations; excludes browser, transport, auth overhead:

| Loader | Original | Current |
|---|---:|---:|
| Active jobs | 743 / 686,583 | 787 / 573,664 |
| Enquiries | 1563 / 1611,1551 | 1536 / 1392,1505 |
| TEST history | 338 / 456,291 | 208 / 186,165 |
| Operations excluding TEST | 153 / 104,106 | 107 / 89,116 |

Fresh browser current desktop first/warm settled: Active 2489/2028; Enquiries 3352/3184; TEST property 2452/4559. Phone 2654/2019, 3222/2916, 2238/2387 respectively. Networkidle includes a 500ms quiet floor and global shell/transport; property warm outlier occurred during expanded QA and is retained, not discarded. Earlier matched first-pass property 3585→1954, Enquiries3075→2878, Active2330→2369, Closed1637→1647. No blanket improvement inferred from noisy repeats.

SQL evidence: root RPC mean421/max813ms, second 13-column facts mean698/max846ms, four-column facts mean43ms. Read-only EXPLAIN repeated view evaluation534.207ms with planner expansion before ID semi-join. Dropping two unused columns/parallelization is safe but not enough.

Public cold Vite baseline root H1 17251ms, DOM5745ms, TTFB21ms; after warmed-server fresh browser root275ms/calculator160–174ms. Cold Vite vs warmed server are **not matched production cold-first-visit proof**. SSR-disabled flag removed only on two pure calculator routes; root auth callback/font wiring untouched. JavaScript-disabled rendering verified earlier. Font display=swap unchanged; emitted production bundle/cold published performance unavailable/unverified, no manual build/restart.

## Pricing and wording proof

Preview `/` AND `/calculator`, desktop and phone, dummy VIC address, address-search response stub only: 100m² before rebate3698;150m²5198; increment1500 =50×30 inc GST. Includes panel shows Home Insulation Ready Check — free. No registration/enquiry submission. Source price modules/template wording unchanged since baseline. Focused FREE Ready Check suite18 PASS; Save My Spot8 PASS; actual isolated window persistence4 PASS and actual sender boundary1 PASS. These isolated tests are **not** live booking/send proof.

## Test personas and scope

Office `admin@hivic.test`, user `36b849de-1cde-425c-a05d-623f8985bbd6`, admin-only. Alpha `qa.installer.alpha@hivic-test.example`, user `b8202cb7-614c-4b89-905e-696c4245f995`, installer-only, one active membership; business `62956b54-2e44-4c96-a156-33949b20fa82`. Canonical user-scoped SELECT verifies nine reachable jobs, all qa_test, zero non-test. A broader origin-only diagnostic found cancelled HV-1554 (`installer_import`) at this business, no active matching assignments; not reachable in the canonical scope and not used/mutated. No new accounts or ordinary staff persona provisioned.

Office read fixture HV-2111 `518271f4-90b5-4d16-8ccc-2d2a5a0a12c1`, qa_test, SELECT/browser reads only. Post-run readback: zero acceptances/windows and zero new email/communication/post-intake rows since task start. No snapshot/restore needed because no job/customer rows changed.

## Proposal for separate approval only

`docs/pending-migrations/PROPOSED_office_enquiry_page_facts.sql` SHA-256 `9d4246857d95a44b30a76f0c06778bf18423e782e8d897276958383b696c158b`. One transaction, CREATE OR REPLACE existing service-only RPC; only additive facts JSON from existing page_rows. Practice PGlite 8 PASS/0 FAIL, 44 assertions; nine views preserve exact IDs/counts, facts match canonical view, repeat application safe, observed live anon/authenticated EXECUTE refusal/service_role grant unchanged. Not registered as a migration, not applied, not client-enabled; user/root approval required first.

## Raw reports and truthful historical failures

Prior expanded run `2026-10-21T02-41-28`:161 PASS/3 FAIL/98 NOT_RUN; 146 rendered viewport rows, two phone-overflow failures later repaired plus harness450s timeout. It is preserved as failed, not relabeled. Concurrent second command correctly refused runner lock (no QA evidence). Final canonical run uses 600s bounded browser budget; final counts/checklist are appended after completion. All mutating send/retry/resume/config/pricing/signature controls remain unexecuted. Missing token/job/file/ordinary-staff fixtures remain NOT_RUN.

Unrelated existing `tests/owner-calculator.test.ts` source assertion fails because baseline owner route lacks SavedSpotPanel; not fixed by changing customer wording. Separate Ready Check suite18/0. Fresh isolated performance/safety/read suites27/0, runner screen14/0, proposal8/0, SaveSpot8/0. Typecheck is harness-managed and no separate signal was available; automatic preview build OK. All exact raw timings/controls/proposal/outcomes in adjacent JSON.

## Completed final canonical results

21 Oct 2026 02:50:51–02:59:42 UTC; complete bounded run, **BLOCKED:179 PASS /0 FAIL /83 NOT_RUN**, exit1 deliberately preserves incomplete coverage. 87 unique source families;162 rendered viewport rows,51 distinct landed paths (redirect aliases not distinct pages). Zero page/console/HTTP/transport errors and overflow;21 navigation cancellations recorded separately.36 explicitly clicked read-only disclosures/tabs;1472 inventoried unexecuted controls remain NOT_RUN (duplicates across route variants/viewports, not unique control count). Four calculator flows and supplemental sorting/paging/template controls are separate browser evidence and not inflated into canonical counts.

Raw canonical report: `/mnt/documents/portal-qa/2026-10-21T02-50-50/report.md`; exact per-route/persona/environment results.json, route-inventory.json, landed-route-coverage.json and .browser.json in that directory. Mirrors of all nonsecret result content are in this report's adjacent JSON. Communications six section links, Templates categories/standing/details, active/closed sort/direction/paging/back/search and nine enquiry views checked through actual UI or URL render as recorded; control method distinguishes clicks from route renders. All seven HV-2111 lazy job panels clicked on both viewports. Quote board/payout query rendered; payment/provider buttons not invoked. No ordinary staff, owner signing, live SaveSpot, Ready Check window booking, private-token/file/offer-detail or onboarding signing fixtures; exact NOT_RUN reasons retained. Historical59/0/12 from the separate REC/owner acceptance run remains untouched.

Final app source revision (before report-only completion): `6c7c7c57ae010aed319beaf6f916e21ff8e6ae23`. Exact changed-file list from authorized baseline retained in adjacent JSON (43 files, including previous continuation's performance changes/tests/instructions/reports). Automatic latest build OK; independent typecheck signal unavailable. No background runner remains. No publication; proposal awaits separate approval, owner flow awaits safely reversible approved fixture.
