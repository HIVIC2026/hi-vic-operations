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
- Verified post-Ready-Check ineligible notifications share the existing T7 per-job email key and guarded sender; only durable held records retry after revalidating the current final verification. Why: no duplicate messages, no Gate 1 mutation or historical backlog release.
- Document early recovery owns module error/rejection events; the router handles preload/route catches and cache-busts reloads; both use the pure page-recovery stale-export classifier. Why: competing refresh handlers or missed named lazy exports can leave stale tabs blank.
- Read nested `AGENTS.md` before changing subdirectories, including `src/lib` domain rules and `scripts` QA rules. Why: keeps scoped rules local.
- Server functions are literal `createServerFn(...).middleware(...).inputValidator(...).handler(...)` chains; never import `@tanstack/react-start/server` in `*.functions.ts`. Why: factories/that import break the client bundle.
- Test Centre jobs start `source='qa_test'`, bypassing post-intake. Why: no live automation.
- Journey TEST-trade setup snapshots and restores both offer-preference flags alongside coverage. Why: temporary practice readiness must not undo office-paused dummy trades.
- `/` on every customer host and `/calculator` serve the same current public calculator; staff sign in at `/auth`, and on the staff host (`staff-host.core.ts`, portal.homeinsulationvictoria.com.au, decision 381) `/` opens `/auth`. Secure estimates never embed the retired what-if calculator or track calculator use. Why: preserve customer links and one calculator without obsolete variants.
- The server entry detaches GET/HEAD rendering requests from the local adapter's socket-owned abort signal; keep mutation requests unchanged. Why: cancelled preview navigation must not throw after response close and blank the page.
- Portal look lives in `src/styles.css` tokens (`.portal-theme`) plus pure presentation pieces in `src/components/portal/kit.tsx`; redesign phases use these presentation pieces; phase 3 may add canonical office navigation/routes and compact actual job pages but never change domain guards or workflow. Why: agreed office simplification preserves operational behaviour.

- Portal QA = `bun run portal-qa` only; gaps NOT_RUN, never PASS. Why: honest bounded checks.
- QA scripts resolve server-function IDs from the target's served dev transform or served compiled client (`scripts/qa-serverfn-resolve.ts`); unresolved = diagnostic failure, never a permission result. Office bulk lookups by job id are batched. Why: guessed IDs gave 500s and one all-ids URL stalled Office reads for minutes.

- Detailed application/domain rules live in `src/AGENTS.md`; read it before changing source or scripts that exercise these flows, then read narrower directory guidance. Why: keep cross-project guidance small without losing operational safeguards.
- RLS policies call per-user helpers as sub-selects (`(SELECT is_admin())`, `(SELECT auth.uid())`, `(SELECT has_role((SELECT auth.uid()), ...))`); new policies follow the same form (applied 26 Oct 2026, `docs/pending-migrations/rls-initplan-speed.sql`). Why: evaluated once per query instead of once per row, same rows.
