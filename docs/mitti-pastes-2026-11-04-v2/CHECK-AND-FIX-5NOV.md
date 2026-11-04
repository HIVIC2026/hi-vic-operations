# Mitti forms vs the portal — read-only check, 4 Nov 2026 (late)

**What was checked:** the five published Mitti templates exactly as Jo's Mitti AI exported them tonight (`structures.txt`), against what the portal on branch `new-job-flow-joined` actually reads (the reader files are unchanged between c3d32469 and the current HEAD ca9d6407). Nothing was edited in Mitti or the portal.

**How:** every question on each form was pushed through the portal's own reader code (not my eyes). A question counts as "reads fine" only when deleting it from a filled-in form changes what the portal reads back. "Missing" comes from the portal's own form checks and the Part 8 health check. The "Paste to fix" at the end was re-run through the same checks to prove it works. Scripts: `check.ts`, `verify-fix.ts`; results in `findings.json`, `run2.log`, `verify.log`.

## One-line verdicts

| Form | Safe for the first TEST job? |
|---|---|
| A1 – Ready Check (installer's customer) | **Yes** — everything the quote needs is read. Three small tidy-ups recommended (ready-to-price tick, "Who lives at the property?", delete a duplicate m² box). |
| A2 – Ready Check (our lead) | **Yes, after one small add** — add "Homeowner agrees to be contacted…" or every A2 gives the office a false "Chase installer" item. Two more tidy-ups (photo-ID tick, pricing-tick wording). |
| A3 – PIESA | **No** — the electrician's on-site photo has different wording, so the portal says "On-site photo missing" forever and the PIESA never completes. One reword fixes it. |
| A4 – Electrical upgrades | **Yes** — every item reads, nothing missing. |
| A5 – Install day | **No** — the after-videos and depth-photos wording is different, so the portal doesn't recognise the form as the Install day form at all; and the ruler-photo page is missing, which locks Installation complete. Two rewords plus one page fix it. |

Do the pastes in this order: **A3, A5, A2, A1**. A4 needs nothing.

---

## A1 – Ready Check | Installer-Supplied Customer (65 items)

**1. Reads fine — 46 questions.** Job and owner details, contact permission, photo-ID tick, life support, 5-year, roof, access rating, every ceiling-area answer (name, how measured, floor plan / aerial m² and uploads, m² or length × width, existing insulation, type, depth, depth photo, R value incl. the old "Above R2.0" wording, remove / top up, remove m², good-enough / foil / foil photo / why kept, downlights + count, issues + note + photo, before video), outcome, fail reasons, product.

**2. The portal WON'T read these — none.**
But one trap: **"Enter the measured ceiling area (m²)"** is on the form twice in each area (3.12 only when "Enter area (m²)" is picked, and 3.17 always shown, optional). The portal reads the first one it finds. If the installer types in the second one, the area has no size ("missing or invalid – office review"). And when the first one is filled, the always-shown blank one makes the area diagram drop that area's "Existing insulation: remove … m²" note (confirmed with the diagram code). Delete 3.17.

**3. Missing from the form**
- **"This job is ready to price. Everything I've filled in is correct. Any photos I skipped will be taken on install day."** (required tick) → the Part 8 health check reports A1 NOT OK. The job still runs (a form without the tick counts as ticked), so the boss gets the "enter your price" text without the installer's confirmation.
- **"Who lives at the property?"** (Owner lives here / Private rental – tenant lives here / Public housing / Community housing) → feeds the office note "who lives at the property" (premises type); the portal's form-connect check lists it as Missing. Office note only.

**4. Harmless differences (not read):** "What is the property type?" (Other), "Describe the roof type", "Please explain why the access is difficult / no safe access" (the boss's price card shows the access rating and the per-area issue notes, not these), "Please describe the existing insulation type", the access-point photo (kept in Mitti only), "Total ceiling area (m²)" (the portal adds the areas itself), the signature (Mitti's record; the portal uses Complete), every "Take it live" line and help text, the fail-reason option names (just copied into the office note). Note: "Upload an overview photo of this ceiling area" (3.32) is also counted as the before video by the old-forms rule, so a photo without the video would pass that check.

**5. Verdict: safe for the first TEST job — yes**, because every answer the quote, diagram and eligibility rules need is read; the three items above are tidy-ups, not blockers.

---

## A2 – Ready Check | Home Insulation Victoria's Lead (63 items)

**1. Reads fine — 41 questions.** Same ceiling-area block as A1, plus "Did the owner ask about a different R value?" / "Which R value?", outcome, fail reasons, product.

**2. The portal WON'T read these**
- 4.6 **"I didn't discuss or agree any pricing with the owner — Home Insulation Victoria handles that."** → portal expects **"I confirm I have not discussed or agreed pricing with the homeowner during this Ready Check. All quotes and pricing come from Home Insulation Victoria."** What breaks: the "installer confirmed pricing not discussed" note never lands on the job; the form-connect check lists the tick as Missing.
- Same duplicate **"Enter the measured ceiling area (m²)"** (3.17) trap as A1 — delete it.

**3. Missing from the form**
- **"Homeowner agrees to be contacted by Home Insulation Victoria"** (Yes/No) → on every completed A2 the portal records "Ready Check form is missing: whether the homeowner agrees to be contacted", queues the installer chase (held on TEST jobs and while the switch is off) and after 24h puts "Chase installer" in the office Needs me list. The quote still goes out (our-lead completion doesn't need it), but the office gets a bogus chase item on every A2.
- **"I showed my photo ID (name + business)"** (required tick) → Part 8 health check reports A2 NOT OK; the Code of Conduct tick is simply never asked (and never chased, because it isn't on the form).
- **"Who lives at the property?"** → office note only (as A1).
- The form-connect check also wants Homeowner phone / email / "Life support equipment at property?" / "built or replaced in the last 5 years?" on A2. Nothing reads them for our leads (those come from the website), so leave them off — it only means the office Mitti forms page shows a warning for A2.

**4. Harmless differences (not read):** as A1, plus "Are there recessed downlights in this ceiling area?" (only "How many recessed downlights?" is read), the top note to the installer, the signature.

**5. Verdict: safe for the first TEST job — yes once "Homeowner agrees to be contacted…" is added**; without it the job still works but the office gets a false "Chase installer" item on every A2.

---

## A3 – Electrical safety check (PIESA) (68 items)

**1. Reads fine — 46 questions.** Job ref, address, owner, date, life support record / present / consent / attachment, adult-at-home, mains safe + problem ticks + photo, switchboard photo, solar + problem ticks + photo, ceiling wiring + problem ticks + photo, downlights (count, non-IC, how many, photo), appliances block (type, where, photo, safe, problem, action), "Are electrical upgrades needed?", work list + counts + other, electrician on site at start, "doing the upgrades today?", certificate now / number / date / file, the five electrician details, declaration tick, signature.

**2. The portal WON'T read these**
- 1.6 **"Click 'Add media' and take a photo of yourself in front of the premises holding/showing your photo ID (such as a licence). The photo will be time stamped and geo-tagged, so it MUST be live."** → portal expects **"Photo of you (the electrician) standing in front of the house, holding your photo ID"** (or the older "Photo showing you on site at the property, holding your licence / photo ID (geotagged)"). What breaks: every sync says "Official form: On-site photo missing", so a PIESA marked Complete in Mitti is never complete in the portal — no electrical clearance, no upgrades-day booking, no install booking. **This blocks the test job.**

**3. Missing from the form — nothing** that the readers or the health check need (health check: OK; form-connect check passes once 1.6 is reworded).

**4. Harmless differences:** all the "Take it live", "Stop…", "Tell the owner: 30 days" and "No? We'll text you a link" lines; "Owner name" is prefilled only. All option wordings (consent, problem lists, appliance types, upgrade work list) match the portal exactly.

**5. Verdict: safe for the first TEST job — no**, because the on-site photo wording stops the PIESA ever completing. One reword fixes it.

---

## A4 – Electrical upgrades (24 items)

**1. Reads fine — 16 questions** (all of them): job number, address, the five electrician details, the portal-filled work list, "finished ALL the upgrade work…", "What's not done…", certificate now / number / date / file, finished-work photo, signature. The portal recognises it as the upgrades form.

**2. Won't read — none.** **3. Missing — none** (health check OK, form check OK).

**4. Harmless differences:** the help lines ("Filled in by the portal…", "A photo or the PDF…", "Show the finished work…", "Take it live").

**5. Verdict: safe for the first TEST job — yes**, nothing to change.

---

## A5 – Install day (87 items)

**1. Reads fine — 45 questions** (once the form is recognised, see below): job number, address, install date, accredited person, business, lead / second / third installer names, CII numbers and photos, "anyone else", power-off told, adult-at-home, life support + consent + upload, safety plan signed, hazards covered, isolated + lock-out photo, solar / instructions / isolator, PIESA read, electrician needed / here / photo, ceiling entered, product packaging photo, declaration tick + signature, more than one day + daily re-check, lock-out off, who turned it on, switchboard-on photo, solar back on, supervised, the final "All filled in" tick, second signature, Part B tick + Part B signature.

**2. The portal WON'T read these**
- 8.2 **"Record one slow, well-lit 360° video of each ceiling area (eg: living room), verbally stating the area's name and clearly showing complete insulation coverage, no gaps or missed sections, and no rubbish left behind."** → portal expects **"AFTER videos: one slow 360° turn of each area"** (or the longer "After videos: one slow 360° of each ceiling area, lit, saying the area's name, showing full coverage and no rubbish left").
- 8.4 **"Take one clear photo per ceiling area, showing a vertical ruler measuring the insulation depth, with markings visible. Do not compress the insulation."** → portal expects **"Depth photos: ruler standing straight up in the new insulation, one per area"** (or "Depth photos: the new insulation in each area with a ruler standing in it").
- What breaks: the portal recognises the Install day form by the after-videos wording, so right now it **doesn't recognise this form at all** — it treats it as the old form: after videos and depth photos read as missing, the adult answer and ruler photos are never read, the final "All filled in" tick never counts (so the "All filled in" text to the installer never goes), the official PIISA answers come back blank, and Installation complete stays locked.

**3. Missing from the form**
- The ruler-photo page: a repeating section **"Add a ceiling area"** with **"Existing insulation depth — photo with a ruler standing upright in it"** (optional) and **"New insulation depth after install — photo with a ruler standing upright in it"** (required) → without it the portal says "The install day form has no ruler photo questions yet … send a new form" and Installation complete, the rebate gates and the installer's payout stay locked.
- **"Did anything new come up during the job that affects safety? What was it?"** and **"What did you do to keep everyone safe?"** (both optional text) → they print on the safety plan (SWMS). Not blocking — a form without them just reads as "not asked" — but the Part 8 health check reports A5 NOT OK until they're there.

**4. Harmless differences:** the READ FIRST text is shorter than the portal's version (it lacks "Do not leave site until the whole form is done, you have pressed Complete, and the portal has texted you 'All filled in'.") — not read, not checked; the declaration text (7.1–7.3), "Photo ID readable.", "Every page readable.", "It's on your job page.", "Ask the owner.", "One per product.", "Don't squash it.", the Stop lines, "STOP. You are only halfway…", "Sign this last…". The Part B page and declaration text match what the health check wants.

**5. Verdict: safe for the first TEST job — no**, because the form isn't recognised as the Install day form and the ruler-photo page is missing, so the install can never be marked complete. Two rewords and one new page fix it.

---

## Paste to fix

One box per form. Do them in this order, publish each, then check it on your phone. Copy every word exactly — the portal reads answers by their wording. Re-run the health check afterwards: all five should pass.

### 1. A3 — PIESA (one reword)

```
Edit ONE existing Mitti template: "A3 – Electrical safety check (PIESA)" (template ID eb3bf3b6-17d3-4c59-9244-5892a0ec16f5). Keep its template ID. Make ONLY the change below. Copy the wording exactly, character for character. Do not add, reorder or delete anything else. If Mitti cannot do it, stop and tell me.

1. On the first page, find the photo question that starts "Click ‘Add media’ and take a photo of yourself in front of the premises". Change ONLY its wording to exactly:
   Photo of you (the electrician) standing in front of the house, holding your photo ID
   Keep it a Media (photo) item, Required, location (GPS) on. Keep the "Take it live — uploads not allowed." line under it. If you want the old sentence kept, put it in the help text, not the question.

Publish. Then confirm the change was made.
```

### 2. A5 — Install day (two rewords, one new page, two optional questions)

```
Edit ONE existing Mitti template: "A5 – Install day" (template ID 1f325828-3f71-4b1a-988f-083c83414f95). Keep its template ID. Make ONLY the changes below. Copy every wording exactly, character for character, including the long dash (—). Do not add, reword, reorder or delete anything else. If Mitti cannot do something, stop and tell me.

1. On the page "Videos and photos (after the install)", find the video question that starts "Record one slow, well-lit 360° video of each ceiling area". Change ONLY its wording to exactly:
   AFTER videos: one slow 360° turn of each area
   Keep it Media, Required, several files allowed, location (GPS) on. Put the old sentence in its help text if you want it kept.

2. On the same page, find the photo question that starts "Take one clear photo per ceiling area, showing a vertical ruler". Change ONLY its wording to exactly:
   Depth photos: ruler standing straight up in the new insulation, one per area
   Keep it Media, Required, several files allowed, location (GPS) on. Keep "Don't squash it." under it.

3. Add a NEW page called "Ruler photos (each ceiling area)". Put it straight after the page "Product" (the one with "Photo of the packaging showing brand, model and R-value") and BEFORE the page "Declaration (sign before you start)".
   On that page add ONE repeating section with the button "Add a ceiling area". Help text on the section: Add one for each ceiling area, in the same order as the Ready Check areas.
   Inside the repeating section add these two questions, in this order:
   a) Existing insulation depth — photo with a ruler standing upright in it
      Media (photo), location (GPS) on, NOT required. Help text: Only if this area had insulation before. Take it before any work starts.
   b) New insulation depth after install — photo with a ruler standing upright in it
      Media (photo), location (GPS) on, Required. Help text: Come back to this page when the insulation is in. Don't squash it.
   Do not add any "only show when" logic to a). They must be inside the repeating section.

4. On the page "Finishing up", straight after "I was here the whole time and supervised everyone", add two NEW questions, both Text — paragraph, NOT required:
   Did anything new come up during the job that affects safety? What was it?
   What did you do to keep everyone safe?

Change nothing else. Publish. Then list the four items and confirm each was done, and anything you could not do.
```

### 3. A2 — Ready Check, our lead (one reword, two adds, one delete; "Who lives at the property?" optional)

```
Edit ONE existing Mitti template: "A2 – Ready Check | Home Insulation Victoria’s Lead" (template ID dbaf67a2-c9c5-4120-8c69-0f4a43c5bd39). Keep its template ID. Make ONLY the changes below. Copy every wording exactly, character for character. Do not add, reword, reorder or delete anything else. If Mitti cannot do something, stop and tell me.

1. On the "Ready Check Outcome" page, find the checkbox "I didn't discuss or agree any pricing with the owner — Home Insulation Victoria handles that." Change ONLY its wording to exactly:
   I confirm I have not discussed or agreed pricing with the homeowner during this Ready Check. All quotes and pricing come from Home Insulation Victoria.
   Keep it a Checkbox, Required.

2. On the "Title Page", straight after "Homeowner name", add two NEW items in this order:
   a) Homeowner agrees to be contacted by Home Insulation Victoria
      Multiple choice, single answer, Required. Answers exactly: "Yes", "No".
   b) I showed my photo ID (name + business)
      Checkbox, Required.

3. Optional but recommended, on the "Title Page" after "Property type": a NEW question
   Who lives at the property?
   Multiple choice, single answer, Required. Answers exactly: "Owner lives here", "Private rental – tenant lives here", "Public housing", "Community housing".

4. Inside the repeating section "Add a ceiling area", there are TWO questions worded "Enter the measured ceiling area (m²)". DELETE the one that is always shown and not required (the one sitting after the "Got a floor plan for the whole house?" tip). KEEP the one that only shows when "How do you want to give the size?" = "Enter area (m²)".

Change nothing else. Publish. Then list the four items and confirm each was done, and anything you could not do.
```

### 4. A1 — Ready Check, installer's customer (one add, one delete; "Who lives at the property?" optional)

```
Edit ONE existing Mitti template: "A1 – Ready Check | Installer-Supplied Customer" (template ID 01ee0428-be6d-4435-b34d-8b738935f099). Keep its template ID. Make ONLY the changes below. Copy every wording exactly, character for character. Do not add, reword, reorder or delete anything else. If Mitti cannot do something, stop and tell me.

1. On the "Ready Check Outcome" page, straight BEFORE the signature "I confirm the information, measurements, photos and quote provided in this Ready Check are accurate to the best of my knowledge.", add a NEW Checkbox, Required, worded exactly:
   This job is ready to price. Everything I've filled in is correct. Any photos I skipped will be taken on install day.

2. Optional but recommended, on the "Title Page" after "Property type": a NEW question
   Who lives at the property?
   Multiple choice, single answer, Required. Answers exactly: "Owner lives here", "Private rental – tenant lives here", "Public housing", "Community housing".

3. Inside the repeating section "Add a ceiling area", there are TWO questions worded "Enter the measured ceiling area (m²)". DELETE the one that is always shown and not required (the one sitting after the "Got a floor plan for the whole house?" tip). KEEP the one that only shows when "How do you want to give the size?" = "Enter area (m²)".

Change nothing else. Publish. Then list the three items and confirm each was done, and anything you could not do.
```

### After the pastes
Checked against the portal code with the same scripts (`verify.log`): with these changes A1, A2, A3, A4 and A5 all pass the Part 8 health check; A3's "On-site photo missing" goes away; A5 is recognised as the Install day form with after videos, depth photos, ruler photos, the adult answer, the final tick and Part B all read; A2 no longer raises the "whether the homeowner agrees to be contacted" chase. The only leftover is the A2 form-connect warning about phone / email / life support / 5-year (not read for our leads) — a code tweak, not a form change.

Forms already sent to installers before a paste keep their old wording — send a new form for the test job after publishing.
