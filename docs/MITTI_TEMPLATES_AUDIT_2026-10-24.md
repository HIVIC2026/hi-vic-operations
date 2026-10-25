# Mitti templates audit — 24 Oct 2026

> **Form numbers (decision 390, 25 Oct 2026):** this dated audit uses the numbering of the time. Today A3 = Electrical safety check (PIESA), A4 = Electrical fixes, A5 = Install day; this audit's form "A3" is today's A5. Audit item IDs such as A3-1 are unchanged.

Ordered by Jo with decision 206. Read-only audit of the four Mitti templates against what the portal reads and what the regulator records require. No code was changed.

## 1. Scope, sources and limits

**Templates audited**

| Code | Template | Portal definition | Live status |
|---|---|---|---|
| A1 | Ready Check – installer's own customer (`template_01ee…`) | `FORMS.ready_check_priced` (`src/lib/mitti-forms.core.ts`) + readers in `mitti.core.ts`, `ready-check-answers.core.ts`, `ready-check-complete.core.ts` | Live, edited by Jo 23 Oct (published) |
| A2 | Ready Check – our lead (`template_aafa…`) | `FORMS.ready_check` + the same readers | Live |
| A3 | Install day = native PIISA (`template_f6a2597479164eb181453eb335ce5125`) | `src/lib/piisa-a3.core.ts` (stable item IDs) + decision 205 items in `install-evidence.core.ts` (agent worktree, being built) | Live; decision 205 items not yet added in Mitti |
| PIESA | Electrician safety assessment | `SHORT_PIESA_FIELDS` (`official-short.core.ts`) + `PIESA_EVIDENCE` (`piesa-evidence.core.ts`); spec `docs/MITTI_PIESA_FORM_SPEC.md` | Not built; `OFFICIAL_TEMPLATES.piesa.approved: false` |

**Rule sources used:** ESC Ceiling Insulation Activity Guide v1.2 (1 Oct 2026) §2.1, §2.3, §3.3–§3.6, Table 3, §4.2, Table 4, Appendix A (Table 5), Appendix C (Table 11); DEECA PIESA and PIISA March 2026 forms (`official-forms.core.ts`, verbatim, incl. PIISA Table 1); Schedule 4 of the installer agreement (`activity48-agreement-schedule.text.ts`); OHS Regulations 2017 (Vic) regs 327–330 as recalled — the regulation text is **not** in the repo and the ESC/WorkSafe sites are blocked here, so every OHS statement below is marked for legal confirmation; `docs/VEU_COMPLIANCE_CHECKLIST_2026-10-24.md` (incl. the Activity Guide re-check section).

**Limits.** Network to Mitti and Supabase is blocked, so the live template definitions were **not** read. "On the template" below means: the portal's own definition expects it, or a reader accepts its label, or a repo document records that Jo published it (23 Oct). Where the three disagree it is called out, because that is itself a finding: the form-health check (`validateTemplate` / `a3MissingFields`) can only prove questions it knows about.

**Status key:** CAPTURED = on the template and read by the portal · PARTIAL = captured but weaker than the rule (not per zone, no geotag, free text, or only when the installer chooses to) · GAP = nothing on the template captures it · PORTAL = captured elsewhere in the portal (office record, website, PIESA carry-over), not on this template.

---

## 2. Cross-cutting findings (all templates)

1. **The Ready Check definition and the Ready Check readers have drifted apart.** `FORMS.ready_check*` (the validator used by `connectMittiForm` / form health) still requires `Assessor`, the Extras Yes/No trio, `Upgrade area diagram or floor plan` per area and the signature `I confirm this information is accurate`, none of which Jo's 23 Oct forms necessarily carry; and it does **not** know the questions the readers now depend on — `Insulation product` / `What insulation product will you be using on this job?`, `Homeowner agrees to be contacted by Home Insulation Victoria`, `Homeowner email`, `Is there a difficult access charge?`, `Difficult access fee ($ inc GST)`, `What is the determined R value of the existing ceiling insulation?`, `Based on your onsite assessment, does this property meet the Ready Check requirements to proceed?`, `Title address`. Result: a template missing any of those passes validation and the job silently holds with "Needs finishing…". Fix: add them to `READY_CHECK_FIELDS`/`PRICING_FIELDS` (with the live aliases) and mark the retired ones optional.
2. **Nothing on any template captures the SWMS document** (only a Yes/No). Decision 206 answers this — design in §8.
3. **Nothing captures lock-out removal / re-energising** (Guide §3.6; Schedule 4.4). Proposed A3 questions in §5.
4. **Appendix C VEEC-creation facts are partly unrecorded**: premises *type* (public / community / private rental / owner-occupier) is asked nowhere; "were any downlights replaced" is derivable from the PIESA but not asked; per-area scenario 48A(i)/(ii) is derivable once zone under-insulated status is reliable. §9.
5. **Zone naming is free text on both ends** (Ready Check `Where is this area?` → A3 `Zone N — name of this ceiling area`) and is matched by normalised string equality; a single-area job has no recorded name at all (`rcAreasFromRecord` returns a nameless area; `ready-check-areas.core.ts` defaults to "Main ceiling"). Prefill is the fix (§6).
6. **Product brand/model**: the 8 Ready Check options carry brand + R-value; the register *model* comes from `productBrandModel`. The install-day form has only free text (`What insulation products are being installed?…`) and the invoice lines carry the quote description, not "brand – model – R-value – m²" (Guide Table 4 tax invoice). §7.

---

## 3. Template A1 — Ready Check, installer's own customer

### 3.1 Questions the portal reads by label

