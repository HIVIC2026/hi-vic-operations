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

## Architecture rules
- All writes go through `src/lib/portal.functions.ts` (caller role check) → central `workflow.server.ts` / `quotes.server.ts` / `xero.server.ts` using the service role; non-admins have no RLS write policies. Why: one place for workflow, pricing and payment gates.
- Stage-entry guards (Owner Authority, PIESA window, 50% deposit, evidence, compliance) live only in `stageEntryBlockers`; authority rules live in `authority.server.ts`. Why: rules change centrally.
- Owner Authority is a versioned, immutable `owner_authorities` record (trigger-enforced), not a boolean. Why: audit-grade evidence.
- One combined installation quote (rectification lines folded in) carries the single Xero invoice and 50% deposit. Why: deposit must precede rectification scheduling.
- PIESA window length lives in `workflow_settings`; deadline/urgency computed by the `job_piesa_deadlines` view. Why: single source for UI and server.
- Payment display state is derived by the `invoice_status` view (customer-safe columns; internal Xero IDs admin-only via server fn); Xero is the system of record. Why: time-based states need no cron.
- Internal pricing (cost/margin/fee) lives only in admin-only `quote_internals`; customer-facing prices in `quote_items` are inc GST. Why: never expose margins.
- Evidence files live in the private `job-files` bucket, accessed only via server-issued signed URLs. Why: no public evidence URLs.
- See `docs/PORTAL.md` for workflow and the security test matrix.
- Write every server function as a literal `createServerFn(...).middleware(...).inputValidator(...).handler(...)` chain; never wrap `createServerFn` in a helper factory. Why: the compiler only turns literal chains into server calls — a factory made handlers run in the browser.
- Never import `@tanstack/react-start/server` in `*.functions.ts` or modules they import; read request data via a `createMiddleware().server()` (see `request-meta.ts`). Why: that import is denied in the browser bundle and crashes every page.
- Job source lives in `jobs.channel` (+ originating installer business/user), made permanent by the `guard_job_source` trigger; installer-sourced jobs get one quote from the assigned installer and stay payment-gated via `commercialBlocker` until `commercial_model = hivic_invoices_owner`. Why: attribution is audit evidence; installer invoicing isn't defined yet.
- Two invoices per accepted installation quote: `invoices.part` deposit|balance, unique (quote_id, part); lifecycle is pure in `invoice.lifecycle.ts` (injectable store), Xero rules in `xero.core.ts` (injectable `XeroCall`), wired by `xero.server.ts` with `sync_lock_at`, reference `HI VIC <job> DEPOSIT|BALANCE`, Idempotency-Key, contact reuse; Xero due-date updates flagged `xero_update_pending`, sending gated by `XERO_DUE_DATE_UPDATES_ENABLED`. Why: retries/rebookings never duplicate; all Xero writes testable with mocks (`bun test ./tests/`).
