# Official PIESA mapping samples (piesa-map-2.0.0) — for Jo's approval

SAMPLES ONLY. The mapping is **not approved** (`OFFICIAL_TEMPLATES.piesa.approved = false`), so the portal produces no official PIESA yet. These files were made by `bun scripts/render-piesa-mapping-samples.ts` with the portal's own pure steps (A4 answers → `shortAnswersFromEntries` → A5 merge → `expandPiesa` with the owner's secure-link confirmations (safety check, decision 296; electrical fixes, decision 330) → `evaluatePiesa` → Word form fill / PDF), skipping only the approval check. Nothing was stored or sent. Names, numbers and addresses are made up.

Form: VEU pre-installation electrical safety assessment form (© DEECA March 2026), original `docs/official-forms/VEU-pre-installation-electrical-safety-assessment-form_1.docx`, SHA-256 `2a89d21c1f2c8fef916954d070449bd3175590d90b9a514d4a8d7625f3a299ac`.

For each case:

- `*.docx` — the official DEECA Word form filled by the portal (what the office downloads). `*-word.pdf` + `*-word-N.png` — that Word file printed by LibreOffice, so you can look at it without Word.
- `*.pdf` + `*-pdf-N.png` — the PDF the portal attaches to the electrician's email / /field download (decision 317): the same answers as plain text in the form's order.

## What decision 329 fixed (wrong on f001aeba, 25 Oct 2026; re-checked against the Word file on every run)

Each case below reads the filled Word file back (`readOfficialDocx`) and compares EVERY box and text field with the answers; the run stops if the Word XML is not well-formed. Before → after:

1. **Multi-select ticks.** Before: Mitti joins ticks with ", " but `expandPiesa` split on " | ", so two ticks were lost (case 2: both RCD questions said **Yes**) and B2 became one combined entry no box matched. After: ticks are matched against the known option wording, longest first (`splitSelections`, official-forms.core) — never comma-split, because the option labels contain commas; an unknown piece is flagged, never guessed. Case 2: RCDs present **No**, RCDs tested **No**, two B2 boxes ticked. Same for the solar, ceiling and B2 lists.
2. **Owner declarations.** Before: the ONE secure-link tick filled all four owner declarations, including "any electrical rectification works were completed on the above date" before the fixes were done. After: the P6 tick fills declarations 1, 2 and 4; declaration 3 is ticked only when no repair work was needed before installation, when the owner confirmed on/after the fixes were certified, or from the owner's post-fix confirmation (decision 330: one tick "The electrical fixes were completed on <date>" + typed name on the same secure link, asked when the A5 form is complete). Without it, declaration 3 stays blank and the expansion flags "Owner hasn't confirmed the electrical fixes" (nothing else is held). `o.name` / `o.date` = the latest owner confirmation used.
3. **Signatures.** Before: `c.signature` / `o.signature` were never written, so `evaluatePiesa` reported `REQ:o.signature` (and `REQ:c.signature`) on every PIESA. After: the typed electronic signature "Name (signed electronically on DD/MM/YYYY)" — the A5 signer + the A5 signature date for Section C, the owner's typed name + confirmation date for the owner block. Neither REQ appears any more.
4. **"No" boxes.** Before: a space run sits between the No box and the word "No"; the filler read only the first run, so no "No" was ever ticked. After: each box's own following text is read across space/tab runs.
5. **B1 / B2 / declaration boxes.** Before: a tab run between the box and its wording — never ticked. After: ticked (see each case).
6. **Main switch.** Before: "Is the main switch for the premises:" has no box on the Word form, so it and its three sub-items all landed on the first sub-row. After: each item claims its own Yes/No pair; the overall main-switch line is derived and stays in the signed record / PDF only (the Word form has nothing to tick).
7. **Part 7 table.** Before: Appliance, Location and Hazard all wrote into the first cell. After: rows × columns in order — each in its own cell (case 1).
8. **Section C declaration.** Before: the original box carries `w:checked="0"`, the filler only changed `w:default`, so `c.tick7` never showed. After: every box is set through both `w:default` and `w:checked`.
9. **Invalid Word XML.** Before: each tick was a run inside another run (`<w:r><w:r>`). After: no glyph run is inserted at all (the box state carries the tick); the filled XML is checked for balanced tags / no nested runs (and `xmllint` where installed).
10. **Plain-text PDF.** Before: every non-ASCII character became "-" ("don-t"), colons doubled ("Licence no::"), and every empty table row printed. After: characters the PDF font can draw are kept (’ “ ” – — • ²), others map to the closest plain text (✓ → [x]); no second colon; empty table rows are skipped and answered rows carry their row number.