| Question (exact label / accepted aliases) | Type | Read by | Used for |
|---|---|---|---|
| `Portal Job Number` / `Job Reference ID` | text (prefilled, not mandatory on A1 since 23 Oct) | `PREFILL`, `parseAudit.jobNumber`, `validateStoredMittiAudit` | link check when present |
| `Site address` / `Property Address` / `Address including postcode` | text/location (prefilled, mandatory) | `PREFILL` | — |
| `Title address` | text (prefilled) | `PREFILL` | inspection title |
| `Owner name` / `Homeowner name` | text (prefilled, mandatory) | `PREFILL` | — |
| `Homeowner phone` / `Owner phone` / `Owner mobile` / `Homeowner mobile` | phone | `PREFILL`, `contactAnswersFromEntries.phone` | quote basics (BASIC_MOBILE) |
| `Homeowner email` / `Owner email` | text | `PREFILL`, `contactAnswersFromEntries.email` | quote basics (BASIC_EMAIL) |
| `Homeowner agrees to be contacted by Home Insulation Victoria` | Yes/No | `contactAnswersFromEntries.contactPermission`, `readyCheckStopReasons` (No = hard stop) | BASIC_PERMISSION, consent row (`MITTI_CONSENT_TEXT`) |
| `Life support equipment at property?` (A1) / `Office life support result` (A2) | Yes/No (prefilled from office) | `PREFILL`, `readyCheckStopReasons` (Yes = office stop) | STOP_LIFE_SUPPORT |
| `Property type` [House / Townhouse / Unit or apartment] | choice (prefilled) | `PREFILL` | building class (Class 1 / Class 2 SOU) |
| `Are these details correct?` / `Are the property details provided above correct?`, `What needs correcting?` | choice / text | spec only | office |
| `Roof type` / `What type of roof does the home have?` | choice | `parseAudit` → notes | crew context |
| `How easy is the ceiling access?` / `How would you rate the ceiling access?` | choice | `parseAudit.access_difficulty` | quoting |
| `Photo of the ceiling access point` / `Upload a clear photo of the ceiling access point` | media | `photoGaps.access` | install-day photo lock when missing |
| `How many separate ceiling areas are there?` / `How many ceiling areas need to be measured separately?` | choice | opens repeats | — |
| per area `Where is this area?` / `Which part of the home does this ceiling area cover?` | text | spec; areas record | zone name (Table 4 floor plan) |
| per area `Length (m)`, `Width (m)` or `Enter the measured ceiling area (m²)` | number | `parseAudit.measured_area_m2` | quote basics (BASIC_AREA), VEEC m² |
| per area `Is there existing insulation?` / `…in this ceiling area?` | choice | `parseAudit.insulation_present`, `readyCheckFactsFromEntries` | eligibility, PIISA P6 prefill |
| per area `Insulation type (tick all that apply)` / `What type of existing insulation is installed? Select all that apply` [Batts / Loose fill] | multichoice | `parseAudit` (removal pricing) | removal pricing |
| per area `Depth (mm)` / `What is the measured insulation depth (mm)?` | number | spec (not stored canonically: `rcAreasFromRecord` depth = null) | — |
| per area `What is the determined R value of the existing ceiling insulation?` [Below R2 / Above R2] | choice | `parseAudit`, `readyCheckStopReasons` (Above = STOP_R2), `readyCheckFactsFromEntries.belowR2` | verified eligibility (decision: form-eligible event) |
| per area `Photo with tape measure showing depth` / `Upload a photo clearly showing the measured insulation depth` | media | `photoGaps.depth` | Table 4 R-value photo (carried to install day) |
| per area `No photo? I confirm the existing insulation is below R2.0 and the home is eligible for the rebate` | tick | `readyCheckFactsFromEntries.belowR2Tick` | replaces the depth photo (Jo 8 Oct) |
| per area `What needs to happen to it?` / `What is required for the existing insulation?` [Remove / Top up / Not sure] | choice | `parseAudit.removal_required` | removal pricing, PIISA P6 |
| per area `Area to remove (m2)` / `How much existing insulation needs to be removed? (m²)` | number | `removalTotalM2` | removal pricing |
| per area `Photo of the empty ceiling space` / `Upload an overview photo of this ceiling area` | media | `photoGaps.overview` | install-day photo lock |
| per area `Recessed downlights in this area?` / `Are there recessed downlights in this ceiling area?`, `How many?` / `How many recessed downlights?` | choice / number | `parseAudit` (downlights sum) | PIISA P5 prefill |
| per area `Hazards in this area?` / `Are there any issues that could affect the insulation installation? …` + `Describe them and add a photo` / `Describe the issue and add a photo` | choice / media | `parseAudit.hazards` (office review) | SWMS input |
| per area `How was the ceiling measured?` / `How was this ceiling area measured?`, `Explain the method` / `Tell us how you measured it` | choice / text | `parseAudit` (provenance) | measurement provenance |
| per area `Upgrade area diagram or floor plan` / `Upload your area sketch or floor plan.` | media | spec (Table 4 floor plan) | VEEC floor plan |
| `Was the ceiling or roof built or replaced in the last 5 years?` | choice (prefilled from website on A2) | `PREFILL`, `readyCheckStopReasons` (Yes = STOP_BUILT_5) | eligibility |
| `What insulation product will you be using on this job?` / `Insulation product` [8 options] | choice | `contactAnswersFromEntries.productOption` → `resolveMittiProduct` | quote line, VEEC brand/model (BASIC_PRODUCT) |
| `What's included in your quote?` / `What's included in your price (tick all that apply)` | multichoice | `validateQuotedPrice`, `a1DifficultAccessIncluded` | installer line |
| `What else is included?` | text | `validateQuotedPrice` | — |
| `Total quoted price (inc GST)` | number | `validateQuotedPrice` | installer line (BASIC_PRICE) |
| `Is there a difficult access charge?`, `Difficult access fee ($ inc GST)` | Yes/No / number | `difficultAccessFee` (added 23 Oct) | shown on the owner quote (inside total) |
| `Who is doing the electrical safety check?` [Home Insulation Victoria electrician / My usual electrician / A different electrician] | choice | `contactAnswersFromEntries.electricianChoice` | PIESA line / payer |
| `Electrician name`, `Electrician licence number`, `Electrician price (inc GST)` | text / text / number | `contactAnswersFromEntries` | quote electrician snapshot |
| `Based on your onsite assessment, does this property meet the Ready Check requirements to proceed?` | choice | `parseAudit.rcOutcome` (No = office review) | — |
| `Are any extras needed beyond the standard install and removal?` + description + photos | Yes/No / text / media | spec only (no reader found) | superseded by the difficult-access pair |
| `Anything else the office should know?` | text | optional | office |
| `I confirm this information is accurate` (+ 2 long aliases) | signature | spec | installer confirmation |

### 3.2 Regulator / agreement items that belong on this visit

| Requirement (source) | A1 status | Note |
|---|---|---|
| Premises class — Class 1 or Class 2 SOU (Guide §1.1.1; App. C "Premises class type") | CAPTURED | `Property type` → class. |
| Premises type — public / community / private rental / owner-occupier (App. C) | **GAP** | Asked nowhere in the portal. |
| Not constructed in the last 5 years (Guide §1.1.1) | CAPTURED | |
| Uninsulated vs under-insulated per zone, avg R < 2.0 (Guide glossary; App. C per-area) | PARTIAL | Below/Above R2 choice + optional depth; depth not stored canonically; the "No photo? I confirm…" tick lets a VEEC job go to install with no R-value evidence. Table 4 needs the ruler/brand photo for under-insulated zones; decision 205 adds it on A3, so A1 may stay optional **only if** the A3 item is required when the tick was used (it is: `evaluateInstallEvidence` ignores the tick). |
| Zone names consistent across records + dimensions per zone (Table 4 floor plan) | PARTIAL | Free text; no convention; single area unnamed. |
| Floor plan / diagram with dimensions (Table 4) | CAPTURED (spec) | Not read by any reader; office checks. Confirm it is still on the live A1. |
| IC/IC-4 luminaires (Guide §1.1.1) | PARTIAL (observation) | Count only; the PIESA decides. Fine. |
| Existing insulation removal criteria / owner advised if retained (Guide §3.4.2) | PORTAL | Remove/Top up answer here; the owner advice is in the quote wording — confirm the quote text states "existing insulation will stay, is suitable, meets AS 3999" when Top up. |
| Scope agreed with consumer before upgrade — removal, rectification (Guide §3.5 step 5) | PORTAL | Quote acceptance. |
| Product on the VEU Register at VEEC creation; ≥ R5.0 total (Guide §1.1.2, §3.4.2) | CAPTURED | 8-option list; `declaredProductProblems` (worktree) tests register + date. |
| Owner contact permission (Code of Conduct) | CAPTURED | |
| Installer photo at front of premises with ID (Table 4) | n/a here | Taken on install day (A3). Spec field `Installer photo at front of premises with photo ID` is optional on A1 — fine. |
| Hazards for the SWMS (Guide §2.1) | PARTIAL | Per-area "issues" Yes/No + photo. Useful as SWMS pre-fill (asbestos age, vermin, access) — see §8. |

