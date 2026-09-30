# Installer-led jobs (main pathway) + the three Mitti forms

## 1. Who does what
```text
Installer  = owns the customer, sells, quotes, installs (lead EEC installer)
Electrician = installer's own REC (onboarded once) OR one of ours - PIESA + rectification
HI VIC (AP) = eligibility, compliance, documents, signatures, ESC notice, VEECs
Owner      = one clear portal, e-signs everything, pays co-payment
```
Pricing: the owner pays the installer's quoted price plus the HI VIC AP fee. There is no referral fee, the owner gets $70 per VEEC, and HI VIC keeps the AP fee and the VEEC margin.

## 2. The journey
```text
A Submit -> B Eligibility -> C Measure-up check -> D Electrician -> E PIESA
-> F Quote + e-sign -> G Pre-install gates -> H Install day (PIISA) -> I Completion sign-off -> J VEECs
```

**A. Installer submits the job (2 minutes)**
- The installer uses a "New customer job" button in their portal. It needs the owner's name, mobile, email and address (autocomplete), and the installer can drop in anything they already have (quote PDF, measure-up, photos, EasyMate export).
- The portal pre-fills a draft. The installer confirms one short screen, and nothing is asked twice.
- The owner gets a co-branded "Your installer has partnered with HI VIC" invite. They answer the same short eligibility questions as the website, give their contact consent, and receive the factsheet. Everything is done on their phone and signed electronically.

**B. Eligibility (automatic, same Gate 1 rules)**
- The check shows ticks and crosses for the property type, age over 5 years, the existing insulation below R2.0, no previous Activity 48 upgrade, and life support.
- If the job fails, the installer sees why straight away and the owner gets the kind "not eligible" email. Nothing more happens.

**C. Measure-up: has it vs doesn't**
| Installer already has... | What happens |
|---|---|
| Measurements, photos, quote meeting the Ready Check list | Accepted as the Ready Check with no extra visit. The portal ticks each item off. |
| Some items | The portal lists only the missing items, e.g. "ruler depth photo, area 2". The installer adds them at the PIESA visit or on install day, before works start. |
| Nothing yet | The installer books their free Ready Check in Mitti Form A. |

Measurements stay provisional until HI VIC accepts them. Aerial-only measurements are never accepted as final.

**D. Electrician: bring one or request one**
- **Installer's own REC:** the installer enters the electrician's email. The electrician gets a one-time onboarding link (licence, REC, insurance, agreement). They can be assigned once approved, and they are remembered for that installer's future jobs.
- **Request HI VIC's:** this is matched by postcode coverage. If nobody covers the area, the installer is told immediately.
- The installer can also say "My sparky, but let HI VIC book it."

**E. PIESA (Mitti Form B)**
- It's booked through the portal chat, with no phone numbers shared. It must be within 30 days before install.
- The outcome is recorded as either no issues or rectification required.
- If rectification is required, the electrician's items are priced from their agreed rates, and "other" items go to the office for pricing.

**F. One quote, one signature**
- The office builds the combined quote from the installer's quote, rectification, the AP fee, the VEU discount and the final owner cost (inc GST, minimum $200).
- The office reviews it, then sends the quote with every quote-stage document in one email: terms, consent to share information, factsheet, Code of Conduct information and warranty terms.
- The owner reviews and e-signs once. Each document is ticked in Compliance when the acceptance comes back.

**G. Pre-install gates (portal enforces, installer sees a checklist)**
- Owner ESC consent at least 24h before, ESC notice between 5 days and 24h before, and PIESA copies to the owner and installer at least 24h before.
- Rectification is completed with a Certificate of Electrical Safety before install.
- Life-support plan, if applicable.
- The install date is blocked until everything is green, and the installer can see exactly what is outstanding.

**H. Install day (Mitti Form C, PIISA)**
- Installer ID photos, isolation, product label, SWMS, and electrician presence if the PIESA requires it.
- A daily re-check on each extra day, then after-install videos and depth photos.

