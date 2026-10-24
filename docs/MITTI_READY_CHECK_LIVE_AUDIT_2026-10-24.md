# Mitti Ready Check templates — LIVE audit, 24 Oct 2026

Jo: "not sure the Mitti forms are great, go check." This is the check, done against the **live** template definitions
(fetched 24 Oct ~10:25 UTC through Lovable, `GET /templates/v1/templates/{id}`), not against the portal's idea of them.
Read-only: no code and no Mitti template was changed. It reconciles `docs/MITTI_TEMPLATES_AUDIT_2026-10-24.md`
(written earlier the same day WITHOUT the live definitions) in §8.

| Code | Live template | Modified | Questions / items |
|---|---|---|---|
| A1 | `A1 – Ready Check \| Installer-Supplied Customer` (`template_01ee0428…`) | 24 Oct 09:31 UTC | 140 questions / **601 items** |
| A2 | `A2 – Ready Check \| HIVIC Sourced Customer` (`template_dbaf67a2…`) | 24 Oct 09:41 UTC | 131 questions / **561 items** |

**What the live dump could and could not show.** The item lists give path, label (cut at 110 characters), kind and
nesting. They do **not** carry option lists, the Required flag or the "show when" conditions (every `req` is null).
For those I used the last full definitions in the repo (`tests/fixtures/mitti-ready-check/a1-published-r35.json`,
`a2-published-r13.json`, published 22 Oct 22:24 UTC) and marked anything that may have changed since as **check in Mitti**.
Both fixtures have `mandatory_mark_as_complete: false` — check this too (§4, problem 9).

**Readers** (the code that reads a Ready Check answer by its question text): `src/lib/mitti.core.ts`
(`PREFILL`, `parseAudit`, `contactAnswersFromEntries`), `src/lib/ready-check-answers.core.ts`
(`readyCheckStopReasons`, `removalTotalM2`, `difficultAccessFee`, `a1DifficultAccessIncluded`),
`src/lib/ready-check-complete.core.ts` (`readyCheckFactsFromEntries`), `src/lib/ready-check-basics.server.ts`
(`/^total quoted price/i`), `src/lib/installer-led.core.ts` (`quotedPriceFromEntries`),
`src/lib/insulation-product.core.ts` (via `contactAnswersFromEntries.productOption`), `src/lib/usual-electrician.core.ts`
(`resolveMittiElectrician`), and `src/lib/mitti.server.ts` (`applyContactAnswers`, `MITTI_CONSENT_TEXT`, `ensureInstallDayPhotos`).
The build sheet / validator is `FORMS.ready_check` + `FORMS.ready_check_priced` in `src/lib/mitti-forms.core.ts`.

**Rules used:** `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md`; `docs/JO_DECISIONS_LOG.md` 5, 25, 28, 34, 36, 110, 116, 148–150,
157, 163, 185, 205, 210, 211; Activity Guide v1.2 Table 4 / Appendix C as summarised in the earlier audit.

---

## 0. The one-paragraph answer

The forms are not 140 questions long for the tradie — they are **17 questions copied 21 or 22 times**. The per-area block
("Which part of the home… / How was it measured… / sketch / m² / existing insulation… / downlights / issues") is pasted
once into every fixed branch of "How many ceiling areas?" (1 copy for "1", 2 for "2" … 6 for "6+"), and on A1 once more
inside a dynamic "CLICK ON ME to add a ceiling area" field. That block is 396 of A1's 427 answerable items (93 %) and
378 of A2's 397 (95 %). A tradie doing a one-area house sees about 25 items, so the 20-minute target is not the problem;
the problems are: every edit has to be made 21–22 times (and the two forms already disagree), the retired floor-plan
sketch (decision 211) is still asked 22 times, nine labels are answered and read by nobody (including the **area name**,
which decision 211 now needs), the R-value choice says "Above R2.0" where the rule is "R2.0 or above", a failed or
"no safe access" result does not stop the form, and the portal's own build sheet (`READY_CHECK_FIELDS`) no longer matches
either live form, so form health cannot prove the questions the quote actually depends on. A lean rebuild is in §6
(A1 = 40 questions, A2 = 34, one repeating area group) and the ChatGPT prompt to build both is in §7.

---

## 1. Section-by-section map of the live forms

Counts are **answerable items** (text, choice, photo, tick, signature; sections, logic containers and "── Ceiling Area N ──"
headings excluded). "Unique" = distinct question texts. Verdict key: **PORTAL** = read by the portal · **RULE** = required
by a Jo decision or the regulator even if the portal only files it · **NICE** = useful, not required · **BLOAT** = asked,
read by nobody, adds nothing · **RETIRED** = contradicts a decision.

### 1.1 A1 — Ready Check | Installer-Supplied Customer (5 sections, 427 answerable items, 49 unique)