### 3.3 Gaps — proposed Mitti wording (A1)

| # | Proposed question (exact) | Type | Why |
|---|---|---|---|
| A1-1 | `Who lives at the property?` options: `Owner lives here` / `Private rental – tenant lives here` / `Public housing` / `Community housing` | Pick one, required | App. C "Premises type"; also decides who the energy consumer is (Guide §3.2). Same on A2 (or ask on the website for our leads). |
| A1-2 | Help text on `Where is this area?`: *"Name it the way it will be named on install day and on the floor plan, e.g. Main house, Rear extension, Garage. One name per area."* | help text only | Table 4 "named consistently". |
| A1-3 | `Year the home was built (approximately)` options: `Before 1990` / `1990 or later` / `Not sure` | Pick one, required | Feeds the SWMS asbestos question (pre-1990) and gives the office the 5-year check context. |
| A1-4 | `Is any of the existing insulation foil-backed, metallic or electrically conductive?` Yes / No / Not sure (per area, when existing insulation = Yes) | Pick one | PIISA Part 6 note + `P6-FOIL-UNKNOWN` blocker needs an explicit answer; the earlier the better. |
| A1-5 | Add the reader-only questions to the portal spec (finding 1) so form health can prove they exist | portal | not a Mitti change |

### 3.4 Candidates to remove / retire on A1

- `Assessor` (Jo removed 23 Oct; spec still requires it).
- `Are any extras needed beyond the standard install and removal?` + `Describe each extra…` + `Photos of each extra` — no reader; superseded by `Is there a difficult access charge?` / fee (Jo 23 Oct). Remove from the live form if still present, and drop from `READY_CHECK_FIELDS`.
- `Difficult access` as an option inside `What's included in your quote?` (removed 23 Oct per `INSTALLER_MITTI_WORKFLOW_PLAN.md`; `PRICE_ITEMS` still lists it — keep as legacy alias only).
- `Price already agreed with the owner?` (optional, never gates).
- `Describe the roof type` (A1 never had it; spec `notRequiredIf`).
- Legacy price items `Tile lift`, `Metal sheet access` (parser aliases only — keep in code, never on the form).

---

## 4. Template A2 — Ready Check, our lead

Identical evidence questions to A1 (§3.1 rows up to and including `Insulation product`), **without** the pricing block, electrician choice and difficult-access-inside-total logic. Differences that matter:

| Item | A2 |
|---|---|
| `Portal Job Number` | kept, prefilled, matched exactly (`validateStoredMittiAudit`). |
| `Office life support result` | display only; life support and the 5-year answer come from the **website** answers for our leads (`websiteStopReasons`; `ownerAnsweredOnWebsite`), so the form answers are not stops here. |
| `Is there a difficult access charge?` / `Difficult access fee ($ inc GST)` | read by `difficultAccessFee` → separate `DIFFICULT_ACCESS` line on the HIV quote (`hiv-quote.core.ts`). |
| `Homeowner agrees to be contacted…` | still a hard stop on No; permission normally already exists from the website — keep. |
| Price | none; `readyCheckBasics` skips BASIC_PRICE. |

**A2 gaps:** same as A1-1…A1-4. In addition: `Based on your onsite assessment, does this property meet the Ready Check requirements to proceed?` is read by `parseAudit` but is not in the spec — add to the spec, or (better) let the office rely on the explicit stops and remove the subjective question (candidate to remove; a "No" today only adds an office-review issue).

**A2 candidates to remove:** `Assessor`; Extras trio; `Installer photo at front of premises with photo ID` (optional, Table 4 wants it on install day, A3 has it); `Office life support result` could become a read-only instruction rather than an answerable text item (it is never re-asked).

---

## 5. Template A3 — Install day (native PIISA)

### 5.1 Questions the portal reads (stable IDs + exact label; `A3_ALIASES` / `A3_NATIVE_IDS`)

| Official PIISA item | Native label on A3 | Portal use |
|---|---|---|
| jobRef / address | `Job number`, `Property address` | prefill |
| startDate / completionDate | `Installation start date`, `Expected completion date` | official P1; `p2.installDate` copied from start |
| p1.powerInformed | `Has the household or tenant been told the power will be off during installation?` | stop-work on No |
| lifeSupport / Consent / Attachment | `Does anyone at this property rely on life support?`, `Have you received written consent or a medical plan before starting this assessment?`, `Please upload the written consent or medical plan…` | stop-work; attachment |
| p2.ap / p2.company / p2.lead / p2.addName ×3 | `Accredited person (AP)`, `Installer company`, `Lead installer`, `Additional installer` (crew response set + `Other` branch: full legal name + EEC number ×4) | crew resolution against verified staff; EEC never typed for known staff |
| p3.swms / p3.table1 / p3.isolated | `Has the Safe Work Method Statement (SWMS) been completed for this job and all risks identified?`, `Have all Table 1 hazards been assessed and controlled in the SWMS?`, `Have the main and any alternative power supplies been isolated, locked out and tagged, and the roof cavity confirmed electrically safe to enter?` | stop-work on No; **the only SWMS capture** |
| p4.present / instructions / isolator | solar trio (with controlled suffixes) | stop-work; electrician trigger |
| p5.reviewed … p5.noAccess | PIESA review, electrician attended, recessed lights + count, IC, safe to cover, RCD, TPS, basic protection, no access since PIESA | stop-work |
| p6.present / height / rValue / treatment / suitable / reason | existing insulation block | official P6; `P6-UNSUITABLE-TOPUP` |
| p7.products | `What insulation products are being installed? Include brand, model and R-value.` | free text copied to the official form; **not** structured |
| p8.declaration / signature / name / date | `Signature`, `Installer full name`, `Date` | signature image + own timestamp required |
| Media (7, by ID) | installer photos, electrician photo, isolation photo, before video, product photos, completed video, final plan | `a3EvidenceRequired`, geotag on 4, capture-time, before-work ordering |
| Decision 205 (by label, being added) | `How many upgrade zones…`, per zone: name, under-insulated?, existing-insulation ruler/brand photo, before 360° video, after 360° video, after depth photo; `Will this installation run over more than one day?`, daily re-check checkbox; relabels of the 4 photos | `evaluateInstallEvidence` |

### 5.2 Official PIISA / Guide / agreement items vs A3

