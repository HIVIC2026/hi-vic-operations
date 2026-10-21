# Bounded preview performance and QA

Target: `http://localhost:8080` only (unpublished working preview).
Baseline: `5f862f3437fa4a207905a0c8af7ad1f2ca348f92`.
Verified implementation revision: `44bcfa2d696a0f551152b98c6552ba073dd36ab7` (report/roadmap metadata may have a later harness-managed revision).
Observed 21 October 2026, approximately 01:37–01:54 UTC.

## Verdict

Public content and TEST property/history reads improved. **Consistent Office <1s is not achieved.** No publish, migration, schema/access/role/credential changes, communications switch changes, real-job writes, or manual outbound actions were performed. Dedicated TEST sessions were generated without email delivery. Canonical Office QA changed and restored only its existing HV-2111 snapshot; permanent TEST audit/estimate records remain as the existing harness specifies.

## Changes

- `src/lib/office-enquiry-page.server.ts`: hydrate returned page IDs and index facts concurrently; same checked result and classification.
- `src/lib/enquiry-groups.server.ts`: removed-lead read joins existing independent enrichment batch.
- `src/lib/operations-preview.server.ts`: independent secondary facts and originating-business names join first batch; same scoping, paging, SELECT projections, errors and classifier.
- `src/lib/jobfile.server.ts`: job/owner metadata and actor roles load alongside their independent reads; role-filtered output unchanged.
- `src/lib/jobfile.functions.ts`: Admin-only latest-consent getter, no media signing; header optionally omits unused readiness, default preserves existing consumers.
- `src/components/portal/job-workspace.tsx`: identity uses consent-only read and requests readiness only in the three stages that display it. Consent key remains below `intake_summary,jobId`; invalidation prefix/all-reader callers still reach it. Header key includes display mode below `jobfile-header,jobId`.
- `src/components/portal/panels.tsx`, `CompactJobStatus.tsx`: same blocker content consumes the existing parent observer rather than mounting a second stale observer; no stale-time changes or gate changes.
- `src/routes/index.tsx`, `calculator.tsx`: remove client-only rendering; same calculator HTML renders before hydration without data/auth calls. Existing leaf metadata retained.
- New tests: `tests/office-read-performance.test.ts`, `tests/enquiry-read-concurrency.test.ts`, `tests/operations-read-concurrency.test.ts`.
- Instruction/task records: `src/lib/AGENTS.md`, `roadmap.md`, this report.

## Timings and method

Playwright Chromium, fresh context, desktop 1280x1800 and phone 390x844. Local Vite is not a published optimized bundle. First context/process read is called cold; later reads warm. Browser settled includes a **500ms network-idle quiet period**, auth hydration, JS transforms and rendering. Visible public timing waits for H1, not full interactivity/LCP. Backend timings invoke actual SELECT-only loaders from a separate Bun process using configured backend access; they omit HTTP/auth/worker/browser overhead and are not permission tests.

| Measurement | Baseline | After |
|---|---:|---:|
| Public `/`, first desktop visible | 17.251s (cold Vite dependency transforms) | 0.270s (warm server, fresh browser) |
| Public `/`, warm desktop visible | 2.966s | 0.104s |
| `/calculator`, warm desktop visible | 3.398s | 0.092s |
| Public phone `/`, first context visible | 0.920s | 0.147s |
| Public phone `/`, later visible | 2.881s | 0.109s |
| Active list backend, first/warm range | 0.743s / 0.583–0.686s | 0.628s / 0.564–0.606s |
| Enquiries backend, first/warm range | 1.563s / 1.551–1.611s | 1.504s / 1.409–1.414s |
| TEST history backend, first/warm range | 0.338s / 0.291–0.456s | 0.181s / 0.172–0.207s |
| TEST property desktop settled | 3.585s, seven RPCs | 1.954s, six RPCs |
| Active list desktop settled | 2.330s | 2.369s (not improved) |
| Enquiries desktop settled | 3.075s | 2.878s |
| Closed desktop settled | 1.637s | 1.647s (not improved) |

Post-change phone warm RPC timings: active list 708ms; enquiries 1619ms; TEST job overview 160ms, consent 89ms, header 95ms, operations 167ms, blockers 554ms. Settled phone property 2.011s. Operations TEST getter intentionally excludes QA facts: its 86–102ms backend measurement is **not** proof of full real-job enrichment speed. Full classifier concurrency/parity is covered with mocks only.

Server-rendered calculator H1 also appears with JavaScript disabled, both routes/viewports. All logo checks passed after network idle. No cold server restart was done; before/after cold numbers are therefore not equivalent production cold-start measurements. Fonts, shared auth initialization and route bundle were inspected but not changed; no reproducible font/auth blocker justified a broader refactor. Production 4–8s historical peaks were not reproduced in these bounded preview samples.

## QA and scope

Existing TEST Office `admin@hivic.test`, user `36b849de-1cde-425c-a05d-623f8985bbd6`, sole admin role.
Existing TEST installer Alpha `qa.installer.alpha@hivic-test.example`, user `b8202cb7-614c-4b89-905e-696c4245f995`, sole installer role. Authenticated jobs read: nine reachable, all `qa_test`, zero non-test. No installer mutations performed; in particular HV-1351 was not touched.
Office fixture HV-2111: `518271f4-90b5-4d16-8ccc-2d2a5a0a12c1`, `qa_test`; snapshot restoration and unchanged owner-answer proof passed canonical runner. No Dad/Lorraine/Deep sessions or account changes.

