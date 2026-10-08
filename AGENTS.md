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
- PIISA pins read-back definitions; signatures use audit-owned IDs, never historic fallback. Expected day uses capture; products/post-work use same-audit review before output. Why: no inferred facts.
- PIISA AP uses authoritative config and readback before sharing; blank repair requires observed unsigned capture fields. Why: no installer substitution or signed-history mutation.
- Emails reuse Step 3; no drift.
- Staff labels/disclosure targets use pure `src/lib/portal-presentation.core.ts`, never workflow or eligibility decisions. Why: presentation must not duplicate domain rules.
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
- Installer Add job shares CustomerFields and guarded import handlers; legacy bookmarks redirect there. Quote-removal events stay separate from measured facts; `intake-quote-details.core.ts` validates shared quote inputs. Why: one intake, no double counting.
- Intake pages share progress reads without error fallbacks; successful installer saves invalidate job-keyed readers and trade-home through job-cache; evidence retains all-reader invalidation. Why: next actions stay current without remounting editors.
- Evidence confirmation uses the guarded persistence helper with stored-path-derived primary keys and legacy path lookup; it checks both writes before success and never labels upload location/time as original capture. Why: retries and downstream failures must not duplicate files or invent evidence provenance.
- Installer QA: `--installer-app-only`, no signing/office. Why: bounded.
- Intake serializes files, keeps partial uploads/provenance, locks pending inputs and protects dirty drafts. Why: safe retries.
- Group B guards are shared; follow-up removal uses snapshot facts; initial email stays separate. Why: no repeat requests or price drift.