| # | Section | Items (unique) | What it asks | Verdict |
|---|---|---|---|---|
| 001 | Title Page | 10 (10) | Portal Job Number, Site address, Homeowner name, phone, email (all prefilled), "Homeowner agrees to be contacted by Home Insulation Victoria" (Yes/No), Property type (+ "What is the property type?" text on Other), "Life support equipment at property?" (Yes/No, prefilled from the office record), "Was the ceiling or roof built or replaced in the last 5 years?" (prefilled from the owner's declared answer) | PORTAL for 8 of 10 (job number link, phone/email/permission = quote basics, life support + 5-year = hard stops, property type = prefill). BLOAT: "What is the property type?" (nobody reads it; `propertyTypeOption` only knows House/Townhouse/Unit). |
| 002 | Site Verification | 8 (8) | Roof type (Tiles/Metal sheet/Other + "Describe the roof type"), "How would you rate the ceiling access?" (Easy/Standard/Difficult/No safe access) → on Difficult: "Please explain why the access is difficult" + "Is there a difficult access charge?" → "Difficult access fee ($ inc GST)"; on No safe access: "Please explain why there is no safe access"; access-point photo | PORTAL: roof (notes), access rating (`access_difficulty`), charge + fee (owner quote line, decision 24 Oct), access photo (install-day photo lock). BLOAT: the three free-text "explain/describe" boxes — unread, and Mitti's logic already *requires a note* on Difficult / No safe access (22 Oct definition), so the tradie is asked to explain twice. **STOP problem:** "No safe access" is not recognised by the reader (§3.4) and the form carries on into the whole Ceiling Assessment. |
| 003 | Ceiling Assessment | 398 (20) | "How many ceiling areas need to be measured separately?" (1–6+), then the 18-item area block ×22: part of the home (name), how measured (+ "Tell us how"), **sketch or floor plan upload**, measured m², existing insulation? → type (Batts/Loose fill/Other + describe), depth (mm), R value (Below R2.0 / Above R2.0), depth photo, what is required (Remove/Top up/Not sure) → m² to remove; overview photo; downlights? → how many; issues? → "Please explain" | PORTAL: m² (sum = `measured_area_m2`, quote basic), existing Yes/No, type (removal pricing), R value (STOP_R2 / `belowR2`), depth + overview photos (install-day lock), required + removal m² (`removal_m2`), downlight count, issues Yes (office flag), how measured + "tell us" (provenance note). **RETIRED:** sketch/floor plan upload ×22 (decision 211). **BLOAT:** depth (mm) ×22, "Please describe the existing insulation type" ×22, "Please explain" (issues) ×22 — none read. **PORTAL-SHOULD-BUT-DOESN'T:** "Which part of the home does this ceiling area cover?" ×22 — the area name is read by nothing, yet decision 211 draws the diagram from "one box per area: name, length × width, m², product". Structure: 7 branches (dynamic field + fixed 1…6) — see §3.1. |
| 004 | Your quote to the homeowner | 7 (7) | "What's included in your quote?" (multi) + "What else is included?"; "Total quoted price (inc GST)"; "Who is doing the electrical safety check?" (HIV electrician / My usual electrician / A different electrician) → name, licence, price | PORTAL, all seven (installer line of the co-branded quote, `BASIC_PRICE`, electrician snapshot). Correct that A1 asks the installer's price; no owner price is shown anywhere on A1 (good). Order problem: priced **before** the outcome question in 005. |
| 005 | Ready Check Outcome | 4 (4) | "Based on your onsite assessment, does this property meet the Ready Check requirements to proceed?" → on failed: "Why did the property fail the ready check? Select all that apply" (multi); on passed: "What insulation product will you be using on this job?"; signature | PORTAL: outcome (failed = office review issue, never a stop), fail reasons (notes), **product (quote basic; the 8 options, decision 150)**. NICE: the outcome question itself — the hard stops are already derived from the answers; see §3.5 for the contradiction risk. Signature = Mitti completion. |

### 1.2 A2 — Ready Check | HIVIC Sourced Customer (4 sections, 397 answerable items, 37 unique)

| # | Section | Items (unique) | What it asks | Verdict |
|---|---|---|---|---|
| 001 | Title Page | 5 (5) | Portal Job Number, Site address, Homeowner name (prefilled), Property type (+ "What is the property type?") | PORTAL: job number (exact match in `validateStoredMittiAudit`), prefill of the rest. Phone / email / contact permission / life support / 5-year are **not** asked on A2 — correct for our leads: `checkReadyCheckBasics` takes mobile/email from the job, permission from `owner_contact_consents`, and `websiteStopReasons` takes life support + 5-year from the website (`ownerAnsweredOnWebsite: true`). BLOAT: "What is the property type?". |
| 002 | Site Verification | 8 (8) | Same as A1 (order of the Difficult sub-questions differs: charge first, then explain) | As A1. Note: the **access fee is a price question on our lead** — see §3.6. |
| 003 | Ceiling Assessment | 379 (19) | Same 18-item block ×21 (fixed branches 1…6 only; no dynamic field) | As A1 (sketch ×21 RETIRED; depth/describe/explain ×21 BLOAT; area name unread). |
| 004 | Ready Check Outcome | 5 (5) | Outcome → fail reasons (multi) / product; "I confirm I have not discussed or agreed pricing with the homeowner during this Ready Check…" tick; signature | PORTAL: outcome, reasons, product, no-pricing tick (recorded in notes; Jo decision 28 keeps it). |

### 1.3 Verdict totals (unique question texts)

| | A1 (49) | A2 (37) |
|---|---|---|
| PORTAL (read by label) | 33 | 22 |
| Prefill only (portal writes it, never reads it back: Site address, Homeowner name, Property type) | 3 | 3 |
| Structure / completion (How many areas, CLICK ON ME, signature) | 3 | 2 |
| Indirect (downlights Yes/No — only the count is read) | 1 | 1 |
| **Nobody reads** | **9** | **9** |
| of which RETIRED by decision 211 | 1 (sketch, ×22 instances) | 1 (sketch, ×21) |

Per instance, A1 carries **114 answerable items nobody reads** (5 per-area labels ×22 + 4 singles) out of 427; A2 carries 109 of 397.

---

## 2. Exact lists: what the portal reads vs what nobody reads

### 2.1 Read by the portal (exact live wording → reader → what it feeds)

| Live question text | Form | Reader | Feeds |
|---|---|---|---|
| Portal Job Number | A1 A2 | `PREFILL`; `parseAudit.jobNumber`; `validateStoredMittiAudit` | job link (exact match when present) |
| Homeowner phone | A1 | `contactAnswersFromEntries.phone` | `BASIC_MOBILE`; owner record via `applyContactAnswers` |
| Homeowner email | A1 | `contactAnswersFromEntries.email` | `BASIC_EMAIL` |
| Homeowner agrees to be contacted by Home Insulation Victoria | A1 | `contactAnswersFromEntries.contactPermission`; `readyCheckStopReasons` (No → `STOP_NO_CONTACT`); `MITTI_CONSENT_TEXT` | `BASIC_PERMISSION`, consent row |
| Life support equipment at property? | A1 | `PREFILL`; `readyCheckStopReasons` (Yes → `STOP_LIFE_SUPPORT`) | hard stop (A1 only) |
| Was the ceiling or roof built or replaced in the last 5 years? | A1 | `PREFILL`; `readyCheckStopReasons` (Yes → `STOP_BUILT_5`); `parseAudit` notes | hard stop (A1 only) |
| What type of roof does the home have? | A1 A2 | `parseAudit` → notes "Roof type: …" | crew context |
| How would you rate the ceiling access? | A1 A2 | `parseAudit.access_difficulty` (easy / moderate(Standard) / difficult; **"No safe access" → "not recognised" issue**) | quoting |
| Is there a difficult access charge? / Difficult access fee ($ inc GST) | A1 A2 | `difficultAccessFee` (A2 → `DIFFICULT_ACCESS` owner line; A1 → shown inside the installer total, `applyMittiAccessFeeIncluded`) | quote |
| Upload a clear photo of the ceiling access point | A1 A2 | `parseAudit.photoGaps.access` → `ensureInstallDayPhotos` | install-day photo lock |
| How was this ceiling area measured? / Tell us how you measured it | A1 A2 | `parseAudit` → notes "Measured by: …" (missing → issue) | provenance |
| Enter the measured ceiling area (m²) | A1 A2 | `parseAudit` rooms → `measured_area_m2` (sum) | `BASIC_AREA`, quote, VEEC m² |
| Is there existing insulation in this ceiling area? | A1 A2 | `parseAudit.insulation_present`; `readyCheckFactsFromEntries` | eligibility, PIISA P6 |
| What type of existing insulation is installed? Select all that apply | A1 A2 | `parseAudit` → "Insulation type to remove" (mixed → issue) | removal pricing |
| What is the determined R value of the existing ceiling insulation? | A1 A2 | `readyCheckStopReasons` (/^above\s*r?\s*2/ → `STOP_R2`); `readyCheckFactsFromEntries.belowR2`; `isRValueBand` | verified eligibility (`ready_check_form_eligible`) |
| Upload a photo clearly showing the measured insulation depth | A1 A2 | `photoGaps.depth`; `readyCheckFactsFromEntries.depthPhoto` | install-day lock |
| What is required for the existing insulation? | A1 A2 | `parseAudit.removal_required` (Not sure → issue) | removal pricing, PIISA P6 |
| How much existing insulation needs to be removed? (m²) | A1 A2 | `parseAudit.removal_m2`; `removalTotalM2` | removal pricing |
| Upload an overview photo of this ceiling area | A1 A2 | `photoGaps.overview`; `readyCheckFactsFromEntries.overviewPhoto` | install-day lock |
| How many recessed downlights? | A1 A2 | `parseAudit.downlights_qty` (sum) | PIISA P5 prefill |
| Are there any issues that could affect the insulation installation? … | A1 A2 | `parseAudit.hazards` (Yes → office review issue) | office |
| What’s included in your quote? / What else is included? / Total quoted price (inc GST) | A1 | `quotedPriceFromEntries`; `a1DifficultAccessIncluded`; `ready-check-basics.server` | installer line, `BASIC_PRICE` |
| Who is doing the electrical safety check? / Electrician name / licence number / price (inc GST) | A1 | `contactAnswersFromEntries` → `resolveMittiElectrician` | PIESA line, payer, `electricianDecided` |
| Based on your onsite assessment, does this property meet the Ready Check requirements to proceed? | A1 A2 | `parseAudit.rcOutcome` (failed → issue + notes) | office review |
| Why did the property fail the ready check? Select all that apply | A1 A2 | `parseAudit.failReasons` → notes | office |
| What insulation product will you be using on this job? | A1 A2 | `contactAnswersFromEntries.productOption` → `resolveMittiProduct` (exact one of 8) | `BASIC_PRODUCT`, quote line, VEEC brand/model, invoice wording (decision 209) |
| I confirm I have not discussed or agreed pricing with the homeowner… | A2 | `parseAudit` → notes | record (decision 28) |

Prefilled but never read back: Site address, Homeowner name, Property type (both forms). Structural: "How many ceiling
areas need to be measured separately?", "CLICK ON ME to add a ceiling area" (A1), the signature (Mitti completion drives
`formComplete`).

