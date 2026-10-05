<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# Project rules
- `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md` + `src/config/workflow-decisions.ts` override older prompts/comments/labels; run `bun scripts/scan-retired-terms.ts` before workflow work. Pending DB changes live in `docs/pending-migrations/` and are proven on PGlite (`tests/helpers/pglite-*.ts`) before any live run. Why: stop retired rules returning and keep untested SQL off the live database.
- Staff portal presentation-only derivations and exact disclosure targets live in pure `src/lib/portal-presentation.core.ts`; they may label existing facts but never decide workflow or eligibility. Why: focused UI tests must not duplicate or alter domain rules.
- Service Coverage is a read-only operational summary derived from approved partner credentials, verified postcodes, active enquiries, and approved workers; it never assigns work or changes partner status. Why: coverage planning must not trigger operational actions.
- Domain, workflow, payment, compliance and integration rules live in `src/lib/AGENTS.md`; read it before changing `src/lib`. Why: keeps this file small.
- Server functions are literal `createServerFn(...).middleware(...).inputValidator(...).handler(...)` chains; never import `@tanstack/react-start/server` in `*.functions.ts`. Why: factories/that import break the client bundle.
- Pure rules in `*.core.ts` (tested via `bun test ./tests/`), persistence in `*.server.ts`, RPC in `*.functions.ts`. Why: testable, central guards.
- The PIESA request and all scheduling go through one payment-option gate (`evaluatePaymentGate`/`piesaRequestBlockers` in `payment-gate.core.ts`, mirrored by SQL `invoice_deposit_cleared`), behind a switch that fails closed when off or missing. Why: one route-aware rule, no silent fallback to a retired rule.
- Test Centre jobs use `jobs.source = 'qa_test'` from creation and never enter post-intake automation. Why: launch testing must remain visibly isolated from live work and external actions.
- The bare address `/` is the public calculator on every host; the same calculator also answers at `/calculator`, and staff sign in at `/auth`. Why: customers already have the plain link, so the calculator must stay on the home page.
- Likely and onsite outcome emails share one renderer (`renderV2QuoteEmail` in `estimate-email.ts`) whose onsite-only differences are explicit branches; ineligible reuses the same header/button/footer helpers (`v2Header`, `v2Button`, `v2Footer`). Any change must keep the approved likely output byte-identical (hash-check before/after). Why: one visual system, without silently changing the locked likely email.
- Customer estimate follow-ups have one active template only: the unopened three-day reminder; engaged customers, all seven-day slots, and both retired legacy kinds are suppressed before delivery. Why: withdrawn reminders must never reach customers while historical rows remain auditable.
- The current calculator exists only at the customer-domain root through `/calculator`; secure estimate pages do not embed the retired what-if calculator or track calculator use. Why: customers use one current calculator and obsolete variants stay deleted.
- The server entry detaches GET/HEAD rendering requests from the local adapter's socket-owned abort signal; keep mutation requests unchanged. Why: cancelled preview navigation must not throw after response close and blank the page.
- Onboarding start limits, office block clearing and quarantined insurance uploads are enforced in the database (migration 0079, recorded as drizzle 0074_onboarding_security) and keyed by server-secret HMACs; clearing marks attempts, never deletes them. Why: abuse limits must be auditable and impossible to bypass from the browser.
- PIESA/PIISA pre-fills, defaults, reminders and cross-checks live in pure `src/lib/official-prefill.core.ts`; only "prefill" hints seed editable answers, reminders/cross-checks never become answers, and empty sources stay blank. Why: LR-003 change requests must never fill a blank as "No" or answer for the signer.
- REC onboarding keeps legacy step keys for validation/history but maps them through nine visible page groups; every group validates all member steps and persists its canonical legacy anchor. Why: old drafts resume safely without duplicated one-question pages or weakened gates.

- Installer onboarding keeps legacy step keys for history but shows nine page groups (`INSTALLER_VISIBLE_PAGES`); each group validates all members and persists its first member as anchor; contact details are asked once and signing authority only at signing. Why: old drafts resume safely.
- Bulk upload reads every file in the browser (lists/Word/text locally; PDFs and photos via AI `readBulkFile`; photo GPS via OpenStreetMap `geocodeBulkPhotos`), never stops on one bad file, and always reaches the server so leads can come from file names/photos alone (flagged `unsure` → office review); each file gets a plain-English result line. Why: messy uploads must never dead-end.
