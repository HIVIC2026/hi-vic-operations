# Quick taps by email + "who lets the installer in" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners get the quick taps message (and its day-2 reminder) by email as well as text, and the quick taps ask who will let the installer in (owner, or tenant with name + mobile), shown to the installer and office.

**Architecture:** A pure email renderer beside the existing quick taps decline emails; `area-batch.server.ts` gains `emailOwner` next to `textOwner`, called independently on Send and on the day-2 sweep. The access answer is a new optional field on `QuickTapAnswers`, a new step before "go", saved on the existing `quick_taps_answered` event and read back for the installer and office job pages.

**Tech Stack:** TypeScript, TanStack Start server functions, Supabase, MJML email kit, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-11-02-quick-taps-email-and-access-design.md`

## Global Constraints

- Read `AGENTS.md`, `src/AGENTS.md` and `src/lib/AGENTS.md` before editing; run `bun scripts/scan-retired-terms.ts` before workflow work.
- Email copy is verbatim from the spec:
  - First: subject `It's almost time for your free Ready Check`; line `Hi {first}, great news - it's almost time for your free Ready Check! Please confirm a few quick details for your quote.`
  - Reminder: subject `Just a reminder - confirm your details`; line `Hi {first}, just a reminder - please confirm a few quick details so we can book your free Ready Check.`
  - Button `Confirm my details`; sign-off `Home Insulation Victoria`; no first name → `Hi there,` style greeting (`Hi there, great news - …`).
- Access copy verbatim: question `Who will be at the home to let the installer in?`; options `Me` / `My tenant`; tenant fields `Tenant's name`, `Tenant's mobile`.
- Real owner emails only through `sendGuardedOwnerEmail`; TEST jobs only through `sendTestEmail`. No new SMS types, no change to text wording.
- Email key: `quick-taps-email:v1:{batchId}:{jobId}:{step}`; purpose `quick_taps:{step}` (`step` = `sent` | `reminder`).
- The tenant is never texted or emailed. No DB migration (answers live in the existing event `details`).
- Any greyed-out button says what's needed. Server functions follow the literal `createServerFn(...).middleware(...).inputValidator(...).handler(...)` chain.
- Nothing is published or merged: open a pull request and stop.

## Review Focus

- Owner email is blank/whitespace or obviously invalid → Send still texts and reports email "no email on file", batch still sent (Task 2).
- Email sender throws (Resend down) → text result unaffected, batch not rolled back, error shown (Task 2).
- Sweep runs twice on the reminder tick → reminder email sent once (same key) (Task 2).
- Tenant mobile typed with spaces/+61 (`+61 412 345 678`, `0412 345 678`) → accepted and stored as `+61412345678`; landline `03 9123 4567` → refused with a reason (Task 3).
- Owner answered quick taps before this change (no `access` on the event) → installer/office pages show nothing, never "undefined" (Task 5).

---

### Task 1: Quick taps email renderer + Template hub

**Files:**
- Modify: `src/lib/quick-taps-email.core.ts`
- Modify: `src/lib/template-hub.core.ts` (two `ENTRY`s next to `owner:O77`)
- Test: `tests/quick-taps-email.test.ts` (create)

**Interfaces:**
- Produces: `QUICK_TAPS_EMAIL_SUBJECT`, `QUICK_TAPS_REMINDER_EMAIL_SUBJECT`, `QUICK_TAPS_EMAIL_BUTTON = "Confirm my details"`, `renderQuickTapsEmail(i: { firstName: string | null; link: string; unsubscribeUrl: string | null; reminder: boolean; test?: boolean }): { subject: string; html: string; text: string }`.

- [ ] **Step 1: Write failing tests** — `renderQuickTapsEmail`:
  - `{ firstName: "Dev Govekar", reminder: false }` → `subject === "It's almost time for your free Ready Check"`; `text` contains `Hi Dev, great news - it's almost time for your free Ready Check! Please confirm a few quick details for your quote.`, `Confirm my details: {link}`, `Home Insulation Victoria`; `html` contains `href="{link}"` and the unsubscribe URL.
  - `reminder: true` → subject `Just a reminder - confirm your details`; text contains `Hi Dev, just a reminder - please confirm a few quick details so we can book your free Ready Check.`
  - `firstName: null` → text starts `Hi there, great news`.
  - Template hub: entries `owner:quick-taps-email` and `owner:quick-taps-reminder-email` exist, `kind: "email"`, `approvalNote` contains `Jo 2 Nov 2026`, and their `render()` succeeds.
