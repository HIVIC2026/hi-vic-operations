# Additional performance / canonical QA evidence

Preview ONLY: `http://localhost:8080`. Original baseline `5f862f3437fa4a207905a0c8af7ad1f2ca348f92`; addendum began on current `691ef7e0fe36f23e0887b0f8db653843be634d3b`. Verified code revision `acab35435a63c2ba0f8630879fb6838bd768463a`; this report has a later harness-managed revision. No publish, migrations, schema changes, role/credential changes, real job/customer mutations, communications settings or sends. Existing TEST sessions only; no Dad, Lorraine or Deep login. Expanded read-only mode never starts Office writes, installer legacy mutations or owner-token discovery. `--allow-test-email` is rejected by canonical runner.

## Additional code corrections

- `buildJobFile` now performs ONE combined `jobs` read (`owners(user_id),created_at,stage,updated_at`) alongside initial sources. Profiles/roles/job assignments already ran together from the first performance pass; retained. Role filtering (`visibleTo`), storage-path masking and non-admin `detail:null` are unchanged, asserted using the actual aggregator.
- `DocRow` opens through existing guarded function and toast handling with `refresh:false`; it no longer invalidates every panel. All write callers preserve default refresh. New history consumers do not reload merely because another section mounts; explicit invalidation while unmounted still refetches, and focus/reconnect behavior is unchanged. No longer stale-time relaxation.
- Collapsed section document rows and timeline JSON are deferred until expansion. Outer job-workspace disclosure already conditionally mounts content; unchanged. This removes visibly unconditional formatting work but its standalone speed contribution is **not measured**; do not attribute a numerical improvement to it.
- Two actual phone overflows discovered by expanded checks fixed in presentation only: Partners grid uses min-width-zero tracks/items; Owner paperwork keeps its wide table in a local horizontal scrolling region. Labels, rates, templates, approval controls unchanged. Both repaired screenshots inspected and final overflow checks pass.
- Canonical runner gains `--read-only` preview-only route allowlist and complete generated UI route checklist. Missing fixtures/unvisited routes remain NOT_RUN. Default legacy mutation behavior otherwise retained; it was not executed. C13 now distinguishes incomplete/blocked booking from successful scheduled-state readback; missing ask-owner coverage makes the combined flow NOT_RUN, not PASS. Its optional legacy email path is not used/authorized by this task.
- Phone browser QA now uses 390x844; desktop 1280x1800. Captures overflow, console/page errors, HTTP/transport failures, timing, visible control inventory, and explicit read-only disclosure interactions. Navigation `net::ERR_ABORTED` is recorded separately, never erased; not treated as transport failure by itself. Partial browser reports are atomically saved and missing viewports marked NOT_RUN.

Exact changed files since addendum start:
`src/lib/jobfile.server.ts`, `src/hooks/use-me.ts`, `src/components/portal/jobfile.tsx`, `src/routes/_authenticated/admin.partners-overview.tsx`, `src/routes/_authenticated/admin.owner-paperwork.tsx`, `scripts/portal-qa.ts`, `scripts/portal-qa-coverage.ts`, `scripts/installer-test.ts`, `e2e/journey/shoot.py`, `tests/document-read-refresh.test.ts`, `tests/jobfile-read-concurrency.test.ts`, `tests/portal-qa-coverage.test.ts`, `AGENTS.md`, `src/lib/AGENTS.md`, `scripts/AGENTS.md`, `roadmap.md`, and these `.md`/`.json` reports. First-pass changes remain listed in `docs/qa/2026-10-21-preview-performance.md`.

## Timings: no blanket <1s claim

Direct backend loader samples (first invocation / subsequent two; Bun, configured backend SELECT-only loaders, excludes browser/HTTP/auth overhead):

