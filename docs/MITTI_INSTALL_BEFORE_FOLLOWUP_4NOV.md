# Install-day BEFORE and floor-plan follow-up

## Built and checked

- Explicit Floor plan ceiling m² feeds the normal measured area, layout quantity and diagram; no hidden length/width fallback. Old dimensions remain supported.
- Floor-plan media IDs and per-area references are preserved; the normal Ready Check sync copies actual attachments into private job files idempotently and reports failed copies for retry.
- A5 can prefill a single ordinary text field named `Ceiling areas in Ready Check order` as `1. Main house · 2. Rear extension`. This is not repeated-instance prefilling and needs that field in the supplied draft.
- Pure automatic BEFORE-need rules cover missing video, old insulation with missing ruler photo, office rejection and all areas with no Mitti Ready Check. A server reader derives this from current stored facts. This rule is staged, not wired to unproven conditional template creation.
- A5 sync detects added area names, records a scope-review event and raises one Needs me candidate without repricing. Completion remains held for scope review. No accepted quote is changed.

## Mitti capability result — not yet an operational BEFORE pathway

Audit creation using a configured alternative template ID is supported by the existing client. The API payload for read-only hidden answers and creating/prefilling repeat instances is **not established** by the saved API evidence. No template API writes/probes were made.

Option (a), a separate validated Install day variant, is the safer approach, but a generic extra repeat block does not meet the area-specific requirement: it could still let the installer choose which areas need evidence. A usable variant needs fixed portal-selected area blocks or documented immutable conditional selectors per area. That definition/behavior must be supplied and checked before wiring creation. No invented hidden-answer payload or guessed alternate template ID was added.

The current A5 creation/read path is therefore not claimed complete for conditional BEFORE capture, reuse of those new facts into the official installer assessment, suppression of every accepted ruler question, or no-Mitti-Ready-Check installs. Its existing Ready Check/prestart gates were not bypassed. This part waits on Mitti's confirmed draft behavior.

## Exact instructions and field changes for Jo/Mitti

- BEFORE video: `The power is off, so use a bright torch or work light.`
- AFTER video: `The power is still off, so use a bright torch or work light.`
- Methods: Floor plan / Laser measure / Tape measure / Other; Tape measure remains the FAILED option in Mitti, not a silent Gate 1 override.
- Method instruction: `Got a floor plan for the whole house? Pick Floor plan and add just one area called 'Whole house'.`
- Floor plan branch: `Ceiling area from the floor plan (m²)` and `Upload the floor plan (photo or PDF)`.
- File instruction: `The whole plan, readable, with the areas you're insulating marked.`
- Floor plan hides length/width/calculated area; other methods retain length × width. The portal sums validated individual areas, never trusts a separate total instead.
- A5 needed-area blocks must retain Ready Check names, BEFORE video/whole-area photo, measurement and old-insulation facts, removal/top-up reason/R value, downlights and hazards; no batt questions. No installer-controlled “need BEFORE” answer.

## TEST quote browser check

Signed in with the existing `qa_office` account through the real sign-in page; reached `/admin/needs-me`. The page displayed an AsyncLocalStorage browser-import error instead of office content. Screenshot inspected. The review card was not reached; both-options display, held warning and Send main only are NOT RUN.

No practice quote was created: authenticated office content failed to load, and sampled TEST jobs did not have the mandatory persisted no-delivery marker. No admin account was substituted and no delivery controls were weakened. This needs the office-page import issue resolved and a safe TEST setup before the requested browser proof can be completed.

## Verification

Red-first measurements/BEFORE tests were run before their implementations. Related suite: **151 passed, 0 failed across eight files**. Latest automatic compilation/type checks: **build OK**. Browser sign-in confirmed only; no end-to-end conditional Mitti draft proof or two-user data-isolation exercise was completed. No Mitti templates, communication switches, real records, sends or publishing changed.