| Requirement (source) | Status | Note |
|---|---|---|
| Every PIISA Part 1–8 field (Table 4 "all fields… signed by the lead") | CAPTURED | `p2.installDate` copied; `p2.leadEec` from records; declaration tick ID exists. |
| PIISA Table 1 hazards considered in the SWMS (Part 3) | PARTIAL → GAP for the document | Yes/No only. §8. |
| SWMS prepared before HRCW starts (OHS Regs; Guide §2.1, §3.4.2; Schedule 4.4) | **GAP** | No document captured. |
| Power isolated, locked out, tagged before work (Guide §3.4.2) | CAPTURED | Yes/No + geotagged isolation photo (relabelled to include solar/battery isolators). |
| Electrician on site where the PIESA requires (Guide §3.4.2; Table 4 photo with ID) | CAPTURED | electrician photo required when `electricianRequiredAtStart`; relabel adds "front of premises / photo ID". |
| Each installer photo with photo ID at front of premises, before install (Table 4) | CAPTURED | min = crew count; relabel pending. |
| Per-zone before/after 360° video ≤250 MB, labelled, geotagged (Table 4) | PARTIAL → CAPTURED once decision 205 items are on the form | Video geotag + size read from Mitti metadata only; `sizeBytes` must be present in the Mitti media payload for the 250 MB check to work (not yet confirmed — `mittiMediaFile` does not return `sizeBytes` in the main branch). |
| Existing-insulation ruler + brand photo per under-insulated zone (Table 4) | PARTIAL → CAPTURED (205) | |
| After-install depth photo per zone (Table 4) | GAP → CAPTURED (205) | |
| Product packaging photo brand/model/R (Table 4) | CAPTURED | |
| Diagram/floor plan: zones named consistently, dimensions, product+R per zone, m² per zone (Table 4) | PARTIAL | `final_plan` media; names/m²/product per zone not structured; consistency not enforced. See §6. |
| Daily re-check on multi-day installs (Guide §3.4.2; PIISA Part 8(i)) | GAP → CAPTURED (205) | One checkbox for the whole job; OHS-wise a per-day record is better (§8 item SW-19). |
| Foil-backed / conductive existing insulation (PIISA Part 6 note; `P6-FOIL-UNKNOWN`) | **GAP on A3** | The native form has no conductivity question; the portal needs `conductiveExistingInsulation` and a photo (`CONDUCTIVITY_PHOTO_MISSING`). Confirm where the A3 path sources it; if nowhere, add A3-3 below. |
| Lock-out devices removed, premises re-energised after work (Guide §3.6; Schedule 4.4) | **GAP** | Nothing on any form. |
| Lead installer on site for the duration, supervising (Guide §2.3; Schedule 4.2) | **GAP** | Only the signature at start; no completion attestation or finish time. |
| Waste removed from premises, EP Act disposal (Guide §3.7) | PARTIAL | After video label says "no waste left"; no disposal record (where it went). |
| Products installed listed on the register (PIISA Part 8(j)) | PARTIAL | Free text p7; the structured product lives on the Ready Check. |
| Owner advised when existing insulation retained (Guide §3.4.2) | PARTIAL | `p6.reason` only; no "owner advised" record. |
| Installation start/finish actual times (Appendix A update fields; lead-present rule) | PARTIAL | Start date only. |

### 5.3 Gaps — proposed Mitti wording (A3), excluding the SWMS section (§8)

| # | Proposed question (exact) | Type | Logic |
|---|---|---|---|
| A3-1 | `After installation: have all lock-out devices been removed and the premises safely re-energised?` | Yes / No, required | Completion section. No = blocker "Lock-out still in place — do not leave site". |
| A3-2 | `Who removed the lock-out and re-energised the premises? (name and role — the person who applied the lock, or the attending electrician)` | Text, required when A3-1 = Yes | OHS lock-out practice: removed by the person who applied it (legal confirmation). |
| A3-3 | `Photo of the switchboard after re-energising — lock-out tag removed, main switch on (geotagged)` | Photo, location on, required when A3-1 = Yes | Pairs with the before isolation photo; proves §3.6. |
| A3-4 | `Solar, battery or generator restarted following the shutdown/restart instructions?` options `Yes` / `No` / `N/A – none at this property` | Pick one, required | §3.6 + PIISA Part 4 instructions; `No` = blocker. |
| A3-5 | `Installation finished at (date and time)` | Date & time, required at completion | Appendix A end date-time; lead-present check. |
| A3-6 | `I, the lead installer, was on site for the whole installation, supervised every other installer and confirm the installation complies with the VEU program requirements.` | Checkbox (must tick), required | Guide §2.3; Schedule 4.2. |
| A3-7 | `Lead installer signature at completion` | Signature, required | Portal compares signer name with the Part 2 lead and the time with A3-5. |
| A3-8 | `Insulation product installed` options exactly the 8 Ready Check options | Pick one, required | Structured product on the install record; VEEC Section 2 brand/model from `productBrandModel`; cross-check against the Ready Check answer, packaging photo and `p7.products`. Portal can prefill from the Ready Check. |
| A3-9 | `Zone N — installed area (m²)` and `Zone N — product installed in this zone` (same 8 options) | Number / Pick one per zone | Table 4 floor plan "m² and product per zone"; App. C per-area m²; `final_plan` then only needs to match. |
| A3-10 | `Is any of the existing insulation foil-backed, metallic or electrically conductive?` Yes / No, shown when existing insulation = Yes, plus `Photo of the existing insulation showing the facing (geotagged)` | Yes/No + Photo | Fills `conductiveExistingInsulation` / `conductivityEvidence` (currently a portal-only record). |
| A3-11 | `Where was the removed insulation and waste taken? (tip / transfer station name, or 'Nothing removed')` | Text, required | Guide §3.7 EP Act disposal record; VEEC Part B "waste removed" declaration support. |
| A3-12 | `Were any downlights replaced before today's installation?` Yes / No | Yes / No, required | App. C field; cross-check with PIESA B2 option 1 + Section C. |
| A3-13 | `The owner has been told the existing insulation is staying, is suitable to lay over, and the install will meet AS 3999 and the manufacturer's instructions.` | Checkbox, required when treatment includes Topped Up | Guide §3.4.2 owner-advice record. |

Item wording follows the decision 205 style (first line = label, geotag in brackets) so `labelledItems`/`norm` reads them unchanged.

### 5.4 Candidates to remove / change on A3

- The **named crew options** in the shared crew response set (privacy — `a3RosterStatus` raises an alert; every known worker is entered under `Other` anyway). Remove the named options; keep `Other`.
- The four **retired standalone certificate items** (`A3_RETIRED_CREW_CERT_IDS`) if still on the template (tolerated, never required).
- `Will this installation run over more than one day?` duplicates `Installation start date` ≠ `Expected completion date`. Keep one: either drop the question and derive, or keep it as the installer's explicit answer and let the portal flag disagreement (current worktree does the latter). Recommendation: keep (explicit beats derived) but make the completion-date item's help text say so.
- Once the SWMS section exists, `Has the Safe Work Method Statement (SWMS) been completed…` and `Have all Table 1 hazards been assessed…` become derived facts. They are **official PIISA Part 3 questions with stable IDs that `a3MissingFields` fails closed on**, so they cannot simply be deleted: either keep them (shown after the SWMS section, portal cross-checks Yes against a complete SWMS), or delete them and change `piisa-a3.core.ts` to derive `p3.swms`/`p3.table1` from the SWMS section (code change, same release). Recommendation: keep both and cross-check; it costs the installer two taps and keeps the official wording on the form.
- `A3_PREVIOUS_MEDIA_LABELS` old wordings: once the Part A relabels are published, the old labels can be dropped from the accepted list after the last in-progress audit completes.

