# Full Address Required Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every enquiry has a full street address: the website only accepts a picked address, and the portal holds no-street enquiries and asks the owner for their address.

**Architecture:** Website: a small pure rule decides whether the address step can move on, and the autocomplete reports when an address was picked. Portal: a pure core decides when a job needs the address request, reminder or nothing; a server sweep on the 15-minute tick sends them; Save my spot's `sendOne` refuses jobs with an open request; a public token page lets the owner pick their address and saves it through `saveEnquiryDetails`.

**Tech Stack:** Base44 (React/Vite, `node --test`); Lovable portal (TanStack Start, Supabase, `bun test`).

**Spec:** `docs/superpowers/specs/2026-10-28-full-address-required-design.md`

## Global Constraints

- Website error copy, exactly: "Please choose your address from the list."
- Owner message copy starts: "We need your full address to check your home." Wording is shown to Jo before it goes live (`wordingApproved: false` until she approves).
- Reminder: exactly one, 24 hours after the first message. Nothing after that.
- Save my spot block reason, exactly: "Waiting for the owner's full address"
- No texts 8pm–7am (use `quietHours: true`). Customer emails master switch, opt-outs and TEST-job rules unchanged (use the existing guarded senders, never a raw provider call).
- "No street" = `parseStreet(addressLine) === null` from `src/lib/address-complete.core.ts`.
- Only new website/email enquiries created after go-live. Jobs created before go-live (incl. HV-3542) and installer "Add a job" jobs are untouched.

## Review Focus

- Owner picks, then edits the text by hand → must pick again (Task 1 test).
- An enquiry that arrives with a street but no suburb → not this feature; the existing address completion handles it (Task 2 test).
- Owner opens the link after already answering → page says the address is saved, nothing saved twice (Task 5 test).
- Owner picks a non-Victorian address on the page → refused with the existing "must be a Victorian postcode" error (Task 5 test).
- Request due at 9pm → email goes now, text goes at 7am, still counted as one request (Task 4 test).

---

### Task 1: Website — only a picked address passes

**Files:**
- Create: `src/lib/address-pick.js` (Base44 app `6ab0c47ee6cd14456bf15362`)
- Modify: `src/components/homeowner/AddressAutocomplete.jsx` (`select` at line 62, `handleInput` at line 95)
- Modify: `src/pages/Homeowner.jsx:139-141`
- Test: `tests/address-pick.test.mjs`

**Interfaces:**
- Produces: `addressStepError(address: string, picked: boolean): string | null` and `ADDRESS_PICK_ERROR = "Please choose your address from the list."`; new prop `onPickedChange(picked: boolean)` on `AddressAutocomplete`.

- [ ] **Step 1: Write the failing test** `tests/address-pick.test.mjs` (node:test):
  - `addressStepError("Brighton VIC 3186", false) === ADDRESS_PICK_ERROR`
  - `addressStepError("12 Wattle Street, Clayton VIC", false) === ADDRESS_PICK_ERROR`
  - `addressStepError("12 Wattle Street, Clayton VIC", true) === null`
  - `addressStepError("", true) === ADDRESS_PICK_ERROR`
- [ ] **Step 2: Run** `node --test tests/address-pick.test.mjs` — expect FAIL (module not found).
- [ ] **Step 3: Implement** `src/lib/address-pick.js`; in `AddressAutocomplete` call `onPickedChange(true)` after a successful `select`, `onPickedChange(false)` in `handleInput`; in `Homeowner.jsx` keep `addressPicked` state, pass `onPickedChange`, and replace the 8-character check with `addressStepError(answers.address, addressPicked)`.
- [ ] **Step 4: Run** `node --test tests/` — expect all PASS (existing homeowner tests still pass; update their fixtures only if they drive the address step without a pick).
- [ ] **Step 5: Checkpoint** with `create_checkpoint` ("Address must be picked from list").

### Task 2: Portal core — when to ask

**Files:**
- Create: `src/lib/address-request.core.ts`
- Test: `tests/address-request.test.ts`

