# SWMS: fill "Specific to this house" from the job

Date: 30 Oct 2026. Approved in chat by Jo.

## Why

Right now the only house-specific text in the SWMS is the installer's optional typed note. If they skip it, the SWMS says "None recorded", even though the portal already knows a lot about the house from the Ready Check and the PIESA.

## What changes

### 1. House facts listed automatically

The "Specific to this house" part lists these facts, taken from the job's latest Ready Check and PIESA:

| Group | Facts |
|---|---|
| Roof and access | Roof type, access rating, the access note |
| Ceiling facts | Foil/metallic/conductive existing insulation (per area), recessed downlights (count per area), life support at the property, ceiling or roof built or replaced in the last 5 years |
| Ready Check issues | Each issue noted, with its area name ("What is the issue, and where is it in this area?") |
| PIESA result | Pass, or the electrical upgrades found and whether they're done |
| Installer's note | Still typed on the safety plan card. Added last, same as now |

If a fact wasn't recorded (e.g. an old Ready Check form), its line is left out. Nothing is blocked. If nothing at all is known, it still says "None recorded".

### 2. Set safety steps for four facts only

When one of these facts is true, a fixed line is added under "Specific to this house":

| Fact | Safety step |
|---|---|
| Foil or conductive insulation in any area | Power off at the switchboard before anyone enters the ceiling |
| Life support at the property | Don't switch off power without the owner's OK and a plan for the equipment |
| Access rated Difficult | Extra care getting in and out of the ceiling space |
| Recessed downlights | Keep the required clearance or fit approved covers around every downlight |

The asbestos rule (built before 1990, or "asbestos" in a note) stays as it is now. The main hazard table stays the same on every job.

### 3. Sign again if the SWMS changes

Today a person's signature counts even if the SWMS changes after they sign. From now on, a signature counts only for the version they signed. Each signature already stores a fingerprint of the plan. If the plan changes (a Ready Check or PIESA update, a new site note, a crew change), the old signatures stop counting and the pre-start check shows them as "not signed" until they sign again.

No new texts or emails are added by this change.

### 4. Dead phone: sign on the Lead's phone

If a crew member can't sign on their own phone, the Lead can open that person's own sign link on the Lead's phone (from the job's safety plan card). The crew member reads the SWMS and types their own name there. The signature is recorded as "signed on the Lead's phone", so the record shows how it was given. They still sign only their own line. The Lead can't type someone else's name for them.

## Not changing

- The Ready Check and PIESA forms (no new questions)
- The PDF layout, apart from the longer "Specific to this house" section
- Who signs, and how they sign

## Checks

- Tests: each fact appears when present and is left out when missing; each of the four safety steps appears only when its fact is true; an old signature stops counting after the plan changes, and a new signature counts; a crew member can sign their own line on the Lead's phone and it is recorded that way.
- Regenerate the sample SWMS PDF using a TEST job with every fact filled in, and look at it.