- [ ] **Step 2: Run** `bun test tests/quick-taps-email.test.ts` — expect FAIL (export missing).
- [ ] **Step 3: Implement** in `quick-taps-email.core.ts`, built like `renderSpotReleasedEmail` (MJML kit `mjEmail`, `K.plainText`, unsubscribe footer); add the two hub `ENTRY`s (`section: "owner"`, `step: "ready_check"`, `when: "Jo presses Send on Jobs › Choose installer (and the day-2 reminder), with the quick taps text"`, `source.sender: "src/lib/area-batch.server.ts"`).
- [ ] **Step 4: Run** the test file and `bun test tests/template-hub*` — expect PASS.
- [ ] **Step 5: Commit** `feat: quick taps email and reminder email (Jo 2 Nov)`.

### Task 2: Send the email on Send and on the day-2 reminder

**Files:**
- Modify: `src/lib/area-batch.server.ts` (`TextTo` → add `email`; `batchCandidates` select `owners(full_name, phone, email)`; `sendBatch`; sweep reminder at ~line 438)
- Modify: `src/components/portal/choose-installer.tsx` (show email result)
- Test: `tests/a48-b2-send.test.ts`, `tests/a48-b2-batch-sweep.test.ts`

**Interfaces:**
- Consumes: `renderQuickTapsEmail` (Task 1).
- Produces: `SendBatchResult.texts[i].email: { status: string; detail: string }`; internal `emailOwner(h: TextTo, batchId: string, myJobLink: string, businessId: string | null, actorId: string | null, step: "sent" | "reminder"): Promise<{ status: string; detail: string }>` (status `sent` | `no_email` | `blocked` | `already` | `failed`).

- [ ] **Step 1: Write failing tests** (fake DB + recorded senders, as the existing files do):
  - `sendBatch emails and texts each home`: 2 homes with emails → 2 texts and 2 guarded emails, each email key `quick-taps-email:v1:{batch}:{job}:sent`, subject `It's almost time for your free Ready Check`, link = the quick taps link in the text.
  - `no email on file → text only`: owner email `null` and `"  "` → text sent, `email.status === "no_email"`, no email call.
  - `email throw does not stop the text or batch`: email sender throws → text `sent`, `email.status === "failed"` with detail, `area_batch_sent` events stay.
  - `opted-out owner gets no email`: guarded sender returns `blocked — not sent` → `email.status === "blocked"`.
  - `TEST home → sendTestEmail only`.
  - Sweep: `day-2 reminder sends reminder email once` — run the sweep twice on the reminder tick → one reminder email (key `…:reminder`, subject `Just a reminder - confirm your details`) and one reminder text.
- [ ] **Step 2: Run** `bun test tests/a48-b2-send.test.ts tests/a48-b2-batch-sweep.test.ts` — expect the new tests FAIL.
- [ ] **Step 3: Implement** `emailOwner` beside `textOwner`; in `sendBatch`'s `send` and in the sweep reminder, call text and email each in their own `try/catch` (email first-name via `firstName` from `worker-links.core`). Choose installer: after Send, show per home "Text: {status}" and "Email: {status}" (plain words: sent / no email on file / not sent — unsubscribed / didn't go — {detail}); update the two "each owner gets a text" lines to "a text and an email".
- [ ] **Step 4: Run** the two test files plus `bun test tests/a48-b2-*` — expect PASS.
- [ ] **Step 5: Commit** `feat: quick taps go by email too, incl. day-2 reminder`.

### Task 3: The access question (pure rules)

**Files:**
- Modify: `src/lib/quick-taps.core.ts`
- Test: `tests/a48-b2-quick-taps.test.ts`

**Interfaces:**
- Produces: `type Access = { who: "owner" } | { who: "tenant"; name: string; mobile: string }`; `QuickTapAnswers.access?: Access`; `TapStep` gains `"access"`; `QUICK_TAPS_COPY.access = { question, options: [{value:"owner",label:"Me"},{value:"tenant",label:"My tenant"}], tenantName: "Tenant's name", tenantMobile: "Tenant's mobile", needBoth: "Add your tenant's name and mobile so the installer can call them" }`; `normaliseAuMobile(v: string): string | null` (returns `+614XXXXXXXX` or null); `validAccess(a: Access | undefined): boolean`; `accessLine(a: Access | undefined | null): string | null` → `"At the home: owner"` / `"At the home: tenant — {name}, {mobile}"` / `null`.

