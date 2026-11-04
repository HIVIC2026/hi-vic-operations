# Mitti paste — A5 (Install day): put it back to your 4 Nov rebuild

Jo, this is the whole A5 form, page by page, in your 4 Nov wording. One paste.
It rebuilds the existing template in place (same ID), so forms already sent keep working.
Read the short "Not certain" list first — five things I couldn't pin down from what's saved here.
Then paste the box into your Mitti AI, publish, open the form on your phone and check it page by page.
The portal reads every question by its exact wording, so the words must be copied character for character.

## Not certain — check before you paste

1. **Ruler photos page (two ruler photos per ceiling area).** Your rebuild prompt left this page out; the check before you sent it told you to keep it. I have KEPT it in (page 7) because the portal holds "Installation complete" on every install day form that doesn't have it. If your rebuilt form really didn't have this page, delete page 7 from the paste.
2. **Two safety questions have two possible wordings.** The paste uses the plain 4 Nov wording. The check before you sent the rebuild asked you to use the longer wording instead, and the portal reads both. With the plain wording the portal leaves two official answers blank for office review on every job. If you used the longer wording, swap these in:
   - Page 3, item 8: `Have the hazards been considered and their controls implemented for this job?` (instead of `Does the safety plan cover every hazard at this house?`)
   - Page 4, item 3: `Is its ground-level isolator accessible, working and able to switch off safely?` (instead of `Does its isolator (at ground level) work and switch off safely?`)
3. **The 2 Nov additions are NOT in this paste** (adult at home question + stop line, the two "Changes during the job" text items, and the "Rebate form (VEEC) — Lead Installer" last page). Your 4 Nov notes say they weren't published before the rebuild. If you want them on A5, paste `docs/mitti-paste-2026-11-02-A5-adult-part-b.md` after this one.
4. **Help lines and page names.** The portal doesn't read them, so nothing breaks either way. The help lines are the ones from the original build (no "Must show" lines). One of them differed on the live form before the rebuild: the lock-out photo help was `Solar and battery isolators off too, if the home has them.` — the paste uses the original build line `If there's solar, a battery or a generator, it must be off too.` Pick either.
5. **No "A5 + BEFORE photos" variant.** Nothing saved here shows a second A5 template was ever built, so this paste builds one template only. The single text field `Ceiling areas in Ready Check order` is also left out (it was only planned, never confirmed on the form).

Order note: where my notes disagreed on order I followed the portal's own build order (the solar questions come before the power-off questions, as you asked on 25 Oct).

## The paste

Copy everything in the box below into your Mitti AI.

```
Rebuild ONE existing Mitti template: "A5 – Install day" (template ID 1f325828-3f71-4b1a-988f-083c83414f95). Keep its template ID — edit it in place, do not create a new template. When you are done the form must contain EXACTLY the pages and items listed below, in this order, and nothing else: delete anything on the form that is not in this list (including any help line that starts "Must show:", any line "Take it live — uploads not allowed.", any text item that starts "Paid only when", and any question, page or option not listed here).

Copy every wording exactly, character for character, including punctuation, capitals, the apostrophes, the ° and the long dash (—). A connected software system reads every answer by its question text, so do not reword, merge, split, reorder, add or drop anything. If Mitti cannot do something exactly as written, stop and tell me before substituting.

HOW TO READ THIS LIST
- "Page" = a section/page in the template. One page per heading below.
- Text item = an Instruction item (not a question).
- Help line = the help text under that question. If Mitti has no help-text field on a question, add the help line as an Instruction item directly under the question.
- Stop line = an Instruction item nested under the question so it only shows when that answer is given (Add logic → If answer is No → show the item). Stop lines are not questions.
- "Only show when" = nest the item under the trigger question with logic on that answer (Add logic → If answer is Yes → Ask questions). Keep every one of these rules even where the dependent item is a photo.
- Answer types: Text = single-line text; Date = date; Yes/No = multiple choice, single answer, options exactly "Yes" and "No"; Pick one = multiple choice, single answer, with the exact options listed; Photo = media (photo) with location/GPS on; Video = media (video) with location/GPS on; "several files allowed" = the installer can attach more than one file to that one item; Checkbox = a single checkbox; Signature = signature capture.
- Colours: GREEN = the safe or done answer, RED = a problem or stop, GREY = a plain fact. Use separate Yes/No response sets if Mitti needs them (Yes green/No red; Yes red/No green; Yes grey/No grey; Yes grey/No green). The RED answers are the ones marked red below.
- Everything is Required unless it says "Not required".

