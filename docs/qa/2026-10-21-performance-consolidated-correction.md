# Consolidated performance / QA validity correction

Preview only `http://localhost:8080`; no publication, live DDL, sends, SMS, customer/job/account mutations, communication switches, pricing or customer-wording changes. Existing approved TEST Office and Alpha sessions were read-only verified and reused; no session minted or repaired. Original reports remain historical, not silently corrected or relabeled.

## Verdict: incomplete, not ready for full workflow release

Historical82/0/114 and179/0/83 report counts remain historical execution totals, **not completed 87-family/control coverage**. The earlier34 targets×2 viewports and6 disclosure-click records did not prove490 unexecuted controls. Later1472 button instances likewise were unexecuted, not inherently blocked or passed. The consolidated JSON derives coverage solely from actual requested URL, loaded final URL, normalized route family, TEST role and viewport. Parameterized HV-2111 correctly maps to `/admin/jobs/$jobId`; planned targets, invalid tokens, auth/loading screens and wrong redirects do not count.

Current generated source has87 normalized UI families; **`/admin/job-queue` is absent both from routeTree and route files**. Explicit Office desktop/390×844 probes failed to find loaded queue content. No new route was invented in this QA-only task. `/admin/list?test=true` loaded on desktop but has confirmed phone horizontal overflow; left unchanged and FAIL, not hidden. Other canonical failures were QA marker/disclosure ambiguity corrected by targeted retries; originals remain recorded.

## Affected canonical runs only

All invoked through `bun run portal-qa --read-only --review-gaps --base http://localhost:8080 --personas installer --skip-installer`, with240/540-second bounded budgets. No legacy mutation suites or email flags.

| Raw run | Result | Purpose |
|---|---|---|
|2026-10-21T03-06-55|31 PASS /12 FAIL /177 NOT_RUN|Initial explicit loaded-path/role/content and eight disclosure checks; phone hidden-nav markers and ambiguous quote control failed; queue absent and list overflow recorded|
|2026-10-21T03-10-09|26 PASS /4 FAIL /184 NOT_RUN|Only affected phone markers/disclosures; seven sections verified; quote selector still matched unrelated navigation|
|2026-10-21T03-11-09|9 PASS /2 FAIL /180 NOT_RUN|Exact quote region verified both viewports; first installer job was archived and correctly refused; not happy-path PASS|
|2026-10-21T03-12-51|21 PASS /0 FAIL /178 NOT_RUN; BLOCKED|Numeric Communications data and all six links verified both viewports; active user-scoped TEST job/day loaded both viewports|

Raw results, `.browser.json`, `actual-route-coverage.json`, `control-runbook.json` and screenshots remain in each `/mnt/documents/portal-qa/<run>/` directory. Combined actual evidence, per-family matrix and remaining control runbook are in the adjacent consolidated JSON. Counts are not summed into a fictional all-portal success rate.

Verified actual read-only controls: six Communications links on desktop/phone, intended selected section and loaded content; Overview numeric counts and Sent/Failed numeric matching counts read back. Eight HV-2111 disclosure regions verified both viewports across targeted runs: Contacts/source/exceptions, Enquiry, Ready Check, Quotes/payments, PIESA, Installation, AP/VEEC, Correspondence/history. Each PASS requires aria-controlled intended region, loaded nonempty content, no load failure, and post-interaction errors/overflow checks. No swallowed networkidle timeout is used as readiness proof. Once-opened document and30-second cache regression checks5/5 from prior correction reused, not rerun.

Office Ready Check invitations and Prices/margins loaded both viewports; configuration/send/payment controls unexecuted. Installer `/field`, `/field/money`, `/field/business` use Alpha installer/business-owner access, not REC entries. Active TEST job `fe56301e-a0f5-4c2b-9ccb-40e80b003274` and its day page loaded desktop/phone; historical day outcome was displayed, **no new Ready Check booking or acceptance**. Its legacy job UI shows historical safety-payment/instalment wording; observation only, not evidence of current FREE booking correctness and not altered under wording/workflow restrictions.

## Remaining NOT_RUN and failures

