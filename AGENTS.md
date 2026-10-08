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
- Group B reuses locked Group A email layout; submissions queue office review only, with saving guarded by `campaignSaveAllowed`. Why: declarations never approve eligibility or save spots.
- Lead campaigns share `lead_campaign_responses`; post-Gate-1 email selection is centralised in `lead-email-routing.server.ts`, while each sender remains consent, opt-out, TEST and idempotency guarded. Why: one automatic outcome per enquiry without accidental sends.
- Staff portal presentation-only derivations and exact disclosure targets live in pure `src/lib/portal-presentation.core.ts`; they may label existing facts but never decide workflow or eligibility. Why: focused UI tests must not duplicate or alter domain rules.
- Service Coverage is a read-only operational summary derived from approved partner credentials, verified postcodes, active enquiries, and approved workers; it never assigns work or changes partner status. Why: coverage planning must not trigger operational actions.
- Domain, workflow, payment, compliance and integration rules live in `src/lib/AGENTS.md`; read it before changing `src/lib`. Why: keeps this file small.
- Server functions are literal `createServerFn(...).middleware(...).inputValidator(...).handler(...)` chains; never import `@tanstack/react-start/server` in `*.functions.ts`. Why: factories/that import break the client bundle.
- Pure rules in `*.core.ts` (tested via `bun test ./tests/`), persistence in `*.server.ts`, RPC in `*.functions.ts`. Why: testable, central guards.
- The PIESA request and all scheduling go through one payment-option gate (`evaluatePaymentGate`/`piesaRequestBlockers` in `payment-gate.core.ts`, mirrored by SQL `invoice_deposit_cleared`), behind a switch that fails closed when off or missing. Why: one route-aware rule, no silent fallback to a retired rule.
- Test Centre jobs use `jobs.source = 'qa_test'` from creation and never enter post-intake automation. Why: launch testing must remain visibly isolated from live work and external actions.
- The bare address `/` is the public calculator on every host; the same calculator also answers at `/calculator`, and staff sign in at `/auth`. Why: customers already have the plain link, so the calculator must stay on the home page.
- The current calculator exists only at the customer-domain root through `/calculator`; secure estimate pages do not embed the retired what-if calculator or track calculator use. Why: customers use one current calculator and obsolete variants stay deleted.
- The server entry detaches GET/HEAD rendering requests from the local adapter's socket-owned abort signal; keep mutation requests unchanged. Why: cancelled preview navigation must not throw after response close and blank the page.
- Office navigation is the top bar + tab map in `src/lib/office-nav.ts`; Leads has one canonical screen and old routes remain valid. Why: one operational queue without breaking bookmarks.
- REC and installer onboarding keep legacy step keys for history but show nine page groups (installer: `INSTALLER_VISIBLE_PAGES`); each group validates all members and persists its canonical anchor; installer contact details are asked once, signing authority only at signing. Why: old drafts resume safely without weakened gates.
- Trade screens (`/field`, `/field/offer|day|money|business|welcome`) read only through `trade-view.server.ts`, business-scoped; labels in pure `trade-view.core.ts`. Why: trades never see customer prices, margins or other partners.
- Portal look lives in `src/styles.css` tokens (`.portal-theme`) plus pure presentation pieces in `src/components/portal/kit.tsx`; redesign phases restyle pages with these and never change routes, server functions or workflow. Why: one consistent look without touching approved behaviour.
- The new-installer test (`bun run installer-test --runs 3`) drives the portal's own server steps plus `e2e/journey/shoot.py`, uses only TEST logins/businesses, snapshots and restores the TEST business each run, and writes reports/screens to Files `installer-test/`. Why: Jo approves real installers from a repeatable, strict check.
- Sign-in wording, email tidy-up and safe return paths live in pure `src/lib/login.core.ts`; every sign-in surface (/auth, /portal, /reset-password) uses it and returns only to portal paths via `?next=`. Why: one consistent, non-revealing login that never lands on the calculator.
- Partner welcome/login emails carry our own 24-hour single-use token (`partner_login_links`, claimed via `claim_partner_login_link`), which mints a fresh built-in set-password token on open. Why: the built-in token lasts 1 hour and trades often open emails the next day.