TEMPLATE SETTINGS
- Template name: A5 – Install day
- Inspection title: Job number + Address (the first two questions).
- Mandatory mark-as-complete: ON.
- Location/GPS: ON for every Photo and Video question.

=====================================================================
PAGE 1 — "Job"
1. Text item, first item on the page:
READ FIRST: The VEU will not accept this job unless every answer, photo and video on this form is filled in. Do not leave site until the whole form is done, you have pressed Complete, and the portal has texted you "All filled in". Press Complete before you leave — we can't claim the rebate or pay the job until it's done.
2. Job number — Text — Required
3. Address — Text — Required
4. Install date — Date — Required
5. Accredited Person — Text — Required

=====================================================================
PAGE 2 — "Who's on site"
1. Installer's business name — Text — Required
2. Lead installer's full name — Text — Required
3. Lead installer's CII number (EEC Ceiling Insulation Installer) — Text — Required
4. Photo of the LEAD installer standing in front of the house, holding photo ID — Photo — Required — help line: Photo ID readable.
5. Is anyone else installing insulation today? — Yes/No — Required — Yes grey, No grey
   Only show when item 5 = Yes:
   6. Second installer's full name — Text — Required
   7. Second installer's CII number — Text — Required
   8. Photo of the SECOND installer standing in front of the house, holding photo ID — Photo — Required — help line: Photo ID readable.
   9. Is there a third installer? — Yes/No — Required — Yes grey, No grey
      Only show when item 9 = Yes:
      10. Third installer's full name — Text — Required
      11. Third installer's CII number — Text — Required
      12. Photo of the THIRD installer standing in front of the house, holding photo ID — Photo — Required — help line: Photo ID readable.

=====================================================================
PAGE 3 — "Before anyone goes up"
1. Have you told the household the power will be off today? — Yes/No — Required — Yes green, No RED
   Stop line when No: Stop. Tell them before you go on.
2. Does anyone living here use life support equipment? — Yes/No — Required — No green, Yes grey
   Only show when item 2 = Yes:
   3. Do you have their written consent or medical plan? — Yes/No — Required — Yes green, No RED
      Stop line when No: Stop. You need it before starting.
      Only show when item 3 = Yes:
      4. Photo of every page of the consent or medical plan — Photo — Required — help line: Every page readable.
5. Have you signed the safety plan (SWMS) for this job? — Yes/No — Required — Yes green, No RED — help line: It's on your job page.
   Stop line when No: Stop. Sign it on your job page first.
6. Does the safety plan cover every hazard at this house? — Yes/No — Required — Yes green, No RED
   Stop line when No: Stop.

=====================================================================
PAGE 4 — "Solar, battery and power off"
1. Is there solar, a battery or a generator at the house? — Yes/No — Required — No green, Yes grey
   Only show when item 1 = Yes:
   2. Do you have its shutdown and restart instructions? — Yes/No — Required — Yes green, No RED
      Stop line when No: Stop. An electrician must isolate it.
   3. Does its isolator (at ground level) work and switch off safely? — Yes/No — Required — Yes green, No RED
      Stop line when No: Stop. Get an electrician to check it.
4. Is the power off, locked out and tagged, and is the ceiling safe to go into? — Yes/No — Required — Yes green, No RED
   Stop line when No: Stop. Isolate, lock out and tag first.
5. Photo of the switchboard: main switch off, lock and tag on — Photo — Required — help line: If there's solar, a battery or a generator, it must be off too.

=====================================================================
PAGE 5 — "The electrician's check (PIESA)"
1. Have you read the electrician's safety check (PIESA), and does it say it's safe to start? — Yes/No — Required — Yes green, No RED
   Stop line when No: Stop.
2. Does the PIESA say an electrician must be here when you start? — Yes/No — Required — No green, Yes grey
   Only show when item 2 = Yes:
   3. Is the electrician here now? — Yes/No — Required — Yes green, No RED
      Stop line when No: Stop. Wait for the electrician.
      Only show when item 3 = Yes:
      4. Photo of the ELECTRICIAN standing in front of the house, holding photo ID — Photo — Required
5. Has anyone been in the ceiling since the electrician's check? — Yes/No — Required — No green, Yes RED — help line: Ask the owner.
   Stop line when Yes: Stop. An electrician must check again.

=====================================================================
PAGE 6 — "Product"
1. Photo of each insulation pack you're using — Photo, several files allowed — Required — help line: One per product.