### 2.2 Nobody reads (exact live wording)

| Live question text | Form | Instances | Note |
|---|---|---|---|
| What is the property type? (Other text) | A1 A2 | 1 | `propertyTypeOption` ignores free text |
| Describe the roof type | A1 A2 | 1 | |
| Please explain why the access is difficult | A1 A2 | 1 | Mitti logic already demands a note here (22 Oct def.) |
| Please explain why there is no safe access | A1 A2 | 1 | same |
| Which part of the home does this ceiling area cover? | A1 A2 | 22 / 21 | **should be read** — area name for the decision-211 diagram and the install-day zone names |
| Upload your area sketch or floor plan. Rough is fine. Mark this ceiling area and show the measurements used. | A1 A2 | 22 / 21 | **retired, decision 211** |
| Please describe the existing insulation type | A1 A2 | 22 / 21 | Other-type detail; office only sees it in the Mitti PDF |
| What is the measured insulation depth (mm)? | A1 A2 | 22 / 21 | not stored (`rcAreasFromRecord` depth = null); the R-value choice is what counts |
| Please explain (issues) | A1 A2 | 22 / 21 | replaced the 22-Oct "Describe the issue and add a photo" **photo** — the SWMS hazard evidence is gone |

Counts: A1 reads **33** of 49 unique questions and ignores **9**; A2 reads **22** of 37 and ignores **9**. Everything the
quote needs (`readyCheckBasics`: area, product, price on A1, mobile/email/permission; `readyCheckCompletionChecks`:
form complete, price, electrician, permission, below-R2, life support, 5-year) **is** on the live forms with the right
wording — the live forms are not missing any reader label. The problems are the reverse: repetition, retired and dead
questions, and the portal's build sheet being out of date (§3.3).

---

## 3. Duplicates, contradictions, wording, wrong stops, prices, floor plans

### 3.1 The 21/22-fold copy of the ceiling-area block (both forms)

`How many ceiling areas need to be measured separately?` (options 1, 2, 3, 4, 5, 6+) opens a fixed logic branch per
answer, and each branch holds **N full copies** of the 18-item block with a "── Ceiling Area N ──" heading. Totals:
18 × (1+2+3+4+5+6) = 378 copies' worth of items on A2; A1 adds a 7th branch holding a **dynamic** "CLICK ON ME to add a
ceiling area" repeater (19 items). On 22 Oct the fixed branches held only the headings and the questions lived in the
dynamic field (A1) or the "1" branch (A2); the copies were pasted in on 23–24 Oct.

Consequences:
1. Every wording/option/required change must be made 21 (A2) or 22 (A1) times. The two forms already differ (A1 label
   "Upload your area sketch or floor plan.\nRough is fine…" vs A2 "…floor plan. Rough is fine…" on one line; A1 has an
   example line under "Which part of the home…", A2 does not).
2. **Double-counting risk on A1.** The dynamic branch is shown for a set of answers (`response_is_in` with four option ids
   on 22 Oct; which four is not visible in the live dump). If a tradie picks an answer that shows BOTH the dynamic
   repeater and a fixed branch and fills both, `parseAudit` sums every "Enter the measured ceiling area (m²)" it finds
   and the house is measured twice. **Check in Mitti which answers show "CLICK ON ME".**
3. "6+" gives exactly six copies — a seventh area cannot be entered on A2.
4. The portal reader (`parseAudit` grouping by the parent of each m² answer) does not care which way repetition is
   done, so the fix is purely a Mitti one: one repeating group (§6) — but a dynamic repeater must be **tested** with a
   2-area TEST form to prove each instance has its own parent id (otherwise `roomParents` collapses to one and only the
   first m² is read).

