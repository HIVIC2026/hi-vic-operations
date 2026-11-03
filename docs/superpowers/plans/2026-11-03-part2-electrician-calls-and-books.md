# Part 2 — The electrician calls and books the PIESA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On an installer's own job, once the owner has paid the PIESA fee, the job goes straight to the installer's chosen electrician and/or office. The booker calls the owner and enters the day and time, and it's booked at once. There are 2 business days to book, a "Can't do this one" button, and the installer can swap electricians from the job page.

**Architecture:** Reuse the in-house "call and book" pieces that already work (`confirmBooking`, `notifyOwnerBooked`, the booking card, the stall-flag pattern). Gate them on a new pure predicate, "installer's own job", instead of only `in_house`. The old 3-times offer path (`autoOfferForJob`, `startPiesaAllocation`, the piesa-times owner messages) is skipped for those jobs. The electrician gets a stored-hash no-login link (the `worker_job_links` pattern), so a swap can revoke it.

**Tech Stack:** TypeScript, TanStack routes, Supabase (admin client), Bun test with PGlite practice DB, pending-migration SQL files.

**Spec:** `docs/superpowers/specs/2026-11-03-deep-first-job-design.md` (Part 2)

## Global Constraints

- Applies to **installers' own jobs** (`jobs.channel = 'installer_sourced'`), every installer. HIV leads and in-house partner jobs keep their current flows.
- Booker setting per installer: `office` | `electrician` | `either`, default `office`. Reinsulate = `electrician`.
- Installer offices are **emailed, never texted**. Electricians get a **text** with a no-login link. Electricians never log in.
- 2 **business days** (Victorian, `addMelbourneBusinessDays`) to book, counted from when the job is handed over.
- "Can't do this one" reasons: `busy` / `owner_not_answering` / `other` (with text).
- Swap only until the PIESA is done. The new electrician gets a new link and a fresh 2 business days. The old link is revoked, and the old electrician gets exactly one email.
- Only an electrician business that is onboarded (approved REC with an approved electrician worker) and actively linked to the installer in `partner_relationships` can be chosen.
- New wording is held (`wordingApproved: false` or an unapproved template) until Jo approves each message one at a time. Use "Home Insulation Victoria" and "Lead Installer" in full, and "electrical upgrades", never "fixes".
- Trade messages pass `{ businessId: <recipient business>, jobId }` to the pause check (Part 1 rule).
- Live database changes ship as `docs/pending-migrations/2026-11-03_*.sql` plus `.undo.sql`. Code reads new columns fail-closed until they're applied. Claude asks Jo before applying.

## Review Focus

1. The owner pays twice, or a Xero and Stripe double payment → the job is handed over exactly once (idempotent event key). Test in Task 2.
2. The electrician's worker has no profile user (`job_assignments.user_id` is NOT NULL) → hold with the office item "Electrician has no portal profile". Never insert a broken assignment. Test in Task 2.
3. A swap while a link page is open → the old link refuses to book after the swap ("This job has moved to another electrician"). Test in Task 5.
4. The 2-day deadline crosses a weekend or Melbourne Cup day → due date skips them. Test in Task 4.
5. A booking time in the past, or more than 30 days after the PIESA fee was paid → refused with the reason. Test in Task 3.

---

### Task 1: "Who books" setting

**Files:**
- Create: `docs/pending-migrations/2026-11-03_piesa_booked_by.sql` (+ `.undo.sql`): `ALTER TABLE businesses ADD COLUMN piesa_booked_by text NOT NULL DEFAULT 'office' CHECK (piesa_booked_by in ('office','electrician','either'))`
- Create: `src/lib/piesa-booker.core.ts`
- Modify: `src/lib/trade-view.server.ts` / `trade-view.functions.ts` (new `tradeSetPiesaBooker`), `src/routes/_authenticated/field.business.tsx` (a 3-option control under "Taking new jobs", boss only)
- Test: `tests/piesa-booker.core.test.ts`

**Interfaces:**
- Produces: `type PiesaBooker = "office" | "electrician" | "either"`; `piesaBookerOf(raw: unknown): PiesaBooker` (unknown/missing → `"office"`); `bookerNotices(b: PiesaBooker): { textElectrician: boolean; emailOffice: boolean }` (office → {false,true}; electrician → {true,true}; either → {true,true}). Office is always emailed so it knows the job moved; only `electrician`/`either` text the electrician.
- Produces: `readPiesaBooker(businessId: string): Promise<PiesaBooker>`. A missing column or read error gives `"office"`.

