# Short onsite PIESA/PIISA in Mitti → official Word form filled automatically

## What changes for the electrician and installer
In Mitti, each form is a short checklist. Each part has one "All OK" tap. Detail questions only show if they choose "Problem".

**Short PIESA (electrician), about 12 screens instead of 62 fields:**
1. Life support? (No / Yes – consent / Yes – medical plan + photo)
2. Mains power all OK? If there's a problem, tick which: mains cable not marked, main switch issue, not de-energised, no RCDs, RCDs not tested
3. Solar/battery/generator? None / Present and all OK / Present with a problem (tick which)
4. Hazards and cables all OK? If not, tick which of the Part 4 and Part 5 items failed
5. Downlights: none / all IC or IC-4 (count) / prohibited present (count)
6. Appliances, fans or flues in the ceiling? If yes, add appliance, location and hazard plus the action taken
7. Outcome: no repairs / repairs needed (tick the B2 items plus "Other") / repairs not possible
8. Sign. Licence number, name and REC details are filled from their portal profile, so they only confirm them.
9. Section C (only if repairs were needed): one "all rectification done" confirmation, Certificate of Electrical Safety number and date, then sign
10. Owner: one confirmation tick, name and signature

**Short PIISA (installer), about 8 screens:**
1. Dates and "household told power off": dates are filled from the booking
2. Life support: carried over from the PIESA, confirm only
3. Crew: lead installer and extra installers picked from approved workers, with EEC numbers filled automatically
4. Safe system of work: one "SWMS done, hazards considered, power isolated" confirmation, or flag a problem
5. Solar: carried over from the PIESA, confirm only
6. PIESA review: one "PIESA reviewed, nothing changed in ceiling, electrician present if required" confirmation. The downlight and cable answers come from the signed PIESA.
7. Existing insulation: none / top up / remove, with height and R-value. The product comes from the accepted quote.
8. Declaration tick, then sign

## What the portal does automatically
- Reads the short answers back from Mitti, using the existing sync.
- "All OK" is turned into every matching official Yes/No answer. A flagged problem sets only the items they ticked to No (or Yes for Part 5) and leaves the rest Yes.
- Fills the **official March 2026 government Word form**: the real document, with its wording untouched and the boxes ticked. It's saved privately on the job and attached for the installer and AP.
- Anything it can't fill for sure is left blank and flagged for the office. It never guesses a "No".
- The existing pass/fail rules (rectification needed, CANNOT proceed, 30-day deadline) run on the filled answers, so nothing about the gates changes.

## Steps
1. Write the short PIESA and PIISA checklists, plus the build sheet and AI prompt for Mitti, in plain words.
2. Map every official question to the short answer, profile, booking, quote or signed PIESA that supplies it, with tests proving all official questions are covered.
3. Fill the official Word forms (bundled March 2026 .docx) from the mapped answers. Check the result page by page.
4. Show "Download official PIESA/PIISA (Word)" on the job page and the field page.
5. Test on TEST job HV-1003 with made-up answers. Nothing is sent, nothing goes live in Mitti, and no real job is touched.

## Technical details
- `mitti-forms.core.ts`: replace the word-for-word PIESA/PIISA field specs with short specs. Update `validateTemplate` to require the short labels. The Ready Check form is unchanged.
- New pure `official-expand.core.ts`: maps short answers plus context (profile, booking, quote, signed PIESA) to `OfficialAnswers` keyed by `PIESA_ITEMS`/`PIISA_ITEMS` ids. Unknown values stay null. A test asserts that every `answerItems()` id has a source.
- New `official-docx.server.ts`: unzips the bundled official .docx, replaces checkbox/text content controls by mapped id, and stores the result in private job files. `official-pdf.core.ts`'s superseded blocker is replaced by the docx path.
- `evaluatePiesa`/`evaluatePiisa`, the signed snapshot and the gates are reused unchanged. Record the rule in `src/lib/AGENTS.md`.
- Open item: Mitti template IDs must be reconnected after Jo builds the short templates. The old word-for-word templates will fail validation, which is intentional.
