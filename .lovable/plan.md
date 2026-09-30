# Eligibility-first intelligence overhaul and address cleanup

## Goal

Make every address appear once and replace the repetitive Property Intelligence experience with one clear, authoritative Gate 1 view based only on the actual Activity 48 eligibility requirements.

The locked Base44 intake and deterministic Gate 1 decision hierarchy remain unchanged:

```text
Hard failure → Does not appear eligible / reversible On Hold
Unresolved contradiction or required evidence gap → internal REVIEW REQUIRED
Remote checks pass but an eligibility fact needs onsite confirmation → Needs onsite confirmation
Remote eligibility checks pass → Likely eligible
```

## Confirmed problems

- Recent jobs store a complete formatted address in `address_line`, such as `8/2 Dundas St, Thornbury VIC 3071`, while separate state and postcode fields are also populated. The shared job view then appends `VIC 3071` again, producing `8/2 Dundas St, Thornbury VIC 3071, VIC 3071`.
- Address formatting is independently repeated in the job view, customer estimate, agreements, consent, Mitti, ESC and other records, so the same defect can recur in multiple places.
- The Eligibility tab currently stacks intake, the canonical Gate 1 rule table, the estimate, a second Property Intelligence summary, an override form and documents. Four separate areas repeat the outcome or reasons.
- The second intelligence summary derives three broad statuses from raw facts rather than the authoritative Gate 1 rules. This can look inconsistent or weak even when the underlying decision is correct.
- The stored intelligence data confirms the noise: all 37 current `residential_likelihood` facts are review-grade inferred signals, while 36 of 37 age facts are also review-grade. These should not be presented as though they decide eligibility.
- Historical intelligence runs include 2,155 recovered request-abandonment errors. They are audit history, not useful current eligibility evidence, and should not dominate the working view.
- The current Gate 1 next-action wording still says “Assign electrician”; the present workflow requires an installer for the free Ready Check measure-up, with the electrician used later for PIESA.

## What will change

### 1. Fix addresses everywhere

- Add one canonical address formatter that understands both input shapes:
  - a street-only `address_line` plus suburb/state/postcode fields;
  - a complete formatted `address_line` that already contains suburb/state/postcode.
- Prevent duplicate suburb, state and postcode tokens rather than blindly joining fields.
- Use that formatter for the shared job view and every server-generated address used by customer estimates, agreements, consent, ESC, Mitti and job records.
- Remove the repeated address display within the customer estimate/calculator screen while keeping the property clearly identified once.
- Preserve the original intake address and provenance; this is a display/normalisation correction, not destructive rewriting of Base44 snapshots.

### 2. Replace the Eligibility tab with one decision surface

The main view will show, in order:

1. **Gate 1 outcome** — one badge only, with the authoritative reason and next action.
2. **Actual eligibility requirements** — a concise table for:
   - Victorian premises;
   - Class 1 or Class 2 sole-occupancy residential premises;
   - qualifying relevant ceiling with roof cavity/exposed roof and no storey above;
   - relevant ceiling/structure older than five years;
   - no previous VEU ceiling-insulation upgrade / Activity 48;
   - existing insulation criterion, including what must be confirmed onsite.
3. **Evidence needed** — only unresolved items that can change the decision, each labelled declared, recorded or verified and linked to its source.
4. **Operational and safety notes** — life support, access, area and rollout controls shown separately and explicitly marked as not determining eligibility.
5. **Audit details** — collapsed source history, raw snapshots, run status and re-run control for office investigation.

### 3. Remove weak and repetitive intelligence presentation

- Retire the separate three-row Property Intelligence outcome summary.
- Stop showing planning-zone “residential likelihood”, solar summaries, roof shape, coordinates, parcel identifiers, provider availability and completeness percentages as decision-level eligibility evidence.
- Retain useful source records and snapshots in audit history, but only surface them in the main view when they directly support, contradict or leave unresolved an actual eligibility requirement.
- Keep preliminary ceiling area available to quoting and the free installer measure-up workflow, but remove it from eligibility reasoning because area is not an eligibility failure.
- Show Base44 preliminary screening once as contextual history only, never as a second decision.

### 4. One vocabulary and one workflow direction

- Centralise labels, colours and wording for Likely eligible, Needs onsite confirmation, Does not appear eligible and internal REVIEW REQUIRED.
- Reuse them on the pipeline, job header and eligibility view instead of maintaining separate mappings.
- Correct Gate 1 progression wording to assign an eligible installer for the free Ready Check measure-up; PIESA remains a later electrician/REC step.
- Keep admin overrides audited and visibly distinct from the current deterministic rules result.

### 5. Validate the overhaul

- Add regression tests for complete and split address inputs, including units and addresses already ending in `VIC 3xxx/8xxx`.
- Test every actual eligibility requirement across pass, review, onsite and hard-fail outcomes without changing the locked hierarchy.
- Test that non-eligibility information cannot change or visually masquerade as the Gate 1 result.
- Test that next actions send the free Ready Check to the installer and reserve PIESA for the electrician/REC.
- Check the pipeline, job file, eligibility screen, customer estimate and owner/trade screens at desktop and mobile sizes.
- Run the relevant tests, full suite, type check and preview build. Report any pre-existing failures separately rather than claiming untested coverage.

## Safety boundaries

- No Base44 changes.
- No new eligibility rules, invented evidence standards or official wording.
- No changes to the locked Gate 1 hierarchy or admin-decision protection.
- No customer communications, payments, Xero, Mitti external writes or publishing.
- Historical facts and source snapshots remain available for audit.