---

## 6. Floor plan and zone naming between Ready Check and Install day

**Today.** Ready Check: `Where is this area?` free text per repeating area (A1 alias `Which part of the home…`), plus a per-area sketch/plan photo. Portal: `areas.v1` / `ready-check-areas.core.ts` keeps `label` per area, defaulting to `Main ceiling` for a one-area job; `rcAreasFromRecord` yields an unnamed area when zones are not structured. Install day (decision 205): `Zone N — name of this ceiling area (use the same name as the Ready Check and floor plan)` free text, compared by `norm()` to `ctx.zones[n].name`; a mismatch is an office review; the `final_plan` upload is free-form.

**Problems.** (1) Two humans typing the same name twice weeks apart; (2) a nameless single area means no check at all; (3) Appendix C wants "Area 1 / Area 2 / Area 3" plus m² and scenario per area, and the floor plan must use the same names as "other records" (Table 4).

**Proposal (no new Mitti questions needed beyond §5.3 A3-9).**
1. **Prefill** `Zone N — name of this ceiling area` on A3 from the Ready Check areas (text items are prefillable through `buildPrefill`; add the three labels to `PREFILL` with `ctx.zoneNames`). The installer only changes it when it is wrong, and the portal already flags a change.
2. **Convention** in both Ready Check help texts: `Area 1 – <name>` e.g. `Area 1 – Main house`, so the Registry "Area 1/2/3" and the human name travel together. Portal normalises on the part after the dash.
3. **One-area default**: record `Main ceiling` as the area name on save (not only in presentation) so A3 can be prefilled and checked.
4. **Floor plan**: the Ready Check plan is accepted at install day only when the zone set and m² are unchanged (`existingPlanMatchesInstall`); require the A3 `final_plan` otherwise — already the rule; add to its label: `… each area labelled Area 1, Area 2 … with the same names as above`.
5. Appendix C rows are then derivable per zone: name, uninsulated/under-insulated (A3 zone answer), scenario 48A(i)/(ii) (bulk batts; all 8 options are 48A), brand/model (A3-8/A3-9), m² (A3-9).

---

## 7. Product brand / model on invoices and the 8 options

- **Options** (`APPROVED_PRODUCTS`, decision 150): Bradford Gold R5/R6/R7, Fletchers Pink Batts R5/R6/R7, Earthwool R5, ECOWOOL R5. All bulk batts → activity 48A; R-value from the label; `productBrandModel` maps to register names (CSR Bradford / Gold Ceiling Batt; PINK® Batts / Ceiling Insulation; Earthwool / Ceiling batt; ECOWOOL ® / Insulation). The docs' second ChatGPT prompt adds options 7–8 to both Ready Checks; the live forms may still have 6 — form health cannot tell (finding 1). **Check in Mitti that both forms show 8 options spelled exactly.**
- **Install day** has no structured product (free text `p7.products`); the installed product can differ from the quoted one (stock). §5.3 A3-8/A3-9 fix this; `p7.products` should be **prefilled** from the Ready Check option as `Brand – Model – R-value` so the official form text is consistent.
- **Invoice** (Guide Table 4): brand(s), model(s), R-value, total m², price before incentive, incentive, amount paid, date, business name/address/ABN. Portal: quote/Xero line = `productQuoteDescription` → "Supply and install of Bradford Gold R5 ceiling insulation – 120 m²" (brand-ish + R + m², **no register model**, and the HIV rate-card quotes (`hiv-quote.core.ts`) use the option text too); business street address missing from the email invoice (checklist G3). Fix (portal): build the installed-product line from `productBrandModel` + R-value + installed m² ("CSR Bradford Gold Ceiling Batt R5.0 – 120 m²") at invoice time from the install record (A3-8/9), and add the address line. No Mitti change needed beyond A3-8/9.
- **Warranty**: ≥5-year warranty document per product still to be filed (checklist G1) — not a template matter.

---

## 8. SWMS section design (decision 206) — inside the Install day form

### 8.1 What the rules require

- **Activity Guide §2.1**: a SWMS "must be completed when undertaking this activity" and must "accurately document the appropriate steps needed to identify and manage risks for each installation", listing at least: live electrical hazards; hazardous substances (friable asbestos, chemicals); biological hazards (mould, animal waste); high temperatures/heat exhaustion; noise and vibration; respiratory hazards (dust, odours); enclosed spaces; working at height inside and outside ceiling spaces; fire/ignition sources. "All parties… must ensure the activity is undertaken in accordance with the completed SWMS." §3.4.2 repeats it as an installation requirement.
- **PIISA intro + Table 1**: the PIISA "does not replace the need to undertake a SWMS that outlines the hazards associated with high-risk construction work (HRCW) and the control measures"; OHS Regs 2017 "require employers and self-employed persons to prepare a SWMS before starting HRCW". Table 1 hazards: working at height / in roofs / enclosed ceiling spaces (falls through plaster ceilings, ladders); high temperatures; electricity; hazardous noise and vibration; hazardous substances (asbestos, chemicals, solvents); respiratory and biological hazards; heat/ignition sources (flues, chimneys, gas heaters, heat lamps, exhaust fans, downlights, cables surrounded by insulation > 400 mm); working alone.
- **Schedule 4.4 (installer agreement)**: "A completed job-specific SWMS must accurately identify site hazards and controls, and everyone must follow it"; multi-day re-check by the lead.
- **OHS Regulations 2017 (Vic) Part 5.1 Division 4 — as recalled, NEEDS LEGAL CONFIRMATION**: reg 327 — before HRCW starts the employer must prepare a SWMS that (a) identifies the work that is HRCW, (b) states the hazards and risks, (c) describes how the risks will be controlled, (d) describes how the controls will be implemented, monitored and reviewed; it must be set out so it is readily understood by the people using it. Reg 328 — work must be performed in accordance with the SWMS; if not, stop and resume only when it is. Reg 329 — review and, where necessary, revise the SWMS whenever control measures are revised. Reg 330 — keep the SWMS for the duration of the HRCW (and 2 years if a notifiable incident occurs), available for inspection. HRCW relevant to ceiling insulation: risk of a person falling more than 2 m; work on or near energised electrical installations or services; work in or near a confined space (ceiling spaces are usually "enclosed", not confined — the SWMS should say which); work involving, or likely to involve, the disturbance of asbestos; work in an area with movement of powered mobile plant (rare); work on or adjacent to a roadway (rare).

### 8.2 Design principles

