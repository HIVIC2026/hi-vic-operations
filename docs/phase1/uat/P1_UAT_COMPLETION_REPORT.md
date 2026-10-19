# Phase 1 — UAT completion and defect report

**Prepared:** 19 Oct 2026 · **Branch:** `p1/uat-completion` · **Job under test:** HV-2594 (synthetic `qa_test` fixture)

This report closes the interrupted HV-2594 journey (stopped at PIESA booking/scheduling), records every
defect found with its root cause and fix, and states plainly what is **not** verified. It does not merge to
`main` and does not deploy to production.

---

## A. What was asked and what was done

The instruction was to finish every remaining Phase 1 scenario autonomously, fix what breaks, and report in
the A–H format — using the real browser UI, never by writing database state and calling it a pass.

| Step | Outcome |
|---|---|
| Resume the interrupted PIESA booking/scheduling journey | Done — booking, acceptance, stage move all driven through the UI |
| Investigate and fix each failure | 4 defects fixed, 1 open, 1 observation |
| Verify through the browser, not the database | Every result below comes from a browser action; database reads only corroborate |
| Do not disturb the parallel P0 production work | Dedicated branch, no force-push, no `main` merge, no production deploy, no comms switch touched |

---

## B. Environment and baseline

| Item | Value |
|---|---|
| GitHub `main` | `f793df4f` (merge of `lovable-sync`) |
| Preview | `https://id-preview--fb35adfe-10bf-4d4c-987d-28567ca1ddeb.lovable.app`, build `index-DPoH4ukE.js` |
| Published production | `https://estimate.homeinsulationvictoria.com.au`, build `index-DDnZ9Rrz.js` — **older than `main`** |
| Database | Supabase `wvuffpykgnqliikhodzl`, shared by Preview and production |
| Customer comms | `customer_comms_enabled = false`, `save_my_spot_real_send_enabled = false`, `payment_option_gate_enabled = false` |

**Critical caveat:** the running Preview still serves the pre-fix build (`index-DPoH4ukE.js`). Every fix in
section E is committed and unit-tested but **not deployed**, so it has no browser verification yet. This is
the single biggest gap in this report and it is stated again in section G.

---

## C. Scenario results

| ID | Scenario | Result | Evidence |
|---|---|---|---|
| P1-S01 | Office signs in and loads the enquiry book | **PASS** | `/admin` 102,442 chars, 685 enquiries, zero `pageerror` |
| P1-S02 | Office opens every main tab and a job record | **PASS** | `?tab=enquiries/board/jobs/quotes`, `/admin/jobs/<id>`, `/admin/communications`, `/admin/templates`, `/admin/list`, `/admin/pipeline`, `/admin/needs-me` all render |
| P1-S03 | Office opens the whole-business records view | **PARTIAL PASS** | Renders after ~25 s, but the route is blocked on a whole-book aggregate (DEF-06). Fix committed, not deployed |
| P1-S04 | Office offers the PIESA to approved electricians | **PASS** | Offer batch 3 created, `rec_offers_made` event, one electrician offered |
| P1-S05 | Electrician takes one of the owner's PIESA times | **PARTIAL PASS** | Acceptance recorded (`partner_offer_accepted`, `piesa_window_taken`, booking `confirmed`), but the job did not advance (DEF-09). Also blocked once by DEF-07 |
| P1-S06 | Office books the PIESA visit directly (audited override) | **PASS** | `admin_booking_override` → `stage_changed piesa_and_install_window_pending → piesa_scheduled` → `installer_planning_notice` → `install_hold_moved`. Toast "Override booking saved" |
| P1-S07 | Electrician sees the booked visit, the owner's contact details and the PIESA form | **PASS** | Field page: "BOOKED PIESA Thu, 22 Oct, 9:00 am", owner name/phone/email released, full PIESA form |
| P1-S08 | PIESA cannot be completed without the required sign-off evidence | **PASS** (guard) | "Complete PIESA" refused: *"Upload evidence first: PIESA / electrical safety sign-off"* |
| P1-S09 | On-site evidence must carry a location taken at the property | **PASS** (guard) | Upload refused: *"This photo has no location. Turn on location for the portal and take it at the property."* |
| P1-S10 | Electrician records the PIESA result and the job reaches `piesa_complete` | **BLOCKED** | The fixture property has no `coordinates` fact, so no trade photo can pass P1-S09, and there is no office UI to record the location (DEF-10) |
| P1-S11 | Owner sees the booked PIESA and who is coming | **PASS** | "WITH ELECTRICIAN · Results due Thu, 22 Oct, 11:59 pm · Waiting on TEST Delta Electrical to do the onsite PIESA… Booked Thu, 22 Oct, 9:00 am" |
| P1-S12 | Office may not enter the PIESA record on the electrician's behalf | **PASS** | Office PIESA panel is read-only: "PIESA records (entered once by the electrician)" |
| P1-S13 | Installation window, installation booking, AP review, VEEC | **BLOCKED** | Downstream of P1-S10 |