- [ ] Step 1: Failing tests: `piesaBookerOf(null) === "office"`, `piesaBookerOf("either") === "either"`, `piesaBookerOf("x") === "office"`, and a `bookerNotices` row for each value.
- [ ] Step 2: Run `bun test tests/piesa-booker.core.test.ts` → FAIL.
- [ ] Step 3: Implement the core, the read, the setter and the UI control (labels: "Our office books the safety check", "Our electrician books it", "Either — whoever goes first").
- [ ] Step 4: Run → PASS. Also run `bunx tsc --noEmit -p .`.
- [ ] Step 5: Commit `feat(piesa-booker): who books the safety check, per installer`

### Task 2: Hand an own job's PIESA to the booker

**Files:**
- Create: `src/lib/own-job-piesa.core.ts`, `src/lib/own-job-piesa.server.ts`
- Modify: `src/lib/auto-offer.server.ts` (`autoOfferForJob`), `src/lib/allocation.server.ts` (`startPiesaAllocation`, `sweepRecOffers`), `src/lib/owner-email-triggers.server.ts` and `src/lib/approved-texts.server.ts` (skip the 3-times owner messages for own jobs, next to the existing in-house skips), `src/routes/api/public/hooks/allocation-tick.ts` (register `sweepOwnJobPiesaHandoffs`)
- Test: `tests/own-job-piesa.core.test.ts`, `tests/own-job-piesa.pglite.test.ts`

**Interfaces:**
- Produces (pure): `isOwnJobCallAndBook(j: { channel: string | null; heldInHouse: boolean }): boolean` = `channel === "installer_sourced" && !heldInHouse`.
- Produces (pure): `ownJobHandoffPlan(f: { paid: boolean; stage: string; electricianBusinessId: string | null; electricianUserId: string | null; alreadyHanded: boolean }): { kind: "hand"; } | { kind: "wait"; reason: string } | { kind: "hold"; reason: string }`. Hand only when paid, stage `measured_quote_accepted`, and not already handed. Hold reasons: "No electrician chosen for this job" or "Electrician has no portal profile".
- Produces: `handOwnJobPiesa(jobId: string, now?: Date): Promise<"handed" | "waiting" | "held" | "already">`. It:
  - inserts an active `job_assignments` row (`role='electrician'`, `business_id` = the chosen electrician business from `jobChosenElectrician`, `user_id` = that business's approved electrician worker's `profile_id`);
  - moves the stage to `piesa_and_install_window_pending`;
  - logs a `own_job_piesa_handed` event with details `{ electrician_business_id, due_at: addMelbourneBusinessDays(now, 2) }`. A unique key per job/round makes the hand-over idempotent;
  - calls `sendOwnJobPiesaNotices(jobId)` (Task 3).
  A hold becomes one office item.
- Produces: `sweepOwnJobPiesaHandoffs(now?: Date)`. Own jobs in `measured_quote_accepted` whose PIESA fee has cleared → `handOwnJobPiesa`.
- `autoOfferForJob` and `startPiesaAllocation` return early with reason `"own job: call and book"` for these jobs.

- [ ] Step 1: Failing tests:
  - `isOwnJobCallAndBook` truth table (4 rows).
  - `ownJobHandoffPlan`: unpaid → wait; paid with no electrician → hold "No electrician chosen for this job"; paid with no profile → hold "Electrician has no portal profile"; already handed → wait; happy path → hand.
  - PGlite: a paid own job is handed exactly once across two sweeps (Review Focus 1); `autoOfferForJob` creates no `partner_offers` row for it; an HIV-lead job still goes through the old path.
- [ ] Step 2: Run each test file on its own → FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Run each file on its own → PASS. Also run the existing `tests/auto-offer*.test.ts`, `tests/allocation*.test.ts` and `tests/in-house*.test.ts`, one file at a time; no new failures compared with main.
- [ ] Step 5: Commit `feat(own-job-piesa): installers' own jobs skip the offer and go to their electrician`

