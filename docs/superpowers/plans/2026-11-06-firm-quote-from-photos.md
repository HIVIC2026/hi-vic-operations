# Firm quote from photos Implementation Plan

**Goal:** New website enquiries with photos get a preliminary estimate email, press Proceed to firm quote, a From photos installer does the desktop assessment, and Jo sends a firm quote — with no Save my spot anywhere on those jobs.

**Architecture:** One pure core decides whether a job is a firm-quote job and holds every date rule and all owner copy. Proceed reuses the existing saved-spot pipeline (so Choose installer, From photos allocation and the Quote from photos box work unchanged) but every spot message is skipped for firm-quote jobs. A go-live timestamp in `workflow_settings` switches the whole flow on; null = off, nothing changes.

**Spec:** `docs/superpowers/specs/2026-11-06-firm-quote-from-photos-design.md`

## Global Constraints
- Firm-quote job = website enquiry created at/after `workflow_settings.firm_quote_flow_live_at` AND `hasOwnerMedia(docs)`. Null live-at = no firm-quote jobs.
- Owners who saved a spot or got the old email before live-at are never touched.
- Firm quote due = `addVicBusinessDays(proceedMelbourneDay, 7)`. Day-4 email due 4 calendar days after Proceed.
- Word "preliminary estimate", never "preliminary quote". Never "about" before a price. "Home Insulation Victoria" in full. Sign-off "Cheers, the Home Insulation Victoria team". No phone number / "call us".
- Removal rate shown to owners: $15/m² (from pricing settings, not hard-coded).
- Every owner send keeps today's guards: `customer_comms_enabled`, consent, 8pm–7am hold for automatic messages, idempotency key.
- Run `bun scripts/scan-retired-terms.ts` and `bun run portal-qa` before every merge. Nothing live until Jo says.

## Review Focus
1. Owner taps Proceed twice (or on two devices) → one request, one due date, one size-check run.
2. Proceed link on a job that's closed, opted out or already quoted → friendly "already done" page, nothing recorded.
3. Firm quote sent before day 4 → no day-4 email.
4. Owner m² missing (older data) → email 3 drops the "You told us" sentence instead of showing "0 m²".
5. Job created before live-at with photos → old flow exactly (Save my spot email, reminders), no With photos tab.

### Task 1: Firm-quote core (rules + dates)
Files: Create `src/lib/firm-quote.core.ts`; Test `tests/firm-quote.core.test.ts`
Produces:
- `FIRM_QUOTE_REQUESTED_EVENT = "firm_quote_requested"`, `FIRM_QUOTE_DAY4_EVENT = "firm_quote_day4_sent"`
- `isFirmQuoteJob(i: { createdAt: string; hasMedia: boolean; liveAt: string | null; source: string | null }): boolean` — source is the website, live-at set, `createdAt >= liveAt`, media.
- `firmQuoteDueBy(requestedAtIso: string): string` (ISO date, Melbourne) via `addVicBusinessDays(…, 7)`.
- `firmQuoteDay4Due(i: { requestedAt: string; now: Date; quoteSentAt: string | null; closed: boolean; day4SentAt: string | null }): boolean`
- `formatDueDate(isoDate: string): string` → "Friday 20 November".
Tests: isFirmQuoteJob false when liveAt null, false before liveAt, false without media, false for installer-added source, true otherwise; `firmQuoteDueBy("2026-11-06T06:00:00Z")` = "2026-11-17"; firmQuoteDay4Due true at +4 days only when quote not sent, not closed, not already sent; formatDueDate("2026-11-20") = "Friday 20 November".

### Task 2: The three owner emails
Files: Create `src/lib/firm-quote-emails.core.ts`; Test `tests/firm-quote-emails.core.test.ts`
Each returns `{ subject; previewText; html; plainText }`:
- `preliminaryEstimateEmail(i: { firstName; price; rebate; fullPrice; areaM2; insulation: "none" | "present" | "unknown"; removalRatePerM2; proceedUrl })`
- `firmQuoteOnItsWayEmail(i: { firstName; dueDate })`
- `firmQuoteReadyEmail(i: { firstName; price; rebate; fullPrice; ownerM2: number | null; confirmedM2; removalM2; removalRatePerM2; validUntil; acceptUrl })`
Tests: subjects "Alex, your preliminary estimate: $2,940 after a $1,610 rebate", "Your firm quote is on its way", "Your firm quote is ready: $3,390 after rebate"; email 1 contains "Proceed to firm quote", "within 7 business days", "Nothing is locked in until you accept your firm quote." and NOT "Save my", "spot", "Ready Check", "preliminary quote", /\babout \$/; removal card present for present and unknown, absent for none; email 3 contains "You told us 150 m². We confirmed 142 m²." and "40 m² × $15 = $600" when removalM2 = 40, no removal line when 0, no "You told us" when ownerM2 null; plain-text twin has the same price lines.

### Task 3: Go-live switch — migration adding `workflow_settings.firm_quote_flow_live_at timestamptz NULL` (NOT run on live; Jo is asked first); `firmQuoteLiveAt()` and `isFirmQuoteJobId(jobId)` in `src/lib/firm-quote.server.ts` (missing column reads as null).
### Task 4: Email 1 replaces the Save my spot estimate email for firm-quote jobs (office-first-response.server.ts and the automatic first-response path); proceedUrl = /estimate/{token}/firm-quote; pre-live jobs unchanged.
### Task 5: Proceed to firm quote — route `/estimate/$token/firm-quote`, `requestFirmQuoteFn`, `requestFirmQuote(jobId)`: idempotent; sets spot_saved_at (joins Choose installer › To release now) with details.firm_quote = true; logs event with due_by; queues runPropertyIntelligence(jobId, null, "firm quote requested") on the post-intake queue. Closed/opted out/quoted → friendly page, nothing recorded.
### Task 6: No spot messages on firm-quote jobs — estimate follow-ups (day 2/7/21 + auto-close), spot_saved, spot_saved_email, save_spot_reminder, spot_released, quick_taps, "It's your turn" all skip with reason firm_quote_job; remove the calculator's "Spots are released…" line (register-interest.tsx).
### Task 7: Choose installer — firm-quote jobs show "Asked for firm quote · due {date}" and can only go to From photos installers; others greyed: "Firm quote jobs go to installers who quote from photos." No owner message when given.
### Task 8: REMOVED (Jo 6 Nov) — no size check. The installer does the desktop assessment themselves; Home Insulation Victoria pulls nothing.
### Task 9: Firm quote always held for Jo ("Firm quote: you press Send"); notifyOwnerQuoteReady uses firmQuoteReadyEmail for firm-quote jobs (ownerM2 = intake estimate, confirmedM2 = photo quote install m², removalM2 = photo quote remove m²).
### Task 10: Day 4 email sweep `sweepFirmQuoteDay4(now)` from the post-intake tick; key `firm-quote-day4:v1:{jobId}`; normal guards + 8pm–7am hold.
### Task 11: Office "With photos" Enquiries tab (one pile per job; pre-live photo jobs keep today's category).
### Task 12: Switch on with Jo — TEST job end to end, migration, set live-at, publish portal then Base44 website.
