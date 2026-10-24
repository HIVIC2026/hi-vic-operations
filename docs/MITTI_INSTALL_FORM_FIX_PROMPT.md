# Install day form (A3): the one rebuild prompt (24 Oct 2026, decision 260)

Paste everything below the line into ChatGPT. It describes the finished form, so it is safe to run on the form as it
is now. Quoted labels must be copied exactly; the portal reads them by wording.

---

Rebuild the Mitti template "A3 - PIISA + AP Evidence" so it contains exactly the items below, in this order, with
exactly these labels, and nothing else. Keep the existing response sets (Yes/No, Yes/No/N/A, the product list, the
high-risk work list, the zone count 1/2/3) and the existing logic shapes where they match. Anything in the current
form that is not listed here is deleted. `*` = required. "Help:" = help text under the item, never part of the label.
"→ when X" = show only when the answer is X (logic). "Stop line" = a short red text item inside the logic. Then publish.

## Section "Job"
- Text * "Job number"
- Text * "Address"
- Date * "Install date"
- Text * "Accredited person"

## Section "Crew"
- Text * "Installer company"
- Text * "Lead installer name"
- Text * "Lead installer CII number"
- Text "Installer 2 name (blank if none)"
  → when filled:
  - Text * "Installer 2 CII number"
  - Signature * "Installer 2 signature: I have read the safety plan and will follow it"
- Text "Installer 3 name (blank if none)" → same two items with "Installer 3"
- Text "Installer 4 name (blank if none)" → same two items with "Installer 4"

## Section "Safety plan"
- Multiple choice (multiple answers) * "High-risk work on this job (tick all)"
  Answers exactly: "Risk of a person falling more than 2 metres (ladder, manhole, roof, ceiling joists)" /
  "Work on or near energised electrical installations or services (ceiling cables, switchboard, solar/battery)" /
  "Work in or near a confined space" / "Work that may disturb asbestos (home built before 1990, or asbestos suspected)" /
  "Work on or near a roadway or in an area with powered mobile plant" / "None of these apply (explain in the next box)"
  → when "None of these apply (explain in the next box)" is ticked: Text * "None apply: why?"
- Checkbox * "Standard controls are in place (they're on your job page)"
- Text "Anything specific to this house (optional)"
- Media * "Photo: each installer at the front door with ID"   Help: "One photo per installer, geotagged."
- Media * "Photo: power isolated, lock-out tag on switchboard"   Help: "Solar and battery isolators off too, where fitted. Geotagged."

## Section "Household"
- Yes/No * "Household told the power will be off?"   → when No: Stop line "Stop. Tell them first."
- Yes/No * "Anyone on life support?"
  → when Yes:
  - Yes/No * "Written consent or medical plan received?"   → when No: Stop line "Stop."
  - Media * "Upload the consent or medical plan"   Help: "Every page readable."

## Section "Safe to start"
- Yes/No * "Safety plan done, all risks identified?"   → when No: Stop line "Stop."
- Yes/No * "All common hazards controlled in the safety plan?"   → when No: Stop line "Stop."
- Yes/No * "Power isolated, locked, tagged, ceiling safe to enter?"   → when No: Stop line "Stop."

## Section "Solar, battery, generator"
- Yes/No * "Any solar, battery or generator?"
  → when Yes:
  - Yes/No * "Shutdown and restart instructions available?"   → when No: Stop line "Stop. Electrician must isolate."
  - Yes/No * "Ground-level isolator works and is safe?"   → when No: Stop line "Stop. Electrician to check."

## Section "Electrical check (PIESA)"
- Yes/No * "Read the PIESA, safe to start?"   → when No: Stop line "Stop."
- Yes/No/N/A * "Electrician needed at start attended?"   Help: "N/A only if the PIESA doesn't require one."
  → when Yes: Media * "Photo: electrician at the front door with ID"   Help: "Geotagged."
  → when No: Stop line "Stop."
- Yes/No * "Recessed lights in the ceiling?"   → when Yes: Text * "How many?"
- Yes/No * "PIESA: all lights IC or IC-4?"   → when No: Stop line "Stop."
- Yes/No * "PIESA: lights safe to cover?"   → when No: Stop line "Stop."
- Yes/No * "PIESA: cables RCD protected?"   → when No: Stop line "Stop."
- Yes/No * "PIESA: cables TPS or equivalent?"   → when No: Stop line "Stop."
- Yes/No * "PIESA: cables meet basic protection?"   → when No: Stop line "Stop."
- Yes/No * "Nobody in the ceiling since the PIESA?"   → when No: Stop line "Stop. Electrician to reassess."

## Section "Existing insulation"
- Yes/No * "Existing insulation in the ceiling?"
  → when Yes:
  - Text * "Average depth (mm)"
  - Text "R-value if known"
  - Single choice * "Remove, top up or both?"  Answers: "Remove" / "Top up" / "Both"
    → when "Top up": Text * "Why keep it?"
  - Yes/No * "Suitable to lay over?"   → when No: Stop line "Stop. Remove it first."
  - Yes/No * "Foil, metallic or conductive?"   → when Yes: Media * "Photo of the facing"   Help: "Geotagged."

## Section "Product"
- Media * "Photo: product packaging showing brand, model, R-value"   Help: "One per product, geotagged."

## Section "Declaration (before work starts)"
- Keep the three existing declaration text items exactly as they are now (the one starting "INSTALLER DECLARATION – Sign BEFORE insulation work starts.", the one starting "d. I will ensure that:", and the "Privacy Collection Statement").
- Checkbox * "All information is correct"
- Signature * "Signature"
- Text item: "Signing doesn't finish the form. After the install, do Zones and Sign-off."

## Section "Zones (after install)"
- Single choice * "How many zones?"  Answers: "1" / "2" / "3"
  → when 1, 2 or 3: Zone 1 items; → when 2 or 3: Zone 2 items; → when 3: Zone 3 items. For zone N:
  - Text * "Zone N name (same as the Ready Check)"
  - Yes/No * "Zone N: existing insulation here?"   → when Yes: Media * "Zone N: photo with ruler showing depth"   Help: "Ruler vertical; show any brand, model or R-value markings. Geotagged."
  - Media * "Zone N: before video"   Help: "360°, lit, say the zone name. Under 250 MB. Geotagged."
  - Multiple choice (single answer) * "Zone N: product installed"   (keep the existing product list)
  - Text * "Zone N: m² installed"
  - Media * "Zone N: after video"   Help: "360°, lit, say the zone name. Show full coverage, no waste left. Under 250 MB. Geotagged."
  - Media * "Zone N: after photo with ruler showing depth"   Help: "Ruler vertical, not compressed. Geotagged."
- Yes/No * "More than one day?"
  → when Yes: Checkbox * "I re-checked every item before starting each day"

## Section "Sign-off"
- Yes/No * "Lock-out removed, power back on?"
  → when Yes:
  - Text * "Who did it?"   Help: "Name and role: who applied the lock, or the attending electrician."
  - Media * "Photo: switchboard, main switch on"   Help: "Lock-out tag removed. Geotagged."
- Single choice * "Solar, battery or generator restarted?"  Answers: "Yes" / "No" / "None here"
- Checkbox * "I was on site the whole time and supervised every installer"
- Signature * "Signature"

Publish.
