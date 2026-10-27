# Mitti Instant Notice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a portal-made Mitti form is updated or completed, the portal re-syncs that one job within seconds, so the installer's job page clears "Needs finishing" within about a minute.

**Architecture:** Mitti webhooks (`audit.updated`, `audit.completed`) POST to a new public route. The route checks a URL token, pulls the audit id, finds the portal job that owns that audit, and — if the new switch is on — calls the existing `syncMittiAssessment(jobId, null)`. The existing 15-minute Mitti pull (`src/routes/api/public/hooks/mitti-pull.ts` → `syncPendingMitti` + `sweepCompletedMittiReadyChecks`) is unchanged and remains the backup. `syncMittiAssessment` already calls `finishMittiReadyCheck` when the form is Complete, so one call covers both changes and completion.

**Tech Stack:** TanStack Start file routes, Supabase (service-role `admin` client), `docs/pending-migrations/` SQL proven on PGlite, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-10-27-mitti-instant-notice-design.md`

## Global Constraints

- Only forms the portal made. An audit id not on any job → ignore, return 200.
- The notice body is never trusted for answers; the portal re-reads the form via `syncMittiAssessment`.
- Always answer Mitti 200 quickly once the token is good, even if the sync fails. Bad/missing token → 403 (same as `twilio/inbound.ts`).
- Own switch `workflow_settings.mitti_instant_notice_enabled`, default **false**. Until the column exists on live, a read error or missing column = **off** (fail closed), so code can ship before the SQL runs.
- Database change goes in `docs/pending-migrations/` with a rollback file and a PGlite proof; it is run live only with Jo's OK (root `AGENTS.md`).
- Token env var: `MITTI_WEBHOOK_TOKEN`, passed as URL query `?t=`.
- No change to any rule: quote holds, matching, one-pile, quiet hours, `AUTO_QUOTE_SEND_ENABLED`. The 15-minute Mitti pull stays as is.
- TEST Reinsulate job only for live testing; no real owner contacted.
- Never log owner details; counts and ids only.

## Review Focus

1. Same job synced twice at once (notice + 15-min Mitti pull, or two notices for one Complete) → at most one quote draft and at most one owner release. Test in Task 4.
2. Notice for a cancelled/deleted/archived job → nothing happens (already handled inside `syncMittiAssessment`; pinned by a test in Task 2).
3. Body shape varies (`audit_id` at top level vs nested in `data`/`event`), or is not JSON → no crash, 200, nothing synced. Test in Task 1.
4. Mitti or the database is down during the notice → 200, error logged, tick retries. Test in Task 2.
5. Burst of notices while the installer types answers → each one is a cheap no-op once synced; no texts/emails per notice. Covered by Task 4 test (repeat calls send once).

---

### Task 1: Notice parsing and token check (pure)

**Files:**
- Create: `src/lib/mitti-webhook.core.ts`
- Test: `tests/mitti-webhook.core.test.ts`

**Interfaces:**
- Produces:
  - `mittiNoticeTokenOk(urlToken: string | null, envToken: string | undefined): boolean`
  - `mittiNoticeAuditId(raw: string): string | null`
  - `MITTI_NOTICE_EVENTS = ["audit.updated", "audit.completed"] as const`

- [ ] **Step 1: Write the failing tests**

```ts
import { expect, test } from "bun:test";
import { mittiNoticeTokenOk, mittiNoticeAuditId } from "@/lib/mitti-webhook.core";

