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
- Fixes gates read the newest non-superseded quote; generation uses content-based stable quote/line keys and checked writes. A5 completion requires job/audit-bound summaries and successful file copies. Why: stale approvals and interrupted persistence must never unlock work or duplicate records.
- TEST office is a separate deny-by-default capability, never an admin alias: exact route/function allowlists, verified identity, persisted roles, scoped job/business graph checks and database API/RLS/storage boundaries protect its permitted journey surfaces; all other capabilities remain refused. Why: privileged office readers bypass RLS and new screens must never implicitly expose real records.
- Completed Ready Check edits use the validated same-audit refresh helper before held-only redrafting; Add a job runs the existing claim-guarded form creator immediately without delayed retries. Why: completed facts must not go stale and absent request lifecycle must not postpone first creation to the tick.
- Existing-form Mitti pulls and completed Ready Check retries live in the dedicated authenticated Mitti pull callback, separate from allocation; activate its production schedule together with that deployment. Why: slow allocation must not starve form reads or leave a deployment gap.
- Campaign spot saves use one database transaction for response, save event and queue stage; secure next visits repair only recorded saves, without delivery. Why: interrupted requests and replays must not strand saved spots or send repair messages.
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
- `journey --screens` is browser-first evidence with a fail-closed preflight, never the legacy server-driven setup; unproven website sandbox, server-wide provider guards, TEST-domain actors or rule mismatches block downstream actions. Why: command-process guards cannot protect browser-triggered server mutations, and screenshots after direct server actions are not screen proof.
- Screen walk-through starts from the journey s1 qa_test job (website form is portal-qa's), probes message/Mitti/Demo safeguards for that job before any page action, and marks unreached steps BLOCKED/NOT RUN. Why: honest page evidence without manufacturing downstream state.
- Screen journey selects the isolated Bravo persona with people preparation disabled; records release before owner confirmation, attempts independent pages after failures, and restores only selected TEST businesses. Why: Alpha's historical non-qa_test link must remain untouched and QA must not approve people to bypass gates.
- `realMittiCall` routes TEST people (reserved domain, TEST_MITTI_ASSIGNEE), sim_ ids and stored `mitti_sim_audits` ids to the persistent simulator; `mittiCallFor` swaps whole TEST flows including template reads. Why: browser-driven TEST jobs in the running portal never reach real Mitti, real calls stay byte-identical.
- QA scripts resolve server-function IDs from the target's served dev transform or served compiled client (`scripts/qa-serverfn-resolve.ts`); unresolved = diagnostic failure, never a permission result. Office bulk lookups by job id are batched. Why: guessed IDs gave 500s and one all-ids URL stalled Office reads for minutes.

- Detailed application/domain rules live in `src/AGENTS.md`; read it before changing source or scripts that exercise these flows, then read narrower directory guidance. Why: keep cross-project guidance small without losing operational safeguards.
- RLS policies call per-user helpers as sub-selects (`(SELECT is_admin())`, `(SELECT auth.uid())`, `(SELECT has_role((SELECT auth.uid()), ...))`); new policies follow the same form (applied 26 Oct 2026, `docs/pending-migrations/rls-initplan-speed.sql`). Why: evaluated once per query instead of once per row, same rows.
- Clear owner decline emails auto-close only unbooked, unpaid enquiry jobs through `cancelJobFully` (`email-decline-close.server.ts`, gate `declineAutoClose`), with no reply; anything else keeps the Apply card. Why: booked/paid cancels release trades and need the office.
