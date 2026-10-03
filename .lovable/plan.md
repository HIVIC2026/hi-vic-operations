# Short onsite PIESA/PIISA in Mitti → official Word form filled automatically

## How the onsite forms will read
Each part of the form starts with one clear question written as a full sentence, for example "Is everything in this section safe and compliant?" If the answer is yes, the form moves on. If the answer is no, the form asks the person to tick what the problem is. Each item to tick is also written as a full, plain sentence. The meaning always stays faithful to the official form.

**Short PIESA (electrician):**
1. Life support is already known from the enquiry, so the form shows it and asks the electrician to confirm it: "Our records show that [nobody at this property relies on life support equipment / someone at this property relies on life support equipment]. Is this still correct?" If someone does rely on life support and the consent or medical plan hasn't been received yet: "Have you received written consent or a medical plan? Please attach a photo of it." If that is missing, the form says clearly that the installation cannot go ahead.
2. "Is the mains power set-up safe? This means the mains cable in the ceiling is identified and marked, the main switch works and can be locked off, the ceiling is confirmed dead when the switch is off, and RCDs are fitted and tested." If no: "Please tick each item that is not right," followed by each item as its own sentence.
3. "Is there solar, a battery or a generator at the property?" If yes: "Can it be safely shut down, and are its cables in the ceiling labelled, in conduit and protected?" If no to that: "Please tick each item that is not right."
4. "Are the cables, connections and fittings in the ceiling safe to work around and cover with insulation?" If no: "Please tick each problem you found." The list covers each Part 4 and Part 5 item, written as a sentence.
5. "Are there any downlights or other recessed lights in the ceiling?" If yes: "How many are there?" and "Are any of them not IC or IC-4 rated?"
6. "Are there any appliances, exhaust fans or flues in the ceiling space?" If yes: "Please describe each one, where it is, the hazard it creates, and what was done or needs to be done about it."
7. "Is any electrical repair work needed before insulation can be installed?" The options are "No repair work is needed", "Yes, repair work is needed" (then tick the work required) and "Repair work is not possible, so an electrician must be present on installation day".
8. "Please check your licence and contractor details and sign." These details are filled in from the electrician's portal profile.
9. This step shows only if repairs were needed: "Have you completed all of the repair work listed above, and is the ceiling now safe for insulation?" They then enter the Certificate of Electrical Safety number and date, and sign.
10. Owner: "Please confirm that the assessment was completed today, and that you understand that anyone going into the ceiling before installation may cancel this assessment." The owner then enters their name and signs.

**Short PIISA (installer):**
1. "Please check the installation dates. Has the household been told the power will be off during the installation?" The dates are filled in from the booking.
2. "Our records show that [nobody at this property relies on life support equipment / someone at this property relies on life support equipment, and written consent or a medical plan has been received]. Is this still correct?" If it is no longer correct, the form stops the installer and tells them to call the office before starting.
3. "Please confirm who is on the crew today." Workers are picked from the approved list, and their EEC numbers are filled in automatically.
4. "Has the Safe Work Method Statement been completed, have the common hazards been considered, and has the power been isolated, locked out and tagged?" If no, the form says clearly: "The installation cannot go ahead until this is done."
5. "Have you read the electrical safety assessment, has nobody worked in the ceiling since it was done, and, if an electrician needs to be present today, are they here?" The downlight and cable answers are taken from the signed PIESA.
6. "Is there existing insulation in the ceiling?" If yes: "Will it be removed or topped up? What is its average height, and what is its R-value if you know it?"
7. "Please read the installer declaration and sign." The official declaration wording is shown in full at this step.

## What the portal does automatically
- Reads the short answers back from Mitti, using the existing sync.
- A "yes, all safe" answer becomes every matching official Yes/No answer. A "no" sets only the items that were ticked.
- Fills the **official March 2026 government Word form** with its wording untouched and the boxes ticked. The form is saved privately on the job.
- Anything it can't fill for sure is left blank and flagged for the office. It never guesses a "No".
- The existing safety rules (repairs needed, cannot proceed, 30-day deadline) run on the filled-in answers, so nothing about the gates changes.

## Steps
1. Write the short PIESA and PIISA question sets in plain, full sentences, along with a Mitti build sheet and an AI prompt.
2. Map every official question to the short answer or saved record that supplies it. Tests will prove that every official question is covered.
3. Fill the official Word forms from the mapped answers and check each page.
4. Add a "Download official PIESA/PIISA (Word)" button on the job page and the field page.
5. Test on TEST job HV-1003 with made-up answers. Nothing is sent and no real job is touched.

## Technical details
- `mitti-forms.core.ts`: short PIESA/PIISA specs with full-sentence labels; `validateTemplate` updated to match; Ready Check form unchanged.
- New pure `official-expand.core.ts`: short answers plus context (profile, booking, quote, signed PIESA) map to `OfficialAnswers` keyed by `PIESA_ITEMS`/`PIISA_ITEMS` ids. Unknown values stay null. A test asserts full coverage of `answerItems()`.
- New `official-docx.server.ts`: fills the bundled official .docx and stores it in private job files. This replaces the superseded PDF blocker.
- `evaluatePiesa`/`evaluatePiisa`, signed snapshots and gates are reused unchanged. The rule is recorded in `src/lib/AGENTS.md`.
- Mitti template IDs are reconnected after Jo builds the short templates.
