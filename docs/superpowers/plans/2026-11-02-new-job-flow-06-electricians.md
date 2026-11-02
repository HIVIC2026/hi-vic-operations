# New job flow · Part 6 — Electricians (no login, one job link) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Electricians never log in: each job reaches them by text as one no-login job link showing only their next step (book the safety check if the installer's who-books setting allows, open the safety check form, set the upgrades day, open the upgrades form, upload the Certificate of Electrical Safety, all done); the "PIESA booked" email uses the approved wording; missed upgrades days are nudged; an upgrades day that breaks the 30-day rule raises a red flag; "Can't do this one" sends the job back to the installer; the electrician sign-in is removed.

**Architecture:** One pure core `electrician-link.core.ts` decides the step and all wording from job facts. The link reuses the existing hashed-token table `worker_job_links` (`newToken`, `hashToken`, `linkState` in `worker-links.core.ts`) under a new public route `/e/$token`; the server side `electrician-link.server.ts` resolves the token and calls only existing guarded writers (canonical in-house booking, `checkCoes`, `sendCoesOwnerCopy`, `tradeHandBack`-style hand-back). Nudges and the red flag run on the existing 15-minute allocation tick (`src/routes/api/public/hooks/allocation-tick.ts`). Every new send defaults OFF behind its own approval flag.

**Tech Stack:** TypeScript, TanStack Start, React, Supabase, bun:test, existing SMS/email guarded senders, `bun run portal-qa`.

**Spec:** `docs/superpowers/specs/2026-11-02-new-job-flow-design.md` § "Electricians" (+ "What gets removed › Screens: the electrician sign-in screen"). Wording: `docs/hiv-touchpoint-decisions.md` — "Decisions from the electrician + SWMS chat" wins over everything above it (it replaces the electrician sign-in phone screen `ph-elec.png` and the "office always adds the PIESA time" decision).

## Global Constraints