- [ ] **Step 1: Write failing tests**:
  - `nextTapStep` with name/address/hatch/roof/five_years answered and no website blanks → `"access"`; with `access` valid → `"go"`; with a website blank left, the order is `five_years` → website blank → `access` → `go` (assert that order).
  - `tapOutcome` with `go: "yes"` and no `access` → `"incomplete"`; with `{who:"owner"}` → `"pass"`; declines (`hatch:"no"`, `five_years:"yes"`, `go:"no_thanks"`) unchanged with or without access.
  - `normaliseAuMobile`: `"0412 345 678"` and `"+61 412 345 678"` → `"+61412345678"`; `"03 9123 4567"`, `"0412"` → `null`.
  - `validAccess({who:"tenant", name:" ", mobile:"0412345678"})` → false; name `"Sam Lee"` + that mobile → true.
  - `accessLine` cases above, incl. `undefined` → `null`.
  - Exact copy: `QUICK_TAPS_COPY.access.question === "Who will be at the home to let the installer in?"`.
- [ ] **Step 2: Run** `bun test tests/a48-b2-quick-taps.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** in `quick-taps.core.ts` (no I/O); `tapOutcome` returns `"pass"` only when `validAccess(a.access)`.
- [ ] **Step 4: Run** the file — expect PASS (existing tests updated only where a pass now needs `access`).
- [ ] **Step 5: Commit** `feat: quick taps ask who will let the installer in`.

### Task 4: Save the access answer + the My job screen

**Files:**
- Modify: `src/lib/quick-taps.server.ts` (`saveQuickTaps` input validation + event details)
- Modify: `src/lib/quick-taps.functions.ts` (input validator accepts `access`)
- Modify: `src/routes/my-job.$token.tsx` (`TapsScreen` access step)
- Test: `tests/a48-b2-quick-taps.test.ts`

**Interfaces:**
- Consumes: `Access`, `validAccess`, `normaliseAuMobile`, `QUICK_TAPS_COPY.access` (Task 3).
- Produces: `quick_taps_answered.details.answers.access` holding the normalised `Access` (tenant mobile as `+61…`, name trimmed).

- [ ] **Step 1: Write failing tests**: saving a pass with `{who:"tenant", name:" Sam Lee ", mobile:"0412 345 678"}` stores `{who:"tenant", name:"Sam Lee", mobile:"+61412345678"}` on the event; a pass with an invalid tenant mobile is refused (`retry`/error, nothing saved); no message is sent to the tenant number (recorded SMS/email senders untouched by it).
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** server validation/normalising; My job screen: two big buttons (`Me`, `My tenant`); `My tenant` shows the two fields and a Next button disabled until `validAccess`, with `needBoth` shown under it while disabled.
- [ ] **Step 4: Run** the file + `bun test tests/a48-b2-*` — expect PASS.
- [ ] **Step 5: Commit** `feat: save who lets the installer in from the quick taps`.

### Task 5: Show it to the installer and the office

**Files:**
- Modify: `src/lib/job-status.server.ts` (add `access: string | null` to the status payload, read from the newest `quick_taps_answered` event)
- Modify: `src/routes/_authenticated/field.$jobId.tsx` (under the owner Call/Text buttons, only when `showOwnerContact`)
- Modify: `src/routes/_authenticated/admin.jobs.$jobId.tsx` (owner contact area)
- Test: `tests/quick-taps-access-view.test.ts` (create)

**Interfaces:**
- Consumes: `accessLine` (Task 3).
- Produces: status payload `access: string | null`.

- [ ] **Step 1: Write failing tests**: job with a tenant answer → payload `access === "At the home: tenant — Sam Lee, +61412345678"`; owner answer → `"At the home: owner"`; old event without `access`, or no event → `null`; two answers → the newest wins.
- [ ] **Step 2: Run** `bun test tests/quick-taps-access-view.test.ts` — expect FAIL.
- [ ] **Step 3: Implement**; installer page shows the line plus a `Call tenant` (`tel:`) link for a tenant, hidden whenever owner contact is hidden; office job page shows the same line.
- [ ] **Step 4: Run** the file — expect PASS.
- [ ] **Step 5: Commit** `feat: installer and office see who lets the installer in`.

### Task 6: Whole-branch checks and pull request

- [ ] **Step 1:** `bun scripts/scan-retired-terms.ts`, `bunx tsc --noEmit`, `bun run lint`, `bun run test` — all clean.
- [ ] **Step 2:** Push the branch `quick-taps-email-and-access` and open a pull request (body per the repo's PR shape; ends with the session attribution). Stop — do not merge or publish.
