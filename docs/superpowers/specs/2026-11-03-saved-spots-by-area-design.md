# Saved spots by area, ranked best to worst — design

Date: 3 Nov 2026 · Agreed in chat by Jo (brainstorm + grilling, 3 Nov 2026)

## Why

Jo wants to offer the free Ready Check (quick taps text) to **anyone** who has saved a spot, picking them herself. Today the portal blocks anyone whose website answers don't look "likely eligible" (only "no insulation" or "thin" get through), so owners she knows are good — e.g. HV-1644, who confirmed under R2 — can't be sent. She also wants the portal to do the sorting for her: group saved spots by area, then rank them best lead to worst, using everything we know about each home (photos, owner answers, quick taps, the map, online listings and floor plans).

## What Jo decided

1. **Send anyone who saved a spot.** The "likely eligible" block on Send goes.
2. **Group by nearby area (~10 km)**, named by the main suburbs, biggest group first.
3. **Rank inside each area Best → Good → OK → Weak** (last night's bands), refined by the online checks.
4. **Three checks on every saved spot:** the portal's own map/roof check (restarted), a nightly listing/floor plan check run by Claude, and an AI check of owner photos nobody has looked at.
5. Grilling answers (Q1–Q11) are listed at the end.

## 1. The "To release" list

### Views
- **To release opens on "By area".** The current table stays as a second view, one tap away ("Table"), unchanged — search and column filters still live there.
- The **"Suggested batches" box is removed** (area groups replace it). Its Send code path is not needed by the new view and is removed with it; the tick-and-Send bar (Task 6) is what both views use.

### Areas
- Homes are grouped so every home in a group is within ~10 km of the group's centre (same radius and greedy densest-first method as `suggestBatches` in `area-batch.core.ts`, but **no minimum size and no cap** — every saved spot lands in exactly one group, including groups of 1).
- Groups are worked out fresh each time the list loads (no stored groups).
- Group heading: the 2–3 most common suburbs + count, e.g. **"Rowville · Knox · Ferntree Gully (14)"**. Biggest groups first; ties by the best home in the group.
- Location used: the property's `coordinates` fact; postcode-only homes use their postcode centre (as today) and carry a **"No street address"** tag. A home with no coordinates and no known postcode centre goes in a final **"Location not known"** group.

### Order inside an area
1. **Said yes** — owners who passed the quick taps (`batchRowState` = said_yes), ready to send to an installer. Shown as today: "{Name} said yes · free Ready Check". Not tickable for a new text (as today).
2. **Waiting for owner** — texted, no answer yet (as today, not tickable).
3. Everyone else, **Best → Good → OK → Weak**, then the score inside the band (section 3).

### Each spot shows
- Job number, owner name, suburb, size (m²), estimate, waiting since (as the table does).
- **Band** chip (Best / Good / OK / Weak) and a **one-line reason** built from the facts, e.g. "No insulation · house · ~200 m² · floor plan found · pitched roof".
- **Satellite** link (Google Maps satellite view of the address) and the **listing** link when one was found. No links for postcode-only homes.
- Tags: red **Life support** (ranking unchanged); **No street address**; **"Listing says: …"** when the listing doesn't match the owner's answers (e.g. "Listing says: 2-storey townhouse"); **"AI: confirm"** when the band comes from the AI photo check; **"Not checked yet"** when the listing check hasn't reached it.

### Ticking and Send
- **Any saved spot can be ticked**, in any band, across areas. Up to **10 per Send** (unchanged).
- No "are you sure?" for Weak.
- Still not sendable (unchanged rules in `batchCandidates`, minus the likely-eligible rule): not waiting for an installer, hasn't saved a spot / opted out, already waiting on quick taps answers, in a run sent to an installer, said yes (goes to an installer instead), spot release pending.
- Send bar unchanged: shows only installers who cover every ticked home; installer needs a rate card; customer messages and the quick taps text switch must be on; no texts 8pm–7am; owner needs a working My job link.
- Nothing about the owner's text, email, quick taps, reminders, batch close or installer runs changes.

## 2. The checks

### 2a. Map check (portal, Google Solar + Vicmap) — restart it
- Today: the property intelligence run (`intelligence.server.ts`) last ran on **4 Oct 2026**; only 86 of 475 saved spots have one. **First build step: find out why it stopped** (trigger, key, error) and fix that cause.
- Then: run it once for every saved spot with a street address and no current run (backfill, in small batches), and automatically for every new saved spot.
- Uses the Google Solar Building Insights free monthly amount (10,000 calls/month); a **daily quota cap** is set in Google Cloud so it can never run up a bill. Jo sets the cap (Claude gives the steps).
- Facts used in ranking: `roof_form` (pitched / flat / low slope), `site_roof_risk` (complex roof), `building_ground_footprint` (size from above, shown as "~X m² from above", never replaces the owner's or installer's ceiling size).

### 2b. Listing check (Claude, nightly scheduled task)
- A scheduled task runs each night (outside 6–9am Pacific), works through saved spots in this order: **new spots first, then unchecked spots Best → Good → OK → Weak**, oldest first, as many as the night's web search allowance allows.
- For each street address it looks for a listing of **that exact house** (not a neighbour) and records only what the page says: listing link, source, floor plan yes/no, floor area m², land m², storeys, bedrooms, year built, property type, roof wording. Never guesses numbers, never searches owner names.
- Results are saved onto the job as `property_facts` (new fact keys, e.g. `listing_check`, source_type "listing", one current row per property). A spot with no listing found is saved as "checked — none found" so it isn't searched every night.
- **Last night's results** (the 2 Nov research, ~261 spots) are loaded in once.
- Writes go through a small portal endpoint (or direct insert) limited to these fact keys; it never changes owner answers, job stage or messages.

### 2c. Photo check (portal AI)
- Runs **automatically when an owner's photos/video arrive**, plus a **one-off run on the 66 spots** whose media nobody has reviewed (48 desk check pending + 18 sent anyway).
- Uses the portal's existing AI connection (Lovable AI gateway, as `coes-check.server.ts` does). Costs some Lovable AI credits per photo set.
- Output: one of **no insulation / looks under R2 (loose-fill, thin, patchy) / looks over R2 / can't tell**, plus a short reason. Saved as the AI's suggestion — it does **not** overwrite `desk_check_status`.
- Effect: "no insulation" or "looks under R2" → **Best**, tagged "AI: confirm". "Looks over R2" → **Weak**, tagged "AI: looks over R2 — confirm". "Can't tell" → no change.
- **Jo's own desk check always wins** over the AI. The AI never cancels a job, never messages anyone.

## 3. Best to worst

### Bands
- **Best:** photos checked by Jo (`looks_eligible`) or by the AI (no insulation / looks under R2).
- **Good:** owner said no insulation (no photos).
- **OK:** owner said or confirmed thin, loose-fill, patchy or under R2, or "not sure".
- **Weak:** owner said thicker insulation or just "has insulation" with no detail, unit without the roof straight above (not top floor), AI says looks over R2, or no insulation answer at all.

### Inside a band (higher first)
Up: house (over townhouse, over unit) · bigger ceiling · floor plan or listing found · pitched roof on the map · quick taps answered hatch "yes" and roof "sloped" · waiting longer.
Down: flat roof on the map, or quick taps roof "flat" · listing says unit or 2+ storeys ("Listing says…" tag) · complex roof (small step only).

The exact weights live in one pure function (`spotRank` in a new `saved-spot-rank.core.ts`) with tests for each rule above, so they can be tuned without touching the screen.

## 4. Out of scope
- Changing the owner's text, quick taps questions, reminders, batch close, installer runs, or who gets texted automatically.
- Showing installers on area headings (the Send bar already filters installers).
- Any paid property data service.
- Storing area groups.

## Grilling answers (3 Nov 2026)
- Q1 Suggested batches box: **removed**.
- Q2 To release opens **By area**; table one tap away.
- Q3 AI sees thick insulation: **move to Weak, never cancel**.
- Q4 Weak on Send: **no warning**.
- Q5 Mixed areas in one Send: **yes**, if one installer covers all.
- Q6 AI photo check: **automatic** when photos arrive (+ one-off for the 66).
- Q7 Listing doesn't match owner: **rank lower + "Listing says…"**; owner's answer unchanged.
- Q8 Installers on area headings: **no**.
- Q9 Nightly listing check: **all saved spots, new first then Best → Weak**.
- Q10 Life support: **red tag, ranking unchanged**.
- Q11 Postcode-only: **in its postcode's area, tagged "No street address"**; map and listing checks skipped until the street is given.

## Testing
- Pure tests: area grouping (every home in exactly one group, radius respected, postcode-only and unknown handling, heading names), bands and in-band order for each rule, Send no longer refuses a "not likely eligible" saved spot but still refuses each existing blocker.
- AI photo check: unit tests on the result → band mapping; Jo's desk check overrides AI.
- Listing facts: write limited to the allowed fact keys; "none found" stops re-searching.
- QA in the running portal (TEST office login): By area view, ticking a Weak spot and a spot in another area, Send to a covering installer with a TEST job.
