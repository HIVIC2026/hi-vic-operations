# Official PIESA mapping samples (piesa-map-2.0.0) — for Jo's approval

SAMPLES ONLY. The mapping is **not approved** (`OFFICIAL_TEMPLATES.piesa.approved = false`), so the portal produces no official PIESA yet. These files were made by `bun scripts/render-piesa-mapping-samples.ts` with the portal's own pure steps (A4 answers → `shortAnswersFromEntries` → A5 merge → `expandPiesa` with the owner's secure-link confirmation → `evaluatePiesa` → Word form fill / PDF), skipping only the approval check. Nothing was stored or sent. Names, numbers and addresses are made up.

Form: VEU pre-installation electrical safety assessment form (© DEECA March 2026), original `docs/official-forms/VEU-pre-installation-electrical-safety-assessment-form_1.docx`, SHA-256 `2a89d21c1f2c8fef916954d070449bd3175590d90b9a514d4a8d7625f3a299ac`.

For each case:

- `*.docx` — the official DEECA Word form filled by the portal (what the office downloads). `*-word.pdf` + `*-word-N.png` — that Word file printed by LibreOffice, so you can look at it without Word.
- `*.pdf` + `*-pdf-N.png` — the PDF the portal attaches to the electrician's email / /field download (decision 317): the same answers as plain text in the form's order.

## Problems these samples show (checked against branch installer-mitti-workflow @ e41d5081, 25 Oct 2026)

Do not approve the mapping until these are fixed or accepted. The per-case read-back below re-checks the Word form on every run.

**Wrong answers (mapping):**

1. Two or more ticks in one A4 tick-list are lost. Mitti joins a multi-select with ", " (`mitti.core`), but `expandPiesa` splits only on " | ". Case 2 ticked two mains problems (RCDs missing + RCDs not tested): the official form says **Yes** to both RCD questions. The same applies to the solar and ceiling problem lists. B2 repair ticks become one combined entry (case 2), so no B2 box can match. A single tick works.
2. The owner's ONE secure-link tick ("The assessment was completed on <date>") fills all four official owner declarations, including "any electrical rectification works were completed on the above date". That is ticked in case 1 (no works) and in case 2, where the owner confirmed on 28 Oct, before the fixes on 3 Nov. The regenerated form keeps that earlier confirmation. `o.date` is the date the owner confirmed, not the assessment date.
3. `p7.appliances` and `p7.flues` both come from one A4 question, so they always get the same answer. `p7.location` repeats the "What is it and where is it?" text. `p7.hazard` and `p7.actions` are fixed wording. `p7.otherHazard`/`p7.otherAction` (other hazards, e.g. rotten joist) are never asked on A4, so they are always blank. `p4.tps` can never be N/A.
4. Case 3 ("Be on site at the start of the install day" only): B1 = "not possible … under parts 2 and 3". The B2 tick and the electrician's "Other" description (what he will do on the day) are not on the official form. A4 still requires a B2 tick even when the only job is being on site.
5. Signatures: `c.signature` and `o.signature` are never written (by design, they live in the signed record). `evaluatePiesa` therefore reports `REQ:o.signature` (and `REQ:c.signature` after fixes) on EVERY PIESA. The Mitti sync shows this as an "Official form: Required: \"Signature\"." review issue on every job. The Word form's signature boxes print blank.

**Word form filler (`official-docx.core.ts`), whatever the answers:**

