# Separate, validated Mitti templates

## Goal
Replace the incorrect combined Mitti form with two role-specific forms:

1. **Installer — Free Ready Check: Eligibility & Measurement**
2. **Licensed REC electrician — Pre-Installation Electrical Safety Assessment (PIESA)**

Mitti cannot create or edit templates through its connection, so the portal will provide exact field-by-field build sheets and refuse to connect a template until its structure passes validation. The final IDs are entered only after the two forms are created in Mitti.

## Build

### 1. Installer Ready Check template
- Prefill the job number, verified address, owner, assigned installer, booking time, declared life-support status and preliminary area.
- Capture installer identity, attendance time, geotagged attendance evidence and ceiling-space evidence.
- Capture building/ceiling eligibility observations, gross and excluded areas, one authoritative net eligible area, measurement method and measurement evidence.
- Capture existing insulation, observed type/depth/R-value, removal requirement and removal area/reason.
- Capture access and installation factors, plus objective electrical observations only.
- Explicitly state that installer observations are preliminary and are not PIESA or electrical-compliance findings.
- Forbid pass/fail, compliant/safe-to-install and certificate conclusions by the installer.

### 2. REC PIESA template
- Prefill the job, site, owner, assigned licensed electrician and booked assessment time.
- Capture electrician licence and REC details, assessment date and required geotagged identity/site evidence.
- Capture explicit checks for cables, RCD/basic protection, luminaires, de-energisation, switchboard, hazards and whether an electrician must attend installation.
- Capture rectification items using structured standard items plus an unpriced “other” path requiring office review.
- Use the official four-state PIESA result wording, rather than inferring a pass from “no rectification required.”
- Capture conditional Certificate of Electrical Safety details where rectification occurred.
- Keep the completed official form/evidence separate from installer measurement records.

### 3. Portal validation and safe sync
- Add separate configurable IDs for the installer and PIESA templates; remove the hardcoded PIESA dependency.
- Validate each template’s exact required labels, unique matches, field types and allowed choices before creating an inspection.
- Route installer results only to Ready Check/measurement records and PIESA results only to electrical assessment records.
- Preserve the full Mitti snapshot and validation issues.
- Mitti submission never completes a requirement, decides compliance, advances a job, creates a quote or sends communication.

### 4. Verification
- Add tests for both complete forms, missing required fields, duplicate labels, wrong template/role, malformed values, conditional fields and explicit PIESA outcomes.
- Test that the installer cannot record PIESA conclusions and the electrician cannot overwrite the accepted measure-up.
- Check the signed-in screens after the IDs are configured.

## Required external step
After the build sheets are ready, the two templates must be created in the Mitti interface because Mitti’s API does not support template creation/editing. Their IDs can then be entered in the portal and validated before use. The current combined draft will remain disconnected.

## Safety
- External sending and automatic Mitti dispatch remain off.
- No official wording is invented; exact official forms remain attached/retained where required.
- The 30-day PIESA window and every existing deposit, ESC, evidence and completion gate remain unchanged.
