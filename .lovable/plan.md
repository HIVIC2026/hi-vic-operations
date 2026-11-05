# Launch incident — isolated portal QA

## Scope and safety
Extend the existing `portal-qa` command with an explicit local-only isolated browser mode. Use synthetic role sessions and realistic fixtures, with production database access and third-party delivery unavailable. Do not deploy, send, change live records, policies, prices or Mitti wording. Preserve concurrent edits and Claude’s protected files; do not rebuild or integrate PR #172 during this work.

## Checks
1. Establish a browser harness around the real portal screens/components, replacing only authentication, data and provider boundaries. Prefer disposable database-backed fixtures; otherwise label browser checks as mocked-response evidence, not backend or security proof.
2. Reproduce ordinary UI blockers in the available current journeys. Repair only demonstrated frontend defects outside protected files; run the same affected check before and after.
3. Inventory active routes and controls by role. Exercise dashboard and job drilldowns, onboarding, Ready Check, quote, safety check/rectification, install and owner/office handoffs where realistic fixture support exists.
4. Check phone and desktop layouts, two signed-in tabs, refresh/back, saved-data readback, request failure and retry. Keep unreached routes/actions BLOCKED or NOT_RUN.
5. Produce exact counts, command, route inventory, screenshots/traces and remaining gaps. Make the isolated command suitable for pull requests without automatically enabling hosted workflows.

## Technical approach
Reuse the existing standalone Vite portal browser configuration and test stubs. Add fail-closed import/network boundaries and a dedicated isolated dispatch before any production-connected QA code loads. Keep fixture mutations disposable and role-scoped. Run affected tests in separate processes to avoid cross-file mock leakage. Store run artifacts outside application source; no dependency changes unless the existing tools prove insufficient.
