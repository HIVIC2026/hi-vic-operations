# Part 9 — Compliance gates + ESC/VEU timing rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every gate in the spec's "Compliance gates and checks" table and every "VEU and ESC timing rule" blocks exactly as written, is tested by trying to break it, and the GO / DON'T START check runs at 2pm the day before and 6:30am on the day.

**Architecture:** Most gates already exist as pure rules (`esc.core.ts`, `prestart.core.ts`, `consent.core.ts`, `worker-compliance.core.ts`, `trade-expiry.core.ts`, `trade-payout-gate.core.ts`, `install-evidence.core.ts`, `esc-registry-robot.core.ts`) with thin `*.server.ts` readers. This part changes only the deltas, keeps one rule per gate in its existing core, and pins every already-correct gate with a "try to break it" test. New facts are added to `PrestartFacts` so the day-before check, Installation complete and pay all read the same rule. New sends (GO / DON'T START email, insurance expiry reminders) are wording drafts for Jo, behind approval constants that default `false`.

**Tech Stack:** TypeScript, bun:test, Supabase, PGlite (one pending migration), existing guarded senders (`sendInHouseOfficeAlert`, `test-send.server`).

**Spec:** `docs/superpowers/specs/2026-11-02-new-job-flow-design.md` (rev 31): "Compliance gates and checks", "VEU and ESC timing rules", "More VEU Code of Conduct rules" (PIESA copy timing, electrician at the install, adult present), "Testing and Jo's sign-off". Facts: ESC Ceiling Insulation Activity Guide v1.2 §3.3 (notification ≥24h and ≤5 days before start, after consent; update keeps the ID only for start/end, Lead Installer and its details, new start within the next five days, original start not passed; anything else withdraw + resubmit with a new ID; PIISA within 30 days of the PIESA; install starts ≥24h after the notification; consent ≥24h before start; PIESA copy to owner and installer ≥24h before start).

## Global Constraints

- Source of truth: `hiv-touchpoint-decisions.md` (2 Nov 2026); latest dated decision wins; "Decisions from the electrician + SWMS chat" wins over earlier.
- Read root `AGENTS.md`, `src/AGENTS.md`, `src/lib/AGENTS.md`, `scripts/AGENTS.md` before edits; run `bun scripts/scan-retired-terms.ts` before workflow work. Update `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md`, `src/config/workflow-decisions.ts` and the relevant AGENTS.md line in the same commit as any rule they state.
- Root AGENTS rule stays true: "Same-start ESC updates retain the prior notice timestamp and ID."
- The ESC notice is submitted by hand or by the Registry robot (no ESC API); the portal never claims a notice, update or withdrawal that wasn't recorded with a reference.
- Every gate fails closed: a read failure blocks, never clears.
- GO / DON'T START goes to the installer office by email only (no text to the Lead Installer); info@homeinsulationvictoria.com.au gets a copy of every DON'T START, never of GO.
- New sends: no approved wording exists for the GO / DON'T START email or the insurance expiry reminders → draft → Jo approves → send stays behind `GO_EMAIL_APPROVED = false` / `INSURANCE_REMINDER_APPROVED = false` until she does. TEST jobs go to test-send.
- "Do NOT block booking an install before upgrades are done (warning only)"; the GO check is where it blocks.
- Deposit and booking (Jo 2 Nov, answer 21 — supersedes 3 and 5): the 10% deposit is paid on the confirm-and-pay page, which opens straight after the PIESA result (also when upgrades are still to come); the install day can only be booked AFTER the deposit is paid (`installDepositBlocker` kept); booking before the upgrades day is a warning only; the GO check (2pm day before / 6:30am) still requires the Part C + Certificate of Electrical Safety when upgrades were needed. There is no "deposit by 2pm the day before" rule. Task 10.
- Insurance/licence expiry reminders go to the installer's main business email with a copy to info@homeinsulationvictoria.com.au (answer 17). Task 8.
- Real-run jobs (answers 18–19) carry a per-job "no ESC" marker: the ESC notice robot, every Registry submission/update recorder and certificate (VEEC) creation refuse them. Task 14; Part 11 uses it.
- New SQL goes in `docs/pending-migrations/` with a PGlite test; never run live without Jo's go-ahead.
- Trades see PIESA, SWMS, PIISA, ESC, CII without explanation; write "Home Insulation Victoria" and "Lead Installer" in full.

## Review Focus

1. **Install day moves after the ESC notice is sent** (overview #2): inside 5 days → update, same ID; further out, address change, "Owner cancelled", "Can't do this one" → withdraw; the GO check re-runs after every move. Tasks 1, 2, 3.
2. **A job on the old flow at 12pm-day-before when this ships.** A check already recorded at 12pm for tomorrow must not be lost or duplicated; the 2pm run records only if the result changed (existing `runPrestart` rule). Task 6 test.
3. **Lead Installer changed one hour before the 5pm lock, robot updates the notice at 4:59pm.** The update must keep the original `sent_at` (same start) so the 24h check doesn't flip to DON'T START. Task 3 test.
4. **Refund after VEEC creation** (Stripe refund arrives days later). Can't be stopped in Stripe; the office must be told at once. Task 11 test.
5. **Insurance renewed by upload only.** Upload alone never lifts the block; office approval does; a missing date on file blocks. Task 8 test.

---

## Task 1: ESC notice — address change (same start) means withdraw, and every notice change re-runs the GO check

Today `escTask` only compares start times, so a changed address with the same start tells the office "Submit", not "Withdraw first". The robot (`planNotification`) already uses `registryChange`; the office task must too.

**Files:**
- Modify: `src/lib/prestart.core.ts` (`escTask`, `escReminder`)
- Modify: `src/lib/prestart.server.ts` (`prestartNeeds`, `prestartSummary` pass the change)
- Modify: `src/lib/esc.server.ts` (`regenerateEscNotification` ends with `runPrestart(jobId, "esc_regenerated")`)
- Test: `tests/new-flow-09-esc-notice-moves.test.ts`

**Interfaces:**
- `escTask(i: { start: string; current: EscNotice | null; previousSent: EscNotice | null; change: RegistryChange | null; now: Date })` — when `change?.action === "withdraw_and_resubmit"` → `esc_withdraw_resubmit` with detail naming `change.reasons`; when `"update_same_id"` → `esc_update_registry`; `change === null` keeps today's start-only logic (callers without a payload).
- `escReminder` takes and forwards the same `change`.

- [ ] **Step 1: Write the failing test** — one test per Review Focus #1 case, each using `registryChange` on two Table-5 payloads (`fields_version: REGISTRY_FIELDS_VERSION`):
  - start moves from Thu 10am to Sat 10am, now = Tue → `update_same_id` → `escTask(...).code === "esc_update_registry"`.
  - start moves 8 days out → `esc_withdraw_resubmit`, detail contains "more than 5 days away".
  - same start, `premises_address` changed → `esc_withdraw_resubmit`, detail contains "Installation address".
  - same start, `lead_installer` changed → `esc_update_registry`.
  - server: mocked `regenerateEscNotification` path calls `runPrestart` with trigger `"esc_regenerated"` (spy).
- [ ] **Step 2: Run** `bun test tests/new-flow-09-esc-notice-moves.test.ts` — Expected: FAIL (address case returns `esc_submit_due`).
- [ ] **Step 3: Implement** as in Interfaces; `prestartNeeds`/`prestartSummary` build `change` the way `prestartSummary` already does (latest `previousSent` payload vs current payload).
- [ ] **Step 4: Run** the test plus `bun test tests/esc-registry.test.ts tests/jo-morning-registry-update.test.ts tests/prestart*.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "fix(esc): address change on a sent notice means withdraw; notice changes re-run the GO check"`

---

## Task 2: Withdraw the ESC notice on "Owner cancelled" and "Can't do this one"

`cancelJobFully` (`office-actions.server.ts:88`) cancels only UNSENT notices; a SENT notice is left live in the Registry with no office task (there's no booking left, so `prestartNeeds` never sees it).

**Files:**
- Modify: `src/lib/esc.core.ts` (pure `escWithdrawalNeeded`)
- Modify: `src/lib/esc.server.ts` (`requireEscWithdrawal`)
- Modify: `src/lib/office-actions.server.ts` (`cancelJobFully` calls it)
- Modify: `src/lib/allocation.core.ts` (`NeedsCode` + `esc_withdraw_required` entry), `src/lib/office-needs.server.ts` (row from the event, cleared by `esc_notification_withdrawn`)
- Test: `tests/new-flow-09-esc-withdraw-on-cancel.test.ts`

**Interfaces:**
- `escWithdrawalNeeded(notices: { id: string; status: string; sent_at: string | null; submission_reference: string | null; response?: unknown }[]): { id: string; reference: string }[]` — sent, referenced, not withdrawn.
- `requireEscWithdrawal(jobId: string, reason: "owner_cancelled" | "cant_do_this_one" | "address_changed", actorId: string | null): Promise<number>` — one internal `esc_withdraw_required` event per notice id (`details: { notification_id, reference, reason, needs_office: true }`, idempotent by notice id); returns how many.
- Needs me: `esc_withdraw_required: { why: "Install won't go ahead but the ESC notice is still live.", next: "Withdraw it in the Registry, then record the withdrawal on the job.", tab: "compliance", urgency: "urgent" }`; cleared when `withdrawEscNotification` records that notice.
- Consumed by Part 5 (installer "Can't do this one") — it calls `requireEscWithdrawal(jobId, "cant_do_this_one", actorId)`.

- [ ] **Step 1: Write the failing test** — pure: a sent notice + a withdrawn one + an unsent one → only the sent one. Server (mocked admin): `cancelJobFully` on a job with a sent notice writes one `esc_withdraw_required` with `reason: "owner_cancelled"`; calling twice writes one; after `withdrawEscNotification`, the Needs me row is gone.
- [ ] **Step 2: Run** `bun test tests/new-flow-09-esc-withdraw-on-cancel.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** (the robot never withdraws — no verified Registry selector — so the office does it by hand and records it with `withdrawEscNotification`).
- [ ] **Step 4: Run** the test plus `bun test tests/office-actions*.test.ts tests/office-needs*.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(esc): cancelled or handed-back jobs raise 'withdraw the ESC notice' for the office"`

---

## Task 3: One rule for "same-start update keeps the original timestamp and ID"

The rule (root AGENTS) is duplicated as an inline patch in `esc.server.ts:173` and `esc-registry-robot.server.ts:217`. Move it into the pure `registryUpdatePatch` so both paths share one tested rule.

**Files:**
- Modify: `src/lib/esc.core.ts` (`registryUpdatePatch`)
- Modify: `src/lib/esc.server.ts`, `src/lib/esc-registry-robot.server.ts` (drop the inline `if(Date.parse(prev.scheduled_start)===…)` lines)
- Test: `tests/new-flow-09-esc-same-start.test.ts`

**Interfaces:**
- `registryUpdatePatch(p, nowIso)` returns `sent_at = p.prev.sent_at` when `prev.scheduled_start` equals the new start (Lead Installer/details update), else `p.updatedAt`; `submission_reference` always `prev.submission_reference`. Its input type gains `nextStart: string`.

- [ ] **Step 1: Write the failing test** — Review Focus #3: prev sent Tue 9am for a Thu 10am start; Lead Installer update recorded Wed 4:59pm, same start → `sent_at` is still Tue 9am and `readyToInstall`'s ESC line has no "less than 24h" blocker; start moved to Fri 10am, update Wed 4:59pm → `sent_at === updatedAt` and ref unchanged.
- [ ] **Step 2: Run** `bun test tests/new-flow-09-esc-same-start.test.ts` — Expected: FAIL (patch returns `updatedAt` for same start).
- [ ] **Step 3: Implement**; remove the two inline overrides.
- [ ] **Step 4: Run** the test plus `bun test tests/jo-morning-registry-update.test.ts tests/esc-registry.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "refactor(esc): same-start update keeps the original notice time in one pure rule"`

---

## Task 4: PIISA timing — within 30 days of the PIESA and at least 24h after the ESC notice

The A5 before-work declaration (Q36 signature) is the PIISA. Today only "within 30 days of the PIESA" is checked (by install date, `prestartFailures`). Add the signature-time check at Installation complete.

**Files:**
- Modify: `src/lib/esc.core.ts` (pure `piisaTimingBlockers`)
- Modify: `src/lib/install-evidence.core.ts` (`InstallCompletionInput.piisaTiming`, `installCompletionDecision`)
- Modify: `src/lib/install-complete-mitti.server.ts` (reads the facts: Q36 `declarationSignature.signedAt`, current sent notice `sent_at`, `clearanceFacts(jobId).piesaCompletedAt`)
- Test: `tests/new-flow-09-piisa-timing.test.ts`

**Interfaces:**
- `piisaTimingBlockers(i: { piisaSignedAt: string | null; noticeSentAt: string | null; piesaCompletedAt: string | null }): string[]` →
  - `"PIISA signed less than 24 hours after the ESC notice was sent (sent {Melbourne time})."`
  - `"PIISA signed more than 30 days after the PIESA ({date})."`
  - missing inputs → one line each ("No ESC notice recorded as sent", "PIESA completion date missing", "PIISA signature time missing").
- `installCompletionDecision` holds with `nextLine` = first blocker when any.

- [ ] **Step 1: Write the failing test** — notice sent Mon 10:00, PIISA signed Tue 09:59 → blocked; Tue 10:00 → clear; PIESA 1 Oct, PIISA 31 Oct → clear, 1 Nov → blocked (Melbourne dates, one DST-crossing case in early October).
- [ ] **Step 2: Run** `bun test tests/new-flow-09-piisa-timing.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** (reuse `LEAD_MS`, `melbourneYmd`, `PIISA_FROM_PIESA_DAYS`).
- [ ] **Step 4: Run** plus `bun test tests/install-evidence*.test.ts tests/decision-396-a5-ruler-photos.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(gates): PIISA must be signed 24h+ after the ESC notice and within 30 days of the PIESA"`

---

## Task 5: GO check — the new facts (ESC registration, electrician at install, life support, Part C copy)

`prestartFailures` already checks: electrical clearance, 30-day window, ESC notice sent for this start and its 24h/5-day timing, Lead CII, collection notice, White Card, owner consent ≥24h (`consentValidityBlockers`), PIISA ≤30 days, site hold, public liability, SWMS signatures, deposit, PIESA copies to owner + installer ≥24h. Missing from the spec list: Lead Installer ESC-registered (on ALL jobs, audit fix), electrician booked for install when the PIESA requires it, life support plan on file, and the updated PIESA (with Part C) delivered ≥24h before when upgrades were done.

**Files:**
- Modify: `src/lib/prestart.core.ts` (`LeadCert.escRegistered`, `PrestartFacts` new optional fields, `prestartFailures`)
- Modify: `src/lib/prestart.server.ts` (`leadInstallerCert` reads `partner_workers.esc_registered`; `prestartFacts` fills the new fields)
- Modify: `src/lib/esc.core.ts` (`piesaCopyDeliveryBlockers` takes `partCSignedAt`)
- Modify: `src/lib/esc.server.ts` (`piesaCopyDeliveries` returns all delivery times per recipient, not only the first)
- Test: `tests/new-flow-09-go-check-facts.test.ts`

**Interfaces:**
- `LeadCert.escRegistered?: boolean | null` → failure `"Lead Installer {name} is not registered with the ESC yet."` when `false` (undefined = not loaded, older callers).
- `PrestartFacts.electricianAttendance?: { required: boolean; state: "confirmed" | "declined" | "waiting" } | null` → failure `"The PIESA needs an electrician at the install and they haven't confirmed."` when required and not confirmed (read with `attendanceRequired` + `attendanceState`, `install-attendance.core.ts`).
- `PrestartFacts.lifeSupportPlanMissing?: boolean` → `"Life support at this home: the written consent or medical plan isn't on file."` (reader `lifeSupportPlanMissing`, `job-records.server.ts`; counts the PIESA attachment after Part 8 Task 4).
- `piesaCopyDeliveryBlockers(start, deliveries: { owner: string[]; installer: string[] }, opts?: { partCSignedAt?: string | null })` — a copy counts only if delivered at or after `partCSignedAt` and ≥24h before start; new lines `"Updated PIESA (with Part C) not delivered to the owner by {time}"` / `…installer…`.

- [ ] **Step 1: Write the failing test** — a full passing `PrestartFacts` fixture, then one break at a time (spec "try to break it"): lead not ESC-registered; attendance required + waiting; attendance required + confirmed (passes); life support plan missing; Part C signed Wed 3pm, copies delivered Tue → two Part C lines; copies re-delivered Wed 4pm for a Fri 8am start → passes. Also pin existing gates: consent signed 23h before → `"Owner consent: Owner ESC consent was completed less than 24h before start – reschedule"`; PIESA copy to owner 23h before → blocked; install day 31 days after the PIESA → `"The 30-day window ended on …"`; missing SWMS signature → the SWMS line.
- [ ] **Step 2: Run** `bun test tests/new-flow-09-go-check-facts.test.ts` — Expected: FAIL on the four new cases.
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run** plus `bun test tests/prestart*.test.ts tests/esc-registry.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(gates): GO check adds ESC registration, electrician at install, life support plan, Part C copy"`

---

## Task 6: GO check runs at 2pm the day before and 6:30am on the day

**Files:**
- Modify: `src/lib/prestart.core.ts` (`PRESTART_HOUR` → slots)
- Modify: `src/lib/prestart.server.ts` (`runPrestart(jobId, trigger, now)` records the slot; `sweepPrestart`)
- Test: `tests/new-flow-09-go-times.test.ts`

**Interfaces:**
- `GO_SLOTS = [{ key: "day_before_2pm", dayOffset: -1, hour: 14, minute: 0 }, { key: "on_day_630am", dayOffset: 0, hour: 6, minute: 30 }] as const`; `goSlotTimes(startIso): Record<GoSlot, string>`; `dueGoSlot(startIso, now: Date, done: GoSlot[]): GoSlot | null` (latest passed, not yet done, before start).
- `prestartRunAt(startIso)` = the 2pm slot (it is the lock time used by `prestartLocked`).
- `pre_start_checks.trigger` stores the slot key; a slot run always writes a row once (the email in Task 7 needs one result per slot), other triggers keep "record only when changed".

- [ ] **Step 1: Write the failing test** — Thu 8am start: slots Wed 14:00 and Thu 06:30 Melbourne (and across the 5 Oct 2026 DST change); `dueGoSlot` at Wed 13:59 → null, 14:00 → `day_before_2pm`, Thu 06:30 with 2pm done → `on_day_630am`, Thu 08:00 → null; Review Focus #2: an old 12pm `timer` row exists, 2pm slot still runs and writes one slot row.
- [ ] **Step 2: Run** `bun test tests/new-flow-09-go-times.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**; `sweepPrestart` asks `dueGoSlot` per upcoming install (done = slot keys already in `pre_start_checks` for that start).
- [ ] **Step 4: Run** plus `bun test tests/prestart*.test.ts tests/journey*.test.ts` — Expected: PASS (update the journey's "noon the day before" step label to 2pm).
- [ ] **Step 5: Commit** — `git commit -m "feat(gates): GO check at 2pm the day before and 6:30am on the day"`

---

## Task 7: GO / DON'T START email to the installer office (draft → Jo approves)

No approved wording exists. Draft below; Jo approves at phone width before `GO_EMAIL_APPROVED` turns on.

Draft — subject `HV-1234: GO for tomorrow 8:00am` / `HV-1234: DON'T START — {n} thing(s) missing`; body GO: `All set for {address}, {day time}. Lead Installer: {name}.` + button `Open the job`; body DON'T START: `Don't start the install at {address} on {day time} until these are fixed:` + bullet list of `prestartFailures` lines + `We'll check again at 6:30am.` (2pm run only) + button `Open the job`.

**Files:**
- Create: `src/lib/go-email.core.ts`, `src/lib/go-email.server.ts`
- Modify: `src/lib/prestart.server.ts` (after a slot run, call `sendGoEmail`)
- Test: `tests/new-flow-09-go-email.test.ts`

**Interfaces:**
- `GO_EMAIL_APPROVED = false as boolean`; `goEmail(i: { jobNumber: string; address: string; startIso: string; lead: string | null; failures: string[]; slot: GoSlot; link: string }): { subject: string; text: string; html: string }` (`partnerEmailLayout`).
- `goEmailKey(jobId, startIso, slot)` = `go-email:v1:${jobId}:${startIso}:${slot}`.
- `sendGoEmail(jobId, slot, result): Promise<string>` — to the installer business email; on DON'T START a second send to `info@homeinsulationvictoria.com.au` (key suffix `:office`); via `sendInHouseOfficeAlert` (guarded: qa_test → test-send, comms switch); returns `"awaiting approval"` while `GO_EMAIL_APPROVED` is false and records nothing.

- [ ] **Step 1: Write the failing test** — subjects/bodies match the draft exactly; GO has no info@ copy; DON'T START has both; same slot twice → one send per recipient (key); flag false → `"awaiting approval"`, no sender call; qa_test → test-send.
- [ ] **Step 2: Run** `bun test tests/new-flow-09-go-email.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** — Expected: PASS. Send Jo the GO and DON'T START wording as text + phone-width pictures; set the flag true only on her OK (separate commit).
- [ ] **Step 5: Commit** — `git commit -m "feat(gates): GO / DON'T START email to the installer office (held until Jo approves)"`

---

## Task 8: Insurance and licence — hard block until the office approves; $5m+; workers comp; reminders 30 and 7 days

**Files:**
- Create: `docs/pending-migrations/2026-11-02-credential-amount-insured.sql` (+ `.rollback.sql`): `alter table public.business_credentials add column if not exists amount_insured_aud numeric null;`
- Create: `tests/new-flow-09-credential-amount.pglite.test.ts`
- Modify: `src/lib/trade-view.core.ts` (`latestExpiry` gains `{ verifiedOnly: boolean }`)
- Modify: `src/lib/trade-expiry.core.ts` (`expiredBusinessDocsBlocker` → `businessDocsBlocker`, adds missing / unverified / amount / workers comp)
- Modify: `src/lib/worker-compliance.core.ts` (`publicLiabilityBlocker` missing = block)
- Modify: `src/lib/booking.server.ts` (`validateBooking` for every kind), Add a job (`src/lib/add-installer-job.server.ts`), `prestart.server.ts`
- Create: `src/lib/insurance-reminder.core.ts`, `src/lib/insurance-reminder.server.ts`
- Test: `tests/new-flow-09-insurance-gate.test.ts`

**Interfaces:**
- `businessDocsBlocker(creds: CredentialView[], today: string): string | null` — blocks when public liability or workers comp is: not on file; latest VERIFIED expiry `< today`; a newer upload not yet verified while the verified one is expired ("Uploaded, waiting for Home Insulation Victoria to check it"); public liability `amount_insured_aud < 5_000_000` (null amount on a verified row = block "amount not recorded"). Installer certification and REC rules unchanged.
- Used by: `validateBooking` (all kinds), Add a job, offers (existing caller), `prestartFacts.publicLiabilityBlocker` (renamed field `businessDocsBlocker`).
- Electrician licence expiry missing = block: already in `electricianVerified` ("Licence expiry missing"); `validateBooking("assessment")` calls it for the booked electrician on every job (today only the in-house path does).
- `INSURANCE_REMINDER_APPROVED = false`; `dueInsuranceReminder(expiresOn, today, done): 30 | 7 | null`; draft wording: subject `Your {document} expires on {date}`, body `Upload the new one on My business before {date}. Until Home Insulation Victoria has checked it, you can't take new jobs, bookings or installs.` — Jo approves at build time. Recipients (Jo 2 Nov, answer 17): the installer's main business email (`businesses.email`), copy to `info@homeinsulationvictoria.com.au` (key suffix `:office`). Electricians' licence reminders go the same way to their business email.

- [ ] **Step 1: Write the failing tests** — PGlite: migration adds the column, is idempotent, rollback removes it. Pure: expired verified + fresh unverified upload → still blocked with the "waiting to check" line; office verifies → clear; no PL on file → blocked; PL $2m verified → blocked; workers comp missing → blocked; reminder due at 30 and 7 days, once each, each sent to the business email AND info@ (two sends, one key each). Server: `validateBooking` throws the blocker for an installation and for a Ready Check.
- [ ] **Step 2: Run** `bun test tests/new-flow-09-credential-amount.pglite.test.ts tests/new-flow-09-insurance-gate.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**; office "Approve" on My business/Partners writes `verification='verified'` + `amount_insured_aud` (existing verify action gains the amount field).
- [ ] **Step 4: Run** plus `bun test tests/trade-expiry*.test.ts tests/worker-compliance*.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(gates): insurance blocks until office-approved, \$5m+ and workers comp required, expiry reminders held for approval"`

---

## Task 9: Required on file before working + Lead Installer lock

**Files:**
- Modify: `src/lib/worker-compliance.core.ts` (`requiredOnFileBlockers`)
- Modify: `src/lib/prestart.core.ts` (`leadInstallerLock`, `leadInstallerLocked`, `LEAD_LOCKED_MESSAGE`)
- Modify: `src/lib/booking.server.ts` (`validateBooking` reschedule of an installation), `src/lib/in-house-booking.server.ts` (`recordLeadChange`)
- Test: `tests/new-flow-09-required-and-lock.test.ts`

**Interfaces:**
- `requiredOnFileBlockers(people: { name: string; role: "boss" | "office" | "lead" | "crew" | "electrician"; dateOfBirth: boolean; mobile: string | null; ciiVerified: boolean; licenceRecVerified: boolean }[]): string[]` — every person: DOB + mobile; Lead Installer and crew: CII/EEC verified; electrician: licence + REC (`electricianVerified`). Consumed by `validateBooking` (people on the booking) and offers.
- `leadInstallerLock(installStartIso: string): { emailAt: string; lockAt: string; lockLabel: string }` — 9:00 (email) and 17:00 (lock) Melbourne wall-clock, two calendar days before the install's Melbourne date; `lockLabel` = `"Wed 11 Nov, 5pm"`. `leadInstallerLocked(installStartIso: string, now: Date): boolean`. `LEAD_LOCKED_MESSAGE = "Locked: ESC has been told. Email us to move this install."` (approved screen wording, decisions file).
- The ONE lock rule (overview cross-part decision): Part 5 shows it (`lockLabel`, the "Locked" line), Part 7 sends the 9am email and refuses the Lead/crew/time writers — both import these names, never re-implement the clock.

- [ ] **Step 1: Write the failing test** — crew member with no DOB → `"{name}: date of birth missing"`; Lead without verified CII → blocked; `leadInstallerLock("2026-11-12T20:30:00Z")` (Fri 13 Nov 7:30am) → `{ emailAt: "2026-11-10T22:00:00.000Z", lockAt: "2026-11-11T06:00:00.000Z", lockLabel: "Wed 11 Nov, 5pm" }`; DST: `leadInstallerLock("2026-10-05T21:00:00Z")` (Tue 6 Oct 8am AEDT) → `emailAt "2026-10-03T22:00:00.000Z"`, `lockAt "2026-10-04T06:00:00.000Z"`; `leadInstallerLocked(start, "2026-11-11T05:59:00Z")` → false, `"…06:00:00Z"` → true; Thu 8am start: lock at Tue 17:00; `validateBooking` moving that install at Tue 17:01 → throws `LEAD_LOCKED_MESSAGE`; `recordLeadChange` at Tue 17:01 → throws; at Tue 16:59 → allowed.
- [ ] **Step 2: Run** `bun test tests/new-flow-09-required-and-lock.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** plus `bun test tests/in-house-booking*.test.ts tests/booking*.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(gates): required-on-file people check and the 5pm two-days-before Lead Installer lock"`

---

## Task 10: Booking before the upgrades day = warning (deposit still first); GO needs Part C + certificate; no installer pay without GO

Jo 2 Nov, answer 21 (supersedes 3 and 5): the install is booked only after the deposit is paid — the existing `installDepositBlocker` / `installDepositBlockerFor(jobId)` on installation bookings stays exactly as it is, and decision 367's provisional hold is unchanged. What changes: the deposit can now be paid before the upgrades are done (Part 4 Task 2), so an install can be booked before the upgrades day — that is a warning, never a block — and the GO check is where the missing Part C + Certificate of Electrical Safety stops the install.

**Files:**
- Modify: `src/lib/booking.server.ts` (`validateBooking("installation")`: an uncleared clearance whose only reason is upgrades outstanding returns a `warnings` entry instead of throwing; every other clearance reason still throws; the deposit blocker still runs first)
- Modify: `src/lib/allocation.core.ts` (`installationCoordinationBlocker` → `installationCoordination(c): { block: string | null; warn: string | null }`)
- Modify: `src/lib/prestart.core.ts` / `prestart.server.ts` only if the test shows the electrical-clearance line doesn't already refuse a booked install whose upgrades lack the Part C or the certificate (Task 5 already adds the Part C copy timing)
- Modify: `src/lib/trade-payout-gate.core.ts` (`InstallFormFacts.go: boolean | null`)
- Modify: `src/lib/trade-payout-gate.server.ts` (reads the latest `pre_start_checks` for the install start)
- Test: `tests/new-flow-09-warning-and-pay.test.ts`

**Interfaces:**
- Warning text: `"Electrical upgrades aren't done yet. The install can't start until the Part C and certificate are in."` (Part 5's box shows it).
- `tradePayoutBlockers("installation", f)` adds `"No GO for this install"` when `f.install.go !== true` (`go` = latest slot check for the booked start `passed`).

- [ ] **Step 1: Write the failing test** — deposit paid, upgrades still to come + everything else fine → booking allowed with the warning; deposit NOT paid → still refused with the existing `installDepositBlocker` text (answer 21); PIESA failed for another reason → still throws; booked before the upgrades day, at the 2pm slot the Part C or the certificate is missing → DON'T START with the electrical clearance line; both in (and the updated PIESA copy ≥24h, Task 5) → that line gone; no GO line ever mentions the deposit due time; payout: complete form + evidence but last check DON'T START → blocked "No GO for this install"; GO → clear.
- [ ] **Step 2: Run** `bun test tests/new-flow-09-warning-and-pay.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** (callers that showed the throw now show `warnings` before success; installer screen wording is Part 5's).
- [ ] **Step 4: Run** plus `bun test tests/trade-payout-gate.test.ts tests/booking*.test.ts tests/prestart*.test.ts tests/deposit*.test.ts tests/payments*.test.ts` — Expected: PASS (keep every deposit-before-booking and decision-367 test as it is). Update `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md` and `src/config/workflow-decisions.ts` in the same commit.
- [ ] **Step 5: Commit** — `git commit -m "feat(gates): booking before the upgrades day warns; GO needs Part C + certificate; installer pay needs a GO"`

---

## Task 11: Before VEEC creation — product on the VEU Register that day and $200+ paid; refunds after creation flagged

**Files:**
- Modify: `src/lib/esc-registry-robot.core.ts` (`VeecCandidate.productProblems`, `.installPaidCents`; `planVeecCreation`)
- Modify: `src/lib/esc-registry-robot.server.ts` (fills them: `declaredProductProblems(option, { installDate, veecCreationDate: melbourneToday() }, recordedCodes)` from `install-evidence.core.ts`; paid from `jobPaymentView`)
- Modify: `src/lib/portal.functions.ts` (`updateVeec` to `submitted`/`approved` runs the same two checks)
- Modify: `src/lib/stripe.server.ts` (`recordStripeRefund`: after a VEEC creation, raise `veec_copayment_refunded` needs_office)
- Create: `src/lib/veec-creation-gate.core.ts`
- Test: `tests/new-flow-09-veec-creation-gate.test.ts`

**Interfaces:**
- `MIN_COPAYMENT_CENTS = 20000`; `veecCreationBlockers(i: { productProblems: string[]; installPaidCents: number }): string[]` → product lines + `"Owner has paid less than $200 (incl GST) — VEECs can't be created yet."`.
- `planVeecCreation` returns `skip` with `office: true` for any blocker.
- Refund after creation: event `veec_copayment_refunded` (details `{ refunded_cents, veec_reference }`), Needs me `"A payment was refunded after VEECs were created. The $200 minimum can't be refunded — call Jo."`.

- [ ] **Step 1: Write the failing test** — ECOWOOL-only code with register `effectiveTo` before today → skip with the product line; $199.99 paid → skip; $200 → submit; refund after lodgement → one event.
- [ ] **Step 2: Run** `bun test tests/new-flow-09-veec-creation-gate.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** plus `bun test tests/esc-registry-robot*.test.ts tests/esc-approved-products.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(veec): creation needs products on the register that day and \$200+ paid; refunds after creation flagged"`

---

## Task 12: Complaints — acknowledge within 5 business days, aim to resolve within 20

Office process only; no owner message is added (the office acknowledges by hand; no approved automatic wording).

**Files:**
- Create: `src/lib/complaints.core.ts`, `src/lib/complaints.functions.ts`
- Modify: `src/lib/allocation.core.ts` (`complaint_ack_due`, `complaint_resolve_due`), `src/lib/office-needs.server.ts`
- Test: `tests/new-flow-09-complaints.test.ts`

**Interfaces:**
- Events: `complaint_received` `{ received_at, channel, summary }`, `complaint_acknowledged`, `complaint_resolved` (job events; office-only server functions `recordComplaint`, `acknowledgeComplaint`, `resolveComplaint`, literal `createServerFn` chains, `requireAdmin`).
- `complaintDue(receivedAt): { ackBy: string; resolveBy: string }` via `addMelbourneBusinessDays(receivedAt, 5|20)`; `complaintNeeds(events, now)` → `complaint_ack_due` from 1 business day before ack-by until acknowledged (urgent once past), `complaint_resolve_due` from 3 business days before resolve-by until resolved.

- [ ] **Step 1: Write the failing test** — received Fri 30 Oct 2026 → ack-by and resolve-by equal `addMelbourneBusinessDays(receivedAt, 5)` and `(…, 20)` (Melbourne Cup Tue 3 Nov counts only if that helper's calendar has it — assert against the helper, not a hand count); acknowledged → ack row gone.
- [ ] **Step 2: Run** `bun test tests/new-flow-09-complaints.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(office): complaints timed at 5 and 20 business days"`

---

## Task 13: Pin the gates that are already right (records 6 years, downlights, 30-day rule, consent before notice)

**Files:**
- Test: `tests/new-flow-09-existing-gates.test.ts`

- [ ] **Step 1: Write the test** —
  - `retentionFor({ assignmentRetainUntil: null, jobCreatedAt: "2026-11-02T00:00:00Z", completedAt: "2026-11-20T00:00:00Z" }).retainUntil >= "2032-11-20"` and `RETENTION_MIN_YEARS === 6`; a source scan finds `storage.from("job-files").remove(` only in `journey.server.ts` (TEST path).
  - Downlights: short PIESA answers `downlightsPresent: "Yes", downlightsNonIc: "Yes"` → rectification required (the existing rule in `official-short.core.ts` ~line 152), so clearance isn't given.
  - 30-day rule: `repeatPiesaPayer` decides who pays a new PIESA when the window expires (existing cases).
  - `submissionBlockers` refuses a notice sent before consent was completed, sent 6 days before start, or 23h before start.
- [ ] **Step 2: Run** `bun test tests/new-flow-09-existing-gates.test.ts` — Expected: PASS straight away (these pin existing behaviour; if any fails, that is a bug to fix in this task).
- [ ] **Step 3: Commit** — `git commit -m "test(gates): pin records, downlights, 30-day and ESC-before-consent gates"`

---

## Task 14: Per-job "no ESC" marker for real runs (Jo 2 Nov, answers 18–19)

Jo wants real end-to-end runs (Part 11) with real owners' details, INSolation and Tom's Electrical, but the ESC installation notice and VEEC/certificate creation must be STOPPED for those jobs. One per-job marker, checked at every ESC boundary, fail closed.

**Files:**
- Create: `src/lib/no-esc.core.ts`, `src/lib/no-esc.server.ts`, `src/lib/no-esc.functions.ts`
- Modify: `src/lib/esc-registry-robot.core.ts` (`jobMode(mode, jobSource, noEsc?: boolean)` → `"off"` when marked), `src/lib/esc-registry-robot.server.ts` (`noticeWork`, `veecWork` skip marked jobs; `recordRobotNotificationSubmitted`, `recordRobotNotificationUpdated`, `recordRobotVeecSubmitted` refuse), `src/lib/esc.server.ts` (`submitEscViaAdapter`, `recordEscSubmission`, `recordEscRegistryUpdate` refuse; `sweepEscReminders` skips marked jobs), `src/lib/portal.functions.ts` (`updateVeec` to `submitted`/`approved` refuses), `src/lib/veec-creation-gate.core.ts` (Task 11: `veecCreationBlockers` input gains `noEsc`), `src/lib/prestart.core.ts` (`PrestartFacts.noEsc?: boolean`), `src/lib/install-evidence.core.ts` (Task 4's PIISA "no ESC notice recorded" line skipped when marked), office job page (badge "Real run — no ESC")
- Test: `tests/new-flow-09-no-esc.test.ts`

**Interfaces:**
- `NO_ESC_REF = "no_esc"`; `noEscMarked(refs: unknown): boolean` — `jobs.external_refs.no_esc === true` (same pattern as `qaNoDelivery` in `qa-no-delivery.core.ts`; no SQL).
- `NO_ESC_REFUSAL = "Real-run job marked “no ESC”: nothing goes to the ESC Registry and no certificates are created."`
- `assertNotNoEsc(jobId: string): Promise<void>` — throws `NO_ESC_REFUSAL` when marked; a read failure throws (fail closed).
- `setNoEscMarker(jobId: string, actorId: string, reason: string): Promise<void>` — admin only; one-way (no clear function; job writers that merge `external_refs` keep the key); refuses `"An ESC notice was already sent for this job — withdraw it first."` when a sent notice exists; event `no_esc_marker_set` `{ reason }`. Server fn `setNoEscMarkerFn` (literal `createServerFn` chain, `requireAdmin`). Part 11 calls it inside `markRealRun`.
- GO check on a marked job: the ESC-notice sent/timing failures are replaced by the note `"No ESC (real-run job): ESC notice skipped"` (not a failure); every other gate still blocks.

- [ ] **Step 1: Write the failing test** — marked job: `noticeWork`/`veecWork` don't list it; `jobMode("live", "website", true)` → `"off"`; each of `submitEscViaAdapter`, `recordEscSubmission`, `recordEscRegistryUpdate`, `recordRobotNotificationSubmitted`, `recordRobotNotificationUpdated`, `recordRobotVeecSubmitted`, `updateVeec(submitted)` throws `NO_ESC_REFUSAL` and writes nothing; `veecCreationBlockers` contains it; `prestartFailures` has no ESC lines but still blocks a missing SWMS signature and a missing Part C/certificate; unmarked job: all byte-identical to before; marker on a job with a sent notice → refused; marker can't be removed by a normal job save; read failure in `assertNotNoEsc` → throws.
- [ ] **Step 2: Run** `bun test tests/new-flow-09-no-esc.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**; add the rule to `src/lib/AGENTS.md` (ESC boundary) and the source-of-truth doc in the same commit.
- [ ] **Step 4: Run** plus `bun test tests/esc*.test.ts tests/prestart*.test.ts tests/veec*.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(esc): per-job no-ESC marker refused by the notice robot, Registry recorders and VEEC creation"`

---

## Task 15: Try to break every gate on TEST jobs, then show Jo

- [ ] **Step 1:** On a TEST job (journey TEST installer/electrician) run: expired insurance → Add a job, booking and install refused; install booked before the upgrades day, Part C/certificate still missing at 2pm → DON'T START; deposit unpaid → booking refused; a "no ESC" job → robot skips it and every recorder refuses; late Lead Installer change (after 5pm two days before) → refused; missing SWMS signature → DON'T START at 2pm and 6:30am, email to test inbox + info@ copy; PIESA older than 30 days → refused; move install 8 days out after notice sent → "Withdraw" task; Owner cancelled after notice sent → "Withdraw" task.
- [ ] **Step 2:** `bun run portal-qa` for the office Needs me rows touched (NOT_RUN gaps stay NOT_RUN).
- [ ] **Step 3:** Send Jo: GO / DON'T START email pictures + text, insurance reminder text (wording approvals at build time), one question at a time in boxes. Flags stay off until she says yes.

---

## Self-review notes

- Spec coverage: insurance/licence → T8; required on file → T9; Lead Installer lock → T9; GO/DON'T START (timing, recipients, new checks) → T5–T7; no pay without GO → T10; 30-day rule, downlights → T13; PIESA copy ≥24h incl. Part C → T5; audit fixes (ESC registration all jobs → T5, 2-day lock → T9, Part C on every reschedule → T1 re-run + T5, electrician licence expiry → T8, public liability on offers and pre-start → T8); life support → T5 (+ Part 8 T4); ESC notice send/update/withdraw → T1–T3; PIISA timing → T4; consent ≥24h → T5/T13; electrician at install → T5; product on register + $200 → T11; complaints → T12; 6-year records → T13; "don't block booking before upgrades" → T10.
- Jo's 2 Nov evening answers: booking before the upgrades day (deposit still first), GO needs Part C + certificate → T10 (answer 21); insurance reminder recipients → T8; real-run "no ESC" marker → T14; lock names shared with Parts 5 and 7 → T9.
- Not here (other parts): CoES copy to owner, VEEC copy ≤10 business days, dispute info, warranty at completion (Part 4); adult present on forms (Part 8); the 9am Lead Installer email (Part 7).

## Open questions for Jo

None left for this part.

## Decided (Jo, 2 Nov evening, and overview cross-part decisions)

- **Deposit and booking (answer 21, supersedes 3 and 5):** deposit before booking (unchanged blocker); booking before the upgrades day = warning; GO check needs Part C + certificate; no "deposit by 2pm" rule (Task 10).
- **Insurance reminders (answer 17):** business main email, copy to info@ (Task 8). Draft GO and insurance wording are approved from pictures at build time (Tasks 7, 8, 15), not separate questions.
- **Public liability $5m+:** the office types the amount when approving (decided from earlier approvals, Task 8).
- **Real runs (answers 18–19):** per-job "no ESC" marker (Task 14).
- **Lead Installer lock:** one rule here (Task 9), used by Parts 5 and 7.

## Assumptions

- When the install start moves and the notice is updated (same ID), the 24h checks run from the update time; when only the Lead Installer or their details change (same start), they run from the original send time (existing behaviour, now one rule).
- "Can't do this one" from an electrician sends the job back to the installer and does not withdraw the notice; only the installer's "Can't do this one" and "Owner cancelled" do.
- Withdrawals are done by hand in the Registry (the robot has no verified withdraw form); the portal raises the task and records it.
- "Adult present" can't be checked before the day; it is enforced by the Mitti forms (Part 8), not the 2pm/6:30am GO check.
- A $200 refund after VEEC creation can't be stopped in Stripe; the portal tells the office at once.
- Complaints are recorded by the office; there is no automatic owner acknowledgment.

## Overlaps for the main session (not for Jo)

- Lead Installer lock: resolved by the overview cross-part decision — Task 9 owns `leadInstallerLock` / `leadInstallerLocked` / `LEAD_LOCKED_MESSAGE`; Parts 5 and 7 import them.
- Part 5's "Can't do this one" and "Owner cancelled" handlers call `requireEscWithdrawal` (Task 2) — written into Part 5 Task 6. Build Task 2 before Part 5 Task 6, or Part 5 stubs the call behind its import.
- Part 6 changes how electricians confirm install attendance (job link); Task 5 reads `attendanceState` — Part 6 must keep writing the same events.
- Task 5 relies on Part 8 Task 4 so the PIESA's life support photo counts as on file.
