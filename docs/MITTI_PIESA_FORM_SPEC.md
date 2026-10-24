# Mitti PIESA form: build sheet

> **AP evidence (decision 178, Jo 24 Oct 2026).** The PIESA form carries four evidence items and the portal will not count the PIESA as complete until the ones that apply are on the form:
>
> | # | Evidence | When it is required | Checked by the portal |
> |---|---|---|---|
> | 42 | Photo of the cables at the switchboard (geotagged) | Always | Present **and** geotagged |
> | 43 | Photo showing you on site at the property, holding your licence / photo ID (geotagged) | Always | Present **and** geotagged |
> | 44 | Photo of each hazard listed (one per hazard; geotagged) | Only when any hazard was answered Yes (mains/solar/ceiling not safe, non-IC downlights, appliances/flues) | One photo per hazard listed, all geotagged |
> | 45 | Certificate of Electrical Safety (photo or PDF) | Only once repair work was done (q30 answered Yes) | Present |
>
> Sources: ESC 30 Jul 2026 update (switchboard photo by the licensed electrician during the PIESA), DEECA industry pack (electrician identity at the premises). The files are copied into the job file (`documents`, kind `piesa_evidence`) for the 6-year AP record. Rules: `src/lib/piesa-evidence.core.ts`; sync: `src/lib/mitti.server.ts`; gates: `completeAssessment`, `stageEntryBlockers("piesa_complete")`, `piesaAdvanceDecision`.

For whoever builds the electrician's **PIESA** form in Mitti. It's generated from the portal's own definition (`src/lib/official-short.core.ts`, `SHORT_PIESA_FIELDS`, plus the four evidence items in `src/lib/piesa-evidence.core.ts`), so the portal can read every answer.

**The question wording must match exactly.** The portal finds each answer by its question text, and the portal turns the answers into the official DEECA PIESA Word form, so the electrician only sees short, plain questions.

## How to build it
1. In Mitti, create a new template named **"PIESA – Electrician safety assessment"**, with one page per group if you like. Page breaks don't matter.
2. Add the questions below **in this order**, with the **exact wording**, answer type and Required setting shown.
3. **"Only show when" rules** use Mitti's logic on the earlier answer. For example, show question 6 only when question 5 is Yes **and** the office record says life support.
4. Questions marked **portal fills this in** are filled automatically on every form the portal creates. Keep them editable so the electrician can correct them.
5. Set the inspection title to **Job Reference ID + Address including postcode**.
6. Publish, then send me the **template ID**. It's in the Mitti web address when the template is open, or under the template's settings. I'll connect it in the portal and check it before any electrician gets one.