| Loader | Original baseline | First pass | Additional pass |
|---|---|---|---|
| Active list | 743 / 686,583 ms | 628 / 606,564 ms | 823 / 589,715 ms |
| Enquiries | 1563 / 1611,1551 ms | 1504 / 1414,1409 ms | 1443 / 1423,1407 ms |
| TEST history | 338 / 456,291 ms | 181 / 172,207 ms | 181 / 183,216 ms |

Job property browser settled before/after first pass: **3585 -> 1954ms**, seven -> six RPCs. Active list **2330 -> 2369ms**, Closed **1637 -> 1647ms** (not improved), Enquiries **3075 -> 2878ms**. Phone warm property 2011ms; individual overview/consent/header/operations/blockers RPCs 160/89/95/167/554ms. Additional canonical TEST history screen with THREE disclosures clicked takes 6884ms phone / 5307ms desktop, including login/page load, screenshot and per-disclosure quiet waits; **not** comparable to single-route settled timing or a <1s result.

Public baseline cold Vite desktop H1 17251ms, navigation DOMContentLoaded 5745ms, TTFB 21ms; warm root 2966ms/calculator 3398ms. First-pass warmed-server new-browser H1 root 270ms/calculator 174ms; latest repeat root 275ms/calculator and subsequent routes recorded exactly in JSON. Phone baseline first context root 920ms and later 2881ms; first-pass 147ms and later109ms. Latest raw `public-addendum.json` supplies each sample. Warm repeats and fresh browser contexts are NOT cold Vite server/published first-visit proof. No server restart or published-domain test in this addendum.

`/` and `/calculator` already SSR-enabled by first pass; no further route edits. JavaScript-disabled H1/logo checks pass both viewports/routes. `__root.tsx`, fonts and auth callback routing unchanged. Existing head stylesheet uses `display=swap`. No production build artifact directory available; diagnostic build is OK, but detailed emitted bundle/font/LCP production analysis and standalone typecheck are **NOT_RUN/unverified**. Do not manually build or infer a cold-user result from a warm659ms live reload.

## Final canonical outcomes

Command: `bun run portal-qa --read-only --label performance-evidence-r6 --base http://localhost:8080 --personas installer --skip-installer --budget 540`.
Result **82 PASS, 0 FAIL, 114 NOT_RUN; overall BLOCKED**, not full workflow ready.
Raw: `/mnt/documents/portal-qa/2026-10-21T02-26-13/results.json`, `.browser.json`, `route-inventory.json`, `report.md`, screenshots. Exact sanitized route/flow/control matrix and all timings copied into `docs/qa/2026-10-21-performance-addendum.json`.

Generated current inventory: 93 raw non-API paths including two tracking endpoints; 91 after excluding tracking, **87 unique normalized UI paths**, **40 unique Office paths** (41 raw Office paths including its index alias). Four index aliases collapse. Independent review's 93/41 count therefore agrees with the raw declarations; inventory records normalized UI coverage, not a claimed all-pages PASS. Visited **34 route targets × two viewports = 68 render checks**. All final console errors/page errors/failed HTTP/transport requests/overflow: zero. Navigation cancellations remain individually counted in raw evidence. Visible buttons are separately recorded NOT_RUN unless explicitly clicked; screenshot PASS does not assert every button or persistence works.

Visited public `/`, `/calculator`, `/privacy`, `/auth`;
Office `/admin/jobs/active`, `/admin/jobs/closed`, `/admin/enquiries`, `/admin/enquiry-groups`, `/admin/board`, `/admin/pipeline`, `/admin/operations`, `/admin/operations-preview`, `/admin/partners-overview`, `/admin/businesses`, `/admin/workers`, `/admin/templates`, `/admin/quotes`, `/admin/money`, `/admin/ap-queue`, `/admin/owner-paperwork`, `/admin/veec`, and HV-2111 property;
Installer `/field`, `/field/money`, `/field/business`, its `details/insurance/rates/bank/agreement/team` pages, `/partner`, `/partner/add`, `/partner/import`, `/partner/bulk-import`, `/partner/payments`, `/partner/workers` (legacy redirects recorded in source/raw detail).