**Interfaces:**
- Produces:
  - `ADDRESS_REQUEST_SENT_EVENT = "address_request_sent"`, `ADDRESS_REQUEST_REMINDER_EVENT = "address_request_reminder_sent"`, `ADDRESS_REQUEST_ANSWERED_EVENT = "address_request_answered"`, `ADDRESS_REQUEST_REMINDER_HOURS = 24`, `ADDRESS_REQUEST_BLOCK_REASON = "Waiting for the owner's full address"`
  - `type AddressRequestFacts = { addressLine: string | null; source: string | null; channel: string | null; createdAt: string; goLiveAt: string; sentAt: string | null; reminderAt: string | null; answeredAt: string | null }`
  - `addressRequestOpen(f: AddressRequestFacts): boolean` — no street, website/email enquiry (`source` in `base44 | email`, `channel === "hivic_sourced"`), created at/after `goLiveAt`, not answered.
  - `addressRequestStep(f: AddressRequestFacts, now: number): "send" | "remind" | "none"`

- [ ] **Step 1: Write failing tests:**
  - "Brighton VIC 3186", base44, after go-live, nothing sent → open, step `send`.
  - same, sent 23h ago → `none`; sent 24h ago → `remind`; reminded → `none`; answered → not open, `none`.
  - "12 Wattle St" → not open.
  - created before go-live → not open.
  - `source: "portal"` installer job → not open.
