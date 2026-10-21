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
- Office saved headlines share campaign cache. Office review count/paging shares one SELECT-only photos/exception predicate excluding offers; Removed is hidden, history retained; 0216 preserved. Why: exact totals, no duplicated piles or customer changes.
- Save My Spot reminders use own active estimate links, stored offer/attempt timestamps on spot_offered enquiries, shared phone/job claims and reminder-only activation; encrypted links POST through canonical save. Why: decouple email URL matching without weakening other guards.
- Incoming reset credentials bind Save to the verified user; old sessions never satisfy links. Office TEST handover uses exact QA preflight and a private download. Why: no cross-account access or public credential files.
- Staff labels/disclosure targets use pure `src/lib/portal-presentation.core.ts`, never workflow or eligibility decisions. Why: presentation must not duplicate domain rules.
- Read nested `AGENTS.md` before changing subdirectories, including `src/lib` domain rules and `scripts` QA rules. Why: keeps scoped rules local.
- Server functions are literal `createServerFn(...).middleware(...).inputValidator(...).handler(...)` chains; never import `@tanstack/react-start/server` in `*.functions.ts`. Why: factories/that import break the client bundle.
- Test Centre jobs start `source='qa_test'`, bypassing post-intake. Why: no live automation.
- `/` on every host and `/calculator` serve the same current public calculator; staff sign in at `/auth`. Secure estimates never embed the retired what-if calculator or track calculator use. Why: preserve customer links and one calculator without obsolete variants.
- The server entry detaches GET/HEAD rendering requests from the local adapter's socket-owned abort signal; keep mutation requests unchanged. Why: cancelled preview navigation must not throw after response close and blank the page.
- Office nav uses `office-nav.ts`; one Leads screen, legacy routes valid. Why: one queue, intact bookmarks.
- REC and installer onboarding keep legacy step keys for history but show nine page groups (installer: `INSTALLER_VISIBLE_PAGES`); each group validates all members and persists its canonical anchor; installer contact details are asked once, signing authority only at signing. Why: old drafts resume safely without weakened gates.
- Trade screens (`/field`, `/field/offer|day|money|business|welcome`) read only through `trade-view.server.ts`, business-scoped; labels in pure `trade-view.core.ts`. Why: trades never see customer prices, margins or other partners.
- Portal look lives in `src/styles.css` tokens (`.portal-theme`) plus pure presentation pieces in `src/components/portal/kit.tsx`; redesign phases use these presentation pieces; phase 3 may add canonical office navigation/routes and compact actual job pages but never change domain guards or workflow. Why: agreed office simplification preserves operational behaviour.
- Installer tests use TEST accounts and restore snapshots; Closed lists use the exact live-TEST archive complement, Active unchanged. Why: isolation and bounded response headers.

- Office operations categories and compact job status reuse the operations read classifier and one shared Query cache; legacy preview remains direct-link. Why: unique counts and factual precedence must agree without navigation polling.
- Installer Add job shares CustomerFields and guarded import handlers; legacy bookmarks redirect there. Quote-removal events stay separate from measured facts; `intake-quote-details.core.ts` validates shared quote inputs. Why: one intake, no double counting.
- Portal QA = `bun run portal-qa` only; gaps NOT_RUN, never PASS. Why: honest bounded checks.
- QA scripts resolve server-function IDs from the target's served dev transform or served compiled client (`scripts/qa-serverfn-resolve.ts`); unresolved = diagnostic failure, never a permission result. Office bulk lookups by job id are batched. Why: guessed IDs gave 500s and one all-ids URL stalled Office reads for minutes.
- One pile per job: every Enquiries pile, Active jobs filter, board lane and Needs me group is mutually exclusive; `office_enquiry_page` excludes pending-photo jobs from every other enquiry pile (0217) and `tests/enquiry-piles-one-pile-practice-db.test.ts` fails on any overlap. Why: Jo's firm rule (21 Oct) — duplicated piles mislead counts.
- Owner paperwork Gate A has no required items (Jo 21 Oct); tenancy/landlord and earlier-visit moved to Gate B, cooling-off not required; old Gate A signatures stay as history. Why: no paperwork before visits; trades get contact on acceptance via contact_releases.
