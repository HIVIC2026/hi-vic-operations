# Signed official forms in the job file + AP evidence at each stage

The Ready Check is out of scope; it's already built in Mitti and stays as it is.

## Your decisions
- Save the **government's official form, filled in**, to the job's files.
- Refuse any photo with no location, or taken too far from the property. The worker has to retake it onsite.
- Send the signed electrical form (PIESA) to the owner and installer **automatically**, at least 24 hours before install.

## 1. Filled official forms in the job file
- When a PIESA or PIISA is signed, the portal writes every answer, the signature, the name and the date onto the official March 2026 form.
- It saves that filled form to the job's private files, next to the existing tamper-proof copy and its fingerprint.
- Staff, the assigned trades and the owner can open it from the job page. Nobody else can.
- Re-signing creates a new version and marks the old one "replaced". Nothing is ever deleted.
- This still only works once you unlock the forms.

## 2. Electrical form (PIESA) — electrician
- It only opens after the quote is accepted and the 50% deposit is paid.
- It's the official PIESA (already pre-filled), plus a short Home Insulation Victoria evidence section:
  - date, time and location of the visit
  - a front-of-property identity photo of the electrician (with location)
  - switchboard and cable photos
  - isolation arrangements
  - solar/battery photo where present
  - life-support paperwork where it applies
- Each rectification item has a description, quantity, location and photo. The rectification quote is still worked out automatically from the agreed rates.
- After rectification there's no second visit form. The electrician uploads completion photos, the Certificate of Electrical Safety and the completed Section C.
- After signing, the filled form is sent to the owner and installer and recorded in the job history.

### Section C runs itself after rectification
So the electrician can't forget it, and you'll always know where it's up to:
- **It opens by itself.** When the rectification visit is booked, the portal puts Section C on the electrician's job automatically, already filled in from their PIESA and details. They don't have to start it.
- **Reminders.** If Section C isn't done on the day of the rectification visit, the electrician gets a reminder. Another goes the next morning.
- **Office alert.** After 48 hours you get an alert on the To-do list: "Section C missing — job can't be installed".
- **Install stays locked.** Installation can't be booked or started until Section C is signed with its Certificate of Electrical Safety number and completion photos.
- **The 30-day clock is shown.** The job shows the days left before the PIESA window runs out, so a late Section C is caught before it causes a redo.
- Reminders to the electrician follow the same on/off switch as the automatic sending above.

## 3. Install day — lead installer, one Mitti job in three parts
**A. Before starting:**
- the installers onsite and their certification details
- confirm the PIESA has been reviewed, and that rectification and the Certificate of Electrical Safety are done where needed
- confirm nobody has been in the ceiling since the PIESA
- power isolation and lock-out
- safety plan (SWMS) acknowledged
- the official PIISA, signed

**B. Identity:**
- a front-of-property photo with location for each installer
- the electrician too, if they're required at the start

**C. Before-install evidence:**
- isolation photo
- product label photos (maker, product, R-value)
- a ceiling video before work starts
- existing insulation and its depth
- every claimed ceiling zone, named

**"Start installation" stays locked** until A, B and C all pass.

**Finish (same Mitti job):**
- the product installed and batch details
- installed m², with the difference from the Ready Check explained
- excluded areas and why
- depth photos, clearances, and coverage around downlights
- a video of every zone after installation
- the final zone plan (zone sizes, m², product, R-value, total)
- debris removed
- the installer's completion declaration and signature

## 4. AP review screen
One row of ticks:

```text
Ready Check -> PIESA -> Rectification/certificate (or N/A) -> ESC notification -> PIISA -> Before-install -> After-install -> Final m2 -> Ready for VEEC
```

Each tick opens its evidence. It also checks:
- zone names match between the Ready Check and the final plan
- the product is eligible, and the R-value and coverage meet the rules
- the installers match the team named in the ESC notification
- dates, signatures and the 30-day PIESA window are all valid

## Order of work
1. Photo location and time capture, plus the refusal rule.
2. The new evidence items for each stage, and the "Start installation" lock.
3. Writing answers onto the official form and saving it to the job file.
4. Automatic PIESA sending.
5. The AP review screen.
6. Build sheets for the two Mitti forms (PIESA evidence section and install day) for you to build in Mitti.

## Things to know
- **The official forms are Word files.** The portal can fill the Word file exactly and save it. Turning it into a PDF on our servers is limited, so the job may store the filled Word file, with a PDF where conversion works. I'll confirm after a test.
- **Automatic sending conflicts with launch item LR-006.** LR-006 says "office sends by hand" and is still waiting for your written confirmation. I'll build automatic sending switched off, and you turn it on when you confirm the change.
- **Location rule:** the default distance is 150 m from the property, as an admin setting. Phones that strip location data from photos will need the photo taken inside the portal or Mitti camera.
- **Locking and testing:** everything stays locked behind the form approval, and nothing is published. Each part is tested on made-up test jobs before you see it.

## Technical details
- New `evidence_category` values for each stage. `evidence_files` gets `lat`, `lng`, `captured_at` and `distance_m`, with a server check that refuses missing or too-far locations. These are additive migrations with grants and RLS.
- The filled Word file is produced in a pure module from the stored official .docx, mapped by item ID. It's stored in `official-form-copies` and linked from `official_form_signed_copies`.
- Auto-send is an `external_action_outbox` action with its mode OFF by default, recorded in `official_form_deliveries`.
- The "Start installation" gate is added to `stageEntryBlockers`.