- `/admin/job-queue`: absent current source; both explicit probes FAIL. Queue controls cannot be exercised without a real route. `/admin/list` phone overflow FAIL. No app changes made to conceal these findings.
- Ordinary installer staff: no approved existing isolated staff session in supplied sessions, no role/account changes permitted. Business-owner access verified only; not ordinary-staff permission coverage.
- Offer happy path and private document rendering: no exact safe accessible TEST offer/private-file fixture established. Native section/disclosure inspection does not prove signed-file rendering. No arbitrary storage path signing or provider action.
- Save My Spot first save/refresh/duplicate tap, current FREE Ready Check request with3–5 persisted allowed windows over3 Melbourne business days, provider-zero and full restoration: no complete reversible reserved-contact/consent/token/TEST-business fixture proved. Existing active trade fixture is not owner authorization. Isolated tests remain isolated, not live booking proof.
- Token calculator/owner/time/photo families: no exact vetted active TEST tokens for all phone happy paths; invalid-token/refusal pages never count as booking success. Public dummy calculator result proof remains100m²3698/150m²5198, exactly$30/m² inc GST, Ready Check FREE; no enquiry submitted.
- Remaining visible controls are actionable runbook **NOT_RUN**, not uniformly “blocked.” Potential sends/retries/resume/global configuration/pricing/financial/account/mutation controls are explicitly excluded without invoking, so no runtime permission PASS inferred. Read-only controls not executed remain separately labeled for review/click/data-readback. Full search/sort/pagination/template evidence from prior reports stays historical, not promoted to newly verified data-readback.

## Performance, tests and database restriction

Retain earlier measured backend enquiries1392–1536ms and browser3184–3352ms desktop/2916–3222ms phone; no consistent<1s claim. Latest targeted browser loaded markers: Communications desktop1125ms/phone1239ms; active TEST job2105/2318ms; TEST day1705/1715ms. These fresh-context/warmed-server values are not matched cold-first-visit before/after or backend-only timings. Standalone cold production bundle/font proof remains unavailable.

Affected QA-rule regressions5 PASS/0 FAIL plus existing screen-rule tests14 PASS/0 FAIL. Actual cache/disclosure5 PASS reused. Build signal checked separately; no manual app build/typecheck. Exact proposed media indexes and provenance-restricted rollback remain staged/unapplied; root-provided PGlite0.5.9 results are supporting evidence only. **Backup is NOT verified: Lovable browser sign-in was blocked as suspicious activity and the attempt stopped.** No Drizzle journal changes or new database.

## Narrow final window-proof correction (21 Oct 03:16 request)

Saved window comparisons now use validated timestamp epochs, accepting equivalent Z, +00:00 and fractional formatting and rejecting invalid timestamps. Canonical baseline remains TWO business-day lead, THREE distinct allowed Melbourne days, 3–5 windows and 21-day horizon; domain rules unchanged. Nine focused safety regressions and four isolated persistence regressions are the only affected suites.

Two independent phases must not be conflated:
1. **Requested windows:** actual same-job DB readbacks of 3–5 allowed OPEN rows in the returned round after owner choice, plus acceptance `ready_check_amount_inc_gst === 0`, payment-state `paymentId === null`, no payment/invoice/provider effects and no failure events. A `verified:true` assertion is not stored evidence.
2. **Confirmed appointment (only if exercised):** separate actual selected TAKEN window, confirmed `bookings` row with matching `scheduled_start` (and end if recorded), and job `ready_check_scheduled`; owner OPEN windows alone never establish an appointment.

**Live stored FREE evidence: NOT_RUN / unavailable**, not inferred from the zero fee constant, UI or isolated stub. Live requested windows and confirmed appointment both remain NOT_RUN. HV2111 `hivic.test` fails the reserved-domain guard and is not used. Minimal reserved `hivic-test.example` TEST preparation is permitted only through approved guarded helpers with practice-first and reversible rows; current inspected `prepareQaAccess` can create identities, memberships and worker associations, not just the minimal booking fixture. No such wider preparation was invoked, no new live fixture was written, no provider or installer acceptance action run. A pre-vetted reversible owner/consent/token/job fixture through the approved narrow helper remains the specific blocker, rather than a reason to bypass guards or use Jo's contact.