- Overview Global Constraints apply. Read the four `AGENTS.md` files first; run `bun scripts/scan-retired-terms.ts` before and after.
- Electricians never log in. No pay screen for electricians (paid via the installer). Trades see "PIESA", "Part C", "Certificate of Electrical Safety" without explanation; never "fixes"; never "HIV".
- Who books the safety check AND the upgrades day comes from the installer's My business setting (Part 5 `whoBooksOf(businesses.piesa_booked_by)`): `office` → the link never shows a booking step; `electrician` → only the link can book; `either` → whoever goes first, and once one books, the step disappears for the other.
- Link steps, in order: 1 Book the safety check (only if allowed) · 2 Safety check day: "Open safety check form" · 3 If upgrades are needed but not done that day: "When are you doing the upgrades?" · 4 Upgrades day: "Open upgrades form" · 5 Upload the Certificate of Electrical Safety · 6 All done. No upgrades → straight to done. Upgrades the same day → Part C on the same form, then upload the certificate. The Part C lives in Mitti; only the certificate is uploaded.
- Approved "PIESA booked" email (#39, spec wording wins for the last line): subject `"{HV}: PIESA booked, {Ddd D Mmm h:mmam}"`; `"Hi {first},"`; heading `"PIESA booked: {HV}"`; table Day / Arriving / Address / Owner (name, phone); button `"Open the Mitti form"`; `"Need to change the time? Call {owner}, then update it on the job."`.
- Electricians are not named in the Customer Agreement; their name, office phone and email go in the owner's PIESA "You're booked" email (Part 4 owns that email).
- Booking the install before the upgrades day = a warning, never a block. All Mitti forms are created immediately (unchanged).
- New sends (link text, nudges, red flag, can't-do notice) have no approved wording: each is DRAFT, behind its own `*_APPROVED = false` flag, TEST jobs go to test-send, real sends only through the existing guarded senders behind `customer_comms_enabled` and `trade_messages_paused`.
- Trade data rule: the link shows only this job's owner name, phone and address while the electrician has a current visit (existing `contact_releases` rule), never prices.
- Rentals (Jo 2 Nov, answer 7): when someone other than the owner lets the trades in (Part 3 Task 19 `accessPersonFor` — the owner's quick-taps answers, Jo 2 Nov answer 22), the electrician calls that person to arrange times — the link and the "PIESA booked" email show them (Task 9); the owner's details stay as well. Owner-occupied: unchanged.
- 30-day red flag (Jo 2 Nov, answer 13): email to the installer office, copy to info@homeinsulationvictoria.com.au, plus a Needs me row for Jo (Task 7).

## Review Focus

1. **Office and electrician both press Book at the same moment on an "Either" installer**: exactly one PIESA booking exists; the second sees "Already booked for {day time}" (DRAFT) and the step is gone → Task 3 test.
2. **The link is opened after the electrician tapped "Can't do this one" or after the installer changed electrician**: the old link is switched off with a plain message and shows no owner details → Task 6 test.
3. **A long job (upgrades booked 3 weeks after the PIESA, certificate uploaded the day before install)**: the link still works at every step; it expires only 14 days after "All done" or when revoked → Task 2 test.
4. **Upgrades done on the PIESA day in the same Mitti form**: the link skips "When are you doing the upgrades?" and goes straight to "Upload the Certificate of Electrical Safety" → Task 1 test.
5. **Installer switches who-books from "Our electrician" to "Our office" after the link was texted**: the next page load shows no Book step and the booking server refuses a link booking → Tasks 1 and 3 tests.

---

### Task 1: The electrician's next step (pure)

**Files:**
- Create: `src/lib/electrician-link.core.ts`
- Test: `tests/electrician-link.test.ts`

**Interfaces:**
- Consumes: Part 5 `type WhoBooks = "office" | "electrician" | "either"` (`business-screen.core.ts`).
- Produces:
  ```ts
  export type ElectricianLinkFacts = {
    whoBooks: WhoBooks; piesa: { start: string | null; formUrl: string | null; outcome: "pass" | "upgrades" | null; upgradesSameDay: boolean };
    upgrades: { start: string | null; formUrl: string | null; formDone: boolean }; certificateIn: boolean; handedBack: boolean; now: Date;
  };
  export type ElectricianStep = "book_piesa" | "waiting_office_book" | "piesa_day" | "set_upgrades_day" | "waiting_office_upgrades"
    | "upgrades_day" | "upload_certificate" | "all_done" | "closed";
  export type ElectricianStepView = { step: ElectricianStep; title: string; sub: string | null; button: string | null; canBook: boolean };
  export function electricianStep(f: ElectricianLinkFacts): ElectricianStepView;
  export function canBookFromLink(whoBooks: WhoBooks): boolean; // electrician | either
  export const ELECTRICIAN_LINK_WORDS: Record<ElectricianStep, { title: string; sub?: string; button?: string }>; // DRAFT except the approved buttons
  ```

- [ ] **Step 1: Write the failing test** `tests/electrician-link.test.ts`, one test per row:
  | facts | expected `step` · `button` |
  |---|---|
  | nothing booked, `whoBooks "electrician"` | `"book_piesa"` · `"Enter day and time"`; title `"Book the safety check"`; `canBook true` |
  | nothing booked, `"either"` | `"book_piesa"` |
  | nothing booked, `"office"` | `"waiting_office_book"` · `null`; `canBook false` |
  | PIESA booked Fri 6 Nov 10:00am, form url | `"piesa_day"` · `"Open safety check form"`; sub `"Fri 6 Nov, 10:00am"` |
  | outcome `"pass"` | `"all_done"` |
  | `"upgrades"`, `upgradesSameDay true`, no certificate | `"upload_certificate"` · `"Upload the certificate"` (DRAFT); title `"Upload the Certificate of Electrical Safety"` |
  | `"upgrades"`, not same day, no upgrades day, `"electrician"` | `"set_upgrades_day"` · title `"When are you doing the upgrades?"`, button `"Enter the day"` (DRAFT) |
  | same, `"office"` | `"waiting_office_upgrades"`, `canBook false` |
  | upgrades day set, form not done | `"upgrades_day"` · `"Open upgrades form"` |
  | upgrades form done, no certificate | `"upload_certificate"` |
  | certificate in | `"all_done"` |
  | `handedBack true` (any state) | `"closed"` |
  - `JSON.stringify(ELECTRICIAN_LINK_WORDS)` never matches `/fixes|Rectification|HIV\b|log ?in|password/i`.
- [ ] **Step 2: Run** `bun test tests/electrician-link.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `electrician-link.core.ts` — first-match rules from the end of the job back to the start; DRAFT comments on every non-approved line.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git add src/lib/electrician-link.core.ts tests/electrician-link.test.ts && git commit -m "feat(electricians): next-step rules for the no-login job link"`

### Task 2: Mint the link, text it, and the `/e/$token` page

**Files:**
- Create: `src/lib/electrician-link.server.ts`, `src/lib/electrician-link.functions.ts`, `src/routes/e.$token.tsx`
- Modify: `src/lib/in-house-electrician.server.ts` (`allocateElectrician` mints + texts after a successful allocation), `src/lib/sms.core.ts` (new type `electrician_job_link`, `wordingApproved: false`, partner audience, quiet hours), `src/lib/template-hub.core.ts` (entry for the office Templates page)
- Test: `tests/electrician-link-server.test.ts`, `tests/electrician-link-page.test.ts`

**Interfaces:**
- Consumes: `newToken`, `hashToken`, `isTokenShape`, `linkState` (`worker-links.core.ts`); table `worker_job_links` (existing columns, no SQL); Task 1 `electricianStep`; `mittiFormUrl` (`mitti-link.core.ts`); the A3 PIESA audit (`assessments.external_mitti_id`) and A4 upgrades audit (latest `fixes_form_created` event, `fixes-day.core.ts`).
- Produces:
  - `ELECTRICIAN_LINK_DAYS_AFTER_DONE = 14`; `electricianLinkExpiry(f: { allDoneAt: string | null; now: number }): string` — `null` allDone → far expiry renewed on every open (now + 60 days); after All done → allDoneAt + 14 days.
  - `mintElectricianLink(jobId: string, workerId: string, actorId: string | null): Promise<{ token: string; url: string }>` — revokes this worker's older links for the job first (same as `createWorkerJobLink`).
  - `textElectricianLink(jobId: string, workerId: string, url: string): Promise<"sent" | "held" | "test_sent" | "no_mobile">` behind `ELECTRICIAN_LINK_TEXT_APPROVED = false`; body DRAFT `"Home Insulation Victoria: New PIESA job {HV}, {suburb}, for {installer}. Your job link: {url}"`; key `electrician-link:v1:{jobId}:{workerId}`.
  - `electricianLinkView(token: string): Promise<{ business: string; installer: string; jobNumber: string; owner: { name: string; phone: string | null } | null; address: string | null; view: ElectricianStepView; upgradesDay: string | null }>`.
  - Server functions (literal `createServerFn(...).inputValidator(...).handler(...)` chains, no auth middleware): `getElectricianLinkView({ token })`.
  - `electricianBusinessFor(jobId: string): Promise<TradeContact | null>` — the job's assigned electrician's business as Part 3's `TradeContact` (name, office phone `businesses.phone`, business email), `null` when none is assigned; consumed by Part 4 (PIESA "You're booked", upgrades email, All done contacts). Test it in Step 1: assigned → the business's office phone, never the worker's mobile; none → `null`.

- [ ] **Step 1: Write the failing server test** `tests/electrician-link-server.test.ts` (memory PostgREST helper `tests/helpers/memory-postgrest.ts`):
  - minting stores only `token_hash`, never the token; a second mint revokes the first (`revoked_at` set); the returned url is `{SET_PASSWORD_BASE}/e/{token}`.
  - `electricianLinkView` with a revoked link throws `"This link has been switched off. Ask {installer} for a new one."` (DRAFT); expired → `"This link has expired. Ask {installer} for a new one."` (DRAFT); a job no longer assigned to that electrician → switched-off message.
  - opening before All done pushes `expires_at` to now + 60 days; after `all_done` the expiry is All done + 14 days and is not pushed again.
  - `textElectricianLink` with the flag false → `"held"` and no send; TEST job → `sendTestSms` called once; same key twice → one send.
  - owner name/phone are `null` when `contact_releases` has no current release for that business.
- [ ] **Step 2: Run** `bun test tests/electrician-link-server.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the server module and server function; call `mintElectricianLink` + `textElectricianLink` at the end of `allocateElectrician` (after the existing atomic assignment succeeds; a failed text never fails the allocation — it is logged on the job).
- [ ] **Step 4: Write the failing page test** `tests/electrician-link-page.test.ts` (source-reading + `renderToStaticMarkup` of the step block): route `/e/$token`, `ssr: false`, robots `noindex, nofollow`, `referrer no-referrer`, uses `TradePublicShell`, shows `"{business} · {first}"`, title, owner name, `tel:` link on the phone, address, ONE green button; no menu, no prices, no "Messages", no rate items.
- [ ] **Step 5: Implement** `src/routes/e.$token.tsx` (website look; plain error card on a bad link).
- [ ] **Step 6: Run** both tests — Expected: PASS.
- [ ] **Step 7: Commit** `git commit -m "feat(electricians): no-login job link, minted on allocation, texted behind approval"`

### Task 3: Booking from the link — safety check and upgrades day, who-books respected

**Files:**
- Modify: `src/lib/electrician-link.server.ts` (add `bookFromElectricianLink`), `src/lib/electrician-link.functions.ts` (`bookElectricianLinkVisit`), `src/routes/e.$token.tsx`, `src/lib/booking.server.ts` (only if `validateBooking`/`confirmBooking` refuse a `null` actor — then add an explicit `actor: { kind: "electrician_link"; workerId: string }` overload; no gate changes), Part 5 `src/lib/next-step-box.core.ts` (`whoBooks "electrician"` + upgrades booked → `waiting_electrician_book` shows the upgrades day)
- Test: `tests/electrician-link-booking.test.ts`

**Interfaces:**
- Consumes: Part 5 `whoBooksOf`; existing canonical booking (`validateBooking(jobId, kind, start, actorId, proposedWorkerId?)`, `confirmBooking(...)` in `booking.server.ts`) and the in-house path used by `inHouseBookVisit` (`trade-view.server.ts`); Task 1 `canBookFromLink`.
- Produces: `bookFromElectricianLink(token: string, kind: "assessment" | "rectification", startIso: string): Promise<{ ok: true; start: string } | { ok: false; message: string }>`; event `electrician_link_booked` `{ kind, start, worker_id }`.

- [ ] **Step 1: Write the failing test** `tests/electrician-link-booking.test.ts`:
  - `"office"` installer → `{ ok: false, message: "Your installer books this one. Call them if the time needs to change." }` (DRAFT) and no booking row.
  - `"electrician"` installer → booking `kind "assessment"`, `status "confirmed"`, assigned to that electrician; then `electricianLinkView` shows `"piesa_day"`; the installer's Next step box shows `"piesa_booked"`.
  - `"either"`: office books first → the link's next view has no Book step and `bookFromElectricianLink` returns `{ ok:false, message: "Already booked for Fri 6 Nov, 10:00am." }` (DRAFT); two concurrent link calls → exactly one booking (`Promise.all`, count rows = 1).
  - Upgrades day: `kind "rectification"` only when the PIESA outcome is `"upgrades"` and not same-day; booking stores the date; the payment-before-upgrades guard does not apply when upgrades are billed by the electrician (existing partner-billed rule unchanged).
  - Every existing booking guard still runs (deposit/payment/30-day): a start after the install deadline is refused with the existing message.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** `bookFromElectricianLink`: resolve token → re-read `piesa_booked_by` fresh (never from the page) → `canBookFromLink` → run the same validation + confirm path `inHouseBookVisit` uses, inside the existing per-job lock so concurrent calls serialise; record the event; the owner's "You're booked" (PIESA) message is sent by Part 4's existing hook on booking confirm — do not send it here.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(electricians): book the safety check and upgrades day from the link"`

### Task 4: "PIESA booked" email with the approved wording and the job link

**Files:**
- Create: `src/lib/electrician-piesa-booked-email.core.ts`
- Modify: `src/lib/in-house-electrician-booked.server.ts` (`notifyInHouseElectricianBooked` uses the core; keeps its claim/retry/office-review logic and key)
- Test: `tests/electrician-piesa-booked-email.test.ts`

**Interfaces:**
- Produces: `renderElectricianPiesaBooked(i: { jobNumber: string; firstName: string | null; startIso: string; address: string; owner: { name: string; phone: string | null }; mittiUrl: string | null; test?: boolean }): { subject: string; html: string; text: string }`.

- [ ] **Step 1: Write the failing test**: for HV-1234, Will Casdorff, start `2026-11-05T23:00:00Z` (Fri 6 Nov 10:00am), owner Sarah Brown 0400 000 000, address "12 Example St, Box Hill VIC 3128":
  ```ts
  expect(r.subject).toBe("HV-1234: PIESA booked, Fri 6 Nov 10:00am");
  expect(r.text).toContain("Hi Will,");
  expect(r.text).toContain("PIESA booked: HV-1234");
  for (const s of ["Day", "Fri 6 Nov", "Arriving", "10:00am", "Address", "12 Example St, Box Hill VIC 3128", "Owner", "Sarah Brown, 0400 000 000", "Open the Mitti form"]) expect(r.text).toContain(s);
  expect(r.text).toContain("Need to change the time? Call Sarah Brown, then update it on the job.");
  expect(r.text).not.toMatch(/Pre Insulation Electrical Safety Assessment|portal|fixes/);
  ```
  Missing Mitti url → no button and no "Open the Mitti form" text; source test: the sender still uses key `in-house-electrician-booked:v1:{bookingId}:{contractor}` (so already-sent bookings never get a second email), and the "update it on the job" link points to the electrician's `/e/{token}` (minted if missing).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** with the shared MJML frame (`partnerEmailLayout` / `mjEmail`), no styling in `email-kit`.
- [ ] **Step 4: Run** `bun test tests/electrician-piesa-booked-email.test.ts tests/in-house-task7` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(electricians): approved PIESA booked email with the job link"`

### Task 5: Upload the Certificate of Electrical Safety (link and installer office, one upload counts for both)

**Files:**
- Create: `src/lib/coes-upload.server.ts`
- Modify: `src/lib/coes-check.server.ts` (`currentCoes`: add the uploaded-certificate source), `src/lib/electrician-link.functions.ts` (`uploadCoesByLink`), `src/lib/trade-view.functions.ts` (`uploadCoesForJob`, signed-in installer office), `src/components/trade/NextStepBox.tsx` (Part 5; `kind "upload_certificate"` gets the file input), `src/routes/e.$token.tsx`
- Test: `tests/coes-upload.test.ts`

**Interfaces:**
- Consumes: `FIXES_COES_DOC_KIND`, `FIXES_COES_DOC_TITLE` (`fixes-day.core.ts`); `checkCoes(jobId, fileRef, actorId)`; `sendCoesOwnerCopy(jobId, ref)` (`coes-owner-copy.server.ts`); private `job-files` bucket.
- Produces: `saveUploadedCoes(jobId: string, file: { name: string; type: string; bytes: Uint8Array }, by: { kind: "electrician_link"; workerId: string } | { kind: "installer_office"; userId: string }): Promise<{ ok: true; documentId: string }>`; `currentCoes` returns `source: "upload"` for these rows.

- [ ] **Step 1: Write the failing test** `tests/coes-upload.test.ts`:
  - PDF/JPEG/PNG/HEIC ≤ 15 MB accepted; other types → `"Upload a photo or PDF of the certificate."` (DRAFT).
  - Saved as one `documents` row `kind "piesa_evidence"`, `title "PIESA evidence – Certificate of Electrical Safety (photo or PDF)"`, `source_system "upload"`, storage path under `job-files/{jobId}/`; event `coes_uploaded { by }`.
  - Electrician upload then office upload → `currentCoes` returns ONE ref holding both files (key `coes:upload:{ids}`) and the Next step box + link both move past `upload_certificate`.
  - `checkCoes` is called once per new key; `sendCoesOwnerCopy` is NOT called directly here (it follows the existing tick/office-approval path, so the owner gets the copy before install exactly as today).
  - Uploading when no upgrades were needed → refused `"No certificate is needed for this job."` (DRAFT).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**; signed-in upload is allowed for boss and Office (`pricesOrThrow` from Part 5 is the role check) of the job's installer business only.
- [ ] **Step 4: Run** `bun test tests/coes-upload.test.ts tests/coes` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(electricians): upload the Certificate of Electrical Safety from the link or the job"`

### Task 6: "Can't do this one" on the link

**Files:**
- Modify: `src/lib/electrician-link.server.ts` (`electricianCantDo`), `src/lib/electrician-link.functions.ts`, `src/routes/e.$token.tsx`
- Test: `tests/electrician-cant-do.test.ts`

**Interfaces:**
- Consumes: the existing in-house hand-back cleanup (`in-house-handback-cleanup.server.ts`) for revoking form access; `bookings` cancel through the existing booking cancel path.
- Consumes (also): Part 4 `queueVisitCancelledOwnerEmail(jobId, bookingId, "electrician")`.
- Produces: `electricianCantDo(token: string, reason: string): Promise<{ ok: true }>`; event `electrician_cant_do { worker_id, reason, booking_cancelled: boolean }` (Part 9 reads it for ESC timing); when a confirmed PIESA/upgrades booking was cancelled it calls `queueVisitCancelledOwnerEmail` at once (Jo 2 Nov, answer 4: owner emailed straight away); the installer's Next step box returns to `book_piesa` with `Change electrician`.

- [ ] **Step 1: Write the failing test**: reason required (≥ 3 chars) — `"Tell us why in a few words."` (DRAFT); after the call the electrician's `job_assignments` row is inactive, all their `worker_job_links` for the job are revoked, a confirmed PIESA/upgrades booking for them is cancelled and `queueVisitCancelledOwnerEmail` is called once with that booking (not called when nothing was booked), the event is written once (second call → same `{ ok: true }`, no second event); the link then shows the switched-off message; an installer office email is prepared DRAFT `"{HV}: {electrician} can't do this one. Choose another electrician on the job."` behind `ELECTRICIAN_CANT_DO_EMAIL_APPROVED = false`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(electricians): Can't do this one sends the job back to the installer"`

### Task 7: Upgrades day on the job, nudges, and the 30-day red flag

**Files:**
- Create: `src/lib/upgrades-watch.core.ts`, `src/lib/upgrades-watch.server.ts`
- Modify: `src/routes/api/public/hooks/allocation-tick.ts` (call `sweepUpgradesWatch`), Part 5 `src/lib/job-page-rows.core.ts` (Visits row "Upgrades · {day}"), Part 5 `NextStepBox.tsx` (install booking warning)
- Test: `tests/upgrades-watch.test.ts`

**Interfaces:**
- Consumes: `job_piesa_deadlines.install_deadline`; the upgrades booking (`kind "rectification"`); `fixes_form_completed` event; `melbourneToday`, `addYmd`.
- Produces:
  - `installBeforeUpgradesWarning(f: { installStart: string; upgradesStart: string | null }): string | null` → DRAFT `"The upgrades are booked for {Ddd D Mmm}. You can still book the install, but it can't start until the certificate is in."`; never blocks.
  - `upgradesNudgeDue(f: { upgradesYmd: string; formDone: boolean; now: Date; nudgedElectrician: boolean; emailedOffice: boolean }): "electrician" | "office" | null` — electrician the day after the upgrades day (from 9am Melbourne), installer office the day after that.
  - `upgradesPastWindow(f: { upgradesYmd: string; installDeadlineYmd: string }): boolean` (true when the upgrades day is after the 30-day install deadline).
  - `sweepUpgradesWatch(now?: Date): Promise<{ nudges: number; officeEmails: number; redFlags: number }>`; sends: electrician text DRAFT `"Home Insulation Victoria: {HV} upgrades were booked for yesterday. Open your job link to fill in the upgrades form: {url}"` (`UPGRADES_NUDGE_TEXT_APPROVED = false`); office email DRAFT subject `"{HV}: upgrades form not in"` (`UPGRADES_OFFICE_EMAIL_APPROVED = false`); red flag = office Needs me row `upgrades_past_30_days` (internal event, always on) + installer office email DRAFT subject `"{HV}: upgrades day is past the 30-day rule"` with a copy to info@ (`UPGRADES_RED_FLAG_EMAIL_APPROVED = false`).

- [ ] **Step 1: Write the failing test** `tests/upgrades-watch.test.ts`: upgrades Wed 11 Nov, no form → `upgradesNudgeDue` `null` on Wed, `"electrician"` Thu 12 Nov 9:00 Melbourne, `"office"` Fri 13 Nov once the electrician was nudged, `null` once `formDone`; `upgradesPastWindow({ upgradesYmd: "2026-12-08", installDeadlineYmd: "2026-12-06" })` → `true`, `"2026-12-06"` → `false`; `installBeforeUpgradesWarning` returns the line when install < upgrades and `null` otherwise; sweep: each send once per key (`upgrades-nudge:v1:{jobId}:{ymd}`, `upgrades-office:v1:…`, `upgrades-red-flag:v1:{jobId}:{ymd}`), flags false → held, TEST → test-send, red-flag Needs me row always written once.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** core, server sweep (paged 200 like other sweeps; a read failure logs and sends nothing) and the tick call.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(electricians): upgrades day nudges and the 30-day red flag"`

### Task 8: Remove the electrician sign-in and its screens

**Files:**
- Modify: `src/routes/_authenticated/field.tsx` (electrician-only users → `NO_LOGIN_NEEDED` page from Part 5), `src/lib/trade-access.core.ts` (electricians never get an invite — Part 5 Task 1 already returns `NO_LOGIN_NEEDED`; here remove the electrician branch of `grantedRole` callers that send invites), `src/routes/_authenticated/field.$jobId.tsx` (delete `ElectricianFlow`, `OtherItems`, `MittiOnly` electrician use), `src/routes/_authenticated/field.index.tsx` (delete electrician home), `src/lib/trade-view.core.ts` (delete `ELECTRICIAN_GUIDE_STEPS`, `ELECTRICIAN_GUIDE_WORDS`, `ELECTRICIAN_WORK_WORDS`), `src/routes/w.$token.tsx` (remove the electrician "Mandatory safety electrical fixes" rate box), `src/lib/worker-links.functions.ts` (delete `getWorkerApprovedRectificationRates`, `addWorkerApprovedRectificationItem`), `src/routes/portal.tsx` (meta description drops "and electricians"), `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md`, `src/config/workflow-decisions.ts`
- Test: `tests/electrician-no-login.test.ts`

- [ ] **Step 1: Write the failing test**: an electrician-role user hitting `/field` gets the no-login page (route source checks `a.electrician && !a.installer && !a.admin`); `field.$jobId.tsx` has no `ElectricianFlow`/`OtherItems`; `field.index.tsx` has no electrician tiles ("Needs me", "Your move", "Slow"); `w.$token.tsx` has no "fixes" text; the two rectification server functions are gone; `tradeAccessBlocker` for `trade_role "electrician"` returns `NO_LOGIN_NEEDED`; `/field/money` for an electrician-only user is refused. Existing electrician business onboarding (`/electrician-onboarding`) and office approval screens are untouched.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement the removals;** update the two workflow docs in the same commit ("Electricians never log in; each job is one no-login link"); `bun scripts/scan-retired-terms.ts` → 0.
- [ ] **Step 4: Run** `bun test tests/electrician-no-login.test.ts` and `bun run test` — Expected: PASS (update older tests that asserted the removed screens; keep every test that pins a booking or pay guard).
- [ ] **Step 5: Commit** `git commit -m "chore(electricians): remove electrician sign-in and its screens"`

### Task 9: The person who lets the trades in, on the link and the "PIESA booked" email (Jo 2 Nov, answer 7)

**Files:**
- Modify: `src/lib/electrician-link.server.ts` (`electricianLinkView` adds `access`), `src/routes/e.$token.tsx`, `src/lib/electrician-piesa-booked-email.core.ts` (Task 4: optional `access`), `src/lib/in-house-electrician-booked.server.ts` (passes it)
- Test: `tests/electrician-access-person.test.ts`

**Interfaces:**
- Consumes: Part 3 Task 19 `type AccessPerson = { who: "owner" | "tenant" | "property_manager"; name: string; mobile: string }`, `accessPersonFor(jobId)`; the same `contact_releases` rule as the owner's details.
- Produces: `electricianLinkView(...)` result gains `access: { name: string; role: "tenant" | "property manager"; phone: string } | null` (only when `who` isn't `"owner"`); `renderElectricianPiesaBooked(i)` input gains `access?: { name: string; role: string; phone: string } | null` → one more table row DRAFT `"Lets you in"` = `"Tina Lee (tenant), 0400 111 222"` and the last line becomes DRAFT `"Need to change the time? Call Tina Lee, then update it on the job."`; `ELECTRICIAN_ACCESS_ROWS_APPROVED = false` (while false the email stays exactly as Task 4; the link shows the row — screens switch on with this part's sign-off).

- [ ] **Step 1: Write the failing test** — rental with tenant Tina Lee: the link view has `access = { name: "Tina Lee", role: "tenant", phone: "0400 111 222" }` and the page shows a `tel:` link for her above the owner's details, with DRAFT `"Call Tina to arrange the time."`; owner-occupied or `who: "owner"` → `access: null`, page unchanged; no current contact release → `access: null` (same rule as the owner); email with the flag on → contains the "Lets you in" row and the Tina change line; flag off → byte-identical to Task 4's output.
- [ ] **Step 2: Run** `bun test tests/electrician-access-person.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test tests/electrician-access-person.test.ts tests/electrician-piesa-booked-email.test.ts tests/electrician-link-server.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(electricians): show and call the person who lets you in at rentals"`

### Task 10: Full checks and Jo's sign-off pack

- [ ] **Step 1:** `bun run test` — all green; `bun scripts/scan-retired-terms.ts` — 0.
- [ ] **Step 2:** On TEST jobs (journey TEST personas; the real runs with Tom's Electrical are Part 11): walk one job through each who-books setting (Our office / Our electrician / Either), no-upgrades, same-day upgrades, upgrades another day, a rental with a tenant letting us in, and Can't do this one; `bun run portal-qa` for `/e/{token}` and the installer Job page.
- [ ] **Step 3:** Phone-width pictures of every link step, the PIESA booked email (with and without the "Lets you in" row), and one text paste of every DRAFT line (link text, step titles/buttons, error lines, nudges, office emails, red flag, can't-do email, access-person lines). All flags stay false until Jo approves.

## Open questions for Jo

None left for this part. The draft link text, nudges and office emails are approved from the Task 10 pictures at build time (each behind its own flag).

## Decided (Jo, 2 Nov evening)

- **30-day red flag (answer 13):** email to the installer office, copy to info@, plus a Needs me row for Jo (Task 7, as planned).
- **Access at rentals (answer 7):** trades call the person who lets them in; shown on the link and the PIESA booked email (Task 9).
- **"Can't do this one" (answer 4):** the owner is emailed straight away (Task 6 calls Part 4's sender).

## Assumptions

- The approved #39 email's last line ends "…update it on the job." (the spec drops "in the portal" because electricians no longer log in).
- The link reuses the existing `worker_job_links` table (no SQL); it is minted when the installer chooses the electrician and lasts until 14 days after All done.
- Upgrades billed by the electrician directly are "partner-billed": the existing "pay for upgrades before booking" guard doesn't apply to them, as today for partner-billed rectification.
- Nudge timing: electrician from 9am the day after the upgrades day; installer office the next day. Quiet hours (8pm–7am) apply to texts.
- The owner's "You're booked" (PIESA), "date can't be kept", and CoES copy messages are Part 4's; this part records the events they read and calls Part 4's `queueVisitCancelledOwnerEmail` from "Can't do this one". Part 5 owns the who-books setting UI/storage and the Next step box; this part adds the certificate upload control into that box. Part 9 owns ESC timing and the "Part C + certificate on every reschedule" gate.
- The 6:30am jobs text no longer goes to electricians (Part 7 makes it workers-only; electricians get their link instead).
