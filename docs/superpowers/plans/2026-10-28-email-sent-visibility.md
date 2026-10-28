# Seeing What Was Sent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jo's Emails-tab replies go out through info@ Outlook (so they show in Sent and thread), and every outgoing email on a job shows Sent / Delivered / Bounced / Not sent.

**Architecture:** A new Outlook transport (Graph create-reply → send, via the existing Lovable Outlook connector) is plugged into the existing guarded owner-email path so every safety check stays. Delivery results arrive two ways — a signed Resend webhook for automatic emails, and bounce notices picked out of the Outlook sync for Outlook replies — and land in new `delivery_result` columns that the contact history and office lists read. Existing `status` / `delivery_status` values are left untouched so nothing that counts "sent" breaks.

**Tech Stack:** TanStack Start (server routes in `src/routes/api/public/hooks`), Supabase (drizzle SQL migrations), Bun tests in `tests/` run with `bun run test`, Microsoft Graph v1.0 through `connector-gateway.lovable.dev/microsoft_outlook`, Resend through `connector-gateway.lovable.dev/resend`.

**Spec:** `docs/superpowers/specs/2026-10-28-email-sent-visibility-design.md`

## Global Constraints

- Only the two Emails-tab Send buttons change transport: `sendAiDraft` (via `sendJobEmailReply`) and `sendNoJobEmailReply`. Every automatic email keeps Resend.
- Wording, layout, sign-off "Cheers, the Home Insulation Victoria team" and unsubscribe link unchanged.
- All existing checks stay: customer emails switch, `testRecipientBoundary`, opt-outs/suppression, `qa_test` jobs only ever reach the test address, one website reply per person, no 8pm hold on manual sends.
- Outlook failure = nothing marked sent, draft kept, message exactly: `Not sent — Outlook couldn't send it. Try again.` No fallback to Resend.
- Original message missing in Outlook → send as a new Outlook email to the owner with the same subject.
- Status words exactly: `Sent`, `Delivered`, `Bounced`, `Not sent`. Bounce reason shown in plain words, e.g. `Email address doesn't exist`.
- Outlook requests use header `Prefer: IdType="ImmutableId"` (as `archiveOutlookMessage` does) so the message id survives the move to Sent Items.
- Never send to a real owner while testing. Never post `RESEND_WEBHOOK_SECRET` or connector keys in code or logs.
- Portal screens must look right on phone and computer.

## Review Focus

- Double-tap Send → exactly one Outlook email (the `customer_email_sends` reservation must be taken before the Outlook call). Test in Task 4.
- Outlook sync later reads our own reply from Sent Items → must not add a second history row. Test in Task 6.
- Webhook called with a bad/missing signature, an old timestamp, or a replayed event → 401 or no-op; unknown email id → 200 no-op. Tests in Task 2.
- Bounce notice for an owner who got two recent replies → marks the newest reply sent to that address before the notice, never an automatic email. Test in Task 3.
- Outlook accepted the email but saving the history row fails → still reported as sent (no resend), error logged. Test in Task 4.

---

### Task 1: Delivery result columns

