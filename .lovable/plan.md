# Company profile + worker job links

One account per company. The company lists its workers (name, email, phone, licence for electricians). Your office approves each worker once. When a worker is put on a job, they get a secure magic link by text/email that opens just that job — no login, no password, no app.

## What the company sees

- **Workers tab in their portal**: add/edit/remove workers (full name, mobile, email, licence number for electricians). New workers show as "Pending office approval" and can't be assigned to jobs until approved.
- **Assign to worker**: on each job, the company (or your office) picks one of their approved workers. The portal shows the worker's job link with a copy button, and sends it by text/email once communications are switched on.

## What the worker sees

- A link like `/w/<token>` that opens a simple mobile page for that one job: address and suburb, what needs doing, the Mitti form button, photo/evidence upload, and the job timeline (gates, dates, who's waiting on who).
- No login. The link is the access. It only ever shows that one job — owner contact details stay masked, portal messages stay the channel.

## How workers talk to owners

- The worker's job page has the job's **message thread** built in. They type there (e.g. "Running 20 min late", "Can you unlock the side gate?"), and can propose visit times that the owner accepts.
- Messages show as "Sam — Sparky Electrical", so the owner knows who's coming and which company they're from.
- The owner replies in their own portal. The head company and your office see every message — one shared record, no calls or outside texts.
- When a new message arrives, the worker is notified with their job link (once communications are switched on; until then they see it next time they open the link).

## What your office sees

- **Worker approvals**: a queue (in To action + partner screen) of new/changed workers to approve or reject, with the company they sit under. Approval is one click and is recorded in the audit trail.
- Every worker link is listed on the job: who it was sent to, when, when it was last opened, with a revoke button. Revoking or re-assigning kills the old link instantly.

## Safety rules

- Links are unguessable (long random token, stored hashed), expire after 30 days, and are scoped to one worker + one job.
- A worker link can view the job and submit the Mitti form/evidence — it cannot see prices, margins, other jobs, or other companies' data.
- Workers a company lists during sign-up flow into this same approval queue automatically.
- Nothing is texted or emailed until communications are explicitly switched on — until then links are copied manually from the portal.

## Technical details

- `partner_workers` gains `account_status` flow: `pending` → `approved` / `rejected` (column exists; add status transition guard + audit events).
- New table `worker_job_links`: id, worker_id, job_id, token_hash, created_by, expires_at, revoked_at, last_opened_at + GRANTs + RLS (company reads own workers' links, office reads all, worker access only via server-verified token).
- Public route `/w/$token` (no auth gate) backed by a server function that validates the token, records `last_opened_at`, and returns only worker-safe job fields.
- Worker messages reuse the existing job messages/appointment proposals, written via token-verified server functions (`postWorkerMessage`, `proposeWorkerTime`) with the worker + company recorded as author.
- Server functions: `addWorker` / `updateWorker` (company-scoped), `approveWorker` / `rejectWorker` (admin), `createWorkerJobLink` / `revokeWorkerJobLink`, `getWorkerJobView` (token-verified).
- Pure logic (token rules, worker-safe field projection) in `worker-links.core.ts` with `bun test` coverage; persistence in `worker-links.server.ts`.
