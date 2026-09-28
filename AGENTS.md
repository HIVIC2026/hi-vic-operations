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
- Stage-entry guards (PIESA window, 50% deposit, evidence, compliance) live only in `stageEntryBlockers`. Why: rules change centrally.
- PIESA window length lives in `workflow_settings`; deadline/urgency computed by the `job_piesa_deadlines` view. Why: single source for UI and server.
- Payment display state is derived by the `invoice_payment_state` view; Xero is the system of record. Why: time-based states need no cron.
- Internal pricing (cost/margin/fee) lives only in admin-only `quote_internals`; customer-facing prices in `quote_items` are inc GST. Why: never expose margins.
- Evidence files live in the private `job-files` bucket, accessed only via server-issued signed URLs. Why: no public evidence URLs.
- See `docs/PORTAL.md` for workflow and the security test matrix.
