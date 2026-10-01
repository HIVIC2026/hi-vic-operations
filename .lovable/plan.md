# Form A1: Ready Check (installer brings the customer), rebuilt from scratch

We fix this one form first, get your sign-off, then move to the next. The old A1 field list gets thrown out.

## The rules this form follows
1. **The order matches the site visit**: arrive, get into the roof, measure each room, finish, then price.
2. **Never ask what we already know.** The portal fills in job number, owner, address, property type and the office's life support result. The installer only confirms them.
3. **Each question is asked once.** Questions about a room are asked inside that room. The portal adds up the totals itself.
4. **A question is only mandatory when it applies.** Follow-up questions only appear when the earlier answer needs them.
5. **Every photo is geotagged and time-stamped.**

## The form, in order

```text
1. CHECK THE JOB DETAILS (filled in by the portal)
   Job number | Owner name | Address | Property type | Office life support result
   - Are these details correct?            Yes / No            MANDATORY
   - What needs correcting?                text                MANDATORY only if No

2. GETTING INTO THE CEILING
   - Roof type                             Tiles / Metal sheet / Other    MANDATORY
   - Describe the roof type                text                MANDATORY only if Other
   - How easy is the ceiling access?       Easy / Moderate / Difficult    MANDATORY
   - Photo of the ceiling access point     photo               MANDATORY

3. CEILING AREAS
   - How many separate ceiling areas are there?   1 / 2 / 3 / 4 / 5 / 6+   MANDATORY
     (e.g. main roof, extension, garage-side section)
   The form then opens that many sections: "Area 1", "Area 2", ...
   Each area asks the same questions:
   - Where is this area?                   text, e.g. "Main house", "Rear extension"   MANDATORY
   - Length (m)                            number              MANDATORY
   - Width (m)                             number              MANDATORY
     (the portal works out the m2; for odd shapes, split them into extra areas)
   - Is there existing insulation?         Yes / No            MANDATORY
     If Yes:
     - Type (tick all that apply)          Batts / Loose fill  MANDATORY
     - Depth (mm)                          number              MANDATORY
     - Photo with tape measure showing depth  photo            MANDATORY
     - What needs to happen to it?         Remove / Top up / Not sure  MANDATORY
     - Area to remove (m2)                 number              MANDATORY only if Remove
     If No:
     - Photo of the empty ceiling space    photo               MANDATORY
   - Recessed downlights in this area?     Yes / No            MANDATORY
   - How many?                             number              MANDATORY only if Yes
   - Hazards in this area?                 Yes / No            MANDATORY
   - Describe them and add a photo         text + photo        MANDATORY only if Yes
   If they pick 6+, they can keep adding areas.

4. WHOLE JOB
   - How was the ceiling measured?         Laser in the ceiling space / Tape in the ceiling space /
                                           Scaled from floor plan / Other     MANDATORY
   - Explain the method                    text                MANDATORY only if Floor plan or Other
   - Upgrade area diagram or floor plan    photo/upload        MANDATORY
     (a sketch showing each area with its length and width; required evidence for the regulator)
   The portal saves a measurement record for each job: method, who measured it, date/time,
   dimensions for each area, calculated m2 and the diagram.
   - Was the ceiling or roof built or replaced in the last 5 years?  Yes / No / Not sure  MANDATORY

5. YOUR QUOTED PRICE (A1 only, all prices inc GST)
   Repeat one line per item:
   - Item                                  dropdown            MANDATORY
       R5.0 supply and install / Removal of existing insulation /
       Difficult access / Tile lift / Metal sheet access / Other
   - Describe the item                     text                MANDATORY only if Other
   - Price $                               number              MANDATORY
   - Total quoted price $                  number              MANDATORY (must equal the sum of the lines)
   - Already agreed this price with the owner?   Yes / No      MANDATORY

   Portal checks (the job goes to the office if any fail, nothing is guessed):
   - There must be exactly one "R5.0 supply and install" line.
   - A "Removal" line is required if any room says Remove, and not allowed if none do.
   - The areas come from the rooms above and are never retyped.
   - No separate "what this includes" question. The lines already spell it out.

6. FINISH
   - Anything else the office should know? text                optional
   - I confirm this information is accurate   tick             MANDATORY
```

## What the portal does with the answers
- Adds up total area, removal area, and how much of each insulation type there is, so batts and loose fill are priced separately.
- Checks that the price lines add up to the total. If they don't, or a line is missing, the job goes to the office for review. The portal never guesses a price.
- Builds the owner quote: your lines + PIESA + our AP fee − VEU discount.
- If anything is marked "Not sure", it raises a To action item.

## Decisions for you
1. Decided: length × width for each area, with the portal working out the m2, plus a required area diagram.
2. Does a hazard in one room get its own photo, or is one description enough?
3. Should "Not sure" on remove or top up be allowed, or must the installer decide onsite?

## Technical section
- Replace `READY_CHECK_FIELDS` with the new list. A1 = new shared fields + `PRICING_FIELDS` (A2 stays untouched until we do it next).
- Update the parsing labels in `mitti.core.ts` and the PIISA/PIESA mappings in `official-pdf.core.ts` to match. Update tests.
- Generate `Mitti_template_briefs_v5_A1.md` with only Form A1 in it, so there's one thing to paste.
