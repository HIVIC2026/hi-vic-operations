# Activity 48 batch 2, part 2 — the installer's run (design)

Date: 30 Oct 2026 · Owner: Jo · Same branch as part 1 (`fix/a48-batch2-eligibility`), built after it. Ends with an open PR (no merge, no publish).
Input: a closed area batch from part 1 — owners who passed the quick taps and tapped "Yes, let's go" (with consent to share name and number), and the installer Jo picked at Send.

## In plain words

1. **Installer text (Jo approved):** "Hi {name}, you've got a run of {n} Ready Checks around {suburb}. Pick your day: {link} - Home Insulation Victoria". No reply in 24 hours, or they say no → the batch goes back to Jo's suggestions (owners aren't asked again).
2. **Run page (installer):** each home shows address, owner name and phone, m² with its source and how sure ("95 m² · owner's estimate" or "110 m² · aerial roof outline, approx." — best source first), the quick-tap answers, roof shape, map and route. The installer can **remove homes** before choosing a day (removed homes go back to the pool; the owner isn't told).
3. **The installer chooses, per run:**
   - **Portal books:** pick a day (at least 2 days ahead) and start time (default 8:00). The portal orders homes by shortest route and gives each a **1-hour arrival window**, max **8 per day** (extras go to a second day the installer picks). Each owner gets their window to confirm within 24 hours (reminder at 12 hours); "can't make it" → pick another free window that day; none suit or no confirm → back to the pool for the next nearby batch.
   - **Our team books:** their team calls the owners and enters each agreed day/time on the run page — no portal limits. Each owner gets the confirm text. Anything not booked within 5 days → back to Jo's suggestions.
4. **Move run** (sick, weather): installer picks a new day; every owner gets a new window to confirm (same rules).
5. **Owner cancels a confirmed window:** the installer is told and gets a "Fill from nearby waiting owners" button; if they don't tap it, the slot is left alone (they may have filled it themselves).
6. Nothing lands in Needs me.

**Owner wording (Jo approved):**
- Time text: "Hi {name}, your free Ready Check is {day} at {time} with {installer}. Tap to confirm or pick another time: {link} - Home Insulation Victoria" — `{time}` is the window, e.g. "between 9:00 and 10:00am".
- 12-hour reminder: "Hi {name}, please confirm your free Ready Check on {day} at {time}: {link}"

## Technical detail

- **Run state:** append-only workflow_events per job (`run_offered`, `run_declined`, `run_mode_chosen {portal|team}`, `run_slot_proposed {start,end}`, `run_slot_confirmed`, `run_slot_released`, `run_moved`) keyed by `run_id`; a run is the batch's pass list minus removed homes.
- **Route order (pure):** `src/lib/run-route.core.ts` `orderRun(start, homes)` nearest-neighbour from the first home (furthest from the centre) on `coordinates` facts; `windowsFor(startTime, count, 60min, max 8)`.
- **Bookings:** a confirmed window uses the existing `bookAgreedTime` → `confirmBooking(jobId, "ready_check", …)` path, so every existing Ready Check rule, message and Mitti step stays the same after booking.
- **Installer offer:** reuse `partner_offers` kind `ready_check` semantics (24h expiry) for the whole run; owner contact shown only where `quick_taps_answered.consent_share` is true (always true for run members).
- **m² source:** reuse existing estimate fields — owner/website estimate, `preliminary_ceiling_area` (aerial/Solar), each labelled with source + confidence.
- **Sweeps** on the existing tick: 24h installer expiry, 12h owner reminder, 24h owner expiry, 5-day team-booking expiry.

## Testing
Test-first. orderRun / windowsFor (8 cap, second day); installer accept / decline / 24h expiry → back to suggestions; remove home → back to pool; portal-books flow (confirm, other window, no confirm → pool); team-books entry + 5-day expiry; move run → reconfirm; owner cancel → installer told + fill button; confirmed slot books through confirmBooking; TEST jobs test-send only. Existing Ready Check booking tests; full suite vs baseline; tsc; retired scan.