HV-2111 property History, Communications, Forms & evidence buttons actually clicked desktop/phone. No create invite, send, save, signing, approval, toggle, upload or provider action clicked. Other controls inventoried only. Full document-open UI with an existing private stored-file fixture and collapsed-details performance profiling NOT_RUN; isolated action/cache tests cover invalidation, not file rendering.

Existing TEST Office `admin@hivic.test`, `36b849de-1cde-425c-a05d-623f8985bbd6`, admin.
Existing Alpha `qa.installer.alpha@hivic-test.example`, `b8202cb7-614c-4b89-905e-696c4245f995`, installer. User-scoped preflight: nine reachable jobs, all qa_test, zero non-test; no installer writes, HV-1351 untouched.
Office fixture HV-2111 `518271f4-90b5-4d16-8ccc-2d2a5a0a12c1` confirmed qa_test; SELECT only this addendum. No snapshot restoration needed because no writes.

## Honest failed attempts

- `01:57:02` expanded run: browser budget timeout, 14 PASS/114 NOT_RUN/1 FAIL; no screen coverage inferred from lost output.
- `02:02:54`: 22 PASS/114 NOT_RUN/58 FAIL; most were navigation cancellations caught by the overly broad first diagnostic hook, plus two genuine overflow rows. Historical results preserved; not relabeled.
- `02:07:14`: 78 PASS/114 NOT_RUN/2 FAIL, precisely Partners/Owner-paperwork phone overflow.
- `02:15:08`: 81 PASS/115 NOT_RUN/1 FAIL; budget timeout after 67 complete screen rows including phone history. Those rows preserved, missing desktop NOT_RUN.
- `02:20:46`: 3 PASS/107 NOT_RUN/2 FAIL; timeout plus interrupted JSON write. Fixed atomic partial reports and bounded waits/budget; no data fix.
- Final `02:26:13`: 82/0/114 above. All raw earlier report directories retained; only final current status is used, not retroactive PASS.

## Tests, pricing and remaining blockers

New focused tests: document refresh/cache3, aggregator concurrency/privacy1, inventory/booking outcomes4: **8 PASS**. Existing screen-rule suite14, financial privacy8, jobfile14 PASS/4 retired SKIP. Existing isolated email/pricing rule suites run in canonical runner; no email provider calls. Build diagnostic latest checked `02:26:06Z build OK`; standalone typecheck not exposed. Existing unrelated owner-calculator source-shape failure from first pass remains, not fixed or relabeled.

Calculator unchanged: Root's live observation 100m² beforeRebate3698 and150m²5198 confirms1500/50 = **$30/m² incGST**. Earlier dummy preview150m² result5198 =4500install+349PIESA+349AP; Ready Check inclusion free/$0. No price/template/business-rule changes. Memory's older33 rate conflicts with current explicit30 instruction; current30 preserved, no memory or configured price rewrite.

Live Save My Spot and completed Ready Check booking remain **NOT_RUN**: no vetted restorable owner/token fixture free of communication/queue side effects; blocked Gate A never PASS. REC/owner persistence/signatures/payment/onboarding and token routes remain NOT_RUN for exact reasons in matrix. No invitation or setup link issued.

Database health: up; memory69%, disk23%, connections19/90, pool1/400, no recent exhaustion alerts. No evidence for compute resizing. **No migration currently justified/proposed/executed**: slow-query cumulative maxima are insufficient for an exact new index proposal; remaining enquiries needs narrowly scoped EXPLAIN diagnostics first. Any proven future migration will be shown before approval, practice-tested and never applied without permission. Node preview timings do not prove Worker concurrency performance (six outbound header-wait slots); no claim made for full real-job operational enrichment.

Open blockers: Office consistently<1s not achieved; authenticated Save Spot/booking fixture unavailable; production cold-build/font metrics unavailable. Nothing runs after this task.