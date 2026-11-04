# Mitti check, 4 Nov 3:27pm (read only)

Nothing in Mitti was changed, saved or published. Nothing was built or sent.

## What Mitti has now
All five forms were **published today at about 2:52pm Sydney** (03:52 UTC). Each saved draft is identical to its published version, so there are no unpublished drafts waiting.

| Form | Published version | Last changed (Sydney) |
|---|---|---|
| A1 – Ready Check, Installer-Supplied Customer | 71 | 4 Nov 2:51pm |
| A2 – Ready Check, Home Insulation Victoria Customer | 38 | 4 Nov 2:51pm |
| A3 – Electrical safety check (PIESA) | 31 | 4 Nov 2:52pm |
| A4 – Electrical upgrades | 14 | 4 Nov 2:52pm |
| A5 – Install day | 23 | 4 Nov 2:52pm |
| A5 – Install day + BEFORE photos | does not exist yet | — |

**Can't be checked:** Mitti's replies don't say which questions are required, so I can't confirm the required/optional rules. Question order was only spot-checked.

## Per form

**A1: wording mostly OK**
- OK: optional-photo instruction, the "Pressing Complete…" warning, the "ready to price" tick, Floor plan / Aerial image with their m² and upload questions, "How much old insulation is coming out? (m²)", "…lay new batts on top?", "Why is the old insulation staying?", "Did the owner say…", "R2.0 or more", and the plain labels "Job number" / "Address" / "Owner's name".
- Correctly absent: "Don't discuss prices…" (it's now A2 only).
- Problem: the live portal's form check looks for "Portal Job Number". A1 now says "Job number", so the check reports it as missing.
- Question for you: there's no "Life support: what our records say" field on A1 (A3 has it). Is that intended?

**A2: wording OK.** Same "Portal Job Number" problem as A1.

**A3: CHANGED and PUBLISHED, which was too early**
- Now in Mitti: "Are electrical upgrades needed?", "Are you doing the electrical upgrades today?", "Do you have the Certificate of Electrical Safety now?", plus the certificate number and photo/PDF.
- Removed: the total-price question and the "I will not discuss any prices…" checkbox.
- The portal code here does NOT read the new wording yet. Part 3 (#137/#138) isn't in this project's code, so the published portal can't have it either.

**A4: CHANGED and PUBLISHED, which was too early**
- The new certificate question is there, with its number, date and photo/PDF.
- The electrician labels have been renamed ("Your full name" etc.) and so has "The upgrade work listed on the safety check:". The live portal still expects the old labels.

**A5: problems**
- Missing: "The power is still off, so use a bright torch or work light." (AFTER video). The current text is a different "light or torch on" line.
- The "A5 + BEFORE photos" form doesn't exist yet. That's expected; I need its template ID once Mitti makes it.
- The portal's own form check reports 37 items as "missing". Most are probably the rebuilt shorter A5 not matching the old checklist, but this is unproven.

## What breaks on the live portal right now
- **A1/A2:** the form check flags "Job number". Reading answers should mostly work, but I haven't proven this on a real submission.
- **A3 (main risk):** the portal can't read whether electrical upgrades are needed or being done today. The electrician's price is gone, so the electrical upgrades quote falls back or is held. The safety check can't complete without the certificate file, so "No, add it later" stays held. Every new A3 will wait for the office.
- **A4:** the electrician's name, licence and REC details aren't read, and the work done isn't read correctly. Sign-off is held.
- **A5:** possible install-day holds until the reader is checked against the new form.

## Fixes for Jo (pick one way for A3/A4)
1. **A3 and A4: choose one:**
   (a) Ask Mitti to put A3 back to the previous published version and A4 back to its previous version. Republish the new ones only after Part 3 is live in the portal.
   (b) Leave Mitti as is. Approve bringing Part 3 into this project and publishing the portal soon. Until then, new safety checks will be held.
2. **A5:** add the AFTER video instruction "The power is still off, so use a bright torch or work light."
3. **A5 + BEFORE photos:** ask Mitti to create it, then send me its template ID.

## What I need from Jo
- A3/A4: choice (a) or (b) above.
- Part 3 code: it isn't in this project. Please share it or confirm how to bring it in.
- A1 life-support records line: needed or not?
- OK to update the portal (build mode) so it accepts "Job number" and the rebuilt A5 in its form check, keeping old forms readable?
