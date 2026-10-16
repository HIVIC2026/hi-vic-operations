# P1-R3-S102 — Step Record

```
STEP:            P1-R3-S102
TITLE:           COM-04 Dual-Mode (Manual + Automatic) Save-my-spot Remediation
AGENT:           R3 — Application & Integration Engineer
DATE:            2026-10-16 (AEDT)
BASELINE_SHA:    c4fc1482dce12d9357a6df91ced921cc0a19d417   (frozen RC1, integration/p1-rc1-s67)
WORKTREE:        /Users/jet.zhang/CopilotWorkspace/Loveable/wt-r3-p1-s102-com04-dual-mode
BRANCH:          r3/p1-s102-com04-dual-mode

OWNER DECISION:  RELEASE OPTION B + SAVE MY SPOT OPTION C (manual AND automatic),
                 existing CRM fields only — no new columns/groups/statuses/stages/migrations.

MODE:            TARGETED REMEDIATION + FOCUSED TESTS (mocked providers, no network)
  production writes ........ NONE
  shared/prod DB writes .... NONE (disposable UAT read-only schema inspection only)
  migrations applied ....... 0   (migration 0205 NOT applied)
  real email / SMS ......... NONE
  external provider calls .. NONE
  COM-04 switches changed .. NONE (customer_comms_enabled + save_my_spot_real_send_enabled both OFF)
  customer_delivery_settings UNCHANGED
  application code changes . comms-test-recipient.core.ts (new; reserved-domain-only synthetic check);
                             service-coverage.server.ts (new; positive VEU-postcode coverage);
                             hot-leads-send.server.ts (boundary: early + pre-provider);
                             followups.server.ts (Step-3 boundary);
                             lead-email-routing.server.ts (automatic offer_spot coverage gate)
  test changes ............. tests/p1-r3-s102-com04-dual-mode.test.ts (new, 36 tests);
                             4 send-path tests declare HIVIC_COM04_ENV=production;
                             3 automatic-path tests seed veu_location_variables (postcode 3000)
  push / merge / deploy .... NONE
  R1-owned env/config files  NOT modified

SCHEMA VERIFIED (read-only): jobs.eligibility_outcome + jobs.stage enums; indicative_estimates
  area_source / insulation_declared / area_m2; lead_campaign_responses.desk_check_status CHECK;
  owner_contact_consents.consent_status; customer_email_optouts.opted_out_at;
  customer_email_sends.idempotency_key / status / purpose.

KEY IMPLEMENTATION
  - Test-recipient boundary: explicit env model. HIVIC_COM04_ENV=production => inactive;
    otherwise non-production FAIL-CLOSED. Real (non-synthetic) recipients require a valid,
    non-empty HIVIC_COM04_TEST_RECIPIENTS allow-list; missing/empty/invalid => blocked. Synthetic is
    NARROW: ONLY RFC-reserved domains (example.com/org/net, .test, .invalid, .localhost) bypass;
    qa/+qa/disposable-mailbox addresses are NOT assumed synthetic and need an explicit allow-list.
    Validated on the final recipient immediately before the provider call on BOTH real paths.
  - Service-area coverage (automatic only): serviceCoverageEstablished requires a positive VEU
    Victorian postcode (veu_location_variables). Unknown/missing/unreadable => the automatic
    offer_spot send is blocked (route:"none", reason:"service_area_not_established"); customer left
    for Office manual review. No new column, no invented postcode rule. Manual sending is NOT gated.
  - Manual and automatic Save-my-spot share the SAME gates (realSendingOn + sendOne); no separate
    automatic sender. Automatic fires only from the post-Gate-1 router for new official decisions;
    no historical/bulk automatic send added.

TESTS:  tests/p1-r3-s102-com04-dual-mode.test.ts = 36 pass / 0 fail
        full isolated suite (scripts/test-isolated.ts 8) = 339 files / 3354 pass / 0 fail
        (baseline 338 files / 3318 pass; +36 new, 0 regressions)
TYPES:  tsc --noEmit => exit 0, 0 errors
BUILD:  bun run build => exit 0; client bundle has NO service_role / sb_secret_ value inlined
        (only the public publishable key; S99 B3-06 admin-module note unchanged)

VERDICT
  Code + safety gates .......... READY (manual + automatic share gates; boundary tested; fail-closed)
  B-7 real end-to-end delivery . NOT_READY (0205 unapplied, no isolated target, no delivery verification)
  Automatic production sending . NOT production-ready (requires §9 approvals + isolated delivery test)

LIMITATIONS (not silently worked around)
  L1 Service-area coverage is ENFORCED for automatic sending (positive VEU postcode); residual: it
     establishes a covered VEU location, not installer availability.
  L2 needs_onsite_confirmation not auto-sent as fully-verified; provisional copy is a business decision.
  L3 0205 unapplied => secondary switch inoperable in production (fail-closed meanwhile).
  L4 No isolated non-production target (Preview shares production).

REPORT:  docs/phase1/release/P1-R3-S102_COM04_DUAL_MODE_REMEDIATION.md
COMMIT:  local only on r3/p1-s102-com04-dual-mode — NOT pushed, NOT merged, NOT deployed.
```