test("token: missing env → false", () => expect(mittiNoticeTokenOk("abc", undefined)).toBe(false));
test("token: empty env → false", () => expect(mittiNoticeTokenOk("", "")).toBe(false));
test("token: mismatch → false", () => expect(mittiNoticeTokenOk("abc", "xyz")).toBe(false));
test("token: match → true", () => expect(mittiNoticeTokenOk("xyz", "xyz")).toBe(true));
test("audit id at top level", () => expect(mittiNoticeAuditId(JSON.stringify({ audit_id: "audit_1" }))).toBe("audit_1"));
test("audit id under data", () => expect(mittiNoticeAuditId(JSON.stringify({ data: { audit_id: "audit_2" } }))).toBe("audit_2"));
test("audit id under event.data", () => expect(mittiNoticeAuditId(JSON.stringify({ event: { data: { audit_id: "audit_3" } } }))).toBe("audit_3"));
test("not JSON → null", () => expect(mittiNoticeAuditId("<xml/>")).toBeNull());
test("no id → null", () => expect(mittiNoticeAuditId("{}")).toBeNull());
test("non-string id → null", () => expect(mittiNoticeAuditId(JSON.stringify({ audit_id: 7 }))).toBeNull());
```

- [ ] **Step 2: Run to verify fail** — `bun test tests/mitti-webhook.core.test.ts` → FAIL (module not found)
- [ ] **Step 3: Implement both functions in `src/lib/mitti-webhook.core.ts`** — token compare must be constant-time over equal-length strings; parse with try/catch; look for a string `audit_id` at `$`, `$.data`, `$.event.data` in that order.
- [ ] **Step 4: Run to verify pass** — same command → PASS
- [ ] **Step 5: Commit** — `git commit -m "feat: parse Mitti instant notices"`

### Task 2: Handle one notice (server)

**Files:**
- Create: `src/lib/mitti-webhook.server.ts`
- Create: `docs/pending-migrations/mitti-instant-notice-switch.sql` and `docs/pending-migrations/mitti-instant-notice-switch.rollback.sql`
- Test: `tests/mitti-instant-notice-switch.pglite.test.ts` (apply → column exists, default false; rollback → gone; re-run apply is safe)
- Test: `tests/mitti-webhook.server.test.ts` (fake `admin` + mocked `syncMittiAssessment`, same style as `tests/mitti-invite.server.test.ts`)

**Interfaces:**
- Consumes: `syncMittiAssessment(jobId: string, actorId: string | null)` from `src/lib/mitti.server.ts`
- Produces: `handleMittiNotice(auditId: string): Promise<{ action: "ignored" | "off" | "synced" | "failed" }>`

- [ ] **Step 1: Pending SQL + PGlite proof**

```sql
-- mitti-instant-notice-switch.sql
alter table public.workflow_settings add column if not exists mitti_instant_notice_enabled boolean not null default false;
-- mitti-instant-notice-switch.rollback.sql
alter table public.workflow_settings drop column if exists mitti_instant_notice_enabled;
```
Write the PGlite test using an existing helper in `tests/helpers/pglite-*.ts` that creates `workflow_settings`; run it → PASS. Add the column to `src/integrations/supabase/types.ts` (Row/Insert/Update of `workflow_settings`).

- [ ] **Step 2: Write the failing tests**
  - `unknown audit id → "ignored", sync not called`
  - `switch off (column false, row missing, or read error such as column not found) → "off", sync not called`
  - `audit on assessments.external_mitti_id, switch on → "synced", sync called once with (jobId, null)`
  - `audit only on current Mitti ceiling_measurements.external_id (is_current, external_source "mitti") → "synced"`
  - `sync throws → "failed", error logged, no throw`
  - `job deleted/archived → sync still called; returns "synced" (syncMittiAssessment's own closed-job guard does nothing)` — assert the mock was called and nothing else written
- [ ] **Step 3: Run to verify fail**
- [ ] **Step 4: Implement `handleMittiNotice`** — look up the switch first (one read), then `assessments` by `external_mitti_id`, then `ceiling_measurements` (`external_source = 'mitti'`, `is_current = true`, `external_id = auditId`). Log `console.error("mitti notice: sync failed", jobId, message)` on failure — ids only.
- [ ] **Step 5: Run to verify pass**
- [ ] **Step 6: Commit** — `git commit -m "feat: sync one job on a Mitti notice"`

### Task 3: Public route and switch on the Settings page

**Files:**
- Create: `src/routes/api/public/hooks/mitti-audit.ts`
- Modify: `src/lib/office-settings.core.ts` (`OFFICE_SWITCH_COLUMNS` + `SWITCHES`)
- Test: `tests/mitti-audit-route.test.ts`

**Interfaces:**
- Consumes: `mittiNoticeTokenOk`, `mittiNoticeAuditId` (Task 1); `handleMittiNotice` (Task 2)

- [ ] **Step 1: Write the failing tests** (call the route's POST handler directly)
  - `no ?t → 403, handler not called`
  - `wrong ?t → 403`
  - `good ?t, body without audit id → 200, handler not called`
  - `good ?t, valid body → 200, handler called once with the id`
  - `good ?t, handler returns "failed" → still 200`
- [ ] **Step 2: Run to verify fail**
- [ ] **Step 3: Implement the route** following `src/routes/api/public/twilio/inbound.ts` (token from `process.env["MITTI_WEBHOOK_TOKEN"]`, query `t`). Await `handleMittiNotice` (it never throws) and return `Response.json({ ok: true })`.
- [ ] **Step 4: Add the switch** — column `mitti_instant_notice_enabled`; entry `{ key: "mitti_instant", label: "Mitti instant updates", what: "Ready Check changes reach the portal within a minute (the 15-minute check stays as backup)", why: "Jo 27 Oct 2026", kind: "column", column: "mitti_instant_notice_enabled" }` placed right after `mitti_pickup`.
- [ ] **Step 5: Run route tests and `bun run test`** → PASS; `bun run build` → OK
- [ ] **Step 6: Commit** — `git commit -m "feat: Mitti instant notice route and switch"`

### Task 4: No double send when two syncs overlap

**Files:**
- Test: `tests/mitti-sync-overlap.test.ts`
- Modify (only if the test fails): `src/lib/mitti.server.ts` (`syncMittiAssessment`), new `src/lib/mitti-sync-claim.server.ts`

**Interfaces:**
- Consumes: `syncMittiAssessment` (existing)
- Produces (only if needed): `withMittiSyncClaim<T>(jobId: string, run: () => Promise<T>): Promise<T | { skipped: true }>`

- [ ] **Step 1: Write the test** — on the PGlite auto-quote helper (`tests/helpers/pglite-auto-quote-release.ts`), with a fake Mitti returning a Complete A1 form with all quote basics for a TEST job and `AUTO_QUOTE_SEND_ENABLED` on for the test: run `Promise.all([syncMittiAssessment(j, null), syncMittiAssessment(j, null)])`, then a third call; assert exactly **one** quote row for the job and `releaseQuoteToOwner` reached the sender **at most once**.
- [ ] **Step 2: Run it**
  - PASS → existing guards hold; commit the test only and skip Steps 3–4.
  - FAIL → continue.
- [ ] **Step 3: Implement `withMittiSyncClaim`** using the same atomic-claim pattern as `claimMittiCreate` in `src/lib/mitti-create.server.ts` (deterministic key `mitti_sync:<jobId>`, released in `finally`; a held claim returns `{ skipped: true }`). Wrap the body of `syncMittiAssessment` in it.
- [ ] **Step 4: Run the test and `bun run test`** → PASS
- [ ] **Step 5: Commit** — `git commit -m "test: one quote send when Mitti syncs overlap"`

### Task 5: Register the webhook with Mitti (developer script)

**Files:**
- Create: `scripts/register-mitti-webhook.ts`

- [ ] **Step 1: Write the script** — reads `MITTI_API_TOKEN`, `MITTI_WEBHOOK_TOKEN`, `PORTAL_PUBLIC_URL`; default is **dry run** (prints the request with the token masked); `--apply` sends `POST https://api.safetyculture.io/webhooks/v1` with `{ url: "<PORTAL_PUBLIC_URL>/api/public/hooks/mitti-audit?t=<token>", trigger_events: ["TRIGGER_EVENT_INSPECTION_UPDATED","TRIGGER_EVENT_INSPECTION_COMPLETED"] }` and prints the webhook id. Before `--apply`, confirm the exact body field and event names against Mitti's own developer docs and correct them in the script; the spec's `audit.updated` / `audit.completed` are the guide's names.
- [ ] **Step 2: Dry run** — `bun scripts/register-mitti-webhook.ts` → prints the masked request, sends nothing
- [ ] **Step 3: Commit** — `git commit -m "chore: script to register the Mitti instant notice"`

### Task 6: Live check on TEST (with Jo's OK)

- [ ] **Step 1:** Set `MITTI_WEBHOOK_TOKEN`, deploy, run Task 5 with `--apply`.
- [ ] **Step 2:** Turn on "Mitti instant updates" in Settings.
- [ ] **Step 3:** On the TEST Reinsulate job's Ready Check, change one answer in Mitti → within a minute the installer job page shows the change in "Needs finishing".
- [ ] **Step 4:** Tap Complete → "Needs finishing" clears within a minute; wait for the next 15-minute tick → no second quote.
- [ ] **Step 5:** Record the result in `docs/STATUS.md`; leave the switch on only if Jo says so.
