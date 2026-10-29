# Activity 48 batch 2 — eligibility checked automatically (design)

Date: 29 Oct 2026 · Owner: Jo · Branch `fix/a48-batch2-eligibility`. Ends with an open PR (no merge, no publish). Any live database change only after Jo says yes.
Source: 29 Oct Activity 48 audit — R2, R3, R6, R7, R8 (ESC Ceiling Insulation Activity Guide v1.2 §1.1.1, §1.1.3; DEECA industry pack slide 13).

## In plain words

The portal decides each eligibility check itself from the owner's enquiry answers and the Ready Check answers and area names. The property research is used only where it actually returns something: today only Vicmap address/planning/property and Google Solar (roof shape) run; Nearmap, Pricefinder, Vicmap buildings and the evidence provider are not set up, so building class, storey above and recent extension always come back "unknown" — an unknown research value never makes a check unclear. Jo does nothing when the answer is clear.

**Sample run on 1,893 real enquiries (29 Oct, read-only):** building type / roof above — 1,853 pass, 3 fail, 37 unclear; not built in 5 years — 1,849 pass (Ready Check still to confirm), 15 fail, 29 unclear; one upgrade per home — always pass. About 70 jobs would need a look, not 1,561.

| Check (rule) | Clear pass | Clear fail |
|---|---|---|
| Building class: Class 1, or a sole-occupancy unit in a Class 2 building (R2) | owner type is a house/townhouse/unit AND research doesn't say otherwise (or research says class1 / class2_sou) | research or owner says not a home |
| Ceiling space with a roof above, no storey above (R3) | house/townhouse with no "storey above" research flag; or unit where owner says top floor and research agrees | research says another storey above the ceiling, or owner says unit isn't top floor |
| Nothing built in the last 5 years — ceiling/roof above, or floor/structure/extension below (R6) | owner says older than 5 years AND Ready Check says ceiling/roof not built or replaced in 5 years AND no recent-extension research flag | Ready Check says built/replaced in 5 years, or verified build date within 5 years |
| Garages, carports, sheds excluded (R8) | — | any measured area whose name says garage / carport / shed is left out of the eligible m² automatically (never priced or claimed) |
| One upgrade per home (R7) | always pass — Jo 29 Oct: Activity 48 is new, so no home has had one. Live data: every stored owner answer was set to "no" on 29 Oct (originals kept only in `admin_config_events` `previous_upgrade_set_no`). New enquiries are stored as "no"; nothing is ever flagged for it | — |

**Results:** all clear pass → eligible, nothing for Jo. A clear fail → not eligible; the office can't override. Unclear, missing or sources disagree → one Needs me row "Eligibility needs a look — {which check}" with Pass / Fail buttons (office decision recorded with who/when). Office-only wording.

## Technical detail

- New pure `src/lib/a48-eligibility.core.ts`: `a48EligibilityChecks(facts): { key, result: "pass" | "fail" | "unclear", why }[]` for `building_class`, `roof_above`, `built_5_years`, `one_upgrade`; `excludedAreaNames(areas)` (case-insensitive "garage", "carport", "shed", "car port"). Facts come from existing `eligibility.core.ts` derivations (`classifyPremises`, `ncc_class_evidence`, `another_storey_above_relevant_ceiling`, `declaredTopFloor`, `over_five_years`, `age_evidence`, `recent_extension_or_added_storey_risk`, `previous_upgrade` / `previous_activity_48_confirmed`) and Ready Check answers (`ready-check-answers.core.ts`, incl. the "built or replaced in the last 5 years" answer and per-area names).
- `verified-eligibility.core.ts` `assessEligibility`: a `fail` blocks `eligible`; an `unclear` without an office decision keeps the job out of `eligible` with the Needs me row. `priorActivityBlocker` and every previous-upgrade reader treat the check as passed (no office prior-activity check needed, no row, no owner/office prompt); `enquiry.server.ts` stores `declared_previous_upgrade = "no"` for new enquiries.
- Office decision: event `eligibility_check_decided {key, result, by}`; a later change in the underlying facts re-opens the check.
- Eligible m²: measured areas named garage/carport/shed are excluded wherever the eligible area is totalled (quote lines and VEEC area facts); recorded as `excluded_area {name, m2}`.
- No new owner or trade wording.

## Testing
Test-first. Each check: pass / fail / unclear from sample fact sets (house + clean research; unit not top floor; storey-above research; owner older-than-5 + Ready Check "No"; Ready Check "Yes" built in 5 years; extension risk; previous upgrade other area). Office Pass/Fail clears the row; changed facts re-open. Garage area excluded from eligible m² and quote; normal areas unchanged. Existing eligibility, Ready Check, quote and VEEC tests; full suite vs baseline; tsc; retired scan.