**Files:**
- Create: `drizzle/migrations/0178_email_delivery_result.sql`
- Modify: `src/integrations/supabase/types.ts` (add the columns to both tables' Row/Insert/Update)

**Interfaces:**
- Produces: on `customer_email_sends` and `job_communications`: `delivery_result text null check (delivery_result in ('delivered','bounced'))`, `delivery_detail text null`, `delivery_at timestamptz null`; index on `job_communications(provider_message_id)` and `customer_email_sends(provider_message_id)` where not null.

- [ ] **Step 1:** Write the migration (additive only, `if not exists`).
- [ ] **Step 2:** Apply to the practice database used by `*-practice-db.test.ts` and run `bun run test` — Expected: no new failures.
- [ ] **Step 3:** Commit `feat(email): delivery result columns`.

### Task 2: Resend delivery updates (webhook)

**Files:**
- Create: `src/lib/email-delivery.core.ts`, `src/lib/email-delivery.server.ts`, `src/routes/api/public/hooks/resend-delivery.ts`
- Test: `tests/email-delivery.core.test.ts`, `tests/resend-delivery-hook.test.ts`

**Interfaces:**
- Produces (core):
  - `verifyResendSignature(raw: string, headers: { id: string|null; timestamp: string|null; signature: string|null }, secret: string, nowMs: number): boolean` — Svix scheme: HMAC-SHA256 of `${id}.${timestamp}.${raw}` with base64 secret after `whsec_`; any `v1,` signature may match; reject if timestamp more than 300 s from now.
  - `resendEventResult(evt: { type: string; data?: { email_id?: string; bounce?: { message?: string; subType?: string } } }): { emailId: string; result: "delivered"|"bounced"; detail: string|null } | null` — `email.delivered` → delivered; `email.bounced` → bounced; anything else → null.
  - `bounceWords(raw: string|null): string` — plain reason: mailbox missing/user unknown/does not exist → `Email address doesn't exist`; mailbox full → `Their inbox is full`; else `Their email provider refused it`.
- Produces (server): `applyDeliveryResult(p: { providerMessageId: string; result: "delivered"|"bounced"; detail: string|null; at: string }): Promise<number>` — updates matching rows in both tables; never overwrites `bounced` with `delivered`; returns rows changed.
- Route: `POST /api/public/hooks/resend-delivery` → 401 if secret missing or signature bad; 200 otherwise (including unknown ids and ignored types).

- [ ] **Step 1: Failing tests** — `verifyResendSignature` true for a signed sample, false for tampered body, wrong secret, timestamp 301 s old; `resendEventResult` maps both types and returns null for `email.opened`; `bounceWords("550 5.1.1 User unknown") === "Email address doesn't exist"`; hook returns 401 unsigned, 200 + one row updated for a signed `email.bounced`, 200 + zero rows for unknown id, and a second identical event changes nothing.
- [ ] **Step 2:** Run `bun test tests/email-delivery.core.test.ts tests/resend-delivery-hook.test.ts` — Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement following the `stripe-payments.ts` route pattern (raw body, quick answer).
- [ ] **Step 4:** Run the same command — Expected: PASS.
- [ ] **Step 5: Setup** — add secret `RESEND_WEBHOOK_SECRET` in Lovable; create the Resend webhook for `email.delivered` and `email.bounced` pointing at the route (via Resend API through the connector gateway; if the gateway refuses, stop and ask Jo to add it in the Resend dashboard).
- [ ] **Step 6:** Commit `feat(email): resend delivery updates`.

### Task 3: Spot and match Outlook bounce notices (pure logic)

**Files:**
- Modify: `src/lib/email-delivery.core.ts`
- Test: `tests/email-delivery.core.test.ts`

**Interfaces:**
- Consumes: `MailMessage` from `src/lib/outlook-correspondence.core.ts`.
- Produces:
  - `isBounceNotice(m: MailMessage): boolean` — inbound, and from matches `mailer-daemon|postmaster|microsoftexchange` or subject starts `Undeliverable:` / `Delivery Status Notification (Failure)` / `Mail delivery failed`.
  - `bouncedAddress(m: MailMessage): string | null` — first email address in the body that is not ours (`OUR_DOMAINS`) and not the sender.
  - `matchBounce(notice: { address: string; at: string; subject: string|null }, sent: { id: string; to: string; subject: string|null; sentAt: string }[]): string | null` — candidates sent to that address via Outlook within 7 days before the notice; prefer one whose subject is contained in the notice subject; else newest; else null.

- [ ] **Step 1: Failing tests** — Exchange "Undeliverable: RE: your quote" notice detected; an owner's "Out of office" not detected; `bouncedAddress` returns `owner@example.com` and skips `info@homeinsulationvictoria.com.au`; with two replies to the same address picks the subject match, else the newest; reply 8 days old → null; different address → null.
- [ ] **Step 2:** Run `bun test tests/email-delivery.core.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5:** Commit `feat(email): bounce notice matching`.

### Task 4: Outlook transport inside the guarded send

**Files:**
- Create: `src/lib/outlook-send.server.ts`
- Modify: `src/lib/owner-email-send.server.ts`
- Test: `tests/outlook-send.test.ts`, `tests/owner-email-send-outlook.test.ts`

**Interfaces:**
- Produces:
  - `outlookSendAllowed(): Promise<{ ok: true } | { ok: false; detail: string }>` — creates and deletes a draft in the info@ mailbox; 403 → `{ ok: false, detail: "Outlook is connected for reading only. Reconnect it in Lovable to allow sending." }`.
  - `sendViaOutlook(p: { replyToMessageId: string|null; to: string; subject: string; html: string }): Promise<{ outcome: "sent"; messageId: string; internetMessageId: string|null } | { outcome: "failed"; detail: string }>` — if `replyToMessageId` and it exists: `POST …/messages/{id}/createReply` → `PATCH` the draft (`body` html, `toRecipients` = `to` only, `subject`) → `POST …/messages/{draftId}/send`. If 404 on createReply or id null: `POST …/messages` new draft then send. Uses `outlookGatewayUrl`, `outlookMailboxPath`, `OUTLOOK_REQUEST_REDIRECT`, mailbox from `readOutlookSyncState().expected_mailbox`, ImmutableId header.
  - `sendGuardedOwnerEmail` gains optional `transport?: "resend" | { kind: "outlook"; replyToMessageId: string|null }` (default `"resend"`). For Outlook: same reservation and checks; on success sets `customer_email_sends.status = "sent"`, `provider = "outlook"`, `provider_message_id = messageId`; on failure `status = "failed"` and returns `failed: Outlook couldn't send it`. Return type unchanged (`Promise<string>`), plus it exposes the Outlook ids through a new optional `onSent?: (r: { provider: "outlook"|"resend"; messageId: string|null; internetMessageId: string|null }) => void`.

- [ ] **Step 1: Failing tests** (`fetch` mocked) — reply path calls createReply → PATCH → send in order with ImmutableId header; createReply 404 → new-message path; send 5xx → `failed`; 403 on the permission check → read-only detail; guarded send with Outlook transport: opted-out job → `blocked — not sent` and no fetch; second call with same key → `already attempted — not resent` and no second fetch; QA route sends to the test address.
- [ ] **Step 2:** Run `bun test tests/outlook-send.test.ts tests/owner-email-send-outlook.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run, plus `bun test tests/emails-tab.test.ts` — Expected: PASS, no regressions in existing Resend behaviour.
- [ ] **Step 5:** Commit `feat(email): outlook transport for guarded owner emails`.

### Task 5: Emails-tab Send buttons use Outlook

**Files:**
- Modify: `src/lib/ai-email-reply.server.ts:160-197` (`sendAiDraft`), `src/lib/emails-tab.server.ts:151-192` (`sendNoJobEmailReply`)
- Test: `tests/emails-tab-outlook-send.test.ts`

**Interfaces:**
- Consumes: Task 4 `sendGuardedOwnerEmail({ …, transport: { kind: "outlook", replyToMessageId } , onSent })`, `sendViaOutlook`.

Rules:
- `sendAiDraft`: `replyToMessageId = ev.details["message_id"]`. Both real and `qa_test` jobs go through the guarded Outlook send (the guard already routes `qa_test` to the test address — remove the `sendTestEmail` branch only if Task 4's QA test proves it). History row: `provider: "outlook"`, `provider_message_id: messageId`, `source_reference: internetMessageId ?? eventId` (keep `eventId` in `details` of the workflow event). Failure → throw `Not sent — Outlook couldn't send it. Try again.` and keep the draft.
- `sendNoJobEmailReply`: replace `resendSend` with `sendViaOutlook({ replyToMessageId: ev.details["message_id"], … })`. Keep the claim-first insert; on Outlook failure throw the same message. (The claim stays, as today; Jo replies in Outlook.)
- Unsubscribe link: still built into the body as today.

- [ ] **Step 1: Failing tests** — job reply success writes one history row with provider `outlook` and the Outlook id, archives the original; Outlook failure throws the exact message, writes no sent event and no history row, draft still `waiting`; no-job reply calls Outlook with the original message id; recording failure after a successful send still returns `sent`.
- [ ] **Step 2:** Run `bun test tests/emails-tab-outlook-send.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run, plus `bun test tests/emails-tab.test.ts tests/ai-email-reply.core.test.ts` — Expected: PASS.
- [ ] **Step 5:** Commit `feat(email): emails tab replies send through outlook`.

### Task 6: Outlook sync — no duplicates, record bounces

**Files:**
- Modify: `src/lib/outlook-sync.server.ts` (`processMessages`, before the `isHumanOwnerEmail` filter)
- Test: `tests/outlook-sync-bounce.test.ts`

**Interfaces:**
- Consumes: Task 3 `isBounceNotice`, `bouncedAddress`, `matchBounce`; Task 2 `applyDeliveryResult`; existing `archiveOutlookMessage`.

Rules:
- For each normalised message where `isBounceNotice`: load outbound `job_communications` with `provider = 'outlook'` and `source_event in ('email_ai_draft_sent')` sent in the last 7 days to that address; `matchBounce`; on a match call `applyDeliveryResult({ providerMessageId, result: "bounced", detail: bounceWords(body) })` and `archiveOutlookMessage(noticeId, jobId, null)`. No match → leave it alone.
- Our own reply read back from Sent Items must be skipped because its `provider_message_id` already exists — confirm the existing identity check does this; add the check if not.

- [ ] **Step 1: Failing tests** — a bounce notice for a reply sent yesterday marks that row `bounced` with `Email address doesn't exist` and archives the notice; an unmatched notice is not archived and changes nothing; syncing our sent reply (same immutable id) adds no second row.
- [ ] **Step 2:** Run `bun test tests/outlook-sync-bounce.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run, plus `bun test tests/outlook-correspondence.test.ts tests/outlook-recovery.test.ts` — Expected: PASS.
- [ ] **Step 5:** Commit `feat(email): outlook bounces marked on the job`.

### Task 7: Contact history shows the real status

**Files:**
- Modify: `src/lib/contact-history.core.ts`, `src/lib/office-job-page.server.ts:19-35` (select the new columns), `src/components/portal/office-job.tsx:281-310`
- Test: `tests/contact-history.test.ts`

Rules:
- `CommRow` and `EmailSendRow` gain `delivery_result`, `delivery_detail`.
- Status: `bounced` → `Bounced` (failed, red, `what` gets ` — {delivery_detail}`); `delivered` → `Delivered`; sent with no result → `Sent`; failed/blocked → `Not sent`.
- Outlook emails (both ways) show under the existing `Email` chip; the separate `Outlook` chip is removed from `CONTACT_CHANNELS`. (The filter chips already exist — no new filter needed.)

- [ ] **Step 1: Failing tests** — row with `delivery_result: "bounced"` → status `Bounced`, `failed: true`, reason in `what`; `delivered` → `Delivered`; Outlook reply → channel `Email`; `blocked_prelaunch` → `Not sent`; `CONTACT_CHANNELS` has no `Outlook`.
- [ ] **Step 2:** Run `bun test tests/contact-history.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — Expected: PASS. Then look at a test job page at phone and computer widths.
- [ ] **Step 5:** Commit `feat(email): contact history delivery status`.

### Task 8: "Email bounced" tag on Enquiries and Active jobs

**Files:**
- Modify: `src/lib/office-lists.server.ts` (`EnquiryListRow`, `JobsListRow`, their loaders), the list components that render them, `src/lib/office-job-page.server.ts` / `office-job.tsx` (Clear button)
- Create: event constant `EMAIL_BOUNCE_CLEARED_EVENT = "email_bounce_cleared"` in `src/lib/email-delivery.core.ts`
- Test: `tests/email-bounced-tag.test.ts`

**Interfaces:**
- Produces: `emailBounced: boolean` on both row types; core `emailBouncedNow(sends: { at: string; result: "delivered"|"bounced"|null }[], clearedAt: string|null): boolean` — true when the newest email with a result is `bounced`, it is newer than `clearedAt`, and no later email is `delivered`. Server action `clearEmailBounce(jobId, actorId)` writes the event.

- [ ] **Step 1: Failing tests** — bounced then nothing → true; bounced then delivered → false; bounced then cleared → false; bounced after an earlier clear → true.
- [ ] **Step 2:** Run `bun test tests/email-bounced-tag.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement; red tag text `Email bounced`; Clear button on the job's contact history.
- [ ] **Step 4:** Run — Expected: PASS. Then `bun run test` (full suite) — Expected: no new failures.
- [ ] **Step 5:** Commit `feat(email): email bounced tag`.

### Task 9: Live check on a test job

No code. Real owners must not receive anything.

- [ ] **Step 1:** `outlookSendAllowed()` returns ok. If not, stop and ask Jo to reconnect Outlook in Lovable.
- [ ] **Step 2:** On a `qa_test` job, send an Emails-tab reply. Expected: email in info@ Sent; job history shows it under Email as `Sent`.
- [ ] **Step 3:** Send a reply on a test job to a made-up address on the test domain. Expected: within one sync, history shows `Bounced` + reason, notice archived, tag on the list.
- [ ] **Step 4:** Trigger one automatic email to the test address. Expected: history shows `Delivered` within a few minutes.
- [ ] **Step 5:** Turn Outlook off for the test (bad mailbox) and send. Expected: `Not sent — Outlook couldn't send it. Try again.`, draft kept.
- [ ] **Step 6:** Report results to Jo in plain words with screenshots.
