# STAGED MIGRATIONS — DO NOT APPLY AUTOMATICALLY

These SQL files are **staged proposals**, not part of the applied baseline (`drizzle/migrations/`).
They stay at this path because automated tests read them.

## Authorisation

The client has provided **written instructions delegating technical implementation ownership** of the
existing live portal to the project lead. Under that standing delegation, the **project lead is
responsible for deciding and implementing the necessary technical changes**, including applying the
staged migrations below as part of the approved technical release plan. A separate, individual written
approval is **not** required for every single migration.

This delegation covers the decision to apply; it does **not** waive the operational safety requirements
below. Every apply must still follow the controlled procedure, and any change outside the approved
release plan — or anything with unclear scope or risk — must be raised with the project lead before
proceeding.

## Operational safety requirements (always required)

Before and during any apply, the operator must:

1. **Confirm production database identity** — verify you are connected to the intended production
   project before running anything.
2. **Verify a recoverable backup** — confirm a recent, completed backup (or a valid PITR target)
   exists that covers the apply window. Do not proceed without one.
3. **Confirm the migration baseline** — independently check the production schema and migration ledger
   so the expected prior migrations are present and the ones being applied are genuinely absent. Never
   apply a migration just because its ledger entry is missing.
4. **Execute migrations in controlled order** — apply in the planned sequence, one transaction per
   migration.
5. **Verify each migration** — run the post-apply checks for each migration before moving on.
6. **Maintain rollback procedures** — keep the matching `*.rollback.sql` ready for each migration and
   confirm it before apply.
7. **Stop on unexpected results** — on any mismatch, error, or unexpected behaviour, stop and decide
   whether to roll back; do not continue blindly.

## Current approved migration plan

| Migration | Purpose | Rollback |
|---|---|---|
| **0149** — `0149_security_owner_quote_rls.sql` | **Quote RLS security correction.** Closes the exposure where owners can read issued+queued quotes through direct queries; preserves installer/electrician/admin/history access. **Apply first (security-first).** | `0149_security_owner_quote_rls.rollback.sql` (restores the previous, less-restrictive 0126 visibility policy and the 0133 autolink). |
| **0202** — `0202_signed_webhook_nonces.sql` | **Webhook nonce replay protection.** Adds the `signed_webhook_nonces` table with `UNIQUE(source, purpose, nonce)` so replayed timestamped webhooks are rejected. **Apply after 0149.** | `0202_signed_webhook_nonces.rollback.sql` (drops the table; webhook degrades to signature+timestamp fail-open). |

| **0221** — `0221_outlook_history.sql` | **Outlook email history.** Folder-agnostic inbound/outbound cursors plus a record-only historical catch-up pass (a persisted `record_only` flag on `outlook_message_work`; the SQL rejects close/flag decisions on it); Outlook moves to per-job message uniqueness so one email can link to several properties, while every other provider keeps the original global uniqueness; attachment metadata always pending so inline images are fetched. **Apply after 0149 → 0202; requires Outlook sync paused first.** | `0221_outlook_history.rollback.sql` (refuses if multi-job history or recovery work exists; restores the 0212 RPCs, the global unique index, and drops `record_only`). |

Apply order: **0149 → 0202 → 0221** (security-first; 0221 last, with Outlook sync paused).

## Other staged files (not part of this plan)