### 3.2 Duplicates and near-duplicates

- "Please explain why the access is difficult" / "…no safe access" **and** Mitti's `require_note: true` on the same
  answers (22 Oct definition): the tradie explains twice.
- Depth (mm) **and** the Below/Above R2.0 choice **and** the depth photo: three ways to say the same thing; only the
  choice and the photo are read.
- "Tell us how you measured it" shown only on Other (fine) but "How was this ceiling area measured?" is asked per area —
  the method rarely changes between areas; the lean form keeps it per area only because the reader expects it there.
- A1 "Is there a difficult access charge?" + fee **and** historically "Difficult access" as an option in "What's
  included in your quote?" (`PRICE_ITEMS` still lists it; removed from the live option set on 23 Oct per the plan).
  `applyMittiAccessFeeIncluded` guards against adding it twice; keep the option out of the form.

### 3.3 Contradictions between the live forms and the portal's own build sheet

`validateTemplate(FORMS.ready_check*)` (what `connectMittiForm` and form health run) would **fail both live forms today**:
it still requires `Assessor`, `Are these details correct?` (+ `What needs correcting?`), the extras trio (`Are any extras
needed…`, `Describe each extra…`, `Photos of each extra`), the per-area hazard photo `Describe them and add a photo` /
`Describe the issue and add a photo` (live has the text "Please explain"), and on A2 also `Homeowner phone`, `Office life
support result` / `Life support equipment at property?` and `Was the ceiling or roof built…` — all absent live. It still
requires `Upgrade area diagram or floor plan` (alias `Upload your area sketch or floor plan.`) which decision 211 retired
(and the A2 one-line label would not even match). It does **not** know `Insulation product`, the contact-permission
question, the difficult-access pair, the R-value choice, the outcome question or `Title address`, which the readers depend
on. Net effect: form health can neither prove the live forms are complete nor warn when a needed question is deleted.
The build sheet must be rewritten to the lean list (§6.4).

### 3.4 STOP-blocks that stop (or fail to stop) a tradie wrongly

| Situation | Live behaviour | Problem |
|---|---|---|
| Access = **No safe access** | Note required, then the form continues: "How many ceiling areas" is mandatory, so the tradie must invent an area to finish | Should end the form (outcome = failed, reason "No safe access"). Reader: `/difficult\|hard\|restricted/`, `/moderate\|medium\|standard/`, `/easy\|good/` — "no safe access" matches none → issue "Ceiling access answer not recognised – office review required", not a stop. **Reader change needed** (map to `difficult` + stop, or new stop reason). |
| Owner permission = **No** (A1) | Hard stop in the portal (`STOP_NO_CONTACT`), but the form carries on through measuring and pricing | Should end the form after a short note. |
| Life support = Yes / built in last 5 years = Yes (A1) | Office stops; form continues | Acceptable (office decides), but the tradie should be told on the form that the office will call before anything goes out. |
| Outcome = **No - Ready Check failed** (A1) | Section 004 (price, electrician) comes **before** 005 (outcome) — the tradie prices the job, then says it failed | Move the outcome question before the quote page and hide the quote page on failed. |
| Outcome = failed, product | Product is asked only on the **passed** branch (both forms). A form failed then corrected to passed later keeps the product; fine — but a "passed" form with the product left blank holds the quote with "Office needs to: confirm insulation product". Make it Required (22 Oct: unknown). | |
| R value = "Above R2.0" | Stop. But the rule (source of truth) is **"R2.0 exactly is not less than R2.0"** — a measured R2.0 is a fail, and the live wording tells the tradie to tick *Below* for it | **Wording error with an eligibility consequence.** Change to `R2.0 or above`; reader regexes (`isRValueBand`, `STOP_R2` test, `readyCheckFactsFromEntries` `/^below/`) need the new phrase (`/^r?\s*2(\.0)?\s*or\s*above/`). |
| Outcome = passed while an area says Above R2.0, or permission = No | The portal stops it anyway; the installer's "passed" is contradicted silently | Either drop the subjective question or make its help text say "the portal applies the eligibility rules from your answers; this is your overall call". |

### 3.5 Confusing wording

- "What is the **determined** R value of the existing ceiling insulation?" — jargon; and the only answers are two bands.
  Lean wording: `Existing insulation level in this area` with `Below R2.0 (thin, patchy or old)` / `R2.0 or above`.
- "Why did the property fail the ready check? **Select all that apply**" — on 22 Oct this was a single-line **text**
  question with a multi-select label (fixed to a list on 24 Oct; options not visible — check).
- "CLICK ON ME to add a ceiling area" — the label is an instruction shouting at the user.
- "How many ceiling areas need to be measured separately? Count areas separately where they have different roof/…" —
  the help text is cut in Mitti's own label; it explains a concept the dynamic repeater makes unnecessary.
- "Based on your onsite assessment, does this property meet the Ready Check requirements to proceed?" — 17 words for
  "Can this job go ahead?".
- A1 Title Page asks "Property type" as a choice with an Other text; A2 identical — but the earlier A2 had it as a text
  the portal prefilled; the prefill now needs an option match (`choiceOption`) — check the options are exactly
  `House` / `Townhouse` / `Unit or apartment`.
- "Life support equipment at property?" is prefilled from the office record on A1 and a Yes is a stop: the tradie may
  not realise they are confirming it. Help text: "Pre-filled from what the owner told us. Change it if you learn otherwise."

### 3.6 Prices on A2 / owner prices on A1

- **A2 asks a price:** `Difficult access fee ($ inc GST)`. It becomes a line on the owner's quote (`hiv-quote.core.ts`
  `DIFFICULT_ACCESS`, held over $500 — Jo 24 Oct decision 5) and the installer's cost. The label does not say whose price
  it is, and sits a page away from the tick "I confirm I have not discussed or agreed pricing with the homeowner".
  Keep the question (Jo priced it into our leads) but relabel: `Your difficult-access charge to Home Insulation Victoria
  ($ inc GST) — not discussed with the owner`. No other price on A2. ✔
- **A1 shows no owner price** — only the installer's own total and their electrician's price. ✔ The $349 fee, the rebate
  and the owner total are never on the form.

### 3.7 Floor plans / sketch uploads (decision 211: retired)