Canonical command: `bun run portal-qa --label performance-preview --base http://localhost:8080 --skip-installer --personas none --budget 300`.
Result: **43 passed, 0 failed, 23 NOT_RUN**, overall BLOCKED (not PASS). Office endpoint IDs resolved from served transforms; TEST delete/restore/classification and readback passed desktop/phone. Excluded personas were excluded before lookup/sign-in. Installer legacy mutation script not invoked.

### Routes/actions actually checked

- Public `/`, `/calculator`, `/privacy`, `/auth`: desktop and phone, HTTP/rendering/runtime/overflow.
- Office `/admin/operations` -> canonical enquiries, `/admin/enquiry-groups`, `/admin/campaign-emails` -> templates, `/admin/partners-overview`, `/admin/templates`: canonical desktop/phone checks passed.
- `/admin/jobs/active`, `/admin/enquiries`, TEST `/admin/jobs/<HV-2111 UUID>`: additional desktop/phone timed checks passed; closed list desktop plus canonical closed/deleted workflows.
- TEST property `History`, `Communications`, `Forms & evidence`: clicked on desktop/phone; history appeared with unchanged factual content, no mutation buttons used.
- Alpha `/partner` -> `/field`, `/partner/add` -> `/partner/import`, `/field/business`, `/partner/workers`: real TEST session, desktop/phone rendering; no account, upload, invite, send or save actions. Initial Add Job Next form rendered; this is **not** full saved-job QA. Some controls were sampled before every asynchronous panel settled, so button coverage is bounded, not comprehensive.
- Calculator: dummy `12 TEST Street, Melbourne VIC 3000`, 150m², None; existing result showed before rebate $5,198, rebate $1,470, customer $3,728. Installation $4,500 = $30/m² inc GST, PIESA/AP $349 each; Ready Check inclusion explicitly free. Address suggestions stubbed empty to avoid remote property research; real address lookup NOT_RUN. No register/enquiry submission.

No observed overflow, blank/error pages or page errors in checked screens. No new design, text, pricing or workflow changes.

## Tests and unchanged wording/pricing

New read/auth/concurrency tests: five passed. Existing status/history suites: 53 passed, four deliberately retired skips. Additional isolated suites passed: page-performance 2, admin-record-reliability 7, free-Ready-Check 2, Ready Check booking 7, Ready Check flow 13, Save Spot 8, installer cache 2, enquiry grouping 63, saved-calculator resume 5. Canonical isolated email/pricing/safety suites passed without sending.

One **pre-existing** source-shape test failed: `tests/owner-calculator.test.ts`, expects `SavedSpotPanel` in untouched owner route; current baseline contains its own saved-state markup. Other two cases passed; one retired skip. Left unchanged because customer wording/owner workflow are out of scope. Build diagnostic latest entry 01:49:25 UTC: `build OK`. Separate automatic typecheck output is not exposed here; no manual build/typecheck was run, so standalone typecheck is **unverified**, not claimed PASS.

Byte-diff checks against baseline: public calculator component/settings, estimate core, workflow decisions, Ready Check payment server, campaign server and styles unchanged. Current backend estimator read confirms version 2, `is_current=true`, installation 30, PIESA 349, AP 349. Ready Check free-state tests assert zero even with legacy stored fees.

## Blockers / NOT_RUN

- Live Save My Spot and Ready Check booking: NOT_RUN. Existing Save Spot includes confirmation/queue paths and may deliver TEST email to Jo's real inbox; owner page read also calls referral helper. No suitably vetted restorable owner booking fixture/session was established; no bypass, switch change or new links attempted. Pure/mock tests are not authenticated end-to-end proof.
- Cross-role refusals, REC/owner and installer persistence/signing were excluded in canonical run; exact 23 NOT_RUN remain in raw report.
- Full real-job operations enrichment and large/history-rich property performance: NOT_RUN under TEST-only data policy.
- Historical database statistics still show multi-second maxima; they are cumulative, not proof of current page latency. No migration proposed/applied; remaining enquiries slowness needs separately scoped SQL plan diagnostics before any schema proposal.
- Root `AGENTS.md` was already 5,568 bytes (over prior 5,120-byte preference); unchanged to avoid unrelated instruction refactor.
- Root-owned stale jobs/failed emails/paused followups audit was not repeated or modified.

## Raw evidence

- `/tmp/browser/performance/baseline.json`, `after.json`: public timings and longest resource durations.
- `/tmp/browser/performance/backend-baseline.json`, `backend-after.json`: direct loader timing samples.
- `/tmp/browser/performance/office-baseline-correct.json`, `office-after.json`, `rpc-after.json`: browser/HTTP read timings; initial mistaken `/admin/2111` probe is excluded from property evidence.
- `/tmp/browser/performance/flows.json`, `ssr.json`: route/control/calculator/logo results.
- `/tmp/browser/performance/focused1.log`, `focused2.log`, `focused3.log`, `final-test.log`: exact assertions/results, including unrelated failure.
- Canonical `/mnt/documents/portal-qa/2026-10-21T01-43-18/results.json`, `report.md`, `office-writes.log`, screenshots: authoritative 43/0/23 and TEST restore proof.
- Read-only post-run TEST HV-2111/HV-1919 combined outbox, invoices and SMS counts: zero each. Broader all-job outbound reconciliation NOT_RUN; no sender/worker action was invoked by this task.

Private TEST session files stay under restricted `/tmp/browser/performance`, never in these reports or project assets. No password, token, URL credential, session cookie or bearer printed.