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
- Service Coverage is a read-only operational summary derived from approved partner credentials, verified postcodes, active enquiries, and approved workers; it never assigns work or changes partner status. Why: coverage planning must not trigger operational actions.
- Domain, workflow, payment, compliance and integration rules live in `src/lib/AGENTS.md`; read it before changing `src/lib`. Why: keeps this file small.
- Server functions are literal `createServerFn(...).middleware(...).inputValidator(...).handler(...)` chains; never import `@tanstack/react-start/server` in `*.functions.ts`. Why: factories/that import break the client bundle.
- Pure rules in `*.core.ts` (tested via `bun test ./tests/`), persistence in `*.server.ts`, RPC in `*.functions.ts`. Why: testable, central guards.
- Test Centre jobs use `jobs.source = 'qa_test'` from creation and never enter post-intake automation. Why: launch testing must remain visibly isolated from live work and external actions.
- The bare address `/` renders the shared public calculator (same component and head as `/calculator`) on every host; staff sign in at `/auth`. Why: host-header rewriting did not apply on the published site, so the homepage must not depend on it.
- Likely and onsite outcome emails share one renderer (`renderV2QuoteEmail` in `estimate-email.ts`) whose onsite-only differences are explicit branches; ineligible reuses the same header/button/footer helpers (`v2Header`, `v2Button`, `v2Footer`). Any change must keep the approved likely output byte-identical (hash-check before/after). Why: one visual system, without silently changing the locked likely email.
- Customer estimate follow-ups have one active template only: the unopened three-day reminder; engaged customers, all seven-day slots, and both retired legacy kinds are suppressed before delivery. Why: withdrawn reminders must never reach customers while historical rows remain auditable.
- The current calculator exists only at the customer-domain root through `/calculator`; secure estimate pages do not embed the retired what-if calculator or track calculator use. Why: customers use one current calculator and obsolete variants stay deleted.
- The server entry detaches GET/HEAD rendering requests from the local adapter's socket-owned abort signal; keep mutation requests unchanged. Why: cancelled preview navigation must not throw after response close and blank the page.
- Onboarding start limits, office block clearing and quarantined insurance uploads are enforced in the database (staged 0079) and keyed by server-secret HMACs; clearing marks attempts, never deletes them. Why: abuse limits must be auditable and impossible to bypass from the browser.