**I. Completion sign-off**
- The portal generates the VEEC assignment form with the final facts. It is e-signed installer → HI VIC → owner, with a copy sent to the owner within 10 business days.
- Tax invoice, warranty and completion documents.
- HI VIC runs the final AP review.

**J. VEECs**
- Lodged, with the owner's $70 per VEEC paid and the margin tracked on the VEECs page.

## 3. What each person sees
- **Installer portal:** my jobs by stage, a big "what's missing" list per job, one-tap uploads, chat with the owner and electrician, and "Add my electrician" or "Request one".
- **Owner portal:** one progress bar (Eligible → Assessment → Quote → Booked → Installed → Done), one "What you need to do now" card, e-sign and documents. Co-branded with the installer, with HI VIC named as the AP.
- **Office:** the same Pipeline with an "Installer-led" tag and a per-job compliance checklist with ticks, crosses and to-be-confirmed items.

## 4. Mitti forms (required items only)
- **A. Ready Check (installer):**
  - installer ID photo at the front of the premises
  - building class and age (over 5 years)
  - for each area: uninsulated/under-insulated, ruler depth photo, existing R-value (below R2.0) and the 3 official removal criteria
  - m² per area and a 360° before video (max 250 MB)
  - floor plan with dimensions
  - IC/IC-4 observation only
  - quote extras (tile lift, metal roof, access)
- **B. PIESA (electrician):**
  - licence and REC details, ID photo at the front of the premises
  - life-support plan attached first
  - cables: RCD / TPS / basic protection
  - switchboard cable photo
  - IC/IC-4 confirmed, can be de-energised
  - rectification items and conditions (electrician on site?), downlights replaced?
  - CoES number and description if rectified
  - e-signed by the electrician and the owner
- **C. PIISA (lead installer):**
  - EEC number, PIESA copy held
  - site safe and PIESA conditions followed, IC/IC-4 only
  - life-support plan held, SWMS uploaded
  - electrician-present photo if required
  - isolation photo, product label photo
  - daily re-check, after-install 360° video and depth photos per area
  - e-signed within 30 days of the PIESA

Anything the Guide requires outside these forms is tracked in Compliance and not asked again: consent, ESC notice, invoice fields, co-payment, warranty, assignment and 6-year retention.

## 5. Technical
- There is a new job flag `installer_led` alongside the permanent `installer_sourced` channel. The profit view shows no referral fee and no installer markup, and the owner price = installer quote + AP fee.
- There is an installer "New customer job" intake that reuses the job-import draft and confirm path. The owner invite link runs the same Gate 1 questions and consent capture.
- There is an evidence-coverage checker that maps uploaded files and imported measure-ups to the Ready Check items. It reports missing items per job, and only HI VIC can accept them.
- Nominating an installer's own electrician reuses the existing REC onboarding and approval. The relationship is remembered in `partner_relationships`.
- There are three role-specific Mitti template IDs in the settings, with the hardcoded ID removed. Structure is validated and fails closed, answers are routed by role, and syncing never completes gates, quotes or sends.
- A quote-stage document bundle has one e-signature and each document is ticked. Later forms (ESC consent, assignment) stay on their own timing.
- Tests cover every branch (full, partial and no evidence, own vs HI VIC electrician, rectification, ineligible) plus timing gates.

## 6. Needs your decision before invoicing goes live
- Who issues the invoice to the owner: HI VIC for the full amount (paying the installer their quote), or the installer? Until you decide, these jobs stay on "Commercial setup required" and nothing is charged.
- Amount of the AP fee for installer-led jobs (currently $349 PIESA/AP fee; confirm whether this also covers the AP role).
- The official DEECA PIESA/PIISA forms (please upload them) so the wording can be matched exactly. Until then the forms will be labelled "HI VIC checklist".