### Task 3: Electrician's no-login link, booking, "Can't do this one"

**Files:**
- Create: `docs/pending-migrations/2026-11-03_electrician_job_links.sql` (+ undo). Table `electrician_job_links(id uuid pk, job_id uuid, electrician_business_id uuid, token_hash text unique, created_at, expires_at, revoked_at, revoked_reason text)`, service-role only.
- Create: `src/lib/electrician-link.core.ts`, `src/lib/electrician-link.server.ts`, `src/lib/electrician-link.functions.ts` (no auth middleware, zod token shape, the same pattern as `swms-link.functions.ts`), `src/routes/e.$token.tsx`
- Create: `src/lib/own-job-piesa-notices.server.ts`, with the SMS type `own_job_piesa_link` in `src/lib/sms.core.ts` (`audience:"partner"`, `wordingApproved:false`, `quietHours:true`)
- Modify: `src/lib/in-house-booking.server.ts` (`notifyOwnerBooked`: also allow own jobs)
- Test: `tests/electrician-link.core.test.ts`, `tests/electrician-link.pglite.test.ts`

**Interfaces:**
- Consumes: `newToken()`, `hashToken()` from `worker-links.core.ts`; `confirmBooking(jobId, "assessment", startIso, actorId, roleLabel)`; `notifyOwnerBooked(jobId, "piesa", startIso, who, now)`.
- Produces: `createElectricianJobLink(jobId: string, electricianBusinessId: string): Promise<{ url: string }>` (`/e/<token>`, 30-day expiry); `resolveElectricianLink(token: string): Promise<{ ok: true; jobId: string; electricianBusinessId: string; step: ElectricianStep } | { ok: false; reason: string }>`. It refuses if revoked ("This job has moved to another electrician"), expired, or the electrician is no longer the active assignee.
- Produces (pure): `type ElectricianStep = "book_piesa" | "do_piesa_in_mitti" | "done"` and `electricianStep(f: { booked: boolean; piesaDone: boolean }): ElectricianStep`. Part 3 adds the upgrades and certificate steps.
- Produces (pure): `piesaBookingProblem(startIso: string, now: Date, paidAt: string): string | null`. Refuses a time in the past or after `paidAt + 30 days`, with plain reasons.
- Produces: `linkBookPiesa(token, startIso)`. Resolve → check → `confirmBooking` → `notifyOwnerBooked`.
- Produces: `linkCantDo(token, reason: "busy" | "owner_not_answering" | "other", note?: string)`. Ends the assignment, revokes the link, logs `own_job_piesa_handed_back {reason, note}`, and emails the installer office (approved template held until Jo approves).
- Produces: `sendOwnJobPiesaNotices(jobId)`. Per `bookerNotices`: the electrician text `own_job_piesa_link` with the URL; the office email "Safety check to book for {address}" with a link to the job page. Both pass the Part 1 pause ids.
- Page `/e/<token>` shows ONLY the next step:
  - `book_piesa`: owner name, mobile and address; date and time pickers; "Book it"; "Can't do this one" with the 3 reasons.
  - `do_piesa_in_mitti`: "Booked for {day time}. Do the safety check in Mitti on the day."
  - `done`.

- [ ] Step 1: Failing tests:
  - token round trip; revoked → refused with "This job has moved to another electrician"; expired → refused;
  - `electricianStep` table;
  - `piesaBookingProblem`: a past time is refused; `paidAt + 31 days` is refused; `paidAt + 10 days` is ok (Review Focus 5);
  - PGlite: book → `bookings` row kind `assessment`, stage `piesa_scheduled`, one owner notice; can't-do → assignment ended, link revoked, one office email recorded.
- [ ] Step 2: Run each file → FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Run each file → PASS. Also run the existing `tests/in-house-booking*.test.ts` and `tests/booking*.test.ts` singly.
- [ ] Step 5: Commit `feat(electrician-link): no-login link to book the safety check`

### Task 4: Installer office can book; 2-business-day return