`Upload your area sketch or floor plan. Rough is fine. Mark this ceiling area and show the measurements used.` is on
**every** area copy: 22 instances on A1 (optional on 22 Oct) and 21 on A2 (optional). Decision 211: "the Ready Check
'Upgrade area diagram or floor plan' upload is retired (per-area sketch no longer asked). The portal generates a labelled
schematic from the Ready Check areas (one box per area: name, length × width, m², product, R-value)". Remove all
instances. Two things the generated diagram needs that the forms do not currently give the portal: the **area name is not
read** (§2.2) and **length × width are not asked** (only m²). Either add `Length (m)` / `Width (m)` back per area (the
reader already multiplies them when m² is blank) or accept a diagram of named boxes with m² only. §6 asks for m² only,
with name read — Jo to choose; length/width would add 2 questions per area.

(For completeness: the README notes the A3 install form still carries the old "final roof-space plan" upload (010.002),
also retired by decision 211 — out of scope here.)

---

## 4. Everything else found (numbered for the top-10 list)

1. **Ceiling-area block ×21/22** (§3.1) — 93–95 % of all items; edit-in-22-places; A1 dynamic + fixed double-count risk.
2. **Retired sketch/floor-plan upload** still asked 22 + 21 times (§3.7).
3. **Build sheet ≠ live forms**: `validateTemplate` fails both; readers' labels not in the spec (§3.3).
4. **"Above R2.0" wording** lets an exact R2.0 be marked Below — eligibility error (§3.4).
5. **"No safe access" and "permission = No" do not end the form**; "No safe access" is not even recognised by the reader (§3.4).
6. **Area name read by nobody** although decision 211 and the install-day zone check (A3 `Zone N — name…`) need it; a one-area job has no recorded name (§2.2).
7. **Hazard photo dropped** on 24 Oct ("Please explain" text replaced "Describe the issue and add a photo") — the SWMS-input evidence the earlier audit relied on is gone, and the spec still expects media.
8. **Nine dead questions** (depth mm, describe type, describe roof, two access explanations, property-type Other, hazard explain, plus the area name and sketch) = 114 unread items on A1.
9. **Completion can be pressed with blanks**: both 22 Oct definitions have `mandatory_mark_as_complete: false`; the portal's `formComplete` is Mitti's Complete flag, and `finishMittiReadyCheck` / auto-send run from it. Check the live setting; it should be on.
10. **Outcome asked after the price on A1** and product only on the passed branch (§3.4); the subjective outcome duplicates the derived stops.
11. A2's access fee is an unlabelled price question beside a "no pricing discussed" tick (§3.6).
12. A1 vs A2 drift beyond price (§5).
13. Photo Required flags differ (22 Oct: A1 access photo optional, A2 required; A1 depth/overview required, A2 optional) — Jo 23 Oct made photos optional (install-day lock covers them); check both forms now agree.
14. "Why did the property fail… Select all that apply" became a list on 24 Oct — options unknown; the portal only files them.
15. The 8 product options (decision 150) cannot be verified from the dump — **check both forms show exactly** the eight labels in `APPROVED_PRODUCTS`; any spelling difference holds every quote with "Office needs to: confirm insulation product".

---

## 5. Differences between A1 and A2 (live)

Should be only: A1 asks the installer's price. Actual differences:

| Area | A1 | A2 | Keep? |
|---|---|---|---|
| Title Page | + Homeowner phone, Homeowner email, "Homeowner agrees to be contacted…", "Life support equipment at property?", "Was the ceiling or roof built or replaced in the last 5 years?" | not asked | **Justified** (our-lead facts come from the website/job; Mitti-first pickup on A1 needs them on the form). Keep, but note it is a second difference. |
| Site Verification, Difficult branch | explain → charge → fee | charge → fee → explain | Cosmetic; align. |
| Ceiling Assessment | 7 branches (dynamic "CLICK ON ME" + fixed 1–6), label with example line | 6 fixed branches, one-line labels | Make identical (one repeater). |
| Quote section | "Your quote to the homeowner" (7 questions incl. electrician) | none | **The intended difference.** |
| Outcome | outcome, reasons, product, signature | + "I confirm I have not discussed or agreed pricing…" tick (decision 28) | Justified second difference (A2 tick). |
| Signature text | "…measurements, photos **and quote**…" | "…measurements and photos…" | Fine. |
| Photo Required flags | (22 Oct) access optional; depth/overview required | access required; depth/overview optional | Align: all optional (install-day lock). |

So the forms should differ in exactly three places: A1's quote page, A1's five owner-contact/stop questions, A2's
no-pricing tick. Everything else identical, down to the label text.

---

## 6. Proposed LEAN Ready Check

