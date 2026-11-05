# Installer Fixes (Deep) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the installer portal problems Deep (Reinsulate) hit: Mitti photos in the portal, no Ready Check dates, Send quote from Add a job, discount after sending, easy electrician changes, price hidden from staff, and the Ready Check people picker.

**Architecture:** Photos are copied by the existing 15-minute Mitti pull into job storage as `documents` rows and shown in one shared gallery. Ready Check booking is removed from the job flow and replaced by a "done" rule: Mitti Complete for HIV leads, Send quote for own jobs. A 10-business-day return covers stalled Ready Checks. Own-job quotes reuse the existing installer-price → held draft → office Send path. Electrician pickers read one shared "electricians for this installer" list.

**Tech Stack:** TypeScript, TanStack Start, Supabase, Bun test, PGlite.

**Spec:** `docs/superpowers/specs/2026-11-05-installer-fixes-deep-design.md`

## Global Constraints

- Read `AGENTS.md`, `src/AGENTS.md` and `src/lib/AGENTS.md` (and nested ones) before editing. Run `bun scripts/scan-retired-terms.ts` before workflow work. Read `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md` and `src/config/workflow-decisions.ts`, and add the new decisions there (Jo, 5 Nov 2026).
- Plain wording on every screen. Always write "Lead Installer" in full. Never use "about" for figures. Show names in normal case.
- No message to an owner or trade is switched on or reworded without Jo approving the exact text first. New messages are built behind a switch that is off by default, and their wording goes into the PR for Jo.
- Photos and prices are visible only to the office and the installer business owner login. Never to crew/Lead links, Mitti staff forms, texts to staff, or the owner.
- Every read on these paths checks its error. A failed read never counts as empty.
- Pending SQL goes in `docs/pending-migrations/` with a rollback, is proven on PGlite, and is applied live only with Jo's yes at that moment.
- Tests use mocks/PGlite only. No network, no real Mitti calls (use the existing Mitti simulator / `mittiCallFor`).
- TEST jobs (`qa_test`) keep their existing isolation rules.

## Review Focus

1. A photo that's already copied isn't downloaded again, even if two pulls overlap.
2. A job with 0 photos, or with an archived form that can't be read, still syncs its answers and raises one office row.
3. An installer job that already has a sent quote can't press Send quote again (only "Give a discount").
4. The office sees exactly one "Quotes to check" item per Send quote / discount, not duplicates.
5. Removing Ready Check booking doesn't break PIESA or install booking, which keep their own booking flows.

---

### Task 1: Copy Mitti Ready Check photos into the portal

**Files:** Create `src/lib/mitti-photos.core.ts`, `src/lib/mitti-photos.server.ts`. Modify `src/lib/mitti.server.ts` (call from `syncMittiAssessment` after answers sync, in its own try/catch). Test `tests/mitti-photos.test.ts`.

**Interfaces — Produces:**
- `photoRefsFromAudit(audit: unknown): { photoId: string; url: string; label: string }[]` (pure; read the Mitti audit shape already used in `mitti.server.ts`)
- `syncMittiPhotos(jobId: string, call: MittiCall): Promise<{ copied: number; skipped: number; failed: number; archivedUnreadable: string[] }>`. It reads the current linked form plus every audit id in that job's `mitti_form_replaced` events, and writes `documents` (`kind 'mitti_photo'`, `storage_path job-files/<jobId>/mitti-photos/<auditId>/<photoId>.<ext>`, title = label). It skips existing `(auditId, photoId)`. An unreadable archived form → one `mitti_archived_form_unreadable` event (needs_office) per audit with text "Old Mitti form for {jobNumber} is archived – un-archive it so its photos can be copied".

- [ ] **Step 1: Failing tests.**
  - `copies_new_photos_once`: a 2nd run → skipped 2, copied 0.
  - `reads_replaced_forms`: photos from a `mitti_form_replaced` audit are copied.
  - `archived_unreadable_flags_once`.
  - `download_failure_does_not_stop_answers`.
  - `overlap_safe` (RF1).
