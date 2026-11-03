# Ready Check: owner wants a different R-value — design

Date: 3 Nov 2026 · Approved by Jo in chat

## Why
The Ready Check has nowhere to record that the owner wants a different R-value, so whoever prices the job doesn't know about it.

## Mitti Ready Check forms (A1 and A2)
- New question: **"Does the owner want a different R-value from the standard?"** Yes / No, required.
- If Yes: **"Which R-value?"** with **R5 / R6 / R7 / Other**, required.
- New box: **"Notes for the quote (anything the person pricing should know)"**. Optional, on every Ready Check.
- The portal reads these by exact wording. The portal change ships first, then Jo pastes the Mitti wording (Claude gives her the prompt).

## Portal
- **HIV's own leads:**
  - The quote is auto-priced at HIV's price for the R-value the owner picked, using HIV's rate for that R-value product.
  - If the owner picked "Other", or HIV has no active price for that R-value, the quote is **held for the office**, with the reason "Owner wants {R-value} — no price set" or "Owner wants another R-value — see the note".
- **Installers' own customers:** the requested R-value and the note show on the installer's price card ("Your price"), so whoever prices sees them. Nothing is auto-priced or held for this.
- **Office job page:** the requested R-value and the note show in the Ready Check details.
- Old Ready Checks without these questions read as "No" and no note, so nothing changes for them.

## Not changing
- The standard product and pricing when the answer is No.
- The 15% estimate-difference hold and the other existing holds.

## Testing
- The answers are read by exact label, with old forms reading as No.
- HIV lead with R7 and an R7 rate → priced at that rate. R7 with no rate → held. Other → held with the note.
- Installer's own job → shown on the price card, not held.
- A drift test keeps the Mitti prompt wording and the portal labels in step.
