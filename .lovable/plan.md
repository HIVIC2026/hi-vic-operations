# Two Mitti forms: installer Ready Check + PIISA, electrician PIESA (required items only)

## Rule
Each form asks only for what the ESC Activity 48 Guide V1.1, the Accreditation Conditions and the VEEC assignment/creation forms require. The only additions are the few items the portal needs to quote and book the job, and each one is marked "portal" below. Nothing optional or nice-to-have is included.

Mitti can't create forms remotely. The portal will produce an exact build sheet for each form, and a form is connected only after its structure passes validation. The current combined draft stays disconnected.

## Form A: Installer Ready Check (free, before PIESA)
Eligibility and measurement only. It includes no safety sign-off.
1. Job number and address (prefilled, portal)
2. Photo of each EEC certified installer at the front of the premises, with photo ID visible (geotagged, timestamped)
3. Building class: Class 1, or a sole-occupancy unit in Class 2 (top-floor/relevant ceiling)
4. Relevant ceiling/roof or extension built in the last 5 years? (Yes/No)
5. For each upgrade area (up to 3), with consistent area names:
   - uninsulated or under-insulated
   - if under-insulated: photo with a vertical ruler showing depth, any brand/R-value marking, and estimated existing R-value (eligible only below R2.0)
   - removal required? Answer against the 3 official criteria (conductive/metallic, unsuitable condition, cannot meet AS3999/manufacturer requirements)
   - measured area in m²
6. 360° video of each area before the upgrade, labelled per area, max 250 MB
7. Diagram/floor plan of the areas, with dimensions and m² (plus elevation photos if there is a balcony, verandah or patio)
8. Do all luminaires appear to be IC/IC-4? (observation only; the electrician confirms)
9. Access/extras that affect the quote: tile lift, metal roof, difficult access (portal)

## Form B: Electrician PIESA (licensed electrician engaged by a REC)
1. Job number and address (prefilled)
2. Electrician name, phone, licence number, company name/address and REC number
3. Photo of the electrician at the front of the premises with photo ID, before the assessment (geotagged, timestamped)
4. Life support: if yes, the written consent/medical plan must be attached before the assessment begins
5. Mains-connected cables in the ceiling space: RCD protected if required, TPS or equivalent, and meet basic protection (each Yes/No)
6. Switchboard cable photo showing TPS, with no infinity/Olsent, lead-sheathed, TRS, cotton-insulated, timber-trunking or split-metal conduit wiring (taken by the electrician)
7. Every luminaire classified and marked IC or IC-4 (Yes/No; No means not eligible until rectified)
8. Can the space above the ceiling be de-energised before works? (Yes/No)
9. Rectification required? If yes, list the items (standard rate items, or "other" for office pricing)
10. Conditions for electrical safety, including whether an electrician must be on site at installation start
11. Downlights replaced before installation? (Yes/No; VEEC creation field)
12. Certificate of Electrical Safety number and description, only if rectification was done
13. Signatures: electrician and property owner, both electronic, with the assessment date (no earlier than 30 days before works)

## Form C: Installer PIISA (install day, lead installer)
Separate short form, completed on the day after the PIESA copy has been received.
1. Lead installer name and EEC certification number
2. Confirm a copy of the signed PIESA is held (the portal blocks this until the PIESA has been sent at least 24h before)
3. Worksite is safe and PIESA conditions will be followed, including whether an electrician is required on site
4. Only IC/IC-4 luminaires in the ceiling area
5. Life support consent/plan held, if applicable
6. SWMS completed (upload)
7. If an electrician is required: photo of the electrician at the front with ID on install day
8. Isolation photo: switchboard tagged and locked out, plus solar and battery isolators off if present
9. Product packaging photo showing brand, model and R-value
10. Daily re-check on each extra day (repeatable)
11. After installation, for each area: 360° video (coverage, no compression, no debris, max 250 MB) and a vertical ruler depth photo
12. Electronic signature and date (must be within 30 days of the PIESA)

## Where the other AP evidence lives (not in Mitti)
These already exist or are tracked in the portal's Compliance section, so the forms won't ask for them again:
- owner consent to share information
- ESC installation notice
- consumer factsheet
- tax invoice fields
- $200 co-payment
- 5-year warranty
- VEEC assignment form (installer, then AP, then owner)
- 6-year record retention

## Portal changes
- Separate settings for the Ready Check, PIESA and PIISA form IDs. The hardcoded PIESA ID is removed.
- Each form's labels, types and choices are validated before use, and a form fails closed if anything is missing, duplicated or the wrong type.
- Answers are routed by role: Ready Check to measurements, PIESA to electrical assessment, PIISA to the installer safety record. No role can write another role's findings.
- Evidence photos/videos are stored against each checklist item in the private job file, and missing items block the matching stage.
- Syncing never completes a gate, passes compliance, advances a job, quotes or sends anything.
- Tests cover each form in full, missing fields, duplicates, wrong role, conditional items and timing (PIESA 30 days, 24h copies, PIISA within 30 days).

## Open item
The fillable DEECA PIESA/PIISA documents couldn't be downloaded automatically because the site blocks it. The checklist above comes from the ESC Guide/Conditions, which set out what those forms must contain. If you download the two official forms and upload them, I'll match the wording exactly. Until then, the forms will be labelled "HI VIC checklist", not the official form.

## Installers bringing their own customers (new pathway)
For an installer who has already quoted their own customer and wants HI VIC as the AP.

**Commercial rules**
- There is no $220 referral fee on these jobs, in either direction. The job is permanently tagged "Installer's own customer".
- The owner pays the installer's quoted price plus the HI VIC AP fee, shown clearly inc GST. HI VIC keeps the AP fee and the VEEC margin, and the owner still gets $70 per VEEC.
- The profit view shows these jobs separately, with no installer markup and no referral fee.

**Streamlined for the installer**
1. The installer uploads their quote, measure-up, photos and customer details in one step; the portal pre-fills a draft job.
2. The installer confirms a short screen. Nothing already provided is asked again.
3. The owner is checked against Gate 1 as normal. Any eligibility fail stops the job here.
4. The installer's measure-up stays provisional until checked. If their photos/evidence meet the Ready Check list, no separate Ready Check visit is needed. Otherwise only the missing items are requested.
5. The PIESA is booked with a HI VIC-approved electrician (or the installer's preferred one, once onboarded).

**Streamlined for the owner**
- One quote showing the installer's price plus the AP fee, the VEU discount and the final cost. All quote-stage documents are signed electronically in a single step.
- Their portal and emails are co-branded with the installer, and HI VIC is clearly identified as the AP.

**Guard kept**
Invoicing for these jobs stays on "Commercial setup required" until you confirm who invoices the owner (HI VIC for the full amount, or the installer). Nothing is charged or sent until then.