## Questions
| # | Exact question wording | Answer type | Rules |
|---|---|---|---|
| 1 | Job Reference ID | Text answer | Required · **portal fills this in** |
| 2 | Address including postcode | Text answer | Required · **portal fills this in** |
| 3 | Date of inspection | Date | Required |
| 4 | Office life support record | Text answer | Required · **portal fills this in** |
| 5 | Is the life support record shown above still correct? | Yes / No: Yes / No | Required |
| 6 | Have you received written consent or a medical plan? Please attach a photo of it. | Multiple choice (pick one): Yes – received Consent / Yes – received Medical Plan | Required · only show when: Life support confirmed Yes |
| 7 | Written consent or medical plan (kept as an attachment to this assessment) | Photo / attachment | Required · only show when: Life support confirmed Yes |
| 8 | Is the mains power set-up safe? This means the mains cable in the ceiling is identified and marked, the main switch works and can be locked off, the ceiling is confirmed dead when the switch is off, and safety switches (RCDs) are fitted and tested. | Yes / No: Yes / No | Required |
| 9 | Please tick each item that is not right. | Multiple choice (tick all): The mains cable in the ceiling has not been identified and marked. / The main switch is not accessible or does not work. / The main switch cannot isolate all of the cables in the ceiling space safely. / The main switch cannot be secured in the off position. / Testing has not confirmed that the ceiling is dead when the main switch is off. / Safety switches (RCDs) are missing for the circuits in the ceiling area. / The safety switches (RCDs) have not been tested. | Required · only show when: mainsSafe = No |
| 10 | Is there solar, a battery or a generator at the property? | Yes / No: Yes / No | Required |
| 11 | Can it be safely shut down, and are its cables in the ceiling labelled, in conduit and protected? | Yes / No: Yes / No | Required · only show when: solarPresent = Yes |
| 12 | Please tick each item that is not right. | Multiple choice (tick all): There are no instructions for safely shutting down and restarting the system. / The isolator is not accessible, not working, or cannot be switched off safely. / The system cables in the ceiling are not in conduit or are not clearly labelled. / The system cables in the ceiling are not protected or supported where they could be damaged. | Required · only show when: solarSafe = No |
| 13 | Are the cables, connections and fittings in the ceiling safe to work around and cover with insulation? | Yes / No: Yes / No | Required |
| 14 | Please tick each problem you found. | Multiple choice (tick all): There is electrically conductive conduit in the ceiling. / The cables are not supported, or are run in a way that risks damage during the installation. / Cables that will be surrounded by insulation do not meet the wiring rules for that situation. / Thermoplastic (TPS) cables in the ceiling are deteriorated or damaged. / Connections or terminations in the ceiling are exposed or not securely enclosed. / Plug bases for lights or fans are loose in the ceiling. / Foil-backed or electrically conductive insulation is present and has not been confirmed as not live. / There are mains-connected cables in the ceiling that are not TPS. / There is split metal conduit wiring in the ceiling. / There are damaged or deteriorated cables in the ceiling. | Required · only show when: ceilingSafe = No |
| 15 | Are there any downlights or other recessed lights in the ceiling? | Yes / No: Yes / No | Required |
| 16 | How many are there? | Number | Required · only show when: downlightsPresent = Yes |
| 17 | Are any of them not IC or IC-4 rated? | Yes / No: Yes / No | Required · only show when: downlightsPresent = Yes |
| 18 | Are there any appliances, exhaust fans or flues in the ceiling space? | Yes / No: Yes / No | Required |
| 19 | Please describe each one, where it is, the hazard it creates, and what was done or needs to be done about it. | Text answer | Required · only show when: appliancesPresent = Yes |
| 19a | Does the action you described effectively reduce the risk from each hazard listed? | Yes / No: Yes / No | Required · only show when: appliancesPresent = Yes · decision 210: fills official Part 7 "effective" (`p7.effective`), so the printed P7 rule can pass without a rectification record for every hazard |
| 20 | Is any electrical repair work needed before insulation can be installed? | Multiple choice (pick one): No repair work is needed / Yes, repair work is needed / Repair work is not possible, so an electrician must be present on installation day | Required |
| 21 | Please tick the repair work that is required. | Multiple choice (tick all): Prohibited luminaires (e.g. CA-class luminaires, non-IC luminaires, or ‘do-not-cover’ light fittings) are present and need to be replaced with IC and/or IC4 rated LED lights. / Circuit protection rating needs to be upgraded to allow for effects of thermal insulation on the wiring system (derated) / Residual Current Devices (RCDs) need to be installed for circuit/s within the ceiling insulation area, as per the most current version of AS/NZS 3000 / Cables in the ceiling or at the switchboard need to be replaced with ThermoPlastic Sheathed (TPS) cables, (or an equivalent cable) as per the most current version of AS/NZS 3000 / Cables and wiring in the ceiling space need to be altered or repaired to meet Basic Protection requirements, as per the most current version of AS/NZS 3000. / Other (indicate below): | Required · only show when: rectificationOutcome = Yes, repair work is needed |
| 22 | Please describe the other repair work. | Text answer | Required · only show when: Other is ticked |
| 23 | Licence no: | Text answer | Required · **portal fills this in** |
| 24 | Full Name: | Text answer | Required · **portal fills this in** |
| 25 | Name: | Text answer | Required · **portal fills this in** |
| 26 | REC registration no: | Text answer | Required · **portal fills this in** |
| 27 | Telephone no: | Text answer | Required · **portal fills this in** |
| 28 | I declare that all information contained in and attached to this form is correct and not misleading by inclusion or omission | Checkbox (must tick) | Required |
| 29 | Electrician signature | Signature | Required |
| 30 | Have you completed all of the repair work listed above, and is the ceiling now safe for insulation? | Yes / No: Yes / No | Required · only show when: rectificationOutcome = Yes, repair work is needed |
| 31 | Certificate of Electrical Safety number (required for any electrical works completed): | Text answer | Required · only show when: rectificationOutcome = Yes, repair work is needed |
| 32 | Date of Certification: | Date | Required · only show when: rectificationOutcome = Yes, repair work is needed |
| 33 | Licence no: | Text answer | Required · **portal fills this in** · only show when: rectificationOutcome = Yes, repair work is needed |
| 34 | Full Name: | Text answer | Required · **portal fills this in** · only show when: rectificationOutcome = Yes, repair work is needed |
| 35 | Name: | Text answer | Required · **portal fills this in** · only show when: rectificationOutcome = Yes, repair work is needed |
| 36 | REC registration no: | Text answer | Required · **portal fills this in** · only show when: rectificationOutcome = Yes, repair work is needed |
| 37 | Telephone no: | Text answer | Required · **portal fills this in** · only show when: rectificationOutcome = Yes, repair work is needed |
| 38 | Please confirm that the assessment was completed today, and that you understand that anyone going into the ceiling before installation may cancel this assessment. | Yes / No: Yes / No | Required |
| 39 | Name: | Text answer | Required · **portal fills this in** |
| 40 | Date: | Date | Required |
| 41 | Owner signature | Signature | Required |
| 42 | Photo of the cables at the switchboard (geotagged) | Photo / attachment (location on) | Required · **VEU requirement for installs from 21 Aug 2026** · portal blocks completion until present and geotagged |
| 43 | Photo showing you on site at the property, holding your licence / photo ID (geotagged) | Photo / attachment (location on) | Required · **VEU evidence the electrician attended** · portal blocks completion until present and geotagged |
| 44 | Photo of each hazard listed (one per hazard; geotagged) | Photo / attachment (location on, several files) | Required · only show when: any hazard answered Yes (mainsSafe = No, solarSafe = No, ceilingSafe = No, downlightsNonIc = Yes or appliancesPresent = Yes) · portal expects one photo per hazard listed, all geotagged |
| 45 | Certificate of Electrical Safety (photo or PDF) | Photo / attachment (PDF allowed) | Required · only show when: rectificationComplete = Yes (q30) · portal blocks completion until present |