**Files:**
- Modify: `src/lib/trade-view.server.ts` (`inHouseBookingAccess` → also allow the installer office on own jobs for kind `piesa` when the booker is `office` or `either`), `src/components/trade/InHouseBookingCard.tsx` (show it for those jobs; "Can't do this one" isn't shown to the office)
- Create: `sweepOwnJobPiesaDeadlines(now?: Date)` in `src/lib/own-job-piesa.server.ts`; register it in `allocation-tick.ts`
- Test: `tests/own-job-piesa-deadline.pglite.test.ts`

**Interfaces:**
- Consumes: the `own_job_piesa_handed` event's `due_at` (Task 2).
- Produces (pure, in `own-job-piesa.core.ts`): `deadlineAction(f: { dueAt: string; booked: boolean; alreadyReturned: boolean; now: Date }): "none" | "return"`.
- On `"return"`: log `own_job_piesa_not_booked` once and email the installer office "Not booked yet — book it or pick another electrician". The link stays usable, so the electrician can still book.

- [ ] Step 1: Failing tests:
  - `deadlineAction` across a weekend and across 3 Nov 2026 (Melbourne Cup) (Review Focus 4);
  - PGlite: no booking after the due date → one return and one email, and a second sweep does nothing; booked → none;
  - the office of a `booker=office` installer sees the booking card for the own job; the office of a `booker=electrician` installer does not.
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Run → PASS.
- [ ] Step 5: Commit `feat(own-job-piesa): office booking and 2-business-day return`

### Task 5: Installer swaps the electrician

**Files:**
- Create: `src/lib/electrician-swap.server.ts`, `src/lib/electrician-swap.core.ts`
- Modify: `src/lib/installer-intake.server.ts` (stop throwing `OWN_ELECTRICIAN_OFFICE_CHANGE` on own jobs before the PIESA is done; route to the swap), `src/lib/trade-view.functions.ts` (new `tradeSwapElectrician`), and the installer job page (a "Change electrician" picker listing linked, onboarded electricians)
- Test: `tests/electrician-swap.core.test.ts`, `tests/electrician-swap.pglite.test.ts`

**Interfaces:**
- Produces (pure): `swapProblem(f: { piesaDone: boolean; linkedActive: boolean; onboarded: boolean; same: boolean }): string | null`. The reasons:
  - "The safety check is done, so the electrician can't change"
  - "That electrician isn't linked to your business"
  - "That electrician hasn't finished signing up"
  - "That's already the electrician"
- Produces: `installerSwapElectrician(jobId: string, installerBusinessId: string, newElectricianBusinessId: string, actorId: string): Promise<void>`. It:
  - ends the old nomination and adds a new one (`recordJobElectricianChoice`);
  - ends the old assignment and inserts a new one;
  - revokes the old link;
  - if a booking exists, cancels it (`bookings.status`), so the new electrician books fresh;
  - moves the Mitti PIESA form (`reassignMittiFormTo`) if one exists;
  - logs `own_job_piesa_handed` again with a fresh `due_at`;
  - sends the new electrician the link (`sendOwnJobPiesaNotices`);
  - emails the old electrician once ("You're no longer on {address}").

- [ ] Step 1: Failing tests:
  - `swapProblem` table;
  - PGlite: a swap gives a new active assignment and nomination; the old link is refused with "This job has moved to another electrician" (Review Focus 3); a fresh `due_at`; exactly one old-electrician email; after the PIESA is done the swap is refused.
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Run → PASS. Also run the existing `tests/installer-intake*.test.ts` and `tests/installer-own-electrician*.test.ts` singly.
- [ ] Step 5: Commit `feat(electrician-swap): installer changes the electrician before the safety check`

### Task 6: Wording, TEST journey, pull request

- [ ] Step 1: Put every new message (electrician link text, office "to book", office "not booked yet", office "can't do this one", old-electrician swap email) in one file, `docs/wording/2026-11-03-part2-messages.md`, for Jo to approve one at a time. Keep `wordingApproved:false` until she does.
- [ ] Step 2: Add an "installer's own job, call and book" run to the morning TEST journey (`journey.server.ts`): hand over → link book → owner notice → swap → can't-do.
- [ ] Step 3: Final checks: `bunx tsc --noEmit -p .`; every new and touched test file, singly.
- [ ] Step 4: Push the branch `part2-electrician-calls-and-books` and open a PR with the `supermatt:pr` body shape. Ask Jo who merges. After merging, ask Jo before applying the two pending SQL files, then set Reinsulate to `piesa_booked_by='electrician'`.
