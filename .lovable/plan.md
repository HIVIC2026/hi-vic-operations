# Mitti Ready Check forms — backup vs live (read-only check, 22 Oct 23:55 UTC)

Nothing was changed in Mitti, the portal or the database.

## Important first: the backups are not from this morning
The files in the 2026-10-23 backup folder are older versions of the forms: A1 last edited 3 Oct, A2 last edited 11 Oct. They do not show what the forms looked like this morning, so I can't tell from them what changed today.

## A1 – Installer-Supplied Customer (live last edited 22 Oct 23:48 UTC)
1. **Show-if rules:** 19 in the backup, 19 now.
   - Gone: "Are the property details provided above correct?" = No, which showed "What needs to be corrected?". The question itself was removed.
   - New: "Who is doing the electrical safety check?" = "A different electrician", which shows the 3 electrician questions.
   - Every other rule is the same as in the backup: roof type, ceiling access (note needed), number of ceiling areas (1–N), how measured, existing insulation, insulation type, remove (removal m²), downlights (count), issues (note needed).
2. **Red-flag answers:** the backup had 5 kinds, now there are 4.
   - Still flagged, on every ceiling area: "How was this ceiling area measured?" = Tape measure; downlights = Yes; issues = Yes. Also outcome = "No - Ready Check failed".
   - Gone: "Are the property details provided above correct?" = No (the question was removed).
   - Life support: not flagged in the backup, and not flagged now.
3. **Address:** "Site address", a plain text answer, required. Same in the backup and now. The form says Mitti supports "site" as a question type, but the API doesn't list the available question types, so I can't confirm an address type that fills itself in.
4. **Job number:** "Portal Job Number", plain text, required, on the Title Page. Same in the backup and now.
5. **Other changes:**
   - Removed: "Inspection Date and Time", "Assessor", "Was the ceiling or roof built or replaced in the last 5 years?", "Are the property details provided above correct?", "What needs to be corrected?".
   - New, all required: "Homeowner phone" and "Homeowner email" (plain text), "Homeowner agrees to be contacted by Home Insulation Victoria" (Yes/No), "Who is doing the electrical safety check?" (pick list), "Electrician name", "Electrician licence number", "Electrician price (inc GST)", and "Insulation product" (pick list, one choice).
   - Changed:
     - "Life support equipment at property?" was a typed answer, now a choice question.
     - "Upload a clear photo of the ceiling access point" was required, now optional.
     - "What is the measured insulation depth (mm)?" was required, now optional.
     - "Upload an overview photo of this ceiling area" was optional, now required.

## A2 – HIVIC Sourced Customer (live last edited 22 Oct 23:50 UTC)
1. **Show-if rules:** 11 in the backup, 11 now. All identical, none missing.
2. **Red-flag answers:** 5 kinds in the backup, the same 5 now, including "Are the property details provided above correct?" = No. Life support isn't flagged in either.
3. **Address:** "Site address", plain text, required. Same in both.
4. **Job number:** "Portal Job Number", plain text, required. Same in both.
5. **Other changes:**
   - Removed: "Inspection Date and Time", "Assessor", and the whole "Approval" section ("Date and time of approval", "Approver's signature").
   - New: "Insulation product" (pick list, one choice, required) in "Ready Check Outcome".
   - The form was renamed from "A1 – … HIVIC Sourced Customer" to "A2 – Ready Check | HIVIC Sourced Customer".

## What I can't tell
- Anything that changed between 3 Oct / 11 Oct and this morning, because there's no backup from this morning.
- Whether Mitti has an address question that fills itself in. The API shows only the question types these two forms use.

## Suggested next step (only if you approve)
Before anyone edits the forms again, save a fresh copy of both live forms to a new dated backup folder, so later changes can be compared properly. That's the only step here that saves anything: a copy of the forms inside the portal's files. It doesn't touch Mitti or the database.
