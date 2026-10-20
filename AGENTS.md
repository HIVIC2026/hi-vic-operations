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
- Installer/REC contracts use canonical sections, signing versions and shared versioned Schedule 4 in review/signing; retain prior activatable versions and stored-text historic PDFs. Why: new terms bind exact signatures without rewriting history or revoking approvals.
- Staff labels/disclosure targets use pure `src/lib/portal-presentation.core.ts`, never workflow or eligibility decisions. Why: presentation must not duplicate domain rules.
- Domain, workflow, payment, compliance and integration rules live in `src/lib/AGENTS.md`; read it before changing `src/lib`. Why: keeps this file small.
- Server functions are literal `createServerFn(...).middleware(...).inputValidator(...).handler(...)` chains; never import `@tanstack/react-start/server` in `*.functions.ts`. Why: factories/that import break the client bundle.
- Pure rules in `*.core.ts` (tested via `bun test ./tests/`), persistence in `*.server.ts`, RPC in `*.functions.ts`. Why: testable, central guards.
- Test Centre jobs start with `jobs.source = 'qa_test'` and never enter post-intake automation. Why: isolate tests from live work and external actions.
- `/` on every host and `/calculator` serve the same current public calculator; staff sign in at `/auth`. Secure estimates never embed the retired what-if calculator or track calculator use. Why: preserve customer links and one calculator without obsolete variants.
- The server entry detaches GET/HEAD rendering requests from the local adapter's socket-owned abort signal; keep mutation requests unchanged. Why: cancelled preview navigation must not throw after response close and blank the page.
- Office navigation is the top bar + tab map in `src/lib/office-nav.ts`; Leads has one canonical screen and old routes remain valid. Why: one operational queue without breaking bookmarks.
- REC and installer onboarding keep legacy step keys for history but show nine page groups (installer: `INSTALLER_VISIBLE_PAGES`); each group validates all members and persists its canonical anchor; installer contact details are asked once, signing authority only at signing. Why: old drafts resume safely without weakened gates.
- Trade screens (`/field`, `/field/offer|day|money|business|welcome`) read only through `trade-view.server.ts`, business-scoped; labels in pure `trade-view.core.ts`. Why: trades never see customer prices, margins or other partners.
- Portal look lives in `src/styles.css` tokens (`.portal-theme`) plus pure presentation pieces in `src/components/portal/kit.tsx`; redesign phases use these presentation pieces; phase 3 may add canonical office navigation/routes and compact actual job pages but never change domain guards or workflow. Why: agreed office simplification preserves operational behaviour.
- Installer tests use TEST accounts and restore snapshots. Why: isolation.

- Office operations categories and compact job status reuse the operations read classifier and one shared Query cache; legacy preview remains direct-link. Why: unique counts and factual precedence must agree without navigation polling.
- Installer Add job shares CustomerFields and guarded import handlers; legacy bookmarks redirect there. Quote-removal events stay separate from measured facts; `intake-quote-details.core.ts` validates shared quote inputs. Why: one intake, no double counting.
- Portal QA = `bun run portal-qa` only; gaps NOT_RUN, never PASS. Why: honest bounded checks.
- The /admin board places jobs by the facts-based office classifier (`board-phase.core.ts` via `getBoardStages`), never the stored stage alone. Why: stored Ready Check stages without a real Ready Check must not appear in Ready Check.
- QA scripts resolve server-function IDs from the target's served dev transform or served compiled client (`scripts/qa-serverfn-resolve.ts`); unresolved = diagnostic failure, never a permission result. Office bulk lookups by job id are batched. Why: guessed IDs gave 500s and one all-ids URL stalled Office reads for minutes.
- Installer quote price basis/GST/removal+extras pricing is an append-only `installer_quote_commercial_declared` event read by `installerIntakeState`; its blockers live in readiness so every draft/release/approve/accept path enforces them. Why: one factual check, no migration, history preserved.
- Mitti saved-form health: unreadable definitions report `schema: "unreadable"` (never missing questions); a native-A3 PIISA is checked with `a3MissingFields`; results record `schemaBasis`. Why: issue counts must not be mistaken for proven absent questions.
- Ready Check areas = `areas.v1` observation + `area_key` evidence rows (pending 0214); works locked via `rcWorksBlockers` until each before photo is accepted. Why: one evidence model, server hold.
