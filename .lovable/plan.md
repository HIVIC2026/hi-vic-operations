# Read-only finding: can the Save My Spot automatic rules block ENQ_01-queued enquiries?

Short answer: **Yes. Right now they block every one, old or new.** Nothing was changed or sent.

## How a queued enquiry reaches the rule check
- `supabase/manual_sql/ENQ_01_ENQUEUE_SAFE.sql` only adds jobs to the existing post-intake queue (its header says the worker ends in `maybeAutoRouteLeadEmail`).
- `src/lib/postintake.server.ts:66-67`: the worker calls `maybeAutoRouteLeadEmail(item.job_id)`.
- `src/lib/lead-email-routing.server.ts`, `maybeAutoRouteLeadEmail`: on the `offer_spot` route it calls `automaticSaveSpotGate(jobId, { route: "offer_spot", coverageVerified: true })`; if that is not allowed it returns `sent:false` and **never calls `sendSaveMySpot`**. There is no bypass for queued backlog jobs.

## The rule check: `src/lib/save-spot-rules.server.ts`, `automaticSaveSpotGate` (line 173)
Checks run in this order:
1. Settings readable/valid, else `rules_unavailable`.
2. `config.enabled`, else `selection_disabled`.
3. Job readable.
4. `lifecycleExclusion(stage)`.
5. `if (!config.activatedAt) return blocked("rules_unavailable", …)`, then `created < activatedAt` gives `historical` ("created before the current rules were switched on").
6. Route must be `offer_spot`.
7. Service coverage (skipped here because it was already checked).
8. `matchAutomaticRules` in `save-spot-rules.core.ts:328` (via `categoryPasses`, line 274) applies the saved filters (AND across them).

## What is saved in live settings now (read-only query of `workflow_settings.save_my_spot_auto_rules`)
- enabled: true; updatedAt 2026-10-16T11:07:12Z
- **activatedAt: null**
- Filters: eligibility = likely_eligible; insulation = none; jobStatus = preliminary_estimate_ready; enquiryDate = last_3_days (all on); postcode and ceiling area off.

## What this means
- **Today every automatic Save My Spot is blocked at step 5**, because `activatedAt` is null. The gate returns `rules_unavailable` ("Automatic sending rules are unavailable…") before it even looks at the date or status filters. Probable cause: the saved settings have `enabled:true` but no activation time was stamped (`prepareRulesForSave` stamps one only when the setting goes from off to on). This is inferred from the code and data, not proven.
- Even if `activatedAt` were set, older backlog enquiries would still be blocked twice:
  - `historical`: any job created before `activatedAt`.
  - `rule_mismatch`: `enquiryDate last_3_days` (`categoryPasses` "enquiryDate", line 304) fails any job created more than 3 days ago. `jobStatus` fails any job whose stage is not exactly `preliminary_estimate_ready` (line 300).
- Ineligible (`sendDecisionIneligibleEmail`) and insulation-details (`sendAutomaticInsulationDetails`) routes do **not** use this check, so ENQ_01 categories B and C are not blocked by it.
- The office's manual Save My Spot sending does not go through this check either (comment in `maybeAutoRouteLeadEmail`).

## Proposed next step
None. This was an inspection only. Whether to switch the rules off and on again (which stamps an activation time), widen the date window, or send the backlog manually is Jo's decision.
