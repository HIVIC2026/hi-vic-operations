# Prompt for ChatGPT: rebuild BOTH Ready Check templates lean in Mitti (decision 222)

Copy everything between the lines into ChatGPT (or Mitti's "Build with AI"). It is ONE self-contained build for the two
Ready Check templates — `A1 – Ready Check | Installer-Supplied Customer` and `A2 – Ready Check | HIVIC Sourced Customer` —
rebuilt lean per `docs/MITTI_READY_CHECK_LIVE_AUDIT_2026-10-24.md` §6 with Jo's one change (24 Oct 2026, decision 222):
each ceiling area is measured as **Length (m) + Width (m)** instead of a single m² entry, so the portal can draw the
Table 4 diagram with dimensions. "Who lives at the property?" stays in.

Every wording below is fixed in `src/lib/ready-check-lean.core.ts` (`LEAN_Q`, the option lists, `LEAN_HELP`, `LEAN_REMOVE`)
and mirrored by the build sheet in `src/lib/mitti-forms.core.ts` (`FORMS.ready_check` = A2, `FORMS.ready_check_priced` = A1);
`tests/lean-ready-check.test.ts` fails if this file and the constants drift apart. The portal reads every answer by its
question text, so the labels must be copied character for character.

After publishing: send BOTH new template IDs to the software team (Office → Settings → Mitti forms), then run **Check form**
on each — the portal lists any question it cannot find by its exact wording. Keep the old A1 and A2 templates unpublished
(rename them "(old)") but do not delete them until every form in progress on them is marked Complete.

---

You are helping me rebuild two form templates in **Mitti** (mitti.com.au field inspection app, web template builder). I
will follow your instructions click by click in the Mitti web app. Give me the build as a numbered list of steps I can
tick off, nothing skipped, for **Template 1 first, then Template 2**. The question wording, answer types, options,
Required settings, help texts and "only show when" logic below are **fixed and must be copied exactly, character for
character, including punctuation, capitals, the ² symbol, the en dash "–" and the curly apostrophe in "What’s"**, because a
connected software system reads every answer by its question text. Do not reword, reorder, merge, split, add or drop any
question. If Mitti does not offer an answer type I name, tell me the closest Mitti type and ask me before substituting.

**Template 1 name:** `A1 – Ready Check | Installer-Supplied Customer`
**Template 2 name:** `A2 – Ready Check | HIVIC Sourced Customer`
The two templates are identical except where a line says **A1 only** or **A2 only**. Build them as NEW templates; the old
templates with the same names will be renamed "(old)" and unpublished by me afterwards.

**Inspection title:** Portal Job Number + Site address (questions 1 and 2).
**Settings:** turn ON **mandatory mark-as-complete** — Mitti's setting that answers to every Required question must be
given before the inspection can be marked complete (`mandatory_mark_as_complete`; it is currently OFF on both old
templates). Turn ON location/GPS for every Photo question.
**Pages:** one page per ## group below; page breaks do not matter to the reading software.
**Questions marked "portal fills this in"** are pre-filled by the software on every form it creates. Keep them as normal
editable items so the installer can correct them.
**The repeating group (Group 4):** build it ONCE as a repeating / dynamic section the installer adds with a button
labelled `Add a ceiling area`. Do NOT ask "how many areas" and do NOT paste copies of the group into separate logic
branches. If Mitti's repeating section cannot contain "only show when" logic inside it, tell me before building and
propose the closest structure that still keeps every question text exactly as written.

Answer-type key: Text = single line text; Number = numeric; Yes/No = two choices `Yes` and `No`; Pick one = single-select
multiple choice with the exact options listed; Tick all = multi-select multiple choice with the exact options listed;
Photo = photo/attachment with location on; Checkbox = single checkbox that must be ticked; Signature = signature capture;
"note required" = Mitti's option that forces a note on that answer.

## Group 1: Job
1. `Portal Job Number` — Text — Required — portal fills this in
2. `Site address` — Text — Required — portal fills this in
3. `Homeowner name` — Text — Required — portal fills this in
4. `Homeowner phone` — Text — Required — portal fills this in
5. `Homeowner email` — Text — Required — portal fills this in
6. `Property type` — Pick one: `House` / `Townhouse` / `Unit or apartment` — Required — portal fills this in (no "Other" text box)

## Group 2: Before you go up
7. `Homeowner agrees to be contacted by Home Insulation Victoria` — Yes/No — Required — help text: `If No, stop here and answer "No - Ready Check failed" on the last page.`
8. `Life support equipment at property?` — Yes/No — Required — portal fills this in — help text: `Pre-filled from what the owner told us. Change it if you learn otherwise; the office will call before anything goes out.`
9. `Was the ceiling or roof built or replaced in the last 5 years?` — Yes/No — Required — portal fills this in
10. `Who lives at the property?` — Pick one: `Owner lives here` / `Private rental – tenant lives here` / `Public housing` / `Community housing` — Required — portal fills this in where it knows

## Group 3: Roof and access
11. `What type of roof does the home have?` — Pick one: `Tiles` / `Metal sheet` / `Other` — Required (no "describe" text box)
12. `How would you rate the ceiling access?` — Pick one: `Easy` / `Standard` / `Difficult` / `No safe access` — Required — note required on `Difficult` and on `No safe access` — help text: `No safe access: take the access photo, then go to the last page and answer "No - Ready Check failed".`
13. `Is there a difficult access charge?` — Yes/No — Required — only show when question 12 = `Difficult`
14. `Difficult access fee ($ inc GST)` — Number — Required — only show when question 13 = `Yes` — help text **A1:** `Included in the price your business owner enters in the portal; it is shown on the owner's quote.` — help text **A2:** `Your charge to Home Insulation Victoria. Never discussed with the owner.`
15. `Upload a clear photo of the ceiling access point` — Photo — Not required

## Group 4: Ceiling areas (repeating section, button `Add a ceiling area`; the installer adds one per area)
**REMOVE, and do not carry over from the old templates (both A1 and A2):**
- the per-area sketch upload — A1 wording `Upload your area sketch or floor plan.` (with help text "Rough is fine. Mark this ceiling area and show the measurements used."), A2 wording `Upload your area sketch or floor plan. Rough is fine. Mark this ceiling area and show the measurements used.` — it exists once in every one of the 22 old A1 area blocks and 21 old A2 area blocks; the software now draws the diagram itself (decision 211);
- `What is the measured insulation depth (mm)?` (22 / 21 copies);
- `Please describe the existing insulation type` (22 / 21 copies);
- `Please explain` under the issues question (22 / 21 copies) — replaced by questions 31 and 32 below (Mitti cannot require a note on a photo, so the note is its own question);
- the question `How many ceiling areas need to be measured separately?` with its six branches `── Ceiling Area 1 ──` … `── Ceiling Area 6 ──` and every fixed area copy 2–22 inside them — replaced by the ONE repeating group below;
- the A1 field `CLICK ON ME to add a ceiling area` — replaced by the repeating group's own button `Add a ceiling area`;
- the single m² entry `Enter the measured ceiling area (m²)` (replaced by questions 17 and 18).
Also do not carry over `What is the property type?` (the "Other" text under Property type), `Describe the roof type`,
`Please explain why the access is difficult`, `Please explain why there is no safe access`, or `Difficult access` as an
option anywhere. The new group below is complete as written.
16. `Which part of the home does this ceiling area cover?` — Text — Required — help text: `Name it the way it will be named on install day, e.g. Main house, Rear extension, Garage.`
17. `Length (m)` — Number — Required — help text (on this question only): `Measure the longest length and width of this ceiling area. Split an L-shaped ceiling into two areas. The portal works out the m² and draws the diagram.`
18. `Width (m)` — Number — Required
19. `How was this ceiling area measured?` — Pick one: `Laser measure` / `Tape measure` / `Floor plan` / `Other` — Required
20. `Tell us how you measured it` — Text — Required — only show when question 19 = `Other`
21. `Is there existing insulation in this ceiling area?` — Yes/No — Required
22. `What type of existing insulation is installed? Select all that apply` — Tick all: `Batts` / `Loose fill` / `Other` — Required — only show when question 21 = `Yes`
23. `What is the determined R value of the existing ceiling insulation?` — Pick one: `Below R2.0` / `R2.0 or above` — Required — only show when question 21 = `Yes` — help text: `R2.0 exactly counts as "R2.0 or above". Typical old 50–70 mm batts or thin loose fill are Below R2.0.`
24. `Upload a photo clearly showing the measured insulation depth` — Photo — Not required — only show when question 21 = `Yes`
25. `What is required for the existing insulation?` — Pick one: `Remove` / `Top up` / `Not sure` — Required — only show when question 21 = `Yes`
26. `How much existing insulation needs to be removed? (m²)` — Number — Required — only show when question 25 = `Remove`
27. `Slow 360° video of this ceiling area, lit, saying its name` — Video (video attachment with location on) — Required — help text: `This is the before video the rebate needs. Show any existing insulation.`
28. `Are there recessed downlights in this ceiling area?` — Yes/No — Required
29. `How many recessed downlights?` — Number — Required — only show when question 28 = `Yes`
30. `Are there any issues that could affect the insulation installation? Example: exposed wiring, vermin, restricted access or other hazards` — Yes/No — Required
31. `What is the issue, and where is it in this area?` — Text — Required — only show when question 30 = `Yes`
32. `Describe the issue and add a photo` — Photo — Required — only show when question 30 = `Yes`

## Group 5: Product and result
33. `What insulation product will you be using on this job?` — Pick one, in this order: `Bradford Gold R5` / `Bradford Gold R6` / `Bradford Gold R7` / `Fletchers Pink Batts R5` / `Fletchers Pink Batts R6` / `Fletchers Pink Batts R7` / `Earthwool R5` / `ECOWOOL R5` — Required — always shown (NOT only when the Ready Check passed)
34. `Based on your onsite assessment, does this property meet the Ready Check requirements to proceed?` — Pick one: `Yes - Ready Check passed` / `No - Ready Check failed` — Required — help text: `The portal also applies the eligibility rules from your answers above.`
35. `Why did the property fail the ready check? Select all that apply` — Tick all: `Existing insulation is R2.0 or above` / `Ceiling or roof built or replaced in the last 5 years` / `No safe access to the ceiling` / `Homeowner does not want to proceed` / `Homeowner has not agreed to be contacted` / `Other – explain in a note` — Required — only show when question 34 = `No - Ready Check failed`
36. **A2 only:** `I confirm I have not discussed or agreed pricing with the homeowner during this Ready Check. All quotes and pricing come from Home Insulation Victoria.` — Checkbox — Required

**No quote page on A1 (decision 278, Jo 25 Oct 2026).** The old A1 page `Your quote to the homeowner` is DELETED and must
not be rebuilt: no `What’s included in your quote?`, `What else is included?`, `Total quoted price (inc GST)`,
`Who is doing the electrical safety check?`, `Electrician name`, `Electrician licence number` or `Electrician price (inc GST)`
question anywhere, on either template. The business owner enters the price, what is included and the electrician in our
portal, never in Mitti (**A1 only** difference: A1 simply has no question 36 and no quote page).

## Group 6: Sign
37. **A1:** `I confirm the information, measurements, photos and quote provided in this Ready Check are accurate to the best of my knowledge.` — Signature — Required
    **A2:** `I confirm the information, measurements and photos provided in this Ready Check are accurate to the best of my knowledge.` — Signature — Required

## When you have given me the steps
Finish with a checklist I can use to verify each published template: **A1 has 36 questions and A2 has 37** (Group 4
counted once; A2 = questions 1–37, A1 = questions 1–35 and 37), in this order; every "only show when" rule;
Required exactly as marked (the three Photo questions 15, 24 and 27 are the only optional ones); location on for every
Photo; the repeating section adds a complete copy of questions 16–32 each time; the eight product options spelled
exactly; the mandatory mark-as-complete setting on; none of the REMOVE items present; and where in Mitti I find each
**template ID** (in the web address when the template is open, or under the template's settings), because I must send
both IDs to my software team. Also remind me to keep the old A1 and A2 templates unpublished but not deleted until every
form in progress on them is complete.

---
