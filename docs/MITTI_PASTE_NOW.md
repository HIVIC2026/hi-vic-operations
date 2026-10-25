# Mitti: the four pastes still to do (25 Oct 2026)

Paste each block into ChatGPT on its own. Blocks 1–3 each change one template; block 4 adds the same four questions to
both Ready Check templates (A1 and A2).

## 1. A5 – Install day

```
Edit the Mitti template "A5 – Install day". Make ONLY these changes, then publish.

1. Page 1, first item, before Q1, a Text item (not a question):
"READ FIRST: The VEU will not accept this job unless every answer, photo and video on this form is filled in. Do not leave site until the whole form is done, you have pressed Complete, and the portal has texted you "All filled in". You are only paid when this form is 100% complete."
Delete the old "Paid only when this form is 100% complete…" line on this form.

2. Replace the Q37 text item with:
"STOP. You are only halfway. Do not leave site. When the insulation is in, come back and finish the next pages: after videos, depth photos and finishing up."

3. First item on the after-install page, before Q38, a Text item:
"AFTER THE INSTALL: do this before you pack up. Every ceiling area needs its after video and depth photo."

4. Just before "Lead installer's signature" (the last question), add a Checkbox question, Required:
"Every answer, photo and video on this form is filled in, and I won't leave site until the portal texts me "All filled in"."

5. Answer colours. GREEN = safe or done, RED = problem or stop, GREY = plain fact:
- Is anyone else installing today? — Yes grey, No grey
- Is there a third installer? — Yes grey, No grey
- Does the household know the power will be off today? — Yes green, No red
- Does anyone here rely on life support? — No green, Yes grey
- Do you have their written consent or medical plan? — Yes green, No red
- Is the safety plan for this job signed? — Yes green, No red
- Are all the common hazards covered in it? — Yes green, No red
- Is there solar, a battery or a generator? — No green, Yes grey
- Do you have the shutdown and restart instructions? — Yes green, No red
- Does the ground-level isolator work and switch off safely? — Yes green, No red
- Is the power isolated, locked out and tagged, and the ceiling safe to enter? — Yes green, No red
- Have you read the PIESA and is it safe to start? — Yes green, No red
- Does the PIESA need an electrician here at the start? — No green, Yes grey
- Is the electrician here? — Yes green, No red
- Has anyone been in the ceiling since the PIESA? — No green, Yes red
- Did the install take more than one day? — Yes grey, No grey
- Is the lock-out off and the power back on? — Yes green, No red
- Is the solar, battery or generator back on? — Yes green, There isn't one green, No red
If you need separate response sets for this, make them. Keep every "only show when" and stop line exactly as it is.

6. Settings (gear icon next to Publish): turn ON Mandatory mark-as-complete. Location/GPS ON for every Photo and Video question.

Change nothing else. Publish.
```

## 2. A3 – PIESA (electrician)

```
Edit the Mitti template "A3 – PIESA". Make ONLY these changes, then publish.

1. Rename the question "Are there any appliances, exhaust fans or flues in the ceiling space?" to:
"Are there any appliances, exhaust fans, flues or other hazards in the ceiling space?" (Yes/No, Required, same logic).

2. In the repeating block "Add an appliance or flue" (shown when that question = Yes):
- Help text: "One per appliance, exhaust fan, flue or other hazard. Answer No if it needs work or clearance before insulation goes in."
- DELETE the question "What is it and where is it?"
- The block must contain, in this order:
  1. "What type is it?" — Single choice: Appliance / Exhaust fan / Flue / Other hazard — Required
  2. "What is it?" — Text — Required
  3. "Where is it?" — Text — Required
  4. "Photo of it" — Photo, location on — Required (keep the existing one)
  5. "Can insulation be safely installed around it as it is?" — Yes/No — Required — Yes green, No red (keep the existing one)
  6. "What is the problem?" — Text — Required — only show when 5 = No
  7. "What needs to be done to make it safe?" — Text — Required — only show when 5 = No

3. In "What will you do? Tick everything included in your price.":
- REMOVE the option "Be on site at the start of the install day".
- Make this question NOT Required (keep its "only show when" logic).

4. Add a new question straight after "Describe the other work" and BEFORE "Your total price for all the repair work, including GST":
"Does an electrician need to be on site at the start of the install?" — Yes/No — Required — only show when "Is any electrical repair work needed before insulation can be installed?" = Yes — Yes red, No green.
The price question stays LAST on that page.

5. Settings (gear icon next to Publish): turn ON Mandatory mark-as-complete. Location/GPS ON for every Photo question.

Change nothing else. Publish.
```

## 3. A4 – Electrical fixes

```
Edit the Mitti template "A4 – Electrical fixes". Make ONLY these changes, then publish.

1. First page, first item, a Text item (not a question):
"Paid only when this form is 100% complete and you press Complete. Take every photo in Mitti on site so it's geotagged."

2. Settings (gear icon next to Publish): turn ON Mandatory mark-as-complete. Location/GPS ON for every Photo question.

Change nothing else. Publish.
```

## 4. A1 and A2 – Ready Check: existing insulation facts for the official PIISA (decision 359)

The official PIISA Part 6 needs these facts whenever the ceiling already has insulation. The portal reads them from the
Ready Check by their exact wording (`LEAN_Q.existingSuitable`, `existingConductive`, `existingConductivePhoto`,
`existingKeepReason` in `src/lib/ready-check-lean.core.ts`; `tests/lean-ready-check.test.ts` fails if this block drifts).
Forms finished before this change stay readable: a top-up on an old form is listed as "not recorded" for the office.
When every area is Removed the portal fills Part 6 itself (decision 360), so these questions only matter for a top-up,
but the foil question and photo are asked whenever there is existing insulation.
The depth stays where it is (decision 375, Jo 25 Oct 2026): the live question "What is the measured insulation depth (mm)?"
is kept unchanged on both templates (asked whenever there is existing insulation, removals included) and the portal reads it
for Part 6 "average height", averaging differing areas by m². Nothing in this block touches it.

```
Edit the Mitti templates "A1 – Ready Check | Installer-Supplied Customer" and "A2 – Ready Check | HIVIC Sourced Customer". Make the SAME change on both, then publish both.

In the repeating ceiling-area section (the "Add a ceiling area" group), straight after the question "How much existing insulation needs to be removed? (m²)" and before "Slow 360° video of this ceiling area, lit, saying its name", add these four questions, in this order. Copy every question exactly, character for character:

1. "Is the existing insulation in good enough condition to lay new insulation over?" — Yes/No — Required — only show when "What is required for the existing insulation?" = Top up — Yes green, No red
2. "Is the existing insulation foil-backed, metallic or electrically conductive?" — Yes/No — Required — only show when "Is there existing insulation in this ceiling area?" = Yes — No green, Yes red
3. "Photo showing whether it is foil-backed or conductive" — Photo, location on — Required — only show when "Is there existing insulation in this ceiling area?" = Yes
4. "Why is the existing insulation being kept?" — Text — Required — only show when "What is required for the existing insulation?" = Top up

They must be inside the repeating section, so every ceiling area gets its own answers. Do not add them anywhere else.

Change nothing else. Publish both.
```

After publishing all four, tell Claude "published" and the portal will re-read the templates to check them (after block 4,
A1 has 38 questions and A2 has 39, the ceiling-area section counted once).