- Every label is unique, first-line-readable, prefixed `SWMS — ` (em dash, same style as decision 205), so the portal reads it with the same `labelledItems`/`norm` reader and nothing collides with PIISA labels.
- Hazard blocks are identical in shape (presence → controls tick-all → other control → person responsible) so "Build with AI" can repeat them; show-when logic only on the presence answer.
- Prefilled job details reuse the existing A3 items (`Job number`, `Property address`, `Installer company`, crew). The SWMS section sits **after Part 2 (crew) and before Part 3** so it is signed before `Has the main and any alternative power supplies been isolated…`; the portal checks the SWMS lead signature time is before the isolation photo capture time.
- Crew sign-on signatures are separate Mitti Signature items (Mitti signatures capture name + timestamp — the portal already reads `a3Signature` shape).

### 8.3 Exact questions (in order)

**SWMS A — job and work**

| # | Label (exact) | Type / options | Rules |
|---|---|---|---|
| SW-1 | `SWMS — prepared by (installer business name)` | Text, prefilled from `Installer company` | required |
| SW-2 | `SWMS — prepared for (principal contractor / accredited person)` | Text, prefilled `Home Insulation Victoria (DC Construction Solutions Pty Ltd)` | required |
| SW-3 | `SWMS — work being done at this address` | Text, prefilled `Ceiling insulation removal (if required) and installation of bulk ceiling insulation – VEU Activity 48` | required, editable |
| SW-4 | `SWMS — date this SWMS was prepared` | Date & time, default today | required |
| SW-5 | `SWMS — which high-risk construction work applies to this job? (tick all)` | Tick all: `Risk of a person falling more than 2 metres (ladder, manhole, roof, ceiling joists)` / `Work on or near energised electrical installations or services (ceiling cables, switchboard, solar/battery)` / `Work in or near a confined space` / `Work that may disturb asbestos (home built before 1990, or asbestos suspected)` / `Work on or near a roadway or in an area with powered mobile plant` / `None of these apply (explain in the next box)` | required; `None` requires SW-6 |
| SW-6 | `SWMS — if none of the high-risk work types apply, explain why` | Text | required when SW-5 = None |

**SWMS B — hazards and controls** (one block per hazard; the Zone/under-insulated answers, Ready Check hazards and A1-3 year-built can prefill presence where known)

Each block has four items. Replace `<H>` with the hazard name below.

- `SWMS — <H>: present on this job?` — Yes / No — required.
- `SWMS — <H>: controls in place (tick all)` — Tick all, options per hazard below — required when Yes.
- `SWMS — <H>: other control (describe)` — Text — required when `Other control` is ticked.
- `SWMS — <H>: person responsible` — Pick one: `Lead installer` / `All crew` / `Attending electrician` / `Other (name in next box)` — required when Yes. (One extra Text `SWMS — <H>: other person responsible (name)` shown on Other.)

Hazard blocks and their control options:

| Hazard `<H>` | Control options (exact) |
|---|---|
| `Electrical` | `Power isolated, locked out and tagged at the switchboard before entry` / `Solar, battery or generator isolated per the instructions` / `PIESA read and its conditions followed` / `Test for dead before touching cables` / `No work within 400 mm of cables unless treated per AS 3999` / `Electrician on site as the PIESA requires` / `Other control` |
| `Heat and heat stress` | `Work early or late; stop in extreme heat` / `Rest breaks and water every 30 minutes` / `Roof space temperature checked before entry` / `Buddy checks for heat illness` / `Other control` |
| `Falls and falling through the ceiling` | `Walk only on joists or crawl boards` / `Ladder secured and footed at the manhole` / `Three points of contact on the ladder` / `Harness or edge protection for external roof access` / `No work on the roof in wind or rain` / `Other control` |
| `Manual handling` | `Bales split; two-person lifts over 20 kg` / `Mechanical lift or roof hoist for bales` / `Correct lifting technique; rotate tasks` / `Other control` |
| `Dust, fibres and PPE` | `P2 respirator, goggles, gloves, long sleeves worn in the ceiling` / `Disposable coveralls for removal work` / `Removed material bagged in the ceiling, not dropped through the house` / `Vacuum or wet methods, no dry sweeping` / `Other control` |
| `Enclosed or restricted ceiling space` | `Entry and exit points identified and kept clear` / `Lighting set up before entry` / `Communication with a person outside the ceiling at all times` / `Confined-space entry procedure used if the space is confined` / `Other control` |
| `Asbestos (homes built before 1990, or suspected)` | `Asbestos register or owner information checked` / `Suspected material not disturbed; work stopped and office called` / `Licensed removalist engaged before work resumes` / `No cutting, drilling or sanding of suspect sheeting` / `Other control` |
| `Vermin, droppings, mould and biological hazards` | `Area inspected before entry; droppings not disturbed dry` / `P2 respirator and gloves; hands washed before eating` / `Pest treatment arranged before install if infestation found` / `Other control` |
| `Lighting` | `Portable lighting set up to light the whole work area` / `Head torch for every person in the ceiling` / `Other control` |
| `Solar and battery systems` | `Shutdown and restart instructions located and followed` / `DC isolator and inverter isolated and tagged` / `Battery isolator off; no work near battery cables` / `Electrician isolates where the instructions are missing` / `Other control` |
| `Heat and ignition sources (flues, chimneys, heat lamps, exhaust fans, downlights, hot water units)` | `Clearances to flues and chimneys kept per AS 3999 and the manufacturer` / `Downlights confirmed IC/IC-4 by the PIESA; guards fitted where required` / `Exhaust fans and heat lamps kept clear` / `Gas appliances in the ceiling identified and kept clear` / `Other control` |
| `Noise and vibration` | `Hearing protection for blowers, saws and compressors` / `Noisy tasks kept short; tools maintained` / `Other control` |
| `Working alone` | `Nobody works in the ceiling alone` / `Check-in calls every 30 minutes where alone on site` / `Other control` |

