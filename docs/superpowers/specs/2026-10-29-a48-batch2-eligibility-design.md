# Activity 48 batch 2, part 1 — area batches + quick taps (design)

Date: 30 Oct 2026 · Owner: Jo · Branch `fix/a48-batch2-eligibility`. Ends with an open PR (no merge, no publish). Any live database change only after Jo says yes. Part 2 (the installer's run and back-to-back booking) has its own spec.
Why: no wasted Ready Check visits, almost no office work, and installers (e.g. Rapid Insulation; No Gap once approved) get runs of nearby jobs. Rules: ESC Ceiling Insulation Activity Guide v1.2 §1.1.1, §1.1.3 (R2, R3, R6, R7, R8 of the 29 Oct audit). Grilled with Jo 29–30 Oct.

## In plain words

1. **Who:** website owners (`hivic_sourced`) who saved a spot. Installer-added jobs skip all of this.
2. **Most likely eligible first** — only these are batched for now: owner said house, townhouse, or unit on the top floor; owner said the home is over 5 years old; Google Solar doesn't say the roof is fully flat (unknown is fine); owner said no insulation, or existing insulation is "thin". (179 of the 420 owners waiting on 30 Oct.)
3. **Batch suggestions:** the portal suggests the next batch — 8 to 10 likely homes within 10 km of each other (a smaller batch once its homes have waited 2 weeks), plus the installers whose checked service area covers them. Jo picks the installer and taps **Send**. That's her only step.
4. **Quick taps** (text + My job, one question at a time, big buttons):
   1. Is there a manhole or hatch into your roof space? [Yes] [No] [Not sure]
   2. Is your roof sloped, flat, or some of each? [Sloped] [Flat] [Some of each] [Not sure]
   3. Was your home built, or its ceiling replaced, in the last 5 years? [No] [Yes] [Not sure]
   4. [Yes, let's go — you can share my name and number with the installer to book it] [No thanks]
   - plus any website answer the owner left blank, in the website's wording.
5. **After 3 days** the batch closes: pass + "Yes, let's go" → the batch goes to the chosen installer as one run (part 2). No hatch, flat, 5 years "Yes" → polite decline, job closed. "No thanks" → closed. No answer → joins the next nearby batch; closed quietly at day 14. "Not sure" always passes (the installer checks on the day).
6. **Replaces "It's your turn"** for website owners. Nothing lands in Needs me.
7. **Also:** measured areas named garage, carport or shed are left out of the eligible m² automatically. Previous upgrade is always "No" (done live 29 Oct; new enquiries stored as "no").

**Owner wording (Jo approved 29–30 Oct):**
- Text: "Hi {name}, 4 quick taps before we can book your free Ready Check: {link} - Home Insulation Victoria"
- Reminder (day 2): "Hi {name}, just a reminder - 4 quick taps so we can book your free Ready Check: {link}"
- After passing (My job): "Thanks! We're lining up your free Ready Check with an installer in your area. We'll text you your time soon."
- No hatch / flat (screen + email): "Unfortunately we can't help with this one, as we need access into the roof space. Please contact another installer, they may be able to assist."
- 5 years (screen + email): "Thanks for letting us know. Unfortunately homes built, or with a ceiling replaced, in the last 5 years don't qualify for the Victorian Energy Upgrades program, so we can't help with this one."
- No thanks (screen + email): "No worries, thanks for letting us know. If you change your mind, just get in touch."

## Technical detail

- **Locations:** before a home can be batched, `ensurePropertyCoordinates` (property-coordinates.server.ts, Vicmap → Google Places fallback) fills its `coordinates` fact once. Distance = `distanceM` (geo.core.ts).
- **Likely-eligible (pure):** `src/lib/area-batch.core.ts` `likelyEligible(facts)`: reads `enrichment.base44.declared` (`property_type`, `over_five_years`), raw answers (`top_floor`, `insulation`, `insulation_thickness`) and the current `roof_form` fact.
- **Suggestions (pure):** `suggestBatches(homes, installers, now)`: greedy densest-first clusters within 10 km, 8–10 homes; smaller clusters only when every home has waited ≥ 14 days since its spot was saved; installers from `verifiedServiceAreaMatch` covering every home in the batch (or `covers_all_victoria`).
- **Send:** office server fn creates `area_batch_sent {batch_id, installer_business_id, job_ids}` (workflow_events per job, append-only) and sends the text (guarded sender, TEST → test-send, quiet hours per existing rules). One batch per job at a time.
- **Owner page:** My job `?screen=taps` (owner token only) — answers stored as `quick_taps_answered {answers, consent_share}`; the share-consent tap also records the existing `trade_contact_share` owner gate.
- **Outcomes:** sweep on the existing 15-minute tick: day-2 reminder; day-3 close → `area_batch_closed` with pass list → hands the run to part 2; declines via `cancelJobFully` with the matching reason and email; day-14 no-answer close; non-answerers are freed for the next batch.
- **Retire** `spot-release` release/confirm for website owners (code kept for history; Choose installer page shows batch suggestions instead).
- **Garage exclusion** where eligible m² is totalled (quote lines, VEEC area facts); recorded as `excluded_area {name, m2}`.

## Testing
Test-first. likelyEligible cases (each rule in/out); suggestBatches on fixed coordinates (10 km, 8–10 cap, 14-day small batches, installer coverage); send → text once (TEST test-send); every tap outcome incl. "Not sure"; reminder day 2, close day 3, day-14 close; installer jobs never batched; garage areas excluded. Existing spot-release / Ready Check tests updated; full suite vs baseline; tsc; retired scan.

## Amendment — 30 Oct (Jo approved)

- **Owner text (replaces the "4 quick taps" text):** "Hi {name}, great news - it's almost time for your free Ready Check! Please confirm a few quick details for your quote: {link} - Home Insulation Victoria". **Reminder (day 2):** "Hi {name}, just a reminder - please confirm a few quick details so we can book your free Ready Check: {link}". No first name on file → "Hi there,".
- **Name and address come first, for every owner**, each with [Yes] [Change it]:
  1. "Is this your full name for your quote? {full name}" — none on file → "What's your full name for your quote?" (typed)
  2. "Is this the right address for your quote? {address}" — none on file → "What's the full address of the home for your quote?" (typed)
  then the hatch, roof, 5-year and "Yes, let's go" taps.
- A changed or new name/address updates the job. A changed or new address is re-located; if it is over 10 km from the batch centre the owner leaves this batch and goes back to the pool (not told).
- Owners with only a postcode on file are batched by their postcode's centre until they give a full address.
- **Runs never go to an installer automatically.** When a batch closes, Jo sees who passed and taps **Send to installer**.