- 0150 (D6) is staged and unapplied; 0204 (T6) remains reserved in the README plan (no file).
- 0205 — `0205_save_my_spot_real_send_enabled.sql` (COM-04 Save My Spot send control; forward-only rename of the original 0204 file, kept 0204 free for T6). Staged and unapplied.
- 0226 — `0226_esc_consent_template_v1.sql` (Jo decision 123, 24 Oct 2026): inserts the ESC Owner's Consent Form Template v1 (14 Apr 2026, SHA-256 `e6458b32…7753151`) as the active, approved `esc_consent` wording (approved_by Jo's admin user), retires the lawyer row to inactive history, and adds `owner_esc_consents.owner_declarations` / `ap_rep`. Requires Jo's profile row `950fa0b6-dc44-49af-a754-6a65f26a661e` (FK). Proven on PGlite: `tests/esc-consent-template-db.test.ts`. Rollback `0226_esc_consent_template_v1.rollback.sql` reactivates the previous approved wording and keeps both rows and both columns. Staged and unapplied.
- `esc-registry-robot-switch.sql` (Jo decision 272, 25 Oct 2026): adds `workflow_settings.esc_registry_robot_enabled boolean not null default false` (the ESC Registry robot switch; idempotent, never resets a value Jo set). Code fails closed while it is missing (Settings row shown "waiting for the database change", robot off). Proven on PGlite: `tests/esc-registry-robot-switch-practice-db.test.ts`. Rollback `esc-registry-robot-switch.rollback.sql` drops the column. Staged and unapplied.
- `owners-email-not-unique.sql` (Jo decision 282, 25 Oct 2026): drops the baseline partial unique index `owners_email_uq` on `lower(owners.email)` and adds the ordinary `owners_email_idx` in its place, so one email may sit on any number of owner rows/jobs (only the property address is a duplicate signal). Until it is applied, installer intake cannot save a second owner with a known email and shows the neutral save error. Proven on PGlite: `tests/owners-email-not-unique-practice-db.test.ts`. Rollback `owners-email-not-unique.rollback.sql` refuses while owners share an email, otherwise restores the unique index. Staged and unapplied.
- `mitti-fixes-template.sql` (Jo decision 293, 25 Oct 2026): adds `workflow_settings.mitti_fixes_template_id text` (NULL = not set up) for the electrician's "A4 – Electrical fixes" Mitti template (`docs/MITTI_FIXES_FORM_PROMPT.md`), written only by `connectMittiForm("fixes")` after validation. Before it is applied the Mitti forms page shows the A4 row as "waiting for the database change", no fixes form is created (a booked fixes visit raises the job-level "Fixes form not set up" office item) and the electrician keeps the portal "record fixes done" page. Proven on PGlite: `tests/mitti-fixes-template-practice-db.test.ts`. Rollback `mitti-fixes-template.rollback.sql` drops the column. Staged and unapplied.
- 0229 — `0229_worker_email_optional.sql` (Jo 28 Oct 2026): makes `partner_workers.email` optional (a person can be saved with just a name, trade role and optional mobile) and adds `partner_workers_email_not_blank` so a blank email is refused; the existing UNIQUE (business_id, email) is unchanged. Until it is applied, adding someone without an email shows "needs the office's database update first". Proven on PGlite: `tests/worker-email-optional-db.test.ts`. Rollback `0229_worker_email_optional.rollback.sql` refuses while any person has no email, otherwise restores NOT NULL. Staged and unapplied.
- 0230 — `0230_team_declarations_due.sql` (Jo 29 Oct 2026): adds `partner_workers.declarations_due boolean not null default false` (true = added on Team, must sign the worker declarations by link before any job; existing people read false). Needs 0229 (`0229_worker_email_optional.sql`) live first. Proven on PGlite: `tests/team-declarations-due-db.test.ts`. Rollback `0230_team_declarations_due.rollback.sql` drops the column. Staged and unapplied.
- `add-installer-job-atomic.sql` (A6, Jo 29 Oct 2026): adds `public.add_installer_job(_payload jsonb)`, which saves Add a job's owner, property, job, assignment, consent and events in ONE transaction keyed by the phone's request key (`external_enquiry_id = 'onsite:' || request_key`), so "Try again" finishes the same job. Execute granted to service_role only. Until it is applied the server keeps the step-by-step save. Proven on PGlite: `tests/add-installer-job-practice-db.test.ts`. Undo `add-installer-job-atomic.undo.sql` drops only the function. Staged and unapplied.
- 0200/0201 are superseded by the applied 0147/0148.
- Numbers 0131 and 0147 are reused by different migrations — always refer to the full filename.

See `handover/05_PENDING_MIGRATIONS_WARNING.md` and `T9_FINAL_MIGRATION_INVENTORY.md`.
