# Plan: SWMS house facts, re-sign on change, sign on the Lead's phone

Spec: `docs/superpowers/specs/2026-10-30-swms-house-facts-design.md`
Branch: `swms-house-facts`. Open a pull request when done; do NOT merge (Jo's rule: only the coordinating chat merges).

Every step is test-first: write the failing test, run it, make it pass, run the full SWMS tests (`bun test tests/swms*.test.ts`), commit.

## Where the data is (read-only, already stored)

| Fact | Source |
|---|---|
| Roof type, access rating, access note, life support, built in last 5 years | Ready Check form answers: `ceiling_measurements.raw_snapshot` (current row), labels in `LEAN_Q` (`ready-check-lean.core.ts`) |
| Per-area foil/conductive, downlight count, issue note + area name | Same answers, grouped per area the same way `areasFromReadyCheckEntries` (`area-diagram.core.ts`) groups them |
| Life support (fallback) | `jobs.life_support_status` |
| PIESA result | `assessments.piesa_outcome`, `rectification_completed_at`, `hazards` |

## Step 1: pure house-facts reader (`src/lib/swms-house.core.ts`, new)

- `swmsHouseFacts(entries, extras)` returns `{ roofType, accessRating, accessNote, lifeSupport, builtLast5, areas: [{ name, conductive, downlights, issue }], piesa: { outcome, upgradesDone, hazards } }`. Any unknown value is `null`.
- `swmsHouseLines(facts)` returns the "Specific to this house" lines in this order: roof and access, ceiling facts, Ready Check issues, PIESA result. Lines for `null` facts are left out.
- `swmsHouseSteps(facts)` returns the four set safety steps, using the exact wording in the spec, each only when its fact is true (foil in any area, life support yes, access "Difficult", downlights > 0).
- Tests (`tests/swms-house.test.ts`): a full TEST form gives every line and all 4 steps; an empty form gives no lines; each step appears alone when only its fact is true; old-form labels (aliases) still read.

## Step 2: put the facts in the plan (`swms.core.ts`, `swms.server.ts`)

- Add `houseLines: string[]` and `houseSteps: string[]` to `SwmsFacts` and `SwmsPlan`. `buildSwms` copies them through.
- `swmsFacts` loads the current `ceiling_measurements.raw_snapshot`, the job's `life_support_status` and the PIESA fields, then calls Step 1.
- Keep the current asbestos rule as it is.
- `swmsRecordText` and the "Specific to this house" line: house lines, then safety steps, then the installer's note. "None recorded" only when all three are empty.
- Tests in `tests/swms.test.ts`: the record text has the lines in order; "None recorded" only when nothing is known.

## Step 3: PDF (`swms-pdf.server.ts`)

- The "Specific to this house" box prints the same lines as Step 2 (one per line, steps marked "Safety step:"). Wrapping and page-splitting already work.
- Update `scripts/render-swms-sample.ts`: the TEST plan gets a full TEST Ready Check and PIESA. Regenerate `docs/templates/compliance/swms/swms-sample.pdf` and look at every page.
- Test in `tests/swms-pdf.test.ts`: the long section still splits across pages without losing lines.

## Step 4: signatures only count for the version signed

- `swmsSignatures` also returns each signature's stored `plan_sha256`.
- Move the fingerprint into one pure function `swmsPlanSha(plan)` (plan without signers), used by both `signSwms` and `swmsStatus`.
- `swmsStatus(plan, sigs)` counts a signature only when its `plan_sha256` matches the current plan. `checkSwmsSign` lets a person sign again when their only signature is for an old version.
- `fileSwms` keeps working unchanged (it files once everyone has signed the current version).
- Tests: sign, then change the site note: that person shows as not signed; sign again: complete. Adding a crew member: only they show as unsigned.

## Step 5: sign on the Lead's phone

- New server function `tradeSwmsLeadPhoneLink(jobId, key)` (`trade-view.server.ts`, plus `.functions.ts` wrapper). It is allowed only when the signed-in person is this install's Lead, the key is another unsigned person on the plan, and the install isn't recorded yet. It returns that person's own sign link (`swmsSignLink`) with `via=lead`.
- `swmsLinkSign` reads `via=lead` and records the method as `"lead_phone"` (add it to `SwmsSignMethod`). The event text reads "(signed on the Lead's phone)". The typed name must still be that person's own name.
- `SafetyPlanCard.tsx`: for the Lead only, each other unsigned line shows a button "Sign on my phone", which opens that link. Others still see "Waiting for <name>".
- Tests in `tests/swms-own-phone.test.ts`: the Lead gets a link for a crew member; a crew member or another business can't; the signature is recorded as `lead_phone`; a wrong typed name is refused.

## Step 6: check and hand over

- Run the full test suite and the type check.
- Check every step against the spec, line by line.
- Push, then open a pull request (title "SWMS: house facts, re-sign on change, sign on Lead's phone") with the regenerated sample PDF attached. Don't merge.