Design rules: one page per group; every question a tap unless a number or name is needed (Jo's working rule, 24 Oct);
each label exactly as the portal reads it today, or the reader change named; every rule-required item kept; the per-area
block appears **once** as a repeating group; no sketch; no dead questions. Counts exclude page headings. **A1 = 40, A2 = 34.**

Legend: Type · Required · Show when · *Reader*.

### Page 1 — Job (prefilled by the portal; the installer only corrects) — 6
1. `Portal Job Number` · Text · Required · *PREFILL, link check*
2. `Site address` · Text · Required · *PREFILL*
3. `Homeowner name` · Text · Required · *PREFILL*
4. `Homeowner phone` · Text · Required · *contactAnswers.phone* (A2: prefilled from the job)
5. `Homeowner email` · Text · Required · *contactAnswers.email* (A2: prefilled)
6. `Property type` · Pick one: `House` / `Townhouse` / `Unit or apartment` · Required · *PREFILL via `propertyTypeOption`*. (Drop the Other text — unread.)

### Page 2 — Before you go up — 4
7. `Homeowner agrees to be contacted by Home Insulation Victoria` · Yes/No · Required · *permission; No = STOP_NO_CONTACT*. Help: "If No, finish with 'Can this job go ahead?' = No."
8. `Life support equipment at property?` · Yes/No · Required · prefilled on A1 from the office record · *STOP_LIFE_SUPPORT (A1); ignored on A2 (website answer rules)*
9. `Was the ceiling or roof built or replaced in the last 5 years?` · Yes/No · Required · prefilled from the owner's answer · *STOP_BUILT_5 (A1); ignored on A2*
10. `Who lives at the property?` · Pick one: `Owner lives here` / `Private rental – tenant lives here` / `Public housing` / `Community housing` · Required · **new** (Activity Guide Appendix C "premises type", earlier audit A1-1; no reader yet — add to `parseAudit` notes/ job record). Jo may defer this one; the count becomes 39/33 without it.

### Page 3 — Roof and access — 5
11. `What type of roof does the home have?` · Pick one: `Tiles` / `Metal sheet` / `Other` · Required · *notes* (no describe box)
12. `How would you rate the ceiling access?` · Pick one: `Easy` / `Standard` / `Difficult` / `No safe access` · Required · *access_difficulty* — **reader change:** recognise `No safe access` (treat as difficult + new stop "No safe access to the ceiling"). Mitti: require a note on Difficult and No safe access (no separate text question).
13. `Is there a difficult access charge?` · Yes/No · Required · Show when 12 = Difficult · *difficultAccessFee*
14. A1: `Difficult access fee ($ inc GST)` · Number · Required · Show when 13 = Yes · *difficultAccessFee* (A1: inside your total, shown on the owner line).
    A2: same label (the reader needs it) with help text "Your charge to Home Insulation Victoria. Never discussed with the owner."
15. `Upload a clear photo of the ceiling access point` · Photo · Optional · *photoGaps.access → install-day lock*

### Page 4 — Ceiling areas (ONE repeating group "Add a ceiling area"; no "How many" question) — 14 per area
16. `Which part of the home does this ceiling area cover?` · Text · Required · Help: "Name it the way it will be named on install day, e.g. Main house, Rear extension, Garage." — **reader change:** `parseAudit` rooms must keep this name and write it to `areas.v1` (decision 211 diagram; A3 zone-name prefill).
17. `Enter the measured ceiling area (m²)` · Number · Required · *measured_area_m2 (sum)*. (If Jo wants the diagram to show length × width, replace with `Length (m)` + `Width (m)` — both already read — at +1 question per area.)
18. `How was this ceiling area measured?` · Pick one: `Laser measure` / `Tape measure` / `Floor plan` / `Other` · Required · *notes*
19. `Tell us how you measured it` · Text · Required · Show when 18 = Other · *notes*
20. `Is there existing insulation in this ceiling area?` · Yes/No · Required · *insulation_present*
21. `What type of existing insulation is installed? Select all that apply` · Tick all: `Batts` / `Loose fill` / `Other` · Required · Show when 20 = Yes · *removal type* (no describe box; "Other" already raises an office note)
22. `What is the determined R value of the existing ceiling insulation?` · Pick one: `Below R2.0` / `R2.0 or above` · Required · Show when 20 = Yes · *STOP_R2 / belowR2* — **reader change** for the new second option (`isRValueBand`, `readyCheckStopReasons`, `readyCheckFactsFromEntries`). Help: "R2.0 exactly counts as 'R2.0 or above'. Typical: old 50–70 mm batts or thin loose fill = Below R2.0."
23. `Upload a photo clearly showing the measured insulation depth` · Photo · Optional · Show when 20 = Yes · *photoGaps.depth*
24. `What is required for the existing insulation?` · Pick one: `Remove` / `Top up` / `Not sure` · Required · Show when 20 = Yes · *removal_required*
25. `How much existing insulation needs to be removed? (m²)` · Number · Required · Show when 24 = Remove · *removal_m2*
26. `Upload an overview photo of this ceiling area` · Photo · Optional · *photoGaps.overview*
27. `Are there recessed downlights in this ceiling area?` · Yes/No · Required
28. `How many recessed downlights?` · Number · Required · Show when 27 = Yes · *downlights_qty*
29. `Are there any issues that could affect the insulation installation? Example: exposed wiring, vermin, restricted access or other hazards` · Yes/No · Required · *hazards flag*
30. `Describe the issue and add a photo` · Photo (with note required) · Required · Show when 29 = Yes · matches the spec alias; the earlier form had it; feeds the SWMS. (Replaces the unread "Please explain".)

Dropped from the block: sketch/floor plan (211), depth (mm), "Please describe the existing insulation type", "Please explain".

### Page 5 — Product and result — 4
31. `What insulation product will you be using on this job?` · Pick one, exactly: `Bradford Gold R5` / `Bradford Gold R6` / `Bradford Gold R7` / `Fletchers Pink Batts R5` / `Fletchers Pink Batts R6` / `Fletchers Pink Batts R7` / `Earthwool R5` / `ECOWOOL R5` · Required · *resolveMittiProduct* (always shown — not only on "passed")
32. `Based on your onsite assessment, does this property meet the Ready Check requirements to proceed?` · Pick one: `Yes - Ready Check passed` / `No - Ready Check failed` · Required · *rcOutcome*. Help: "The portal also applies the rules from your answers above." (Jo may rename it `Can this job go ahead?` — then `parseAudit` alias needed.)
33. `Why did the property fail the ready check? Select all that apply` · Tick all: `Existing insulation is R2.0 or above` / `Ceiling or roof built or replaced in the last 5 years` / `No safe access to the ceiling` / `Homeowner does not want to proceed` / `Homeowner has not agreed to be contacted` / `Other – explain in a note` · Required · Show when 32 = failed · *failReasons*
34. A2 only: `I confirm I have not discussed or agreed pricing with the homeowner during this Ready Check. All quotes and pricing come from Home Insulation Victoria.` · Checkbox · Required · *notes (decision 28)*

### Page 6 — A1 only: Your quote to the homeowner (Show when 32 = passed) — 7
35. `What’s included in your quote?` · Tick all: `Ceiling insulation - supply & install` / `Removal of existing insulation` / `Other` · Required · *quotedPriceFromEntries* (`PRICE_ALIASES` already maps the first option; "Difficult access" is NOT an option — it is question 13/14)
36. `What else is included?` · Text · Required · Show when 35 has Other
37. `Total quoted price (inc GST)` · Number · Required · *BASIC_PRICE*. Help: "Your whole price to the owner for the insulation work, including any difficult-access charge. Home Insulation Victoria adds the electrical safety check and its $349 fee and takes off the rebate."
38. `Who is doing the electrical safety check?` · Pick one: `Home Insulation Victoria electrician` / `My usual electrician` / `A different electrician` · Required · *resolveMittiElectrician*
39. `Electrician name` · Text · Required · Show when 38 = A different electrician
40. `Electrician licence number` · Text · Required · Show when 38 = A different electrician
41. `Electrician price (inc GST)` · Number · Required · Show when 38 = A different electrician

### Page 7 — Sign — 1
42. A1: `I confirm the information, measurements, photos and quote provided in this Ready Check are accurate to the best of my knowledge.` · Signature · Required
    A2: `I confirm the information, measurements and photos provided in this Ready Check are accurate to the best of my knowledge.` · Signature · Required

**Counts:** A1 = 6 + 4 + 5 + 14 + 3 + 7 + 1 = **40**; A2 = 6 + 4 + 5 + 14 + 4 + 1 = **34**. The 14 per-area questions
are counted once; a two-area house adds 14 taps, not a second form.

### 6.4 Portal changes the lean forms need (small, all in one PR)

| Change | Where | Why |
|---|---|---|
| Rewrite `READY_CHECK_FIELDS` / `PRICING_FIELDS` to exactly §6 (drop Assessor, details-correct pair, extras trio, Length/Width-or-m² alternative stays, sketch; add product, permission, life support, 5-year, access pair, R-value choice, outcome + reasons, A2 tick) | `src/lib/mitti-forms.core.ts` | form health / `connectMittiForm` prove the real questions (problem 3) |
| Accept `R2.0 or above` (and keep `Above R2.0` for old forms) | `isRValueBand`, `readyCheckStopReasons`, `readyCheckFactsFromEntries` | problem 4 |
| Recognise `No safe access` → `access_difficulty = difficult` + stop reason | `parseAudit`, `ready-check-answers.core.ts` | problem 5 |
| Read `Which part of the home does this ceiling area cover?` into each room and persist as the area label (`areas.v1`); one-area default "Main ceiling" | `parseAudit` rooms, `ready-check-areas.core.ts` | problem 6, decision 211 diagram, A3 zone prefill |
| Read `Who lives at the property?` to the job record (Appendix C premises type) | `parseAudit` → notes / job field | new question 10 (optional) |
| Nothing else: every other label is read today. | | |

**Must-test before switching templates:** one TEST job per form, two ceiling areas via the repeater, marked Complete:
`measured_area_m2` = sum of both areas (proves distinct parent ids), product recognised, A1 quote drafted, A2 quote
drafted with the access fee line, "Needs finishing…" cleared.

---

## 7. ChatGPT "Build with AI" prompt — rebuild BOTH Ready Check templates lean

Copy everything between the lines into ChatGPT. Same style as `docs/MITTI_PIESA_CHATGPT_PROMPT.md`.

---

You are helping me rebuild two form templates in **Mitti** (mitti.com.au field inspection app, web template builder). I
will follow your instructions click by click in the Mitti web app. Give me the build as a numbered list of steps I can
tick off, nothing skipped, for **Template 1 first, then Template 2**. The question wording, answer types, options,
Required settings and "only show when" logic below are **fixed and must be copied exactly, character for character,
including punctuation, capitals, the ² symbol and the curly apostrophe in "What’s"**, because a connected software system
reads every answer by its question text. Do not reword, reorder, merge, split, add or drop any question. If Mitti does
not offer an answer type I name, tell me the closest Mitti type and ask me before substituting.

**Template 1 name:** `A1 – Ready Check | Installer-Supplied Customer (lean)`
**Template 2 name:** `A2 – Ready Check | HIVIC Sourced Customer (lean)`
The two templates are identical except where a line says **A1 only** or **A2 only**.

**Inspection title:** Portal Job Number + Site address (questions 1 and 2).
**Settings:** turn ON "answers to mandatory questions are required before the inspection can be marked complete" (or
Mitti's equivalent). Turn ON location/GPS for every Photo question.
**Pages:** one page per ## group below; page breaks do not matter to the reading software.
**Questions marked "portal fills this in"** are pre-filled by the software on every form it creates. Keep them as normal
editable items so the installer can correct them.
**The repeating group (Group 4):** build it ONCE as a repeating / dynamic section the installer adds with a button
labelled `Add a ceiling area`. Do NOT ask "how many areas" and do NOT paste copies of the group into separate logic
branches. If Mitti's repeating section cannot contain "only show when" logic inside it, tell me before building and
propose the closest structure that still keeps every question text exactly as written.

Answer-type key: Text = single line text; Number = numeric; Yes/No = two choices `Yes` and `No`; Pick one = single-select
multiple choice with the exact options listed; Tick all = multi-select multiple choice with the exact options listed;
Photo = photo/attachment; Checkbox = single checkbox that must be ticked; Signature = signature capture;
"note required" = Mitti's option that forces a note on that answer.

## Group 1: Job
1. `Portal Job Number` — Text — Required — portal fills this in
2. `Site address` — Text — Required — portal fills this in
3. `Homeowner name` — Text — Required — portal fills this in
4. `Homeowner phone` — Text — Required — portal fills this in
5. `Homeowner email` — Text — Required — portal fills this in
6. `Property type` — Pick one: `House` / `Townhouse` / `Unit or apartment` — Required — portal fills this in

## Group 2: Before you go up
7. `Homeowner agrees to be contacted by Home Insulation Victoria` — Yes/No — Required — help text: `If No, stop here and answer "No - Ready Check failed" on the last page.`
8. `Life support equipment at property?` — Yes/No — Required — portal fills this in — help text: `Pre-filled from what the owner told us. Change it if you learn otherwise; the office will call before anything goes out.`
9. `Was the ceiling or roof built or replaced in the last 5 years?` — Yes/No — Required — portal fills this in
10. `Who lives at the property?` — Pick one: `Owner lives here` / `Private rental – tenant lives here` / `Public housing` / `Community housing` — Required

## Group 3: Roof and access
11. `What type of roof does the home have?` — Pick one: `Tiles` / `Metal sheet` / `Other` — Required
12. `How would you rate the ceiling access?` — Pick one: `Easy` / `Standard` / `Difficult` / `No safe access` — Required — note required on `Difficult` and on `No safe access` — help text: `No safe access: take the access photo, then go to the last page and answer "No - Ready Check failed".`
13. `Is there a difficult access charge?` — Yes/No — Required — only show when question 12 = `Difficult`
14. `Difficult access fee ($ inc GST)` — Number — Required — only show when question 13 = `Yes` — help text A1: `Included in your total quoted price below; it is shown on the owner's quote.` — help text A2: `Your charge to Home Insulation Victoria. Never discussed with the owner.`
15. `Upload a clear photo of the ceiling access point` — Photo — Not required

## Group 4: Ceiling areas (repeating section, button `Add a ceiling area`; the installer adds one per area)
16. `Which part of the home does this ceiling area cover?` — Text — Required — help text: `Name it the way it will be named on install day, e.g. Main house, Rear extension, Garage.`
17. `Enter the measured ceiling area (m²)` — Number — Required
18. `How was this ceiling area measured?` — Pick one: `Laser measure` / `Tape measure` / `Floor plan` / `Other` — Required
19. `Tell us how you measured it` — Text — Required — only show when question 18 = `Other`
20. `Is there existing insulation in this ceiling area?` — Yes/No — Required
21. `What type of existing insulation is installed? Select all that apply` — Tick all: `Batts` / `Loose fill` / `Other` — Required — only show when question 20 = `Yes`
22. `What is the determined R value of the existing ceiling insulation?` — Pick one: `Below R2.0` / `R2.0 or above` — Required — only show when question 20 = `Yes` — help text: `R2.0 exactly counts as "R2.0 or above". Typical old 50–70 mm batts or thin loose fill are Below R2.0.`
23. `Upload a photo clearly showing the measured insulation depth` — Photo — Not required — only show when question 20 = `Yes`
24. `What is required for the existing insulation?` — Pick one: `Remove` / `Top up` / `Not sure` — Required — only show when question 20 = `Yes`
25. `How much existing insulation needs to be removed? (m²)` — Number — Required — only show when question 24 = `Remove`
26. `Upload an overview photo of this ceiling area` — Photo — Not required
27. `Are there recessed downlights in this ceiling area?` — Yes/No — Required
28. `How many recessed downlights?` — Number — Required — only show when question 27 = `Yes`
29. `Are there any issues that could affect the insulation installation? Example: exposed wiring, vermin, restricted access or other hazards` — Yes/No — Required
30. `Describe the issue and add a photo` — Photo with note required — Required — only show when question 29 = `Yes`

## Group 5: Product and result
31. `What insulation product will you be using on this job?` — Pick one, in this order: `Bradford Gold R5` / `Bradford Gold R6` / `Bradford Gold R7` / `Fletchers Pink Batts R5` / `Fletchers Pink Batts R6` / `Fletchers Pink Batts R7` / `Earthwool R5` / `ECOWOOL R5` — Required
32. `Based on your onsite assessment, does this property meet the Ready Check requirements to proceed?` — Pick one: `Yes - Ready Check passed` / `No - Ready Check failed` — Required — help text: `The portal also applies the eligibility rules from your answers above.`
33. `Why did the property fail the ready check? Select all that apply` — Tick all: `Existing insulation is R2.0 or above` / `Ceiling or roof built or replaced in the last 5 years` / `No safe access to the ceiling` / `Homeowner does not want to proceed` / `Homeowner has not agreed to be contacted` / `Other – explain in a note` — Required — only show when question 32 = `No - Ready Check failed`
34. **A2 only:** `I confirm I have not discussed or agreed pricing with the homeowner during this Ready Check. All quotes and pricing come from Home Insulation Victoria.` — Checkbox — Required

## Group 6: Your quote to the homeowner — **A1 only** (whole group only shows when question 32 = `Yes - Ready Check passed`)
35. `What’s included in your quote?` — Tick all: `Ceiling insulation - supply & install` / `Removal of existing insulation` / `Other` — Required
36. `What else is included?` — Text — Required — only show when question 35 has `Other` ticked
37. `Total quoted price (inc GST)` — Number — Required — help text: `Your whole price to the owner for the insulation work, including any difficult-access charge. Home Insulation Victoria adds the electrical safety check and its $349 fee and takes off the rebate.`
38. `Who is doing the electrical safety check?` — Pick one: `Home Insulation Victoria electrician` / `My usual electrician` / `A different electrician` — Required
39. `Electrician name` — Text — Required — only show when question 38 = `A different electrician`
40. `Electrician licence number` — Text — Required — only show when question 38 = `A different electrician`
41. `Electrician price (inc GST)` — Number — Required — only show when question 38 = `A different electrician`

## Group 7: Sign
42. **A1:** `I confirm the information, measurements, photos and quote provided in this Ready Check are accurate to the best of my knowledge.` — Signature — Required
    **A2:** `I confirm the information, measurements and photos provided in this Ready Check are accurate to the best of my knowledge.` — Signature — Required

## When you have given me the steps
Finish with a checklist I can use to verify each published template: A1 has 40 questions and A2 has 34 (Group 4 counted
once), in this order; every "only show when" rule; Required exactly as marked; GPS on for every Photo; the repeating
section adds a complete copy of questions 16–30 each time; the eight product options spelled exactly; the mandatory-
before-complete setting on; and where in Mitti I find each **template ID** (in the web address when the template is open,
or under the template's settings), because I must send both IDs to my software team. Also remind me to keep the old A1
and A2 templates unpublished but not deleted until every form in progress on them is complete.

---

---

## 8. Reconciliation with the earlier (no-live-definitions) audit

| Earlier finding | Live result |
|---|---|
| Finding 1 — spec and readers have drifted | **Confirmed and worse**: `validateTemplate` would fail both live forms on Assessor, details-correct, extras trio, hazard photo, and (A2) phone / life support / 5-year; readers' labels still absent from the spec. |
| Extras trio, Assessor, "Price already agreed", `Describe the roof type` "A1 never had it" | Extras trio and Assessor: absent on both (good). `Describe the roof type`: **present on both** (unread). "Price already agreed": absent. |
| "Difficult access" option inside "What's included" | Removed from the option set on 23 Oct per the plan; the 22 Oct fixture still had the 3-option set; keep `PRICE_ALIASES` as legacy only. |
| Floor plan "CAPTURED (spec) — confirm on live A1" | Present ×22 on A1 and ×21 on A2 and **retired by decision 211** → remove. |
| Zone naming free text, one-area job unnamed | Confirmed; and the name is read by **nothing**. |
| A1-1 premises type gap | Still a gap → §6 question 10. |
| A1-3 year built / asbestos; A1-4 foil/conductive | Not on the lean Ready Check: foil/conductive went to the install form (decision 210 c); year built deferred. |
| A2 "Office life support result" display-only text | A2 no longer asks life support at all (website answers rule) — fine. |
| A2 subjective outcome question "not in the spec; candidate to remove" | On **both** forms; kept in §6 (installer's overall call + fail reasons the office files) but ordered before the A1 price page. |
| "verify the 8 product options are published on both" | Still unverifiable from the dump — check item in §4 (15). |
| Hazard photo "Describe them and add a photo" as SWMS input | **Gone on 24 Oct** (now text "Please explain") → restored in §6 question 30. |
| Zone-name prefill on A3 from the Ready Check | Still needed; depends on the new area-name reader (§6.4). |

New since that audit: the ×21/22 copy structure, the dynamic-plus-fixed double-count risk on A1, the "Above R2.0" wording,
the No-safe-access dead end, `mandatory_mark_as_complete` off, the A2 access-fee labelling, and A1 pricing before outcome.

---

*Prepared 24 Oct 2026 from the live Mitti item lists (README.txt in the fetch folder), the 22 Oct published fixtures, and
the readers listed at the top. No Mitti template or portal code was changed.*