Questions 42–45 are the evidence items from decision 178 (Jo 24 Oct 2026). Earlier wordings ("Switchboard cable photo", "Photo showing you on site at the property (geotagged)", "Electrician photo at front of premises with photo ID") are still recognised by the portal, but build the form with the wording above. The portal copies each file into the job file (`documents`, kind `piesa_evidence`, private `job-files` bucket, one copy per Mitti media id) when the Mitti form is marked complete, so the AP record keeps them for 6 years even while another item is still missing.

### How the CES gets attached after fixes (q45)
There is one PIESA template. Repair work is handled in two ways, and the CES follows the same path as the repair:
- **Fixed on the same visit** (electrician repairs on the day, answers q30 "Have you completed all of the repair work…" = Yes and fills q31–q37): q45 appears on the same form and the CES is attached in Mitti. The portal will not count the PIESA as complete until q45 has a file.
- **Fixed on a later visit** (q20 = "Yes, repair work is needed", q30 left as No/blank, electrician signs off, the office prices the fixes and the owner approves): the first form is completed without q45. After the electrical fixes visit the electrician records the result in the portal (`recordPiesa`, kind `post_rectification`, which already requires the "Electrical fixes completion" evidence upload and the Section C details, CES number and date). The CES photo/PDF goes in as that **portal evidence upload** (`rectification_completion` evidence category) — the current code supports this path; a second Mitti form is not sent for the re-visit. The Mitti form is read-only for the portal once the assessment is complete, so a CES added to Mitti later would not be read.

## After it's published
- Send me the template ID. I'll connect it (`workflow_settings.mitti_piesa_template_id`), and the portal's form-health check will confirm every question above (42–45 included) is present before the PIESA is marked approved.
- Then I'll run one TEST electrician job end to end before any real electrician receives the form.

## Approval step for Jo (official PIESA mapping, currently `approved: false`)
The official DEECA PIESA Word form is only filled from the Mitti answers once the mapping is approved, the same way the PIISA was approved on 24 Oct 2026. Nothing goes live before step 3; `officialFormUseBlocker("piesa")` refuses PIESA audits, form connection and official filling until then.
1. **Connect the template ID.** Compliance → Mitti forms → PIESA: paste the published template ID. `connectMittiForm` runs `validateTemplate("piesa", …)` on the live `/templates/v1/templates/{id}` definition and refuses any missing, duplicated or wrong-type question (q1–q45). Fix the form in Mitti and retry until it passes.
2. **Read the portal definition diff.** The form-health page (`mitti-form-health.*`) lists every difference between the connected Mitti template and the portal definition (`FORMS.piesa`: `SHORT_PIESA_FIELDS` + the four evidence items). Also run `bun test ./tests/official-forms.test.ts ./tests/official-short.test.ts ./tests/piesa-evidence.test.ts` and read `docs/official-forms/` to confirm the official wording is unchanged (SHA-256 in `OFFICIAL_TEMPLATES.piesa`).
3. **Approve the mapping.** In `src/lib/official-forms.core.ts`, change `OFFICIAL_TEMPLATES.piesa` from `approved: false` to `approved: { by: "Jo (Home Insulation Victoria)", at: "<date>" }` and set `effectiveFrom` to the same date (exactly as the PIISA record reads), update the test in `tests/official-forms.test.ts` that pins the PIESA as unapproved, log the decision in `docs/JO_DECISIONS_LOG.md`, and run one TEST electrician job end to end before any real electrician receives the form.