Nothing above was marked PASS from a database write. Where the browser could not proceed, the row says
BLOCKED with the product's own message as the evidence.

---

## D. Defect register

### DEF-06 — Office records route renders a blank page while it loads (P1) — FIXED

- **Reproduce:** sign in as office → `/admin/operations` (or `/admin/operations-preview`). The document body is empty for ~25 s; office staff read it as a crash.
- **Root cause:** the route `loader` awaited `ensureQueryData` for a whole-business aggregate. SSR never flushed, so the first byte carried only `<section>` + `<script>` — no shell, no message.
- **Fix:** non-blocking `useQuery` plus an explicit "Reading every job — this can take up to 30 seconds" state and a retry path. Files: `src/routes/_authenticated/admin.operations.tsx`, `admin.operations-preview.tsx`. Commit `c0fe0797`.
- **Status:** fixed in code, not deployed. Re-verification pending a Preview rebuild.

### DEF-07 — A pre-assigned electrician who never booked takes the job (P1) — FIXED

- **Reproduce:** pre-assign an electrician to a PIESA job (`active = true`, `booking_confirmed_at IS NULL`), offer the PIESA to a different electrician, let them tap one of the owner's times → *"This job has just been taken."* and their own offer is set to `withdrawn`.
- **Root cause:** `accept_partner_offer()` decided "already assigned" from `EXISTS (… role = 'electrician' AND active)`. A pre-assignment is not a visit. The application layer had already been corrected (Brief X: `piesaOfferBlockers`, `startPiesaAllocation` only count an electrician whose `booking_confirmed_at` is set), so app and database disagreed and the database won.
- **Fix:** pending migration `0150_piesa_accept_confirmed_only.sql` adds `AND booking_confirmed_at IS NOT NULL`, with `0150_…rollback.sql` restoring the old predicate. Commit `66c700b9`.
- **Test:** `tests/piesa-accept-confirmed-only.test.ts` (PGlite) — pre-assignment accepted, offer not withdrawn, confirmed visit still refuses with `already_assigned` and withdraws, inactive confirmed assignment does not block, and the rollback reproduces the defect. 5/5 pass.
- **Status:** fixed in code. **The migration is not applied** to the shared database — see H-2.

### DEF-08 — "Offers sent" shown when nothing was sent (P2) — FIXED

- **Reproduce:** offer the PIESA when every eligible electrician in the round has already been offered → the screen shows the success toast "PIESA offers sent to approved electricians" while `offered = 0`.
- **Root cause:** `startPiesaAllocation` returned `{offered: 0, exhausted: true}` and the caller treated any non-throw as success. A stalled job looked like progress.
- **Fix:** a zero-offer result now throws with the reason — "No approved electrician could take any of the owner's times… Ask the owner to choose new times." or "No approved electrician is left to offer this PIESA to…". Pure rule `noOfferMessage()` in `src/lib/allocation.core.ts`. Commit `66c700b9`.
- **Test:** `tests/piesa-no-offer-message.test.ts` — 4/4 pass.

### DEF-09 — A taken PIESA time leaves the job stranded in the pending stage (P1) — FIXED

- **Reproduce:** electrician taps one of the owner's PIESA times. The booking is created and `job_assignments.booking_confirmed_at` is set, but `jobs.stage` stays `piesa_and_install_window_pending` and `next_action` stays *"Waiting for an electrician to take one of the owner's PIESA times"* — while the electrician already reads "Booked".
- **Root cause:** taking a time is two steps. `accept_partner_offer_slot()` commits the offer, the assignment and the proposal atomically; `confirmBooking()` then writes the booking **and then** moves the stage. When the second step does not finish, nothing repairs it: `startPiesaAllocation` refuses while an active electrician exists, and `refillIfNeeded` returns early for the same reason. The job had no way back.
  The office override path was run as a control and advanced the stage correctly (`stage_changed → piesa_scheduled`), which rules out a broken transition and localises the defect to the accept chain.
- **Fix:** `healStrandedPiesaStage()` in `src/lib/allocation.server.ts` moves the stage only when a confirmed assessment booking **and** an electrician assignment with a confirmed visit both exist and the normal entry blockers are clear; it is idempotent and does nothing at any other stage. It runs on the accept path (so a retry repairs), on the office allocation action, and in `sweepRecOffers` (bounded to 50 jobs). The accept path's `catch` no longer overwrites `next_action` with "arrange a time" when a confirmed visit already exists. Commit `66c700b9`.
- **Test:** `tsc --noEmit` clean; the heal path has no unit test because it needs a database (see G-3).

### DEF-10 — No in-portal way to record a property location (P2) — OPEN