=====================================================================
PAGE 7 — "Ruler photos (each ceiling area)"
1. ONE repeating section, button "Add a ceiling area". Help line on the section: Add one for each ceiling area, in the same order as the Ready Check areas.
   Inside the repeating section, in this order (copy the long dash — exactly):
   a. Existing insulation depth — photo with a ruler standing upright in it — Photo — NOT required — help line: Only if this area had insulation before. Take it before any work starts.
   b. New insulation depth after install — photo with a ruler standing upright in it — Photo — Required — help line: Come back to this page when the insulation is in. Don't squash it.
   No "only show when" logic on either of these. They must be inside the repeating section and nowhere else.

=====================================================================
PAGE 8 — "Declaration (sign before you start)"
1. Text item, exactly:
INSTALLER DECLARATION – Sign BEFORE insulation work starts.

As the lead EEC Certified installer responsible for this installation, I confirm that:

a. I have received a completed copy of the Pre-installation electrical safety assessment for the premises; and

b. I have completed the current Pre-installation installer safety assessment, as published on the department's Internet site within 30 days of the completion of the pre-installation electrical safety assessment; and

c. the pre-installation installer safety assessment confirms
   i. the worksite is safe and the installation or upgrade will proceed in accordance with any recommendations or conditions from the pre-installation electrical safety assessment including, if required, that a licensed electrician must be present during the insulation upgrade; and
   ii. that safe work methods are in place as per Occupational Health and Safety Regulations 2017 (Vic); and
2. Text item, exactly:
d. I will ensure that:
   i. all applicable occupation health and safety laws and requirements are complied with; and
   ii. the insulation will be installed in compliance with the effective version of AS 3999; and
   iii. if the installation is carried out on multiple days, that I will check that all items remain compliant with this assessment form at the start of each day prior to undertaking the work; and
   iv. the insulation product/s being installed are listed on the ESC Register of Products.
3. Text item, exactly:
Privacy Collection Statement: DEECA and ESC collect and use this information under the Privacy and Data Protection Act 2014 (Vic) to administer, monitor and enforce VEU. Refer to the complete Privacy Collection Statement in the linked official form: https://www.energy.vic.gov.au/__data/assets/word_doc/0042/788397/VEU-pre-installation-installer-safety-assessment-form-.docx
4. Everything on this form is true and complete — Checkbox — Required
5. Lead installer's signature — Signature — Required   (this is the FIRST of two signatures with this exact name; keep both)
6. Text item, exactly:
STOP. You are only halfway. Do not leave site. When the insulation is in, come back and finish the next pages: after videos, depth photos and finishing up.

=====================================================================
PAGE 9 — "Videos and photos (after the install)"
1. Text item, first item on the page:
AFTER THE INSTALL: do this before you pack up. Every ceiling area needs its after video and depth photo.
2. AFTER videos: one slow 360° turn of each area — Video, several files allowed — Required
3. Depth photos: ruler standing straight up in the new insulation, one per area — Photo, several files allowed — Required — help line: Don't squash it.
4. Did the install take more than one day? — Yes/No — Required — Yes grey, No grey
   Only show when item 4 = Yes:
   5. I checked every item on this form again at the start of each day. — Checkbox — Required

=====================================================================
PAGE 10 — "Finishing up"
1. Is the lock and tag off and the power back on? — Yes/No — Required — Yes green, No RED
   Stop line when No: Don't leave until it is.
   Only show when item 1 = Yes:
   2. Who turned it back on? — Pick one, options exactly in this order: Lead installer / Second installer / Third installer / The electrician — Required — all four grey
   3. Photo of the switchboard: main switch back on, lock and tag removed — Photo — Required
4. Is the solar, battery or generator switched back on? — Pick one, options exactly in this order: Yes / No / There isn't one — Required — Yes green, No RED, There isn't one green
5. I was here the whole time and supervised everyone who installed. — Checkbox — Required
6. Every answer, photo and video is filled in. I won't leave until the portal texts me 'All filled in'. — Checkbox — Required
7. Lead installer's signature — Signature — Required   (the SECOND signature with this exact name; it must be a separate item from the one on page 8)

=====================================================================
FINISH
Delete anything on the form that is not in this list. Check the two "Lead installer's signature" items are both there as separate items (page 8 and page 10). Publish the template. Then list, page by page, what is on the published form, and anything you could not do exactly as written.
```

## After you publish

Open the published A5 on your phone and check it page by page against the list. Then tell me and I'll read the live template (read only, nothing changes in Mitti) and say if any wording is off. Once it's right, send installers a new form.
