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

- `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md` + `src/config/workflow-decisions.ts` override older prompts/comments/labels; run `bun scripts/scan-retired-terms.ts` before workflow work. Pending DB changes live in `docs/pending-migrations/` and are proven on PGlite (`tests/helpers/pglite-*.ts`) before any live run. Why: stop retired rules returning and keep untested SQL off the live database.
# Project rules
- PIISA schema/prefill/copy changes require observed IDs and current-definition validation; media is not structured product data. Why: protect crew/statutory output.
- PIISA pins definitions (response sets ID-sorted, page/condition order fixed); audits keep schema/capture attribution. Expected date uses captured assessment day; products use same-audit review, not quotes. Why: no inferred facts.
- Emails reuse Step 3; no drift.
- Staff portal presentation-only derivations and exact disclosure targets live in pure `src/lib/portal-presentation.core.ts`; they may label existing facts but never decide workflow or eligibility. Why: focused UI tests must not duplicate or alter domain rules.
- Domain, workflow, payment, compliance and integration rules live in `src/lib/AGENTS.md`; read it before changing `src/lib`. Why: keeps this file small.
- Server functions are literal `createServerFn(...).middleware(...).inputValidator(...).handler(...)` chains; never import `@tanstack/react-start/server` in `*.functions.ts`. Why: factories/that import break the client bundle.
- Pure rules in `*.core.ts` (tested via `bun test ./tests/`), persistence in `*.server.ts`, RPC in `*.functions.ts`. Why: testable, central guards.
- Test Centre jobs use `jobs.source = 'qa_test'` from creation and never enter post-intake automation. Why: launch testing must remain visibly isolated from live work and external actions.
- `/` on every host and `/calculator` serve the same current public calculator; staff sign in at `/auth`. Secure estimates never embed the retired what-if calculator or track calculator use. Why: preserve customer links and one calculator without obsolete variants.
- The server entry detaches GET/HEAD rendering requests from the local adapter's socket-owned abort signal; keep mutation requests unchanged. Why: cancelled preview navigation must not throw after response close and blank the page.
- Office navigation is the top bar + tab map in `src/lib/office-nav.ts`; Leads has one canonical screen and old routes remain valid. Why: one operational queue without breaking bookmarks.
- REC and installer onboarding keep legacy step keys for history but show nine page groups (installer: `INSTALLER_VISIBLE_PAGES`); each group validates all members and persists its canonical anchor; installer contact details are asked once, signing authority only at signing. Why: old drafts resume safely without weakened gates.
- Trade screens (`/field`, `/field/offer|day|money|business|welcome`) read only through `trade-view.server.ts`, business-scoped; labels in pure `trade-view.core.ts`. Why: trades never see customer prices, margins or other partners.
- Portal look lives in `src/styles.css` tokens (`.portal-theme`) plus pure presentation pieces in `src/components/portal/kit.tsx`; redesign phases use these presentation pieces; phase 3 may add canonical office navigation/routes and compact actual job pages but never change domain guards or workflow. Why: agreed office simplification preserves operational behaviour.
- Installer testing (`bun run installer-test --runs 3`) uses portal steps + `e2e/journey/shoot.py`, TEST accounts/businesses only, restores snapshots each run, reports to Files `installer-test/`. Why: repeatable strict checks.

- Office operations categories and compact job status reuse the operations read classifier and one shared Query cache; legacy preview remains direct-link. Why: unique counts and factual precedence must agree without navigation polling.
- Installer Add job is one intake (`installer-intake-flow.tsx`) on shared CustomerFields and the guarded import handlers; legacy add/bulk bookmarks redirect there (office keeps batch history). Why: one form, no duplicate or obsolete questions.
- Intake pages share progress reads without error fallbacks; private files use signed viewers, durable controls and explicit read/upload failures; evidence success requires confirmation. Why: truthful progress and retries.
- Installer QA: `--installer-app-only`, no signing/office. Why: bounded.
- Intake serializes files, preserves partial uploads/provenance; editors keep job identity, lock pending inputs and preserve dirty drafts on read errors. Why: safe retries/saves.
