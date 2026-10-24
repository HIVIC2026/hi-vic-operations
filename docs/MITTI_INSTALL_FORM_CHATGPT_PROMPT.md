# Prompt for ChatGPT: add the Activity Guide evidence items to the Install day form in Mitti

Copy everything between the lines into ChatGPT (it edits the template with Mitti's "Build with AI"). This ADDS items to the existing Install day template; nothing existing is removed. Decision 205 (Jo, 24 Oct 2026); wording is fixed in `src/lib/install-evidence.core.ts`.

---

You are editing my EXISTING **Install day** template in **Mitti** (mitti.com.au, "Build with AI" in the template builder). Keep every existing question exactly as it is and in its current order, except the four label changes listed in Part A. Add the new questions in Part B at the end of the template (or as a new page "Zones and evidence" before the final sign-off, if the template has one). The wording below must be copied **character for character** (including the em dash "—", the degree sign in "360°" and "(geotagged...)"), because connected software reads each answer by its question text and will refuse the job's rebate claim if an item is missing. Do not reword, merge, split or drop anything. Every photo and video item: Media type, **location/GPS on** (and "camera only" if Mitti offers it). If Mitti does not support an answer type I name, tell me the closest and ask me before substituting.

Answer-type key: Pick one = single-select multiple choice; Yes/No = two choices "Yes" / "No"; Text = single-line text; Photo = media (photo), location on; Video = media (video), location on; Checkbox = single checkbox that must be ticked.

## Part A: change the label of four EXISTING photo questions (same questions, same position, wording only)
Find each existing item by its current label and replace the label with the new wording:
1. The installer photos item → `Photo of each installer at the front of the premises with photo ID clearly visible — one photo per installer (geotagged)`
2. The electrician photo item → `Photo of the electrician at the front of the premises with photo ID clearly visible (geotagged)`
3. The power-isolation photo item → `Before work starts: photo of the power isolated — lock-out tag on the switchboard, and the solar and battery isolators switched off where the home has them (geotagged)`
4. The product photos item → `Photo of the product packaging on site showing the brand, model and R-value label — one per product (geotagged)`

## Part B: new questions
1. `How many upgrade zones are you insulating on this job?` — Pick one: `1` / `2` / `3` — Required

Then, for Zone 1, Zone 2 and Zone 3, add this block of six questions (replace `Zone 1` with `Zone 2` and `Zone 3` in the second and third blocks). Show the Zone 2 block only when question 1 is `2` or `3`; show the Zone 3 block only when question 1 is `3`. The Zone 1 block always shows.

2. `Zone 1 — name of this ceiling area (use the same name as the Ready Check and floor plan)` — Text — Required
3. `Zone 1 — is there existing insulation in this area (under-insulated)?` — Yes/No — Required
4. `Zone 1 — photo of the existing insulation with a ruler placed vertically showing its depth, and any brand, model or R-value markings (geotagged)` — Photo, location on, allow several — Required — only show when question 3 (this zone) = Yes
5. `Zone 1 — before 360° video of this ceiling area, lit and clearly labelled, showing any existing insulation (geotagged, under 250 MB)` — Video, location on — Required
6. `Zone 1 — after 360° video of this ceiling area, lit and clearly labelled, showing full coverage, depth without compression and no waste left (geotagged, under 250 MB)` — Video, location on — Required
7. `Zone 1 — after-install photo of the new insulation with a ruler placed vertically showing its depth (geotagged)` — Photo, location on, allow several — Required

(Repeat 2–7 as `Zone 2 — …` and `Zone 3 — …` with the show rules above.)

After the three zone blocks:
8. `Will this installation run over more than one day?` — Yes/No — Required
9. `Before starting work each day, I re-checked every item on this safety assessment and they all still hold.` — Checkbox (must tick) — Required — only show when question 8 = Yes

## When you have given me the steps
Finish with a checklist to verify the published template: the four relabelled items, question 1 with options 1/2/3, three zone blocks of six questions each with the exact "Zone N — …" wording, the show rules for Zone 2/3 and for the existing-insulation photo, the multi-day pair, and location on for every photo/video. Confirm the template ID is unchanged (the software stays connected to the same template) and that a form already in progress still opens.

---