(The last three come from PIISA Table 1 and the Guide §2.1 list; the coordinator's list covers the first ten.)

**SWMS C — monitoring and review** (reg 327(d), 329)

| # | Label (exact) | Type | Rules |
|---|---|---|---|
| SW-7 | `SWMS — how the controls will be checked during the job` | Tick all: `Lead installer checks each control before the first entry` / `Lead installer re-checks at the start of each day` / `Any crew member can stop work and call the lead` / `Changed conditions are recorded below before work continues` | required |
| SW-8 | `SWMS — changes to hazards or controls during this job (write 'None' if none)` | Text | required at completion |

**SWMS D — emergency**

| # | Label (exact) | Type | Rules |
|---|---|---|---|
| SW-9 | `SWMS — first aid kit location on site` | Text | required |
| SW-10 | `SWMS — first aider on site (name)` | Text | required |
| SW-11 | `SWMS — nearest hospital emergency department` | Text, portal can prefill from the job address | required |
| SW-12 | `SWMS — mobile phone reception at the property?` | Yes / No | required; No → SW-13 required |
| SW-13 | `SWMS — how emergency services will be called if there is no reception` | Text | required when SW-12 = No |
| SW-14 | `SWMS — emergency assembly point` | Text | required |
| SW-15 | `SWMS — electrical emergency: who isolates and how (switchboard location)` | Text | required |

**SWMS E — crew sign-on** (up to 4; row 1 = lead; names prefilled from the crew chosen in Part 2 / Other branch)

For N = 1..4:
- `SWMS — worker N: name` — Text, prefilled, required for N = 1, required for N > 1 when that crew row is filled.
- `SWMS — worker N: I have read this SWMS, understand the hazards and controls, and will follow it` — Checkbox (must tick) — same rule.
- `SWMS — worker N: signature` — Signature — same rule.

**SWMS F — lead installer declaration**

| # | Label (exact) | Type | Rules |
|---|---|---|---|
| SW-16 | `SWMS — I am the lead installer. This SWMS was prepared for this address before work started, every hazard above was assessed with the crew, the controls are in place, and work will stop if the SWMS cannot be followed.` | Checkbox (must tick) | required |
| SW-17 | `SWMS — lead installer signature` | Signature | required; portal: name = Part 2 lead; time < isolation photo capture time |
| SW-18 | `SWMS — signed at (date and time)` | Date & time, default now | required |

**SWMS G — daily re-check link (multi-day)**

Keep the decision 205 pair (`Will this installation run over more than one day?` and `Before starting work each day, I re-checked every item on this safety assessment and they all still hold.`) and add:

| # | Label (exact) | Type | Rules |
|---|---|---|---|
| SW-19 | `SWMS — day 2 re-check: date, time and lead installer initials (and any change to the SWMS)` | Text | required when multi-day = Yes |
| SW-20 | `SWMS — day 3 or later re-checks: one line per day (date, time, initials, changes)` | Text | required when `Expected completion date` is 2+ days after the start |

**Replacing the bare Yes/No.** After this section, `Has the Safe Work Method Statement (SWMS) been completed for this job and all risks identified?` and `Have all Table 1 hazards been assessed and controlled in the SWMS?` are derived facts. See §5.4 for the two ways to retire them; in both cases the portal rule becomes: `p3.swms = Yes` only when SW-5, every hazard block, SW-7, SW-9…SW-15, worker 1 sign-on and SW-16/17 are complete; `p3.table1 = Yes` only when every Table 1 hazard block has a presence answer (all 13 blocks) and each present hazard has at least one control.

**Portal reading** (for the owner of `install-evidence.core.ts` / `piisa-a3.core.ts`, not done here): add a `SWMS_QUESTIONS` map keyed like `INSTALL_EVIDENCE_QUESTIONS`, read by label, render the section to a PDF filed as `documents` kind `swms` with the signature images (6-year record, decision 206), and add `swmsBlockers` to the prestart snapshot (reg 327: before work) and to AP review / Ready for VEEC.

### 8.4 What the OHS Regulations require that this section cannot fully carry (legal confirmation needed)

1. **Who prepares it.** Reg 327 puts the duty on the *employer* of the workers (the installer business), not the AP. A Mitti section built by HIV is a template the installer completes; the installer business should adopt it as its SWMS (SW-1 "prepared by" does this). Where crew members come from **different employers** (subcontracted labour, or an electrician's apprentice), each employer needs its own SWMS — one form cannot carry two employers' SWMSs. Flag such crews for office review (crew `Other` entries from another business).
2. **Consultation.** The OHS Act (s 35) requires consultation with employees/HSRs when preparing a SWMS. The crew sign-on records that the crew *read* it, not that they were consulted in preparing it. SW-16 says "assessed with the crew"; a true consultation record (who was consulted, when) is beyond a tick.
3. **Review and revision (reg 329).** A completed Mitti audit is a snapshot. Revisions during the job can only be free text (SW-8, SW-19/20); a formal revised SWMS with re-sign-on cannot be produced inside the same completed audit. If controls change materially mid-job, the lead should start a new A3 audit or the office must accept the text revision — decide which.
4. **Availability on site (reg 330).** The SWMS must be available for inspection at the workplace while the work is done. A Mitti form open on the lead's phone probably satisfies this but a WorkSafe inspector may expect a readable document; the portal's filed PDF covers after-the-fact retention, not on-site availability while the phone is in the ceiling.
5. **Generic vs site-specific.** The pick-lists are generic controls; reg 327 needs the SWMS to reflect *this* site. The presence answers, the `Other control` text and the hazards carried from the Ready Check make it site-specific only if the installer uses them — the portal should block a SWMS where every hazard is `No` and SW-5 is `None`.
6. **Confined space.** If a ceiling space is ever a confined space (OHS Regs Part 3.4), an entry permit, atmospheric testing and a standby person are required — a Mitti tick cannot stand in for the permit. The `Enclosed or restricted ceiling space` block should say so in its help text.
7. **Retention clock.** Reg 330's 2-year retention after a notifiable incident is shorter than the Guide's 6 years; the longer applies — no conflict, but the filed PDF must be immutable (use the signed-copy store, not a re-renderable view).
8. **Signature capture.** Mitti signature items record the drawn image and a name the signer types; the portal cannot verify identity. The existing `directLeadSignatureProblem` rule (name must equal the lead's record; no "on behalf") should be applied to SW-17 and to every worker signature against the Part 2 crew.

---

## 9. Appendix C (VEEC creation form) — field by field

| App. C field | Source today | Status | Fix |
|---|---|---|---|
| Activity date (completion) | `installation_completed_at` | PORTAL | — |
| Consumer details | owner record | PORTAL | — |
| Scheme participant (installer) | crew resolution | PORTAL | lead must be a verified scheme participant in the Registry (checklist B5) |
| Premises class type — Class 1 (house) / Class 2 (apartment) | Ready Check `Property type` | CAPTURED | — |
| Premises type — public / community / private rental / owner-occupier | — | **GAP** | A1-1 on both Ready Checks (or website) |
| Installation notification ID | office ESC record | PORTAL | — |
| PIISA acknowledgement | signed A3 | PORTAL | — |
| CES number | PIESA Section C / q31 | PORTAL | — |
| Were any downlights replaced? | derivable: PIESA B2 option 1 + Section C | PARTIAL | A3-12 explicit Yes/No, cross-checked |
| Price / consumer payment inc GST | invoice | PORTAL | — |
| Ceiling insulation present? removed? | PIISA P6 | CAPTURED | — |
| Electrician name + licence | PIESA q23–24 | CAPTURED (once PIESA live) | — |
| Upgrade area (Area 1–3), uninsulated/under-insulated, scenario, brand/model, m² | zones (205), product option, floor plan | PARTIAL | §6 convention + A3-8/A3-9; scenario = 48A(i)/(ii) from the zone answer |

---

## 10. Template PIESA — electrician (spec, not yet built)

### 10.1 Questions the portal will read (q1–q45, `SHORT_PIESA_FIELDS` + `PIESA_EVIDENCE`)

Read by exact label through `shortAnswersFromEntries("piesa")` (duplicate labels `Licence no:` / `Full Name:` / `Name:` / `REC registration no:` / `Telephone no:` resolved in form order) and `piesaEvidenceIdForLabel`. Full list in `docs/MITTI_PIESA_FORM_SPEC.md`; every one of the 45 maps to an official item or evidence rule, and `expansionCoverage` proves every official answer id is filled or explicitly excluded (`c.signature`, `o.signature`, Part 7 table columns).

### 10.2 Official / Guide items vs the spec

| Requirement | Status | Note |
|---|---|---|
| All PIESA Section A Parts 1–7, B1–B3, C, owner declaration (Table 4) | CAPTURED (expanded) | Part 7 appliance table (location / hazard / action) is a single text → office must split (flagged). |
| Life support consent/plan attached to the PIESA (Guide §3.3.1) | CAPTURED (q6–q7) | |
| Electrician photo with ID at front of premises **before** the PIESA (Table 4) | PARTIAL | q43 required + geotag; "before" is not checked — compare capture time with the electrician signature time / `Date of inspection`. |
| Switchboard cable photo by the licensed electrician (Table 4) | CAPTURED (q42) | |
| CoES describing the ceiling-space rectification (Table 4; Table 3 copy to consumer) | PARTIAL | q45 file captured; description not checked; file not sent to the owner (checklist H6). |
| Conditions incl. whether an electrician must be present at install (Guide §3.3.1) | CAPTURED | q20 option 3. |
| DEECA privacy collection statement visible to the electrician (form text) | PARTIAL | On the filled docx, not on the Mitti form. |
| Appendix A notification: PIESA status 4 options, CoES, REC number | PORTAL (derivable) | — |
| Part 7 "does this action effectively reduce the risk?" (official `p7.effective`) | **GAP** | Not asked on the short form; `P7-NOT-EFFECTIVE` then needs a verified rectification record for every hazard. Add q19b. |

### 10.3 Gaps — proposed wording (PIESA)

| # | Proposed question (exact) | Type | Logic |
|---|---|---|---|
| P-1 | `Does the action you described effectively reduce the risk from each hazard listed?` | Yes / No | show when q18 = Yes; fills `p7.effective`; No → hazard-rectification hold |
| P-2 | `For each appliance, fan or flue: what and where` / `Hazard it creates` / `What was done or must be done` as a repeating section (up to 10 rows) | Text ×3 per row | replaces the single text q19 so the official Part 7 table is filled without office retyping |
| P-3 | Instruction item (verbatim DEECA privacy collection statement) at the top of Group 8 | Instruction, text only | C8 |
| P-4 | Help text on q43: *"Take this before you start the assessment."* and portal check capture time ≤ inspection date/signature time | help text | Table 4 "prior to conducting" |
| P-5 | `Must an electrician be present at the start of the installation?` is already q20 option 3 — no new item; ensure the option label is not shortened in Mitti | — | — |

### 10.4 Candidates to simplify (PIESA)

- q44 hazard photos are an HIV extra (not Table 4) — keep, but mark "HIV evidence" in the form section title so the electrician is not told the ESC requires it.
- `Office life support record` could be an instruction item instead of an answerable text (never re-asked).
- Two full REC blocks (q23–27 and q33–37) are official duplicates; the portal prefills both — keep.

---

## 11. Per-template summary table

| Template | Read by label (count) | Official/Guide items captured | Partial | Gaps | Remove candidates |
|---|---|---|---|---|---|
| A1 | ~45 labels (incl. aliases) | class, 5-year, areas/m², existing insulation, product, price, electrician, permission | zone names, R-value evidence (tick), floor plan unread, hazards | premises type, year built (asbestos), conductive insulation | Assessor, Extras trio, "Difficult access" in included list, price-agreed |
| A2 | ~38 labels | as A1 minus price | as A1 + subjective outcome question | as A1 | Assessor, Extras trio, installer ID photo, outcome question |
| A3 | 40 official IDs + 7 media + 15 decision-205 labels | PIISA all parts, isolation, photos, videos (205), depth photos (205), daily re-check (205) | floor plan structure, product free text, waste, multi-day record | **SWMS document**, lock-out removal/re-energise, lead present at completion, finish time, structured product/m² per zone, conductive insulation, downlights replaced, disposal record | named crew options, retired cert items, (after 206) derived Part 3 Yes/No pair |
| PIESA | 45 labels | all official parts, both photos, CoES, life support | Part 7 table split, photo-before-assessment, privacy text | `p7.effective` | none |

---

## 12. Prioritised gap list

### Must-have before go-live (first real install)

1. **SWMS section on A3 (decision 206)** — §8 design; portal reads, files PDF, blocks prestart/AP/Ready for VEEC. Guide §2.1/§3.4.2, OHS Regs 327–328, Schedule 4.4. Today only a Yes/No.
2. **Decision 205 Table 4 items added to the live A3 in Mitti** (zones, per-zone videos/photos, relabels, multi-day) — code exists in the worktree; the form does not. Confirm Mitti returns video `sizeBytes` or the 250 MB rule cannot run.
3. **Lock-out removal / re-energise sign-off** — A3-1…A3-4 (Guide §3.6, Schedule 4.4). Nothing captures it.
4. **Lead installer present for the duration + finish time** — A3-5…A3-7 (Guide §2.3).
5. **Ready Check spec ↔ readers alignment** (finding 1) so `connectMittiForm`/form health can prove `Insulation product` (8 options), `Homeowner agrees to be contacted…`, `Homeowner email`, difficult-access pair, R-value choice are on both live forms; verify the 8 product options are published on both.
6. **Zone naming**: prefill A3 zone names from the Ready Check, `Area N – name` convention, record a name for one-area jobs (§6). Otherwise the 205 name check either never runs or fails on spelling.
7. **PIESA template built, connected, approved** (unchanged from the compliance checklist C1) with P-1 (`p7.effective`) added before build so the official Part 7 rule can pass without a rectification record for every hazard.
8. **Conductive / foil existing insulation** explicit answer + photo on A3 (A3-10) — `P6-FOIL-UNKNOWN` blocks every job with existing insulation unless the portal sources it elsewhere; confirm the source or add the item.

### Should-have (before the first VEEC lodgement)

9. **Premises type** (public/community/private rental/owner-occupier) — A1-1 on both Ready Checks or on the website (Appendix C).
10. **Structured installed product + m² per zone on A3** (A3-8/A3-9) and invoice line "brand – model – R-value – m²" + business address (Table 4 tax invoice; checklist G3).
11. **Downlights replaced Yes/No** on A3 (A3-12) cross-checked with the PIESA (Appendix C).
12. **Part 7 appliance table** as a repeating section on the PIESA (P-2) instead of one text the office splits.
13. **Electrician photo "before the assessment"** check (P-4) and the install-day electrician photo before work (already ordered by capture time — keep).

### Later

14. Year built / asbestos question on the Ready Check (A1-3) to prefill the SWMS asbestos block.
15. Waste disposal destination (A3-11) and owner-advised-retained tick (A3-13).
16. Per-day re-check lines (SW-19/20) beyond the single 205 checkbox.
17. Removals: Assessor, Extras trio, "Difficult access" option, A2 subjective outcome question, named crew options and retired certificate items on A3, old media labels once no in-progress audit uses them.
18. DEECA privacy statement as an instruction item on the Mitti PIESA (P-3).
19. Legal confirmation of the OHS points in §8.4 (multi-employer crews, consultation record, mid-job revision, on-site availability).
