# Mitti: the three pastes still to do (25 Oct 2026)

Paste each block into ChatGPT on its own. Each one changes one template only.

## 1. A3 – Install day

```
Edit the Mitti template "A3 – Install day". Make ONLY these changes, then publish.

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

## 2. A4 – PIESA (electrician)

```
Edit the Mitti template "A4 – PIESA". Make ONLY these changes, then publish.

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

## 3. A5 – Electrical fixes

```
Edit the Mitti template "A5 – Electrical fixes". Make ONLY these changes, then publish.

1. First page, first item, a Text item (not a question):
"Paid only when this form is 100% complete and you press Complete. Take every photo in Mitti on site so it's geotagged."

2. Settings (gear icon next to Publish): turn ON Mandatory mark-as-complete. Location/GPS ON for every Photo question.

Change nothing else. Publish.
```

After publishing all three, tell Claude "published" and the portal will re-read the templates to check them.
