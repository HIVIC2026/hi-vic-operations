# Mitti pastes — 5 Nov (from this morning's forms). One form at a time.

Jo: four pastes, one per form (A1 and A2 share one). Each starts with what the form will look like after, then the box.
Do them in this order, publish each, open it on your phone and check against the "after" list before the next one.
Copy every word exactly — the portal reads answers by their wording. If the Mitti AI asks to nest a question under its
trigger instead of a separate page, say yes (position doesn't matter, wording does).

---

## 1. A1 and A2 — Ready Check (same changes on both)

**After:** your forms as they are this morning, plus — inside "Add a ceiling area", for areas measured with a laser,
tape or "Other" — one new question **"How do you want to give the size?"** (Enter area (m²) / Length × width).
Pick "Enter area (m²)" → one box **"Enter the measured ceiling area (m²)"**. Pick "Length × width" → the Length (m) and
Width (m) boxes you have now. Floor plan and Aerial image keep working exactly as they do now (their own m² box + upload).
Nothing else changes.

```
Edit TWO existing Mitti templates and make the SAME change on both: "A1 – Ready Check | Installer-Supplied Customer" and "A2 – Ready Check | Home Insulation Victoria's Lead". Keep both template IDs. Change ONLY what is listed. Copy every wording exactly, character for character. Nest conditional questions beneath their trigger (Add logic → If answer is … → Ask questions). If Mitti cannot do something, stop and tell me.

Inside the repeating section "Add a ceiling area":

1. Find the question "How did you measure this area?" (older wording: "How was this ceiling area measured?"). Leave it and its answers (Laser measure / Tape measure / Floor plan / Aerial image / Other) exactly as they are.

2. Straight after it, add a NEW question:
   How do you want to give the size?
   Multiple choice, single answer, Required. Answers exactly: "Enter area (m²)" and "Length × width".
   Only show when "How did you measure this area?" is "Laser measure", "Tape measure" or "Other" (NOT for Floor plan or Aerial image).

3. Under "How do you want to give the size?" = "Enter area (m²)", add a NEW question:
   Enter the measured ceiling area (m²)
   Number, Required.

4. Change the EXISTING "Length (m)" and "Width (m)" questions so they only show (and are Required) when "How do you want to give the size?" = "Length × width". Keep any calculated area item that uses them as it is.

5. Leave the Floor plan branch ("Ceiling area from the floor plan (m²)", "Upload the floor plan (photo or PDF)") and the Aerial image branch ("Ceiling area from the aerial image (m²)", "Upload the aerial image (photo or PDF)") exactly as they are.

Change nothing else. Publish both. Then list the five items and confirm each was made on both templates.
```

---

## 2. A3 — PIESA (Electrician safety assessment)

**After:** your form as it is this morning, with six changes: (1) "Does any electrical upgrade work need doing…" reworded to
**"Are electrical upgrades needed?"**; (2) under Yes, after the work list, new **"Are you doing the electrical upgrades
today?"**; (3) under that Yes, new **"Do you have the Certificate of Electrical Safety now?"** with help "No? We'll text you a
link to add it later." — the three certificate fields you already have show only when Yes; (4) the total-price question and the
"I won't talk about prices" tick deleted; (5) new **"Is an adult (18 or over) who understands what's happening at home with
you?"** after the consent-plan photo, with "Stop. Don't start. Leave and call the installer's office." under No; (6) any
"Paid only when…" / "You're paid only when…" line deleted. Nothing else.

```
Edit ONE existing Mitti template: "PIESA – Electrician safety assessment". Keep its template ID. Make ONLY the six changes below, in order. Copy every wording exactly, character for character. Do not add, reword, reorder or delete anything else. Nest conditional questions beneath their triggering question (Add logic → If answer is Yes → Ask questions); position does not matter, wording does. If Mitti cannot do something, stop and tell me before substituting.

1. Find "Does any electrical upgrade work need doing before the insulation goes in?" (older forms: "Is any electrical repair work needed before insulation can be installed?"). Change ONLY its wording to: Are electrical upgrades needed?
   Keep Yes/No, Required, Yes red, and every existing "only show when" rule that points at it.

2. Under "Are electrical upgrades needed?" = Yes, after the existing work-list question ("What upgrade work will you do? Tick everything your price includes." — leave that question and its answers exactly as they are), add a NEW question:
   Are you doing the electrical upgrades today?
   Yes/No, Required, only show when "Are electrical upgrades needed?" = Yes.
   (If a question "Have you completed all of the repair work listed above, and is the ceiling now safe for insulation?" exists, reword it to this instead of adding a new one.)

3. Under "Are you doing the electrical upgrades today?" = Yes, add a NEW question:
   Do you have the Certificate of Electrical Safety now?
   Yes/No, Required, only show when "Are you doing the electrical upgrades today?" = Yes.
   Help text exactly: No? We'll text you a link to add it later.
   (If there is no help-text field, add it as an Instruction item directly under the question.)
   Then move these three EXISTING fields so they show only when "Do you have the Certificate of Electrical Safety now?" = Yes, all Required, no help text, wording unchanged:
   - Certificate of Electrical Safety number (required for any electrical works completed):
   - Date of Certification:   (if the form says "Date on the certificate", keep that)
   - Certificate of Electrical Safety (photo or PDF)
   Remove any other "only show when" rule on those three. If any of the three does not exist, add it (short text / date / photo-or-PDF attachment).

4. Delete the question "Your total price for all the upgrade work (inc GST)" (older forms: "Your total price for all the repair work, including GST"). Delete the checkbox "I won't talk about prices with the owner. Home Insulation Victoria sends the owner all prices." (older: "I will not discuss any prices with the owner. Home Insulation Victoria sends the owner all prices.") if present.

5. Straight after "Photo of every page of the consent or medical plan" (older forms: "Written consent or medical plan (kept as an attachment to this assessment)"), add a NEW question:
   Is an adult (18 or over) who understands what's happening at home with you?
   Yes/No, Required, No red.
   Under it, only show when the answer is No, an Instruction (text) item with exactly:
   Stop. Don't start. Leave and call the installer's office.

6. Delete any text/instruction item whose wording starts with "Paid only when" or "You're paid only when".

Publish the template. Then list the six changes and confirm each one was made, and anything you could not do.
```

---

## 3. A4 — Electrical fixes

**After:** your form as it is this morning, with two changes: (1) under "Have you finished ALL the upgrade work…" = Yes, new
**"Do you have the Certificate of Electrical Safety now?"** with the same help line — the three certificate fields show only
when Yes (today they always show); (2) any "Paid only when…" / "You're paid only when…" line deleted. Nothing else.

```
One template. Keep its template ID. Make ONLY the changes below. Copy every wording exactly, character for character. Nest conditional questions beneath their triggering question (Add logic → If answer is Yes → Ask questions); position does not matter, wording does. Do not add, reword, reorder or delete anything else. If Mitti cannot do something, stop and tell me.

TEMPLATE "A4 – Electrical fixes" (keep its current title and ID):

1. Find "Have you finished ALL the upgrade work listed above, and is the ceiling now safe for insulation?" (this is the trigger; leave it exactly as it is). Under it, when the answer is Yes, add a NEW question:
   Do you have the Certificate of Electrical Safety now?
   Yes/No, Required, only show when that trigger = Yes.
   Help text exactly: No? We'll text you a link to add it later.
   (If there is no help-text field, add it as an Instruction item directly under the question.)
   Do NOT nest it under "What's not done, or what changed?" — that question keeps its own rule unchanged.

2. The three EXISTING certificate fields — "Certificate of Electrical Safety number", "Date on the certificate" (or "Date of certification" — keep whichever is there) and "Certificate of Electrical Safety (photo or PDF)" — must now show ONLY when "Do you have the Certificate of Electrical Safety now?" = Yes. Keep them Required and keep their wording and existing help text. Remove any other "only show when" rule on them.

3. Delete any text/instruction item whose wording starts with "Paid only when" or "You're paid only when".

Publish A4.

Then list each numbered item and confirm it was done, and anything you could not do.
```

---

## 4. A5 — Install day

**After:** your form as it is this morning, with three changes: (1) the READ FIRST text's last sentence becomes **"Press
Complete before you leave — we can't claim the rebate or pay the job until it's done."** and any "Paid only when…" /
"You're paid only when…" line is deleted; (2) new **"Is an adult (18 or over) who understands what's happening at home with
you?"** straight after "Have you told the household the power will be off today?", with the stop line under No; (3) a new
LAST page **"Rebate form (VEEC) — Lead Installer"**: the ESC's Part B declaration text, a tick "I make this declaration as the
Lead Installer", and a signature "Lead Installer's signature for the rebate form (Part B)". Nothing else.

```
Edit ONE existing Mitti template: "A5 – Install day" (template ID 1f325828-3f71-4b1a-988f-083c83414f95). Keep its template ID. Make ONLY the changes below. Copy every wording exactly, character for character. Nest conditional items beneath their trigger. If Mitti cannot do something, stop and tell me.

1. Find the text item that starts "READ FIRST:". Replace its LAST sentence ("You are only paid when this form is 100% complete." or similar) with exactly:
   Press Complete before you leave — we can't claim the rebate or pay the job until it's done.
   Leave the rest of the READ FIRST text as it is.

2. Delete any text/instruction item whose wording starts with "Paid only when" or "You're paid only when".

3. Straight after "Have you told the household the power will be off today?" (older wording: "Does the household know the power will be off today?"), add a NEW question:
   Is an adult (18 or over) who understands what's happening at home with you?
   Yes/No, Required, No red.
   Under it, only show when the answer is No, an Instruction (text) item with exactly:
   Stop. Don't start. Leave and call the installer's office.

4. Add a new LAST page, after the page that holds the final "Lead installer's signature", called:
   Rebate form (VEEC) — Lead Installer
   On it, in this order:
   a) An Instruction (text) item, read only, with exactly this text:
Part B: Declaration by lead installer
I declare that:
I am certified by the Energy Efficiency Council (EEC) as a Certified Insulation Installer and am qualified to install the product(s) listed above.
all work undertaken in respect of installing insulation product(s) at the above premises was undertaken by EEC Certified Insulation Installers.
any luminaires in the ceiling are classified and marked as an IC luminaire or IC-4 luminaire
I have received a completed copy of the VEU pre-installation electrical safety assessment form before the installation commenced.
I have completed a VEU pre-installation installer safety assessment form.
the above listed insulation product(s) have been installed at the above premises.
the installation of above insulation product(s) have been undertaken in accordance with:
all relevant AS 3999 requirements,
all product manufacturer installation requirements
all applicable occupational health and safety laws and requirements, including completed safe work method statement (SWMS)
requirements set out in the VEU pre-installation installer safety assessment form
conditions outlined in the VEU pre-installation electrical safety assessment form
all spaces above a ceiling at the premises which are eligible and practical to insulate have been insulated.
for under insulated areas, existing insulation was removed as required by the program rules.
where existing insulation is not removed, I have advised the property owner that:
the existing insulation will not be removed;
the existing insulation is in a suitable condition for new insulation to be laid over the top of it; and
the installation of new insulation on top of the existing insulation will meet AS3999 requirements and all product manufacturer installation requirements.
all waste or debris generated from the activity, including existing insulation product(s), has been removed from the consumer’s premises and disposed of in accordance with all applicable waste management requirements under the Environment Protection Act 2017 and Regulations made under that Act.
I consent to the installer information provided in this form, along with any other supporting documentation or information relating to the activity undertaken at the above premises, being disclosed to the relevant regulator and to the Energy Efficiency Council for compliance related purposes.
the information supplied in this form is complete and accurate and I am aware that it is an offence to provide false or misleading information to the commission under the Victorian Energy Efficiency Target Act 2007.
   b) A checkbox: I make this declaration as the Lead Installer — Required
   c) A signature: Lead Installer's signature for the rebate form (Part B) — Required
   Help line on the page: Sign this last, after the install is finished.

Change nothing else. Publish. Then list the four items and confirm each was done, and anything you could not do.
```

## After all four are published
Tell me and I check the live forms (read only) against the portal before the first real job.