6. A "No" answer never ticks a box. In the form, the No box is followed by a space run before the word "No", and the filler only looks at the first run. Every No on the official Word form prints as unanswered (see each case's read-back).
7. B1 (the assessment outcome) and B2 boxes are never ticked: a tab run sits between the box and the option text. The Word form never shows the outcome.
8. Main switch: the form has no box for "Is the main switch for the premises:". That answer and the three sub-items all land on the first sub-row, so "able to isolate…" and "able to be secured…" print blank.
9. Part 7 table: Appliance, Location and Hazard all write into the first cell. The Appliance column shows the hazard wording, and Location/Hazard stay blank (case 1).
10. The Section C declaration box carries `w:checked="0"` in the original form. The filler only changes `w:default`, so `c.tick7` never shows as ticked (case 2).
11. Each tick mark is written as a run inside another run (`<w:r><w:r>…`). That is not valid Word XML: LibreOffice opens it, but Word may say the file has unreadable content. These samples were not opened in Word here.

**Smaller:**

12. The plain-text PDF swaps every non-ASCII character for "-" ("don-t", "owner-s", "If -Yes-"). It also doubles colons ("Licence no::") and prints every empty table row (10 appliance rows × 3, 14 other-hazard rows × 2) as "-" lines.
13. The published A4 template (`tests/fixtures/mitti-piesa/a4-published-2026-10-25.json`) does not have the decision 305/308/312 questions yet, and it still asks the retired "Can the repair work be done before installation?". On the live form today, case 3's "Be on site at the start of the install day" tick cannot be answered.

## Every official question: where it comes from, and what each case got

| Official item | Comes from | Case 1 | Case 2 | Case 3 |
|---|---|---|---|---|
| `jobRef` Job Reference ID | A4 "Job Reference ID" (portal prefill) | HV-SAMPLE-1 | HV-SAMPLE-2 | HV-SAMPLE-3 |
| `address` Address including postcode | A4 "Address including postcode" (portal prefill) | 14 Wattle Street, Bentleigh VIC 3204 | 7 Banksia Court, Frankston VIC 3199 | 22 Ironbark Road, Bendigo VIC 3550 |
| `inspectionDate` Date of inspection | A4 "Date of inspection" | 2026-10-27 | 2026-10-28 | 2026-10-29 |
| `lifeSupport` Is anyone at this property dependent on life support? | A4 "Is there life support equipment at the property?" | No | Yes | No |
| `lifeSupportConsent` If yes, has written consent or a medical plan been received prior to this assess… | A4 "Have you received written consent or a medical plan?…" ("No – not received" = stop, left blank + flagged) | _blank_ | Yes – received Medical Plan | _blank_ |
| `lifeSupportAttachment` Written consent or medical plan (kept as an attachment to this assessment) | A4 "Written consent or medical plan (kept as an attachment to this assessment)" (photo) | _blank_ | 1 photo | _blank_ |
| `p2.mains` Has the presence of any consumer mains cable in the ceiling space been identifie… | A4 "Is the mains power set-up safe? This means the mains cable in the ceiling is identified and marked, the main switch works and can be locked off, the ceiling is confirmed dead when the switch is off, and safety switches (RCDs) are fitted and tested." Yes → Yes; No → No only if "The mains cable in the ceiling has not been identified and marked." ticked | Yes | Yes | Yes |
| `p2.switch` Is the main switch for the premises: | Derived: No if any of the three main-switch sub-items is No | Yes | Yes | No |
| `p2.switchAccessible` accessible and operational | A4 mains Yes/No + tick "The main switch is not accessible or does not work." | Yes | Yes | Yes |
| `p2.switchIsolates` able to isolate all cables running through the ceiling space safely (excluding t… | A4 mains Yes/No + tick "The main switch cannot isolate all of the cables in the ceiling space safely." | Yes | Yes | Yes |
| `p2.switchSecured` able to be secured in the off position | A4 mains Yes/No + tick "The main switch cannot be secured in the off position." | Yes | Yes | No |
| `p2.tested` Has testing been carried out to ensure all cables and equipment within the ceili… | A4 mains Yes/No + tick "Testing has not confirmed that the ceiling is dead when the main switch is off." | Yes | Yes | Yes |
| `p2.rcdPresent` Are Residual Current Devices (RCDs) (safety switches) present for circuit/s with… | A4 mains Yes/No + tick "Safety switches (RCDs) are missing for the circuits in the ceiling area." | Yes | Yes | Yes |
| `p2.rcdTested` Have all RCD’s been tested for operation? | A4 mains Yes/No + tick "The safety switches (RCDs) have not been tested." | Yes | Yes | Yes |
| `p3.present` Is there a Solar PV, Battery system and/or alternative supply, such as a fuel dr… | A4 "Is there solar, a battery or a generator at the property?" | No | Yes | No |
| `p3.instructions` Are instructions provided on the safe shutdown/isolation, and re-energisation of… | A4 "Can it be safely shut down, and are its cables in the ceiling labelled, in conduit and protected?" + solar problem ticks | _blank_ | Yes | _blank_ |
| `p3.isolator` Is the ground level system AC and/or DC (may be part of the inverter) isolator a… | A4 solar safe + solar problem ticks | _blank_ | Yes | _blank_ |
| `p3.conduit` Are all system cable(s) in the ceiling space in conduit and clearly labelled? | A4 solar safe + solar problem ticks | _blank_ | Yes | _blank_ |
| `p3.protected` Are the system cables within the ceiling space protected and/or supported in acc… | A4 solar safe + solar problem ticks | _blank_ | Yes | _blank_ |
| `p4.conduit` Is the premises clear of any electrically conductive conduit? | A4 "Are the cables, connections and fittings in the ceiling safe to work around and cover with insulation?" + ceiling problem ticks | Yes | Yes | Yes |
| `p4.supported` Are the electrical cables present in the ceiling space supported or run in a way… | A4 ceiling safe + ceiling problem ticks | Yes | Yes | Yes |
| `p4.treatment` Do electrical cables that are or will be completely or partially surrounded by t… | A4 ceiling safe + ceiling problem ticks | Yes | Yes | Yes |
| `p4.tps` Have thermoplastic insulated and sheathed (TPS) cables present in the ceiling sp… | A4 ceiling safe + ceiling problem ticks (never "N/A") | Yes | Yes | Yes |
| `p4.terminations` Do all the electrical terminations and connections within the ceiling space meet… | A4 ceiling safe + ceiling problem ticks | Yes | Yes | Yes |
| `p4.plugBases` Are all plug bases within the ceiling space securely fixed. (i.e. lighting or fa… | A4 ceiling safe + ceiling problem ticks | Yes | Yes | Yes |
| `p4.foil` If electrically conductive insulation (e.g. foil backed) is present in the ceili… | A4 ceiling safe + ceiling problem ticks | Yes | Yes | Yes |
| `p5.nonTps` Are there any mains connected cables which are not TPS in the ceiling? | A4 ceiling safe (Yes → No) + ceiling problem ticks | No | No | No |
| `p5.splitConduit` Is there split metal conduit wiring present in the ceiling space? | A4 ceiling safe (Yes → No) + ceiling problem ticks | No | No | No |
| `p5.damaged` Are there damaged or deteriorated cables present in the ceiling space? | A4 ceiling safe (Yes → No) + ceiling problem ticks | No | No | No |
| `p6.recessed` Are there recessed luminaires present in the ceiling? | A4 "Are there any downlights or other recessed lights in the ceiling?" | Yes | Yes | No |
| `p6.count` If ’Yes’, specify total number of luminaries: | A4 "How many are there?" | 8 | 4 | _blank_ |
| `p6.prohibited` Are there prohibited luminaires that are not IC and/or IC-4 rated (i.e. classifi… | A4 "Are any of them not IC or IC-4 rated?" | No | Yes | _blank_ |
| `p7.appliances` Are there any electrical appliances present in the ceiling space (e.g. water hea… | A4 "Are there any appliances, exhaust fans or flues in the ceiling space?" (one question for both) | Yes | No | No |
| `p7.flues` Are there any exhaust fans or heating flues that vent into or through the ceilin… | A4 "Are there any appliances, exhaust fans or flues in the ceiling space?" (SAME answer as appliances) | Yes | No | No |
| `p7.appliance` Appliance | A4 "What is it and where is it?" (one row per "Add an appliance or flue") | Bathroom exhaust fan, ceiling above the main bathroom | _blank_ | _blank_ |
| `p7.location` Location | A4 "What is it and where is it?" (SAME text as the Appliance column) | Bathroom exhaust fan, ceiling above the main bathroom | _blank_ | _blank_ |
| `p7.hazard` Hazard | Fixed wording from "Can insulation be safely installed around it as it is?" | None — insulation can be installed around it as it is | _blank_ | _blank_ |
| `p7.actions` If a hazard was identified, what actions were undertaken, or should be undertake… | Fixed wording (none / see Part B2) | None required | _blank_ | _blank_ |
| `p7.effective` Does this action effectively reduce the risk associated with the identified haza… | Derived: Yes when every item is safe as it is, or once repairs are recorded complete | Yes | _blank_ | _blank_ |
| `p7.otherHazard` Other electrical or other hazards identified in the ceiling space (e.g. rotten j… | NOT ASKED on A4 — always blank | _blank_ | _blank_ | _blank_ |
| `p7.otherAction` Action taken, or should be taken, to mitigate against hazard prior to insulation… | NOT ASKED on A4 — always blank | _blank_ | _blank_ | _blank_ |
| `b1` Check ONE option only | A4 "Is any electrical repair work needed before insulation can be installed?" + "Be on site at the start of the install day" tick (decision 314) | Electrical rectification work is not required before insulation is installed or upgraded. | Electrical rectification work is required before insulation is installed or upgraded. | Electrical rectification work is not possible prior to insulation being installed or upgraded under parts 2 and 3 |
| `b2` The following electrical work is required before insulation is installed or upgr… | A4 "Please tick the repair work that is required." (only when B1 = rectification required) | _blank_ | Prohibited luminaires (e.g. CA-class luminaires, non-IC luminaires, or ‘do-not-cover’ light fittings) are present and need to be replaced with IC and/or IC4 rated LED lights., Residual Current Devices (RCDs) need to be installed for circuit/s within the ceiling insulation area, as per the most current version of AS/NZS 3000 | _blank_ |
| `b2.other` Other (indicate below) – details | A4 "Please describe the other repair work." | _blank_ | _blank_ | _blank_ |
| `b3.licence` Licence no: | A4 "Electrician licence number" | A 54321 | A 54321 | A 54321 |
| `b3.name` Full Name: | A4 "Electrician full name" | Sam Spark | Sam Spark | Sam Spark |
| `b3.recName` Name: | A4 "Electrical contractor (REC) business name" | Spark Electrical Pty Ltd | Spark Electrical Pty Ltd | Spark Electrical Pty Ltd |
| `b3.recNo` REC registration no: | A4 "REC registration number" | REC 23456 | REC 23456 | REC 23456 |
| `b3.phone` Telephone no: | A4 "Electrician phone" | 0400 111 222 | 0400 111 222 | 0400 111 222 |
| `b3.declaration` I declare that all information contained in and attached to this form is correct… | A4 declaration tick | ticked | ticked | ticked |
| `c.licence` Licence no: | Copied from B3 once repairs are recorded (A5 fills blanks only) | _blank_ | A 54321 | _blank_ |
| `c.name` Full Name: | Copied from B3 once repairs are recorded | _blank_ | Sam Spark | _blank_ |
| `c.recName` Name: | Copied from B3 once repairs are recorded | _blank_ | Spark Electrical Pty Ltd | _blank_ |
| `c.recNo` REC registration no: | Copied from B3 once repairs are recorded | _blank_ | REC 23456 | _blank_ |
| `c.phone` Telephone no: | Copied from B3 once repairs are recorded | _blank_ | 0400 111 222 | _blank_ |
| `c.tick1` I confirm all identified rectification works have been completed in accordance w… | A5 "Have you completed all of the repair work listed…" = Yes (all seven ticked together) | _blank_ | ticked | _blank_ |
| `c.tick2` I confirm that all luminaires present in the ceiling area are IC and/or IC-4 rat… | A5 "Have you completed all of the repair work listed…" = Yes (all seven ticked together) | _blank_ | ticked | _blank_ |
| `c.tick3` I confirm that all mains connected cables in the ceiling space are appropriately… | A5 "Have you completed all of the repair work listed…" = Yes (all seven ticked together) | _blank_ | ticked | _blank_ |
| `c.tick4` I confirm that all mains connected cables in the ceiling space are thermoplastic… | A5 "Have you completed all of the repair work listed…" = Yes (all seven ticked together) | _blank_ | ticked | _blank_ |
| `c.tick5` I confirm that all mains connected cables in the ceiling space meet Basic Protec… | A5 "Have you completed all of the repair work listed…" = Yes (all seven ticked together) | _blank_ | ticked | _blank_ |
| `c.tick6` I confirm that an electrical safety assessment has been completed and the ceilin… | A5 "Have you completed all of the repair work listed…" = Yes (all seven ticked together) | _blank_ | ticked | _blank_ |
| `c.tick7` I declare that all information contained in and attached to this form is correct… | A5 "Have you completed all of the repair work listed…" = Yes (all seven ticked together) | _blank_ | ticked | _blank_ |
| `c.signature` Signature | NEVER written to the form (lives in the signed record) | _blank_ | _blank_ | _blank_ |
| `c.completionDate` Date of completion: | "today" of the regeneration = A5 "Date of certification" | _blank_ | 2026-11-03 | _blank_ |
| `c.coes` Certificate of Electrical Safety number (required for any electrical works compl… | A5 "Certificate of Electrical Safety number" | _blank_ | CES 7781234 | _blank_ |
| `c.certDate` Date of Certification: | A5 "Date of certification" | _blank_ | 2026-11-03 | _blank_ |
| `o.tick1` I acknowledge that access to the ceiling space between now and the installation … | Owner's secure-link confirmation (ONE tick "The assessment was completed on <date>" → all four official ticks) | ticked | ticked | ticked |
| `o.tick2` I confirm that the electrical safety assessment works were completed on the abov… | Owner's secure-link confirmation (ONE tick "The assessment was completed on <date>" → all four official ticks) | ticked | ticked | ticked |
| `o.tick3` I confirm that any electrical rectification works were completed on the above da… | Owner's secure-link confirmation (ONE tick "The assessment was completed on <date>" → all four official ticks) | ticked | ticked | ticked |
| `o.tick4` I understand that information contained within this form will be provided to the… | Owner's secure-link confirmation (ONE tick "The assessment was completed on <date>" → all four official ticks) | ticked | ticked | ticked |
| `o.signature` Signature | NEVER written to the form (typed name on the secure link) | _blank_ | _blank_ | _blank_ |
| `o.name` Name: | Owner's secure-link confirmation: typed full name | Helen Nguyen | Robert Ellis | Priya Shah |
| `o.date` Date: | Owner's secure-link confirmation: Melbourne date they confirmed | 2026-10-27 | 2026-10-28 | 2026-10-30 |

## Case 1 — All clear — no life support, no repairs

Job HV-SAMPLE-1, 14 Wattle Street, Bentleigh VIC 3204. Inspection 2026-10-27. Owner Helen Nguyen confirmed on the secure link (2026-10-27T19:40:00+11:00).

Files: `case-1-all-clear.docx`, `case-1-all-clear-word.pdf` (8 pages: `case-1-all-clear-word-1.png`, `case-1-all-clear-word-2.png`, `case-1-all-clear-word-3.png`, `case-1-all-clear-word-4.png`, `case-1-all-clear-word-5.png`, `case-1-all-clear-word-6.png`, `case-1-all-clear-word-7.png`, `case-1-all-clear-word-8.png`), `case-1-all-clear.pdf` (6 pages: `case-1-all-clear-pdf-1.png`, `case-1-all-clear-pdf-2.png`, `case-1-all-clear-pdf-3.png`, `case-1-all-clear-pdf-4.png`, `case-1-all-clear-pdf-5.png`, `case-1-all-clear-pdf-6.png`).

A4 answers given:

- Job Reference ID → **HV-SAMPLE-1**
- Address including postcode → **14 Wattle Street, Bentleigh VIC 3204**
- Whose customer is this? → **Home Insulation Victoria**
- I will not discuss any prices with the owner. Home Insulation Victoria sends the owner all prices. → **Yes**
- Date of inspection → **2026-10-27**
- Office life support record → **No (owner said no on the website)**
- Is there life support equipment at the property? → **No**
- Is the mains power set-up safe? This means the mains cable in the ceiling is identified and marked, the main switch works and can be locked off, the ceiling is confirmed dead when the switch is off, and safety switches (RCDs) are fitted and tested. → **Yes**
- Is there solar, a battery or a generator at the property? → **No**
- Are the cables, connections and fittings in the ceiling safe to work around and cover with insulation? → **Yes**
- Are there any downlights or other recessed lights in the ceiling? → **Yes**
- How many are there? → **8**
- Are any of them not IC or IC-4 rated? → **No**
- Are there any appliances, exhaust fans or flues in the ceiling space? → **Yes**
- What is it and where is it? → **Bathroom exhaust fan, ceiling above the main bathroom**
- Photo of it → **1 photo**
- Can insulation be safely installed around it as it is? → **Yes**
- Is any electrical repair work needed before insulation can be installed? → **No**
- Electrician licence number → **A 54321**
- Electrician full name → **Sam Spark**
- Electrical contractor (REC) business name → **Spark Electrical Pty Ltd**
- REC registration number → **REC 23456**
- Electrician phone → **0400 111 222**
- I declare that all information contained in and attached to this form is correct and not misleading by inclusion or omission → **Yes**
- Electrician signature → **signature captured in Mitti**

Word form: the filler reports 45 items placed; not placed: `b1`. Read back from the filled Word file:

- Yes/No questions answered Yes: 19 — "Yes" boxes ticked on the Word form: 16.
- Yes/No questions answered No: 6 — "No" boxes ticked on the Word form: 0.
- B1 outcome answered: one option — B1 boxes ticked on the Word form: 0.
- B2 repair items answered: 0 — B2 boxes ticked on the Word form: 0.
- Declaration ticks answered: 5 — declaration boxes ticked on the Word form: 5.
- 21 tick marks were written as a run inside another run (`<w:r><w:r>`) — not valid Word XML; LibreOffice opens it, Word may report unreadable content.

Flagged by the expansion (`expanded.flagged`): none

Printed-rule blockers (`evaluatePiesa`): 
- `REQ:o.signature` Required: "Signature".

## Case 2 — Life support (medical plan) + solar + 4 non-IC downlights; repairs needed, then done on the A5 fixes form with a CoES

Job HV-SAMPLE-2, 7 Banksia Court, Frankston VIC 3199. Inspection 2026-10-28. Owner Robert Ellis confirmed on the secure link (2026-10-28T20:15:00+11:00). A5 fixes form completed 2026-11-03, CoES CES 7781234.

Files: `case-2-life-support-fixes.docx`, `case-2-life-support-fixes-word.pdf` (8 pages: `case-2-life-support-fixes-word-1.png`, `case-2-life-support-fixes-word-2.png`, `case-2-life-support-fixes-word-3.png`, `case-2-life-support-fixes-word-4.png`, `case-2-life-support-fixes-word-5.png`, `case-2-life-support-fixes-word-6.png`, `case-2-life-support-fixes-word-7.png`, `case-2-life-support-fixes-word-8.png`), `case-2-life-support-fixes.pdf` (6 pages: `case-2-life-support-fixes-pdf-1.png`, `case-2-life-support-fixes-pdf-2.png`, `case-2-life-support-fixes-pdf-3.png`, `case-2-life-support-fixes-pdf-4.png`, `case-2-life-support-fixes-pdf-5.png`, `case-2-life-support-fixes-pdf-6.png`).

A4 answers given:

- Job Reference ID → **HV-SAMPLE-2**
- Address including postcode → **7 Banksia Court, Frankston VIC 3199**
- Whose customer is this? → **Home Insulation Victoria**
- I will not discuss any prices with the owner. Home Insulation Victoria sends the owner all prices. → **Yes**
- Date of inspection → **2026-10-28**
- Office life support record → **Yes (owner said yes on the website)**
- Is there life support equipment at the property? → **Yes**
- Have you received written consent or a medical plan? Please attach a photo of it. → **Yes – received Medical Plan**
- Written consent or medical plan (kept as an attachment to this assessment) → **1 photo**
- Is the mains power set-up safe? This means the mains cable in the ceiling is identified and marked, the main switch works and can be locked off, the ceiling is confirmed dead when the switch is off, and safety switches (RCDs) are fitted and tested. → **No**
- Please tick each item that is not right. → **Safety switches (RCDs) are missing for the circuits in the ceiling area., The safety switches (RCDs) have not been tested.**
- Is there solar, a battery or a generator at the property? → **Yes**
- Can it be safely shut down, and are its cables in the ceiling labelled, in conduit and protected? → **Yes**
- Are the cables, connections and fittings in the ceiling safe to work around and cover with insulation? → **Yes**
- Are there any downlights or other recessed lights in the ceiling? → **Yes**
- How many are there? → **4**
- Are any of them not IC or IC-4 rated? → **Yes**
- How many are not IC or IC-4 rated? → **4**
- Are there any appliances, exhaust fans or flues in the ceiling space? → **No**
- Is any electrical repair work needed before insulation can be installed? → **Yes**
- Please tick the repair work that is required. → **Prohibited luminaires (e.g. CA-class luminaires, non-IC luminaires, or ‘do-not-cover’ light fittings) are present and need to be replaced with IC and/or IC4 rated LED lights., Residual Current Devices (RCDs) need to be installed for circuit/s within the ceiling insulation area, as per the most current version of AS/NZS 3000**
- Your total price for all the repair work, including GST → **1180**
- What will you do? Tick everything included in your price. → **Replace downlights with IC-4 rated LED downlights, Install RCD safety switches**
- How many downlights are you replacing? → **4**
- How many RCD safety switches are you installing? → **1**
- Electrician licence number → **A 54321**
- Electrician full name → **Sam Spark**
- Electrical contractor (REC) business name → **Spark Electrical Pty Ltd**
- REC registration number → **REC 23456**
- Electrician phone → **0400 111 222**
- I declare that all information contained in and attached to this form is correct and not misleading by inclusion or omission → **Yes**
- Electrician signature → **signature captured in Mitti**

A5 fixes form: completed Yes, CoES number, date of certification, CoES file, geotagged work photo, signature — merged with `mergeFixesIntoPiesaSnapshot`.

Word form: the filler reports 60 items placed; not placed: `lifeSupportAttachment`, `b1`, `b2`. Read back from the filled Word file:

- Yes/No questions answered Yes: 23 — "Yes" boxes ticked on the Word form: 20.
- Yes/No questions answered No: 5 — "No" boxes ticked on the Word form: 0.
- B1 outcome answered: one option — B1 boxes ticked on the Word form: 0.
- B2 repair items answered: 1 — B2 boxes ticked on the Word form: 0.
- Declaration ticks answered: 12 — declaration boxes ticked on the Word form: 11.
- 33 tick marks were written as a run inside another run (`<w:r><w:r>`) — not valid Word XML; LibreOffice opens it, Word may report unreadable content.

Flagged by the expansion (`expanded.flagged`): none

Printed-rule blockers (`evaluatePiesa`): 
- `REQ:c.signature` Required: "Signature".
- `REQ:o.signature` Required: "Signature".

Next actions:
- `B1-SECTION-C` "Section C of this document must be completed before ceiling insulation work may commence."

Before the A5 fixes form (the PIESA as first synced) — flags:
- Section C: electrical fixes completion not confirmed — Section C stays incomplete.
- Section C: Certificate of Electrical Safety number missing.
- Section C: certification date missing.

…and blockers:
- `REQ:c.licence` Required: "Licence no:".
- `REQ:c.name` Required: "Full Name:".
- `REQ:c.recName` Required: "Name:".
- `REQ:c.recNo` Required: "REC registration no:".
- `REQ:c.phone` Required: "Telephone no:".
- `REQ:c.tick1` Required: "I confirm all identified rectification works have been completed in accordance with the requirements detailed in the Observations, Conditions and Required Rectifications section of this pre-installation electrical safety check assessment." must be ticked.
- `REQ:c.tick2` Required: "I confirm that all luminaires present in the ceiling area are IC and/or IC-4 rated (i.e. classified and marked)." must be ticked.
- `REQ:c.tick3` Required: "I confirm that all mains connected cables in the ceiling space are appropriately protected by an RCD where required, as per the most current version of AS/NZS 3000." must be ticked.
- `REQ:c.tick4` Required: "I confirm that all mains connected cables in the ceiling space are thermoplastic insulated and sheathed (TPS) or an equivalent cable type as per the most current version of AS/NZS 3000." must be ticked.
- `REQ:c.tick5` Required: "I confirm that all mains connected cables in the ceiling space meet Basic Protection Requirements, as per the most current version of AS/NZS 3000." must be ticked.
- `REQ:c.tick6` Required: "I confirm that an electrical safety assessment has been completed and the ceiling space is either: free from electrical hazards; or the remaining electrical hazards and required controls have been documented and provided to the insulation installer to implement; so that the installation of insulation can proceed safely." must be ticked.
- `REQ:c.tick7` Required: "I declare that all information contained in and attached to this form is correct and not misleading by inclusion or omission" must be ticked.
- `REQ:c.signature` Required: "Signature".
- `REQ:c.completionDate` Required: "Date of completion:".
- `REQ:c.coes` Required: "Certificate of Electrical Safety number (required for any electrical works completed):".
- `REQ:c.certDate` Required: "Date of Certification:".
- `REQ:o.signature` Required: "Signature".

## Case 3 — Repair needed where the only tick is "Be on site at the start of the install day" (electrician present at installation)

Job HV-SAMPLE-3, 22 Ironbark Road, Bendigo VIC 3550. Inspection 2026-10-29. Owner Priya Shah confirmed on the secure link (2026-10-30T08:05:00+11:00).

Files: `case-3-electrician-at-start.docx`, `case-3-electrician-at-start-word.pdf` (8 pages: `case-3-electrician-at-start-word-1.png`, `case-3-electrician-at-start-word-2.png`, `case-3-electrician-at-start-word-3.png`, `case-3-electrician-at-start-word-4.png`, `case-3-electrician-at-start-word-5.png`, `case-3-electrician-at-start-word-6.png`, `case-3-electrician-at-start-word-7.png`, `case-3-electrician-at-start-word-8.png`), `case-3-electrician-at-start.pdf` (6 pages: `case-3-electrician-at-start-pdf-1.png`, `case-3-electrician-at-start-pdf-2.png`, `case-3-electrician-at-start-pdf-3.png`, `case-3-electrician-at-start-pdf-4.png`, `case-3-electrician-at-start-pdf-5.png`, `case-3-electrician-at-start-pdf-6.png`).

A4 answers given:

- Job Reference ID → **HV-SAMPLE-3**
- Address including postcode → **22 Ironbark Road, Bendigo VIC 3550**
- Whose customer is this? → **Home Insulation Victoria**
- I will not discuss any prices with the owner. Home Insulation Victoria sends the owner all prices. → **Yes**
- Date of inspection → **2026-10-29**
- Office life support record → **No (owner said no on the website)**
- Is there life support equipment at the property? → **No**
- Is the mains power set-up safe? This means the mains cable in the ceiling is identified and marked, the main switch works and can be locked off, the ceiling is confirmed dead when the switch is off, and safety switches (RCDs) are fitted and tested. → **No**
- Please tick each item that is not right. → **The main switch cannot be secured in the off position.**
- Is there solar, a battery or a generator at the property? → **No**
- Are the cables, connections and fittings in the ceiling safe to work around and cover with insulation? → **Yes**
- Are there any downlights or other recessed lights in the ceiling? → **No**
- Are there any appliances, exhaust fans or flues in the ceiling space? → **No**
- Is any electrical repair work needed before insulation can be installed? → **Yes**
- Please tick the repair work that is required. → **Other (indicate below):**
- Please describe the other repair work. → **Old main switch cannot be locked off. Electrician to attend at the start of the install day to isolate the mains, lock out and tag.**
- Your total price for all the repair work, including GST → **220**
- What will you do? Tick everything included in your price. → **Be on site at the start of the install day**
- Electrician licence number → **A 54321**
- Electrician full name → **Sam Spark**
- Electrical contractor (REC) business name → **Spark Electrical Pty Ltd**
- REC registration number → **REC 23456**
- Electrician phone → **0400 111 222**
- I declare that all information contained in and attached to this form is correct and not misleading by inclusion or omission → **Yes**
- Electrician signature → **signature captured in Mitti**

Word form: the filler reports 38 items placed; not placed: `b1`. Read back from the filled Word file:

- Yes/No questions answered Yes: 13 — "Yes" boxes ticked on the Word form: 11.
- Yes/No questions answered No: 10 — "No" boxes ticked on the Word form: 0.
- B1 outcome answered: one option — B1 boxes ticked on the Word form: 0.
- B2 repair items answered: 0 — B2 boxes ticked on the Word form: 0.
- Declaration ticks answered: 5 — declaration boxes ticked on the Word form: 5.
- 17 tick marks were written as a run inside another run (`<w:r><w:r>`) — not valid Word XML; LibreOffice opens it, Word may report unreadable content.

Flagged by the expansion (`expanded.flagged`): none

Printed-rule blockers (`evaluatePiesa`): 
- `REQ:o.signature` Required: "Signature".

Next actions:
- `B1-ELECTRICIAN-AT-START` "Selection of this option requires an electrician to be present at the start of the installation to isolate the main and/or alternative power supply, lock out and tag, and confirm that the work area is electrically safe for anyone entering the roof cavity."

