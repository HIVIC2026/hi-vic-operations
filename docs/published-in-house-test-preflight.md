# Published in-house TEST journey — safety preflight

Requested 2 Nov 2026 (23:17 UTC 1 Nov): three published-site journeys using TEST businesses/qa_test jobs, reserved/captured messages and simulated Mitti; restore temporary TEST configuration.

## Actual command result

`bun run portal-qa -- --read-only --base https://portal.homeinsulationvictoria.com.au`

**FAIL — tooling preflight:** exits before setup with “Read-only expanded performance QA targets localhost preview only.” No browser opened; no screenshot exists for this CLI refusal.

Independent source review confirms `journey --screens` hardcodes localhost browser navigation and creates its initial TEST job before later preflight. It omits payment-through-close stages and uses the older batch journey. It cannot establish the requested published in-house evidence. Running it would create TEST data without testing the requested target; it was not run. Removing the guard alone would not establish server-wide provider capture or isolated TEST setup.

## Requested step results

All workflow steps below are **NOT RUN**, with no screenshot: safe published in-house harness not available.

| Scenario | Step | Roles requiring screenshots | Status |
|---|---|---|---|
| Complete | Enquiry / Save my spot / quick taps | Owner, HIV office | NOT RUN |
| Complete | Given to installer | HIV office, installer office | NOT RUN |
| Complete | Ready Check booked/done | Owner, installer office | NOT RUN |
| Complete | Quote / accepts and signs | Owner, HIV office | NOT RUN |
| Complete | $349 Stripe TEST payment | Owner, HIV office | NOT RUN |
| Complete | PIESA booked / selected electrician email | Owner, installer office, electrician | NOT RUN |
| Complete | PIESA pass / deposit request / TEST paid | Owner, electrician, HIV office | NOT RUN |
| Complete | Install booked / day-before email | Owner, installer office, Lead Installer, HIV office | NOT RUN |
| Complete | Install / CoES / close | All applicable roles | NOT RUN |
| Cancellation | Owner cancelled | Owner, installer office, HIV office | NOT RUN |
| Handback | Can't do this one | Installer office, HIV office | NOT RUN |

## Findings / remaining work

1. Published read-only preflight unsupported by portal-qa (actual refusal).
2. Screen journey target hardcoded to preview; changing base alone is insufficient for safe provider boundaries.
3. In-house full/cancel/handback browser scenarios and payment/day-before/CoES/close actions missing from existing screen harness.
4. TEST preparation for in-house worker verification/ESC registration and restoration is not implemented by this runner.
5. Published deployment identity, job-bound sender/Mitti guards and Stripe TEST/Demo routing must be independently proven before any fixture preparation or page mutation.

No app bugs were reproduced; tooling blockers are not app failures. No code fixes or live TEST preparation attempted. No real/TEST rows, settings, launch hold, messages or publication changed; no temporary business configuration exists to restore. Morning private DOB SQL remains pending; do not apply it as a QA shortcut.