- **Reproduce:** a job whose property has no `coordinates` fact. The trade uploads on-site evidence → refused with *"This photo has no location…"*; with a location, the next refusal would be *"We don't have this property's location on file yet… Ask the office to confirm the address."* The office has no control to add it: `property_facts.coordinates` is written only by the Vicmap intelligence run at intake.
- **Impact:** such a job can never receive trade evidence, so the PIESA can never be completed and the job stops dead. Nothing in the office UI says why.
- **Status:** open. Not fixed here — a location-recording control is a new office capability, not a release-blocker patch, and it needs an owner decision on the source of truth (Vicmap re-run vs manual pin).

### OBS-01 — Two views of the same payment disagree on a test job (observation)

The electrician field page reads "$349 paid"; the owner page reads "Safety check payment $349.00 **Not paid**" and shows a "Deposit due" badge, on the same `qa_test` job whose gate was cleared by an audited simulated payment. The trade view honours the simulation, the owner view reads `invoices.deposit_paid_amount`. Test-mode only — real jobs use real payments — so this is recorded as an observation, not a defect.

---

## E. Code changes

| Commit | Branch | What |
|---|---|---|
| `c0fe0797` | `p1/release-blockers` | Never block the office records route on the whole-business read (DEF-06) |
| `992f9167` | `p1/release-blockers` | Phase 1 release-recovery report (baseline, blockers, comms status, go-live actions) |
| `66c700b9` | `p1/uat-completion` | DEF-07 migration + rollback, DEF-08 honest zero-offer failure, DEF-09 stranded-acceptance self-heal, 2 new test files |

No change to any acceptance criterion, no hard-coded pass, no bypassed business gate, no disabled workflow
guard, no fabricated external response. Automatic customer communications were not enabled.

---

## F. Test evidence

```
tsc --noEmit                     clean
bun test (4 files)               43 pass, 0 fail, 151 assertions
  tests/allocation.core.test.ts
  tests/allocation-hardening-db.test.ts
  tests/piesa-accept-confirmed-only.test.ts     (new, 5 tests)
  tests/piesa-no-offer-message.test.ts          (new, 4 tests)
```

Browser evidence (screenshots in the UAT evidence folder): `admin-job-now.png`, `override-result.png`,
`field-piesa.png`, `field-piesa-done.png`, `office-piesa.png`, `owner-after-piesa.png`.

---

## G. What is NOT verified

1. **Every fix in this report is undeployed.** The running Preview is `index-DPoH4ukE.js`, which predates
   `c0fe0797` and `66c700b9`. There is no browser verification of any fix, and I am not claiming one.
2. **PIESA completion and everything after it** (`piesa_complete` → installation window → installation →
   AP review → VEEC) was not exercised. It is BLOCKED on DEF-10, not skipped by choice.
3. **`healStrandedPiesaStage` has no automated test.** It needs a database with `commit_guarded_stage` and
   the full `stageEntryBlockers` chain; the PGlite harness in this repo does not cover that surface.
4. **DEF-07's migration is not applied**, so the shared database still refuses a real acceptance whenever a
   pre-assigned electrician exists. The runtime workaround used during this UAT (deactivating the stale
   unconfirmed assignment) is not a fix.
5. **Production is an older build than `main`.** Nothing in this report was verified against production.

---

## H. Go-live actions

**H-1 — Rebuild Preview from `p1/uat-completion`, then re-run P1-S05, P1-S06, P1-S10.** Without a rebuild,
none of these fixes exist at runtime. This is the gate for everything else.

**H-2 — Apply `0150_piesa_accept_confirmed_only.sql` before any job relies on electrician acceptance.**
Until then a pre-assigned electrician blocks real acceptance. The migration only replaces one function, has a
rollback, and changes no data — but it is a schema change on the shared database, so it needs the owner's go-ahead.

**H-3 — Decide DEF-10.** Either the office gets a "record the property location" control, or intake must
guarantee a Vicmap coordinate for every job before it reaches PIESA. As it stands, one missing coordinate
silently stops a job and the office is never told.

**H-4 — Do not enable automatic customer communications.** Unchanged from the release-recovery report:
`customer_comms_enabled`, `save_my_spot_real_send_enabled` and `payment_option_gate_enabled` are all off, and
only `likely_estimate` and `save_my_spot` are approved for real customer sending.

---

## I. Synthetic data touched

All of it is fixture repair on HV-2594, a `qa_test` job. No real customer record, no real email, no payment.

| Change | Why |
|---|---|
| `owners.user_id` set to the UAT owner's auth user | The fixture owner could not open their own job (the row pointed at a different auth user) |
| One stale electrician assignment set `active = false` | It was an unconfirmed pre-assignment that blocked acceptance under DEF-07 |
| PIESA booked 22 Oct 9:00 am by office override | To exercise the booking → `piesa_scheduled` path while DEF-09 was unfixed |
