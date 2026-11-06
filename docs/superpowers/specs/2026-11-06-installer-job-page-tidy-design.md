# Installer job page + Action items tidy — design

Date: 6 Nov 2026 · Approved in chat by Jo (Superpowers brainstorm from three live screenshots of HV-3794 and Action items)

## Why

Installers (No Gap, Rapid, Reinsulate) start using the portal on Mon 9 Nov. The live job page and Action items have
repeated text, a risky "Owner cancelled" button, buttons that don't look like buttons, and a Mitti Ready Check option
nobody will use. Jo: "They're never going to do a Mitti Ready Check. Get rid of this."

## Part A: live before Monday (one pull request, nothing live until Jo says)

### A1. Desktop quote only (no Mitti Ready Check anywhere)
- Every installer quotes from the desk, on Home Insulation Victoria leads and on their own customers. The per-installer
  "Ready Check / From photos" setting goes. Every business works as "From photos" does today (`quoteMethodOf` always
  returns `photos`, and the office switch in `pilot.functions.ts` / partner settings is removed).
- The own-customer Measure & quote box shows one way only: a green **"Desktop quote"** button that opens the existing
  "enter the details" form (sizes, removal, existing insulation + R-value, how measured with plan/aerial upload, access,
  price inc GST, optional photos). The "Do a Ready Check on site" option, its "Tap this… within 15 minutes" text, the
  "Mitti form ready" line and the Mitti link all go.
- The portal stops making a Mitti Ready Check form automatically for new jobs (own customers after Add a job, and
  Home Insulation Victoria leads when given to an installer). The Mitti install form (A5) and the electrician's forms are unchanged.
- Jobs that already have a finished Mitti Ready Check keep their report and its "view" link.
- The first progress step is called **"Desktop quote"** (replaces "Ready Check" / "Photo quote" / "Measure & quote").

### A2. Owner cancelled
- Moves out of the Owner fold to the very bottom of the job page as a small grey link.
- Tapping it opens the existing reason box. The confirm button is red and reads **"Yes, the owner cancelled"**. The
  writer (`tradeOwnerCancelled`) is unchanged.
- "Can't do this one" (Home Insulation Victoria leads) moves with it and keeps its current look.

### A3. Repeats removed
- The stage chip next to the job number (the progress row already shows the stage).
- The second "Ready Check / Not done yet" section at the bottom of Paperwork.

### A4. Paperwork shows only what's reached
- A row shows only once its stage is reached, then stays:
  - Signed PIESA: once the PIESA is booked
  - Owner's ESC consent: once the PIESA is done (the owner signs it with the deposit)
  - Safety plan (SWMS) and Install form (Mitti): once the install is booked
- No Ready Check row, except on old jobs where one was done (shows "Done in Mitti on {day}" with the view link).
- Nothing reached yet: the Paperwork fold says "Nothing yet."

### A5. Action items cards
- The own-customer quote card says **"Desktop quote"** with an **"Open job"** button (never "Do it in Mitti").
- Booked PIESA: no card while the PIESA day is today or ahead. If the day has passed and the safety check form isn't in,
  an amber card shows "Safety check form not in yet · {electrician first name}" with a **"Change date"** button that opens
  the job's existing change-date step. It counts toward the Action items number. (Replaces the 6 Nov "PIESA booked"
  card with no button.)

### A6. Wording
- "Our lead" → **"Home Insulation Victoria lead"** on Action items cards.
- "Our leads are paid…" → **"Home Insulation Victoria leads are paid…"** in the two installer pay lines
  (`installer-screens.core.ts`). Office screens are unchanged.

### Testing
- Unit tests on the pure cores: `action-items.core.ts` (card words, PIESA hidden/late, count), `job-page-rows.core.ts`
  (paperwork by stage, progress label), `next-step-box.core.ts` (no Mitti Ready Check box), `photo-quote.core.ts` (always photos).
- `bun scripts/scan-retired-terms.ts` and `bun run portal-qa` (gaps reported NOT_RUN, never PASS).
- Phone-size screenshots of the job page (Desktop quote stage, PIESA stage, install booked) and Action items for Jo to
  approve before merge.
- `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md` and `src/config/workflow-decisions.ts` get the new decision (no Mitti Ready Check, all desktop quotes).

### Out of scope for Part A
No change to pricing, payments, emails or texts to owners, the PIESA/install flows, or the office screens.

## Part B: new installer design only (added to the Design canvas and the redesign spec, not before Monday)

- **Urgency on Action items:** Home Insulation Victoria leads show "{n} business days left" before they return to the
  office (amber at 3 or fewer, red when late). Own customers show "Added {n} days ago". Most urgent at the top.
- **Calendar** in the bottom menu (as approved 6 Nov).
- **All jobs in lanes by stage** with a count on each: Desktop quote · Waiting for owner · Book PIESA · PIESA booked ·
  Waiting for deposit · Book install · Install booked · After install. Lanes sit side by side on a computer and stack on a
  phone (tap a lane to open it). Action items stays the short "do this now" list.