- [ ] **Step 2: Run** `bun test tests/address-request.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** using `parseStreet`.
- [ ] **Step 4: Run** the same — expect PASS.
- [ ] **Step 5: Commit** `feat: address request rules (no-street enquiries)`.

### Task 3: Portal — Save my spot refuses open requests

**Files:**
- Create: `src/lib/address-request.server.ts` (facts reader only in this task)
- Modify: `src/lib/hot-leads-send.server.ts` (`sendOne`, line 94, beside the existing blocks, before any provider call)
- Test: `tests/address-request-save-spot.test.ts`

**Interfaces:**
- Consumes: Task 2.
- Produces: `loadAddressRequestFacts(jobId: string): Promise<AddressRequestFacts | null>` (reads job, property `address_line`, and the three workflow events; `goLiveAt` from `workflow_settings.address_request_live_at`, null = feature off → `addressRequestOpen` false).

- [ ] **Step 1: Write failing tests** (in-memory DB, as in `tests/address-complete.test.ts`): a no-street base44 job created after go-live → `sendSaveMySpot` returns `outcome: "blocked"`, `detail: ADDRESS_REQUEST_BLOCK_REASON`, no email row; the same job after an `address_request_answered` event with a street → not blocked by this rule.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** the reader and the block; add pending migration `docs/pending-migrations/address-request-live-at.sql` adding nullable `workflow_settings.address_request_live_at timestamptz`.
- [ ] **Step 4: Run** `bun test tests/address-request-save-spot.test.ts` and `bun test tests/email-preliminary-save-spot.test.ts` — expect PASS.
- [ ] **Step 5: Commit** `feat: hold Save my spot until the owner gives a full address`.

### Task 4: Portal — send the request and one reminder

**Files:**
- Modify: `src/lib/address-request.server.ts` (add sweep)
- Modify: `src/lib/sms.core.ts` (two new types)
- Modify: `src/routes/api/public/hooks/allocation-tick.ts` (call the sweep, same `timed` pattern)
- Test: `tests/address-request-send.test.ts`

**Interfaces:**
- Consumes: Tasks 2–3; `sendGuardedOwnerEmail` (`owner-email-send.server.ts:10`); `sendRealSms` (`sms.server.ts:70`); `ensureOwnerLink` / token from `estimatelink.server.ts`.
- Produces: `sweepAddressRequests(now?: number): Promise<{ sent: number; reminded: number }>`; SMS types `address_request` and `address_request_reminder` (`audience: "owner"`, `wordingApproved: false`, `quietHours: true`); link path `/my-address/{token}`.

- [ ] **Step 1: Write failing tests:** open job → one email (purpose `address_request`, key `address-request:v1:{jobId}`) + one text, event `address_request_sent`; second sweep → nothing; 24h later → one reminder each (key `address-request-reminder:v1:{jobId}`), event logged; 48h later → nothing; sweep at 9pm Melbourne → email sent, text held for 7am (existing quiet-hours path), event logged once; TEST job → test inbox only.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** the sweep (batch 50, oldest first) and wire it into the tick.
- [ ] **Step 4: Run** `bun test tests/address-request-send.test.ts` — expect PASS.
- [ ] **Step 5: Commit** `feat: ask owners for their full address (one reminder at 24h)`.

### Task 5: Portal — owner page to pick the address

**Files:**
- Create: `src/routes/my-address.$token.tsx`
- Create: `src/lib/address-request.functions.ts`
- Test: `tests/address-request-page.test.ts`

**Interfaces:**
- Consumes: `searchAddressSuggestions`, `lookupAddressDetails` (`address-lookup.server.ts`); `saveEnquiryDetails(jobId, null, { fullName, street, suburb, postcode }, { type: ADDRESS_REQUEST_ANSWERED_EVENT })` (`office-actions.server.ts:166`); token resolution as `resolvePublicEstimate`.
- Produces: server fns `searchOwnerAddress({ token, query })` and `saveOwnerAddress({ token, placeId }) → { ok: true } | { ok: false; error: string }`.

- [ ] **Step 1: Write failing tests:** valid token + Victorian pick → address saved, `address_request_answered` logged, `addressRequestOpen` now false; NSW pick → `{ ok: false, error: "The postcode must be a Victorian postcode." }`; second save on an answered job → `{ ok: true }` with no second save; bad token → `LINK_UNAVAILABLE`.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** the functions and page (`ssr: false`, same headers and look as `estimate.$token.tsx`; heading "What's your full address?", one search box, results list, no free-text submit; answered state: "Thanks, your address is saved.").
- [ ] **Step 4: Run** `bun test tests/address-request-page.test.ts` — expect PASS; then full `bun run test`.
- [ ] **Step 5: Commit** `feat: owner page to give their full address`.

### Task 7: Website — full name needs first and last name

**Files:**
- Modify: `src/lib/address-pick.js` is address-only — create `src/lib/name-rule.js` instead (Base44 mirror `/home/claude/base44-site`)
- Modify: `src/pages/Homeowner.jsx:131`
- Test: `tests/name-rule.test.mjs`

**Interfaces:**
- Produces: `nameStepError(name: string): string | null` and `NAME_ERROR = "Please enter your first and last name."`

- [ ] **Step 1: Write the failing test** (node:test): `nameStepError("Jo") === NAME_ERROR`; `nameStepError("Jo Lowe") === null`; `nameStepError("  Jo   Lowe  ") === null`; `nameStepError("J Lowe") === NAME_ERROR`; `nameStepError("Mary Jo Lowe") === null`; `nameStepError("") === NAME_ERROR`.
- [ ] **Step 2: Run** `node --test tests/name-rule.test.mjs` — expect FAIL.
- [ ] **Step 3: Implement** — split the trimmed name on whitespace; at least two parts, each at least 2 characters. Replace the 2-character check at `Homeowner.jsx:131` with `nameStepError(contact.name)`.
- [ ] **Step 4: Run** `node --test tests/*.test.mjs` — expect all PASS.
- [ ] **Step 5: Commit** in the mirror.

### Task 6: Go-live check (with Jo)

- [ ] Show Jo the email, text and page wording. Only after she says yes, set BOTH together: `ADDRESS_REQUEST_EMAIL_APPROVED = true` (`src/lib/address-request.core.ts`, the email) and `wordingApproved: true` for the two texts (`address_request`, `address_request_reminder` in `src/lib/sms.core.ts`). Do this BEFORE the next step — while the email flag is false the sweep sends nothing.
- [ ] Apply the migrations (`address-request-live-at.sql`, then `0228_address_request_not_first_response.sql`); then set `address_request_live_at` to the go-live time.
- [ ] On the website, try "Brighton" in the address step — picking the suburb from the list must be refused.
- [ ] Then send one website enquiry with Jo's OWN email and mobile and no street (TEST jobs are never asked, so this must be a real website enquiry). Note: once the website change is live it no longer lets a street-less address through, so do this before the website change goes live, or use an email enquiry from Jo's own address. **This sends a real email and a real text to Jo.** Check: the request email and text arrive, Save my spot is held, picking a full address on the page lets it carry on (Save my spot email arrives).
