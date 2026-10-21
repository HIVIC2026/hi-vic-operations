# QA safety clarification — preview only

Source at start: `7e22a0d6982cb846d4fba7ecf1869e3af14aa314`. No application/domain logic, wording, pricing, schema, auth, account, live job or communications changes. No publish. No setup/auth links, new logins, global switches or provider calls. Current live flow checks remain **BLOCKED / NOT_RUN**.

## Confirmed hazards and narrow tooling changes

- First Save My Spot calls `queueSpotSavedConfirmations`; qa_test does not prevent `sendTestEmail` reaching either real allowlisted inbox. The actual sender rejects reserved non-allowlisted addresses before provider access. Added isolated actual-sender test with mocked persistence and forbidden fetch/Twilio boundary: blocked_prelaunch records read back locally, zero provider calls. This is **isolated proof**, not live log readback.
- New `scripts/portal-qa-safety.ts` requires qa_test, matching related marked TEST business, reserved `hivic-test.example` email and both contact channels denied by the existing test-send rule. Real Jo inboxes/mobile fail the QA preflight; existing real-sender allowlist untouched. This helper does not grant access, select fixtures, send, write or mutate anything.
- Booking outcome no longer passes on stage/next-action alone. Absent exact persisted-window/zero-side-effect proof is NOT_RUN; explicit failed proof is FAIL. Proof reuses existing Melbourne calendar/window rules, requires same-job checked reads, current round's exact open persisted windows, 3–5 unique allowed picks on at least three business days, no windows_not_saved/advance_blocked, zero payment/invoice/provider effects. No calendar or business rule changed.
- Actual `submitReadyCheckWindows` tested with all persistence/workflow/dispatch sealed locally: three, four and five windows saved/read back; failed insert rejects and leaves no windows/chosen event. Unexpected financial/communication table access throws; network forbidden. No live acceptance, offers or booking executed.
- Browser rows now retain `requested_path`, final `landed_path` and viewport separately, without query strings. Canonical runner emits `landed-route-coverage.json`; requested redirects do not become distinct-page PASS. Unknown/missing completed rows remain NOT_RUN. Runner rejects both recipient-send and fixture-setup flags; adds isolated safety suites to its existing fresh-process phase.

## Route-count correction

Prior 82 PASS / 0 FAIL / 114 NOT_RUN is historical, not rerun. Prior `.browser.json` lacked final destination fields, so **34 requested route targets × two viewports was NOT 34 independently established rendered destinations**, nor full portal coverage. Original standard Office aliases resolve predominantly to three screens; expanded checklist included additional paths, but their exact current landed destination count is **unverified** until a permitted existing-session run. No old results relabeled. Current checklist awaits review; all controls still NOT_RUN unless specifically clicked. Source redirects independently confirm operations/enquiry-groups → Enquiries and pipeline/default board → Active jobs.

## Fixture and session preflight (SELECT only)

Restricted to the existing Dad/Lorraine TEST business IDs `6a1cfe8a-9314-4f41-bcd9-4b6d15b25a0f`, `4beba4a5-e03b-4af8-9d24-3196249f8632`: 13 qa_test jobs, eight aggregate reserved-email/non-allowlisted-phone/marked-business candidates. No contacts, tokens or customer records exported. Candidate count is **not** complete flow authorization: exact owner/business/access/consents/events/snapshot/queue effects and existing session must pass immediately before any action. No candidate was used or changed.

Existing injected session and previously minted session file unavailable. New auth changes/logins forbidden. Thus **live Save My Spot, blocked_prelaunch readback, Ready Check acceptance/window save/book/readback, financial/outbound counts after actions and current authenticated destination rerun NOT_RUN**. No unsafe real-contact substitution, fixture setup or TEST-row snapshot started. No restoration necessary because no live rows changed.

## Tests and verification

Fresh isolated processes: safety+coverage10 PASS; actual sender boundary1 PASS; actual window persistence4 PASS; existing no-size campaign8 PASS; existing browser/runner screen rules14 PASS: **37 PASS, 0 FAIL**. The no-size campaign test uses its existing fake sender and is not asserted as live provider denial; actual-sender test supplies separate boundary proof. Python harness syntax checked; diff check clean. Automatic preview diagnostic build OK; separate typecheck not run (harness-managed). No full canonical browser rerun since it provisions sessions; no new PASS counts substituted for historical82.

Changed files: `scripts/portal-qa-safety.ts`, `scripts/portal-qa-coverage.ts`, `scripts/portal-qa.ts`, `scripts/AGENTS.md`, `e2e/journey/shoot.py`, `tests/portal-qa-safety.test.ts`, `tests/portal-qa-coverage.test.ts`, `tests/test-send-reserved-boundary.test.ts`, `tests/ready-check-window-readback-isolated.test.ts`, `roadmap.md`, this report; project memory stores Jo's QA-contact requirement. No application files changed.

Open blockers: no permitted existing authenticated TEST session for live workflow/destination checks; no fully preflighted restorable safe owner fixture; remaining Office enquiries <1s not achieved (prior measurement unchanged). Root route checklist review pending. No migration proposed/executed and no background work continues after this task.