The same Word filler fills the approved PIISA: it had the same No / tick / nested-run faults. See `docs/templates/compliance/piisa-filler/` for one realistic install filled through the fixed filler.

## Decisions 336 and 338 (Jo 25 Oct 2026)

1. **"WHERE IS THE ELECTRICIAN'S SIGNATURE?"** The Word form now shows the electrician's ACTUAL signature picture captured in Mitti: the A4 "Electrician signature" straight after the Part B3 declaration (the official form prints no B3 signature box, so it sits in its own line there), and the A5 "Electrician signature" in the Section C "Signature" box — each with "Signed in Mitti on DD/MM/YYYY" under it. The picture is a real inline image (its own media part, an image relationship and the content type; the XML is checked well-formed). The PDF draws the same pictures. The samples use a made-up signature picture (`scripts/sample-signature-png.ts`). Owner blocks stay typed e-signatures (secure link). No image on file → the typed name and the office flag "Electrician signature image not available".
2. **Exact hazard rows.** The A4 block asks "What type is it?" (Appliance / Exhaust fan / Flue / Other hazard), "What is it?", "Where is it?", the photo, "Can insulation be safely installed around it as it is?", and when No "What is the problem?" + "What needs to be done to make it safe?". Part 7 is filled row by row from those answers (case 1: an exhaust fan; case 2: a flue and a rotten joist as an "other hazard"). Older forms keep the old standard wording.
3. **On site at the start (decision 338).** "Be on site at the start of the install day" left the tick list and is its own Yes/No question, "Does an electrician need to be on site at the start of the install?" (case 3 = Yes, nothing ticked). Old forms with the tick read the same way.

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
| `p2.switch` Is the main switch for the premises: | Derived: No if any of the three main-switch sub-items is No (the Word form has NO box for this line — kept in the signed record and the PDF, not written on the Word form) | Yes | Yes | No |
| `p2.switchAccessible` accessible and operational | A4 mains Yes/No + tick "The main switch is not accessible or does not work." | Yes | Yes | Yes |
| `p2.switchIsolates` able to isolate all cables running through the ceiling space safely (excluding t… | A4 mains Yes/No + tick "The main switch cannot isolate all of the cables in the ceiling space safely." | Yes | Yes | Yes |
| `p2.switchSecured` able to be secured in the off position | A4 mains Yes/No + tick "The main switch cannot be secured in the off position." | Yes | Yes | No |
| `p2.tested` Has testing been carried out to ensure all cables and equipment within the ceili… | A4 mains Yes/No + tick "Testing has not confirmed that the ceiling is dead when the main switch is off." | Yes | Yes | Yes |
| `p2.rcdPresent` Are Residual Current Devices (RCDs) (safety switches) present for circuit/s with… | A4 mains Yes/No + tick "Safety switches (RCDs) are missing for the circuits in the ceiling area." | Yes | No | Yes |
| `p2.rcdTested` Have all RCD’s been tested for operation? | A4 mains Yes/No + tick "The safety switches (RCDs) have not been tested." | Yes | No | Yes |
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
| `p7.appliances` Are there any electrical appliances present in the ceiling space (e.g. water hea… | A4 "Are there any appliances, exhaust fans, flues or other hazards in the ceiling space?" + a row with "What type is it?" = Appliance (decision 336) | No | No | No |
| `p7.flues` Are there any exhaust fans or heating flues that vent into or through the ceilin… | A4 "Are there any appliances, exhaust fans, flues or other hazards in the ceiling space?" + a row with "What type is it?" = Flue or Exhaust fan (the official question names "exhaust fans or heating flues") | Yes | Yes | No |
| `p7.appliance` Appliance | A4 "What is it?" (one row per Appliance / Exhaust fan / Flue item) | Bathroom exhaust fan | Gas heater flue | _blank_ |
| `p7.location` Location | A4 "Where is it?" | Ceiling above the main bathroom | Ceiling above the lounge | _blank_ |
| `p7.hazard` Hazard | A4 "What is the problem?" (only when "Can insulation be safely installed around it as it is?" = No), else "None — safe to insulate around" | None — safe to insulate around | The flue has no guard — insulation would touch the hot flue | _blank_ |
| `p7.actions` If a hazard was identified, what actions were undertaken, or should be undertake… | A4 "What needs to be done to make it safe?" for each unsafe item ("None required" when all are safe) | None required | Gas heater flue: Fit a flue guard keeping insulation 50 mm clear before insulation goes in | _blank_ |
| `p7.effective` Does this action effectively reduce the risk associated with the identified haza… | Derived: Yes when every item is safe as it is, or once repairs are recorded complete | Yes | Yes | _blank_ |
| `p7.otherHazard` Other electrical or other hazards identified in the ceiling space (e.g. rotten j… | A4 Other hazard rows: "What is it?" (Where is it?): "What is the problem?" | _blank_ | Rotten ceiling joist (Hallway, next to the manhole): The joist is soft and cracked and won't take a person's weight | _blank_ |
| `p7.otherAction` Action taken, or should be taken, to mitigate against hazard prior to insulation… | A4 Other hazard rows: "What needs to be done to make it safe?" ("None required" when safe as it is) | _blank_ | Builder to replace the joist before insulation goes in | _blank_ |
| `b1` Check ONE option only | A4 "Is any electrical repair work needed before insulation can be installed?" + "Does an electrician need to be on site at the start of the install?" (decision 338; old forms: the "Be on site at the start of the install day" tick, decision 314) | Electrical rectification work is not required before insulation is installed or upgraded. | Electrical rectification work is required before insulation is installed or upgraded. | Electrical rectification work is not possible prior to insulation being installed or upgraded under parts 2 and 3 |
| `b2` The following electrical work is required before insulation is installed or upgr… | A4 "Please tick the repair work that is required." (only when B1 = rectification required) | _blank_ | Prohibited luminaires (e.g. CA-class luminaires, non-IC luminaires, or ‘do-not-cover’ light fittings) are present and need to be replaced with IC and/or IC4 rated LED lights. / Residual Current Devices (RCDs) need to be installed for circuit/s within the ceiling insulation area, as per the most current version of AS/NZS 3000 | _blank_ |
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
| `c.signature` Signature | Decision 336: the A5 "Electrician signature" IMAGE in the box with "Signed in Mitti on DD/MM/YYYY" under it (no image on file → the typed "Name (signed electronically on DD/MM/YYYY)" + flag "Electrician signature image not available") | _blank_ | Sam Spark (signed electronically on 03/11/2026) | _blank_ |
| `c.completionDate` Date of completion: | "today" of the regeneration = A5 "Date of certification" | _blank_ | 2026-11-03 | _blank_ |
| `c.coes` Certificate of Electrical Safety number (required for any electrical works compl… | A5 "Certificate of Electrical Safety number" | _blank_ | CES 7781234 | _blank_ |
| `c.certDate` Date of Certification: | A5 "Date of certification" | _blank_ | 2026-11-03 | _blank_ |
| `o.tick1` I acknowledge that access to the ceiling space between now and the installation … | Owner's secure-link confirmation of the safety check (ONE tick "The assessment was completed on <date>") | ticked | ticked | ticked |
| `o.tick2` I confirm that the electrical safety assessment works were completed on the abov… | Owner's secure-link confirmation of the safety check (ONE tick "The assessment was completed on <date>") | ticked | ticked | ticked |
| `o.tick3` I confirm that any electrical rectification works were completed on the above da… | Ticked only when no repair work was needed before installation, when the owner confirmed on/after the fixes were certified, or from the owner's post-fix confirmation (decision 330); otherwise blank + flagged "Owner hasn't confirmed the electrical fixes" | ticked | ticked | ticked |
| `o.tick4` I understand that information contained within this form will be provided to the… | Owner's secure-link confirmation of the safety check (ONE tick "The assessment was completed on <date>") | ticked | ticked | ticked |
| `o.signature` Signature | Typed electronic signature: the owner's typed name on the latest secure-link confirmation + that date | Helen Nguyen (signed electronically on 27/10/2026) | Robert Ellis (signed electronically on 04/11/2026) | Priya Shah (signed electronically on 30/10/2026) |
| `o.name` Name: | Latest owner secure-link confirmation (safety check, or the electrical fixes — decision 330): typed full name | Helen Nguyen | Robert Ellis | Priya Shah |
| `o.date` Date: | Latest owner secure-link confirmation: Melbourne date they confirmed | 2026-10-27 | 2026-11-04 | 2026-10-30 |

## Case 1 — All clear — no life support, no repairs

Job HV-SAMPLE-1, 14 Wattle Street, Bentleigh VIC 3204. Inspection 2026-10-27. Owner Helen Nguyen confirmed on the secure link (2026-10-27T19:40:00+11:00).

Files: `case-1-all-clear.docx`, `case-1-all-clear-word.pdf` (9 pages: `case-1-all-clear-word-1.png`, `case-1-all-clear-word-2.png`, `case-1-all-clear-word-3.png`, `case-1-all-clear-word-4.png`, `case-1-all-clear-word-5.png`, `case-1-all-clear-word-6.png`, `case-1-all-clear-word-7.png`, `case-1-all-clear-word-8.png`, `case-1-all-clear-word-9.png`), `case-1-all-clear.pdf` (5 pages: `case-1-all-clear-pdf-1.png`, `case-1-all-clear-pdf-2.png`, `case-1-all-clear-pdf-3.png`, `case-1-all-clear-pdf-4.png`, `case-1-all-clear-pdf-5.png`).

A4 answers given:

- Job Reference ID → **HV-SAMPLE-1**
- Address including postcode → **14 Wattle Street, Bentleigh VIC 3204**
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
- Are there any appliances, exhaust fans, flues or other hazards in the ceiling space? → **Yes**
- What type is it? → **Exhaust fan**
- What is it? → **Bathroom exhaust fan**
- Where is it? → **Ceiling above the main bathroom**
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

Word form: the filler reports 46 items placed; not placed: none. Read back from the filled Word file:

- Yes/No: 17 answered Yes — Word form shows 17 ticked "Yes" boxes; 7 answered No — Word form shows 7 ticked "No" boxes.
- B1 outcome: answered — Word form shows "Electrical rectification work is not required before insulat…".
- B2 repair items: 0 answered — Word form shows 0 B2 boxes ticked.
- Declaration ticks: 5 answered — Word form shows 5 ticked.
- Signatures: Part B3 electrician's signature PICTURE (from A4) + "Signed in Mitti on …"; Section C blank; owner "Helen Nguyen (signed electronically on 27/10/2026)" (typed — owners sign on the secure link).
- Part 7 other hazards on the Word form: none; actions line: "None required".
- Part 7 rows on the Word form: Appliance "Bathroom exhaust fan" / Location "Ceiling above the main bathroom" / Hazard "None — safe to insulate around".
- Word XML: well-formed (tags balanced, no run nested in a run, `xmllint` clean).

Word form vs answers: every box and text field matches the answers.

Flagged by the expansion (`expanded.flagged`): none

Printed-rule blockers (`evaluatePiesa`): none

## Case 2 — Life support (medical plan) + solar + 4 non-IC downlights + a flue and a rotten joist; repairs needed, then done on the A5 fixes form with a CoES

Job HV-SAMPLE-2, 7 Banksia Court, Frankston VIC 3199. Inspection 2026-10-28. Owner Robert Ellis confirmed on the secure link (2026-10-28T20:15:00+11:00). A5 fixes form completed 2026-11-03, CoES CES 7781234.

Files: `case-2-life-support-fixes.docx`, `case-2-life-support-fixes-word.pdf` (9 pages: `case-2-life-support-fixes-word-1.png`, `case-2-life-support-fixes-word-2.png`, `case-2-life-support-fixes-word-3.png`, `case-2-life-support-fixes-word-4.png`, `case-2-life-support-fixes-word-5.png`, `case-2-life-support-fixes-word-6.png`, `case-2-life-support-fixes-word-7.png`, `case-2-life-support-fixes-word-8.png`, `case-2-life-support-fixes-word-9.png`), `case-2-life-support-fixes.pdf` (5 pages: `case-2-life-support-fixes-pdf-1.png`, `case-2-life-support-fixes-pdf-2.png`, `case-2-life-support-fixes-pdf-3.png`, `case-2-life-support-fixes-pdf-4.png`, `case-2-life-support-fixes-pdf-5.png`).

A4 answers given:

- Job Reference ID → **HV-SAMPLE-2**
- Address including postcode → **7 Banksia Court, Frankston VIC 3199**
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
- Are there any appliances, exhaust fans, flues or other hazards in the ceiling space? → **Yes**
- What type is it? → **Flue**
- What is it? → **Gas heater flue**
- Where is it? → **Ceiling above the lounge**
- Photo of it → **1 photo**
- Can insulation be safely installed around it as it is? → **No**
- What is the problem? → **The flue has no guard — insulation would touch the hot flue**
- What needs to be done to make it safe? → **Fit a flue guard keeping insulation 50 mm clear before insulation goes in**
- What type is it? → **Other hazard**
- What is it? → **Rotten ceiling joist**
- Where is it? → **Hallway, next to the manhole**
- Photo of it → **1 photo**
- Can insulation be safely installed around it as it is? → **No**
- What is the problem? → **The joist is soft and cracked and won't take a person's weight**
- What needs to be done to make it safe? → **Builder to replace the joist before insulation goes in**
- Is any electrical repair work needed before insulation can be installed? → **Yes**
- Please tick the repair work that is required. → **Prohibited luminaires (e.g. CA-class luminaires, non-IC luminaires, or ‘do-not-cover’ light fittings) are present and need to be replaced with IC and/or IC4 rated LED lights., Residual Current Devices (RCDs) need to be installed for circuit/s within the ceiling insulation area, as per the most current version of AS/NZS 3000**
- Your total price for all the repair work, including GST → **1180**
- What will you do? Tick everything included in your price. → **Replace downlights with IC-4 rated LED downlights, Install RCD safety switches**
- How many downlights are you replacing? → **4**
- How many RCD safety switches are you installing? → **1**
- Does an electrician need to be on site at the start of the install? → **No**
- Electrician licence number → **A 54321**
- Electrician full name → **Sam Spark**
- Electrical contractor (REC) business name → **Spark Electrical Pty Ltd**
- REC registration number → **REC 23456**
- Electrician phone → **0400 111 222**
- I declare that all information contained in and attached to this form is correct and not misleading by inclusion or omission → **Yes**
- Electrician signature → **signature captured in Mitti**

A5 fixes form: completed Yes, CoES number, date of certification, CoES file, geotagged work photo, signature — merged with `mergeFixesIntoPiesaSnapshot`.

Word form: the filler reports 70 items placed; not placed: none. Read back from the filled Word file:

- Yes/No: 22 answered Yes — Word form shows 22 ticked "Yes" boxes; 6 answered No — Word form shows 6 ticked "No" boxes.
- B1 outcome: answered — Word form shows "Electrical rectification work is required before insulation …".
- B2 repair items: 2 answered — Word form shows 2 B2 boxes ticked.
- Declaration ticks: 12 answered — Word form shows 12 ticked.
- Signatures: Part B3 electrician's signature PICTURE (from A4) + "Signed in Mitti on …"; Section C "Signed in Mitti on 03/11/2026" under the A5 signature PICTURE; owner "Robert Ellis (signed electronically on 04/11/2026)" (typed — owners sign on the secure link).
- Part 7 other hazards on the Word form: "Rotten ceiling joist (Hallway, next to the manhole): The joist is soft and cracked and won't take a person's weight" → "Builder to replace the joist before insulation goes in"; actions line: "Gas heater flue: Fit a flue guard keeping insulation 50 mm clear before insulation goes in".
- Part 7 rows on the Word form: Appliance "Gas heater flue" / Location "Ceiling above the lounge" / Hazard "The flue has no guard — insulation would touch the hot flue".
- Word XML: well-formed (tags balanced, no run nested in a run, `xmllint` clean).

Word form vs answers: every box and text field matches the answers.

Flagged by the expansion (`expanded.flagged`): none

Printed-rule blockers (`evaluatePiesa`): none

Next actions:
- `B1-SECTION-C` "Section C of this document must be completed before ceiling insulation work may commence."

Right after the A5 form, before the owner confirms the fixes (decision 330) — flags:
- Owner hasn't confirmed the electrical fixes.
- (owner declaration 3 then: blank; o.date 2026-10-28)

Before the A5 fixes form (the PIESA as first synced) — flags:
- Appliances: work required before insulation — the official "effective" tick waits for the repair work to be recorded complete.
- Section C: electrical fixes completion not confirmed — Section C stays incomplete.
- Section C: Certificate of Electrical Safety number missing.
- Section C: certification date missing.
- Owner hasn't confirmed the electrical fixes.

…and blockers:
- `REQ:p7.effective` Required: "Does this action effectively reduce the risk associated with the identified hazard/s?".
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
- `REQ:o.tick3` Required: "I confirm that any electrical rectification works were completed on the above date." must be ticked.
- `P7-NOT-EFFECTIVE` Hazard remains unresolved - office/electrical review required.

## Case 3 — Repair needed where the only work is "Does an electrician need to be on site at the start of the install?" = Yes (decision 338; electrician present at installation)

Job HV-SAMPLE-3, 22 Ironbark Road, Bendigo VIC 3550. Inspection 2026-10-29. Owner Priya Shah confirmed on the secure link (2026-10-30T08:05:00+11:00).

Files: `case-3-electrician-at-start.docx`, `case-3-electrician-at-start-word.pdf` (9 pages: `case-3-electrician-at-start-word-1.png`, `case-3-electrician-at-start-word-2.png`, `case-3-electrician-at-start-word-3.png`, `case-3-electrician-at-start-word-4.png`, `case-3-electrician-at-start-word-5.png`, `case-3-electrician-at-start-word-6.png`, `case-3-electrician-at-start-word-7.png`, `case-3-electrician-at-start-word-8.png`, `case-3-electrician-at-start-word-9.png`), `case-3-electrician-at-start.pdf` (5 pages: `case-3-electrician-at-start-pdf-1.png`, `case-3-electrician-at-start-pdf-2.png`, `case-3-electrician-at-start-pdf-3.png`, `case-3-electrician-at-start-pdf-4.png`, `case-3-electrician-at-start-pdf-5.png`).

A4 answers given:

- Job Reference ID → **HV-SAMPLE-3**
- Address including postcode → **22 Ironbark Road, Bendigo VIC 3550**
- I will not discuss any prices with the owner. Home Insulation Victoria sends the owner all prices. → **Yes**
- Date of inspection → **2026-10-29**
- Office life support record → **No (owner said no on the website)**
- Is there life support equipment at the property? → **No**
- Is the mains power set-up safe? This means the mains cable in the ceiling is identified and marked, the main switch works and can be locked off, the ceiling is confirmed dead when the switch is off, and safety switches (RCDs) are fitted and tested. → **No**
- Please tick each item that is not right. → **The main switch cannot be secured in the off position.**
- Is there solar, a battery or a generator at the property? → **No**
- Are the cables, connections and fittings in the ceiling safe to work around and cover with insulation? → **Yes**
- Are there any downlights or other recessed lights in the ceiling? → **No**
- Are there any appliances, exhaust fans, flues or other hazards in the ceiling space? → **No**
- Is any electrical repair work needed before insulation can be installed? → **Yes**
- Please tick the repair work that is required. → **Other (indicate below):**
- Please describe the other repair work. → **Old main switch cannot be locked off. Electrician to attend at the start of the install day to isolate the mains, lock out and tag.**
- Your total price for all the repair work, including GST → **220**
- Does an electrician need to be on site at the start of the install? → **Yes**
- Electrician licence number → **A 54321**
- Electrician full name → **Sam Spark**
- Electrical contractor (REC) business name → **Spark Electrical Pty Ltd**
- REC registration number → **REC 23456**
- Electrician phone → **0400 111 222**
- I declare that all information contained in and attached to this form is correct and not misleading by inclusion or omission → **Yes**
- Electrician signature → **signature captured in Mitti**

Word form: the filler reports 39 items placed; not placed: none. Read back from the filled Word file:

- Yes/No: 13 answered Yes — Word form shows 13 ticked "Yes" boxes; 9 answered No — Word form shows 9 ticked "No" boxes.
- B1 outcome: answered — Word form shows "Electrical rectification work is not possible prior to insul…".
- B2 repair items: 0 answered — Word form shows 0 B2 boxes ticked.
- Declaration ticks: 5 answered — Word form shows 5 ticked.
- Signatures: Part B3 electrician's signature PICTURE (from A4) + "Signed in Mitti on …"; Section C blank; owner "Priya Shah (signed electronically on 30/10/2026)" (typed — owners sign on the secure link).
- Part 7 other hazards on the Word form: none; actions line: blank.
- Part 7 rows on the Word form: none.
- Word XML: well-formed (tags balanced, no run nested in a run, `xmllint` clean).

Word form vs answers: every box and text field matches the answers.

Flagged by the expansion (`expanded.flagged`): none

Printed-rule blockers (`evaluatePiesa`): none

Next actions:
- `B1-ELECTRICIAN-AT-START` "Selection of this option requires an electrician to be present at the start of the installation to isolate the main and/or alternative power supply, lock out and tag, and confirm that the work area is electrically safe for anyone entering the roof cavity."

## Still can't be filled from A4

These official items have no matching A4 question, so the portal cannot fill them truthfully. Proposal for each (Jo to decide; nothing changed):

- `p4.tps` N/A — A4 can only say Yes/No. Proposal: add "There are no TPS cables in the ceiling" as a choice so N/A can be ticked.
- B1 third outcome (case 3) — "Does an electrician need to be on site at the start of the install?" = Yes (decision 338) gives B1 "not possible … under parts 2 and 3"; B2 is only for rectification required, so nothing is printed in B2. Proposal: accept (the attendance is recorded and lined up automatically, decision 327).
- `p2.switch` — the Word form prints no box; the derived answer lives only in the signed record and the PDF. Proposal: accept (the form's own note says the overall answer follows the sub-items).
- `lifeSupportAttachment` — the consent / medical plan photo is kept as a job file, not printed on the Word form. Proposal: accept; attach the photo with the PIESA copy.
- The published A4 template (`tests/fixtures/mitti-piesa/a4-published-2026-10-25.json`) still lacks the decision 305/308/312/323 questions, the decision 336 hazard-row questions and the decision 338 on-site question, and asks the retired "Can the repair work be done before installation?". Proposal: republish A4 from the current prompt before approving the mapping.