- [ ] **Step 2: Run** `bun test tests/mitti-photos.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Find how Mitti exposes photo files (look in `mitti.server.ts` / `mitti.core.ts` for the report/attachments calls) and reuse `realMittiCall`/`mittiCallFor` so TEST goes to the simulator.
- [ ] **Step 4: Run** the new tests plus `bun test tests/*mitti*.test.ts`. Expected: no new failures vs baseline.
- [ ] **Step 5: Commit** `feat: copy Mitti Ready Check photos into the portal`.

### Task 2: Ready Check photo gallery on the job page

**Files:** Create `src/components/portal/ReadyCheckPhotos.tsx`. Modify the office job page `src/routes/_authenticated/admin.jobs.$jobId.tsx`, the installer job page `src/routes/_authenticated/field.$jobId.tsx`, and the server read in `src/lib/trade-view.server.ts` (or the existing job documents read). Test `tests/ready-check-photos-access.test.ts`.

**Interfaces — Produces:** `readyCheckPhotos(jobId: string, viewer: { role: "office" } | { role: "installer_owner"; businessId: string }): Promise<{ id: string; label: string; url: string }[]>`. It uses signed URLs (short expiry) and refuses anyone who isn't the office or the job's installer business owner.

- [ ] **Step 1: Failing tests.** Office sees photos. The installer business owner of that job sees them. Another installer → refused. Crew/Lead link → refused. Owner → refused.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** The gallery shows "Ready Check photos (N)", a thumbnail grid and tap to enlarge. With no photos it shows "No Ready Check photos yet".
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: Ready Check photos on the job page for office and installer`.

### Task 3: No Ready Check dates; 10-business-day return

**Files:** Modify the Ready Check next-step/card logic (`src/lib/installer-home.core.ts`, `src/components/trade/NextStepBox.tsx`, `src/lib/installer-screens.core.ts`, the `NextStepBox` box core), Ready Check booking deadlines/overdue (`grep -rn "ready_check" src/lib/*deadline* src/lib/*overdue* src/lib/in-house-*`), the owner "You're booked" sends for kind `ready_check`, and HIV-lead Mitti form creation (`src/lib/mitti-autoform.core.ts` `autoFormDecision`: create when an active installer assignment exists, not when booked). Create `src/lib/ready-check-return.core.ts` + `.server.ts`, called from the allocation tick. Test `tests/ready-check-no-dates.test.ts`.

**Interfaces — Produces:**
- `readyCheckDone(job): boolean` (Mitti Ready Check Complete, or the own-job Send quote event `installer_quote_submitted` from Task 4)
- `readyCheckReturnDue(givenAt: string, now: Date): boolean` (10 Melbourne business days; reuse the existing business-day helper)
- Return action: same as today's "trade didn't book in time" return-to-office, with reason "Ready Check not done within 10 business days"

- [ ] **Step 1: Failing tests.**
  - No "Book the Ready Check" or overdue text on a waiting job.
  - The card says "Do the Ready Check".
  - HIV lead with "Open Mitti form".
  - HIV lead form created on assignment with no booking.
  - No owner booked message for ready_check.
  - Returns after 10 business days, not 9.
  - PIESA and install booking untouched (RF5).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Existing waiting jobs drop the book step immediately. The 10-day clock starts at the later of "given to installer" and the release time of this change (store `READY_CHECK_NO_DATES_FROM` as a constant).
- [ ] **Step 4: Run** the new tests plus `bun test tests/*ready-check*.test.ts tests/*installer-home*.test.ts tests/mitti-autoform.test.ts`. Expected: no new failures.
- [ ] **Step 5: Commit** `feat: Ready Checks need no date; return after 10 business days`.

### Task 4: Send quote from Add a job (own jobs, no Mitti needed)

**Files:** Modify the Add a job screen and server (`grep -rn "add_installer_job" src`), the installer job page `field.$jobId.tsx` (show the same fields on an own job with no quote yet), and the price path (`installer_price_set` event + `draftInstallerQuoteFromReadyCheck` in `src/lib/installer-quote.server.ts`). Create `src/lib/own-job-send-quote.core.ts` + `.server.ts`. Test `tests/own-job-send-quote.test.ts`.

**Interfaces — Produces:**
- `sendQuoteFieldsErrors(f: { areaM2: number | null; removal: boolean; removalM2: number | null; product: string | null; priceIncGst: number | null }): string[]`
- `submitOwnJobQuote(jobId, actorId, fields, photoPaths: string[]): Promise<{ quoteId: string }>`. It records `installer_quote_submitted`, stores the optional photos as `documents` `kind 'ready_check_photo'`, builds the quote through the existing installer-price path, and leaves it **held for office review** ("Waiting for office review before sending"). It refuses if the job already has a sent quote (RF3) or isn't an own job.

- [ ] **Step 1: Failing tests.**
  - Missing fields → errors.
  - Submit → held draft quote in Quotes to check, not issued.
  - Exactly one Quotes-to-check item (RF4).
  - A 2nd submit after sending → refused.
  - HIV lead → refused.
  - Photos optional.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new tests plus `bun test tests/add-installer-job*.test.ts tests/*installer-quote*.test.ts`. Expected: no new failures.
- [ ] **Step 5: Commit** `feat: installers send their own quote from Add a job, checked by the office`.

### Task 5: Installer quote timeline (+ messages behind an off switch)

**Files:** Create `src/lib/installer-quote-timeline.core.ts`. Modify `src/lib/trade-view.server.ts` (read the events) and `field.$jobId.tsx` (show the timeline). New installer emails "Quote sent to owner" / "Owner accepted your quote" go through the existing installer email sender behind a new switch, off by default. Test `tests/installer-quote-timeline.test.ts`.

**Interfaces — Produces:** `quoteTimeline(events, smsRows, emailRows): { at: string; label: string }[]`. Labels: "Sent for checking", "Sent to owner", "Reminder email sent", "Reminder text sent", "Owner opened", "Accepted", "Declined", "Expired".

- [ ] **Step 1: Failing tests.** Each label comes from its source. Order is by time. Another installer's job → refused. The emails don't send while the switch is off.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Put the two email texts in the PR description for Jo.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: installers see their quote timeline`.

### Task 6: Discount after the quote is sent

**Files:** Create `src/lib/installer-discount.core.ts` + `.server.ts`. Modify `field.$jobId.tsx`. Use Task 6 of the recovery plan's `apply_quote_adjustment` pattern / the existing quote versioning so the new version is held for office review. Test `tests/installer-discount.test.ts`.

**Interfaces — Produces:**
- `discountErrors(amount: number, installerPriceIncGst: number, quote): string[]` (≤ his price; owner minimum $200 rule via `quoteAdjustmentDiscount`)
- `requestInstallerDiscount(jobId, actorId, amount, note): Promise<{ quoteId: string }>`. It makes a new version with a line "Discount −$X" under his price, held for office review. When the office sends it, it replaces the old quote and the 30-day validity restarts. Only on a sent, unaccepted own-job quote.

- [ ] **Step 1: Failing tests.**
  - Not sent / accepted / HIV lead → refused.
  - Amount > price → error.
  - Below the owner minimum → error naming it.
  - Valid → held new version with the exact line, old one still live until office Send.
  - One Quotes-to-check item.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new tests plus `bun test tests/*quote*.test.ts`. Expected: no new failures.
- [ ] **Step 5: Commit** `feat: installers can offer a discount on a sent quote`.

### Task 7: Electrician pickers, change any time, licence check

**Files:** Create `src/lib/installer-electricians.server.ts`. Modify every installer electrician picker (`grep -rn "no electricians on your Team" src`), the change path (`src/lib/electrician-swap.server.ts`, the current booking form), and `src/lib/installer-quote.server.ts:41`. Test `tests/installer-electricians.test.ts`.

**Interfaces — Produces:**
- `electriciansForInstaller(businessId): Promise<{ workerId: string | null; businessId: string; name: string; licence: string }[]>`: Team electricians plus onboarded electricians linked to the business
- `changeJobElectrician(jobId, actorId, pick, time?: string | null)`: saves the person and time together (one RPC if needed, pending SQL), then sends the job-link text / moves the Mitti PIESA form only after both saved. Allowed until the PIESA is done.
- The hold compares `licence` only (case/space-insensitive)

- [ ] **Step 1: Failing tests.**
  - The Reinsulate-like fixture lists Peter Orlando.
  - Change before the PIESA works.
  - Change after the PIESA → refused.
  - A time save fails → electrician unchanged, no text.
  - "ORLANDO POWERED" vs "Peter orlando" with the same licence → no hold.
  - A different licence → hold.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new tests plus `bun test tests/*electrician*.test.ts`. Expected: no new failures.
- [ ] **Step 5: Commit** `fix: installers can pick and change any linked electrician`.

### Task 8: Staff never see the price

**Files:** The portal-made Mitti Ready Check form prefill and reads (`grep -rn "Total quoted price" src`), staff texts (`grep -rn "price" src/lib/*worker*text* src/lib/installer-texts.server.ts`). Test `tests/staff-no-price.test.ts`.

**Interfaces:** No new exports. New forms don't ask or prefill a price. The code stops reading a Mitti price. No staff message body contains a $ amount.

- [ ] **Step 1: Failing tests.** The form prefill has no price field. Price comes only from the portal entry. Staff text bodies contain no "$".
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** In the PR, note that Jo removes the question from the Mitti template in the Mitti form editor.
- [ ] **Step 4: Run** the new tests plus `bun test tests/*mitti*.test.ts`. Expected: no new failures.
- [ ] **Step 5: Commit** `fix: installer price never shown to staff`.

### Task 9: Ready Check people picker shows the whole Team

**Files:** Modify `src/lib/in-house-booking.server.ts` (~39) and the Ready Check picker. Test `tests/ready-check-picker-team.test.ts`.

- [ ] **Step 1: Failing test.** A 6-person Team, 2 ESC-registered Lead Installers → the Ready Check picker lists all 6, and the install picker still lists only the 2.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new test plus `bun test tests/*in-house*.test.ts`. Expected: no new failures.
- [ ] **Step 5: Commit** `fix: Ready Check picker lists the whole Team`.

### Task 10: Whole check and hand-off

- [ ] **Step 1:** Run `bun scripts/scan-retired-terms.ts`, the new tests, and the related suites in chunks. Expected: no new failures vs the baseline.
- [ ] **Step 2:** `bunx tsc --noEmit`, `bun run lint`. Expected: no new errors in changed files.
- [ ] **Step 3:** Walk-through as a TEST installer (Test Centre / TEST office login) covering every task: photos, no dates, Send quote, timeline, discount, electrician change. Mark anything not run as NOT RUN.
- [ ] **Step 4:** Prepare the PR with the message texts for Jo. Do not merge. Hand the branch to a chat with push access or to Tom.
