# Published in-house harness — partial implementation, 2 November 2026

## Built and tested

- Separate `bun run portal-qa -- --published-in-house --base https://portal.homeinsulationvictoria.com.au` dispatch. Legacy preview QA restrictions remain intact.
- Import-safe orchestrator with mandatory deployed/run/origin identity, fresh provider proofs before setup and every page checkpoint, failure stop by scenario, and checked cleanup on preparation/action failures.
- Five scenario inventories, 405 role/checkpoint rows: complete through close, owner cancelled, Can't do this one, post-notice Lead Installer swap, electrical rectification.
- PASS requires actual execution, resulting readback and a screenshot; absent/unreached evidence stays NOT RUN.
- Authenticated, persisted-admin-only, no-store read endpoint `/api/public/qa-in-house-preflight`. It deliberately returns incomplete capabilities: nothing has been implemented/proven that would authorize a journey. It performs auth/role reads only, no domain writes or provider calls. It is not published.

## Test-first and actual checks

Initial new test failed because the harness module did not exist. Five new orchestration tests then passed (27 assertions). Related suite: 18 passed, zero failed (77 assertions). Local unauthenticated safety endpoint returned HTTP 401. Automatic checks: build OK after a route-brace correction.

These tests prove refusal and evidence accounting, **not whole-job execution or live provider capture**.

## Published run attempted safely

The published preflight returned **HTTP 404** at 10:50 AEDT. No deployed safety endpoint was available. The runner refused before setup, sessions, page actions or domain mutations.

Actual report:

`/mnt/documents/published-in-house/2026-11-01T23-50-37-333Z/report.md`

All 405 workflow checkpoints: **NOT RUN**. No screenshots: taking workflow screenshots would require page actions before the demanded provider proofs. No TEST configuration changed, so restoration was not needed. No provider or publishing action occurred.

## Exactly what remains

1. Authorized run-owned protected fixture creation and durable, complete TEST configuration snapshot/restore with interruption/conflict recovery. Existing journey setup changes more fields than it snapshots and cannot be reused safely as-is.
2. Exact job-bound message capture at every owner/trade/office boundary, including scheduled retries. Existing holds suppress rather than capture; TEST inbox routing is real delivery, not capture.
3. Job-bound Mitti JSON/template **and binary media** simulation. Current binary media path can reach real Mitti and unattributed JSON calls can fall through.
4. Published authenticated actor/scope validation and independently verified Stripe TEST, Xero Demo and captured ESC boundaries. Local key-selection tests/fabricated tenants do not establish deployed safety.
5. Concrete browser action/readback adapters for all five scenarios and role screenshots, owner identity-code capture, TEST payment return/webhook proof, actual form/evidence/CoES/AP/VEEC close and denial checks after swaps/handback.
6. Per-job timing operations; never invoke broad allocation, payment or office-digest sweeps against live data.
7. Publish completed safety changes before any published journey can run. Jo prohibited publishing in this task, so this deployment dependency remains blocked; publishing this partial tool alone is not sufficient.

No app workflow bug was reproduced. No business setting, launch hold, secret, real record, migration, send or publication was changed. This is **not** the completed full tool and must not be presented as whole-job PASS.