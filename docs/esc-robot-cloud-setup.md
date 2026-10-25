# ESC Registry robot – running it from a Claude cloud session (decision 385)

The ESC Registry robot (decision 272) fills the VEU Registry web form for the install notification and VEEC creation.
It cannot run inside the portal (the deployed worker has no browser), so it runs as `scripts/esc-registry-robot.ts` on
a separate machine. Jo chose a separate **Claude cloud session on a schedule** (decision 385, 25 Oct 2026).

That machine **never gets the database key**. The robot talks to the portal only through the robot API
`POST https://estimate.homeinsulationvictoria.com.au/api/public/hooks/esc-robot`, protected by its own secret
`ESC_ROBOT_TOKEN`. The Registry login stays only in the robot's environment and is never sent to the portal.

## 1. Portal side (Lovable) – once

1. **Make the robot token.** Generate a long random value (at least 32 characters, e.g. `openssl rand -hex 32`).
   Keep it in a password manager; do not paste it into chats, tickets or job notes.
2. **Lovable › Settings › Secrets:** add `ESC_ROBOT_TOKEN` = that value. Without it the API refuses every request
   (401), so the robot can do nothing.
3. **Database switch.** Settings › Switches › ESC Registry robot reads `workflow_settings.esc_registry_robot_enabled`.
   That column comes from the pending migration `docs/pending-migrations/esc-registry-robot-switch.sql` (rollback
   `esc-registry-robot-switch.rollback.sql`), which is **not applied to the live database yet**. It is proven on a
   practice database (PGlite) in `tests/esc-registry-robot-switch-practice-db.test.ts`. Until it is applied the switch
   shows "waiting for the database change" and every robot run reports `mode off` and does nothing (fails closed).
   Applying it needs Jo's go-ahead. After that Jo turns the switch on in Settings › Switches.
4. Live submission stays refused until the selector map is checked against the real Registry form and
   `SELECTOR_MAP_VERIFIED` is set to true in `src/lib/esc-registry-selectors.ts`. That happens after the first run that
   Jo watches. Until then every run is a dry run (the robot fills the form, takes a screenshot and never presses Submit).

## 2. Claude cloud environment

Create a dedicated cloud environment for the robot (cloud environment menu in the session title bar › Edit / new
environment) with this repository attached.

### Network access

Choose **Limited** (or Custom) access with **Allow package managers** ticked, and add these allowed domains:

| Domain | Why |
| --- | --- |
| `veu.esc.vic.gov.au` | the VEU Registry the robot logs in to and fills |
| `estimate.homeinsulationvictoria.com.au` | the portal robot API (or whichever host `PORTAL_URL` points to) |
| package hosts (`registry.npmjs.org`, `bun.sh`, `github.com` / `objects.githubusercontent.com`) | `bun install`; these are already in the default package-manager list |
| `playwright.azureedge.net`, `playwright.download.prss.microsoft.com`, `cdn.playwright.dev` | only if you ever need to download a browser (normally not needed, see below) |

### Environment variables

Add these as **environment variables** of the environment. Do not add them as network secrets: the script reads them
from its own environment.

| Variable | Value |
| --- | --- |
| `ESC_ROBOT_TOKEN` | the same value as the Lovable secret. Its presence switches the runner to API mode. |
| `VEU_REGISTRY_USERNAME` | the Registry login (Jo provides). Stays here only. |
| `VEU_REGISTRY_PASSWORD` | the Registry password (Jo provides). Stays here only. It is never logged, stored or sent to the portal. |
| `ESC_REGISTRY_ROBOT_ENABLED` | `true` (this is one of the two locks; the other is the database switch) |
| `ESC_REGISTRY_ROBOT_MODE` | **leave unset** = dry run. Set it to `live` only after Jo has watched a dry run and `SELECTOR_MAP_VERIFIED` is true. |
| `PORTAL_URL` | optional. The default is `https://estimate.homeinsulationvictoria.com.au`. |

Do **not** set `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` here. API mode never loads a Supabase module. On Lovable
Cloud the service key is not visible anyway.

### Setup script

```bash
#!/bin/bash
set -e
bun install
# Chromium is pre-installed in Claude cloud containers (/opt/pw-browsers, PLAYWRIGHT_BROWSERS_PATH is set) and the
# global `playwright` package already resolves from Bun/Node, so nothing else is needed. Only if a future image
# drops it:
#   bun add -d playwright && bunx playwright install chromium
```

Do not add `playwright` to `package.json`: the portal bundle must never pull it in. The setup script cannot read the
environment variables, and it does not need them.

## 3. Running it

Always use a **TEST job** (`source = qa_test`, which is always dry run) for the first runs.

1. **Plan only (no browser):**
   ```bash
   bun scripts/esc-registry-robot.ts --plan
   ```
   The first log line should read `talking to the portal through the robot API (ESC_ROBOT_TOKEN)`, followed by the
   mode and the notices and VEECs it would handle. `mode off` together with a reason means a lock is closed: the
   switch column is missing or the switch is off, `ESC_REGISTRY_ROBOT_ENABLED` is not `true`, or the login is missing.
   `HTTP 401` means the token is wrong or missing on one side.
2. **Supervised dry run on one TEST job, with Jo watching:**
   ```bash
   bun scripts/esc-registry-robot.ts --job <TEST job id>
   ```
   The robot logs in, fills the form and takes a screenshot, and does **not** submit. The screenshot is filed on the
   job (Job File, documents `esc_registry_notice` / `esc_veec_creation`) together with an internal dry-run event. Jo
   compares the screenshot with the Registry block on the job. When the fields match, `SELECTOR_MAP_VERIFIED` is set to
   true in code.
3. **Schedule.** Once the dry runs look right, schedule the session to run `bun scripts/esc-registry-robot.ts` (for
   example every few hours on weekdays). It only acts on what is due. Each run is idempotent: an attempt is recorded
   before Submit, and a sent notice, lodged VEEC, earlier failure or unfinished live attempt is never submitted again.
4. **Live.** Set `ESC_REGISTRY_ROBOT_MODE=live` only after step 2 has been done with Jo and `SELECTOR_MAP_VERIFIED` is
   true. The portal still checks for itself: it refuses any "submitted" record unless the switch is on and the selector
   map is verified, and it refuses them for TEST jobs.

## What the robot API allows (and nothing else)

`robotSettings`, `noticeWork`, `veecWork`, `recordRobotAttempt`, `recordRobotDryRun`, `recordRobotFailure`,
`recordRobotNotificationSubmitted`, `recordRobotNotificationUpdated`, `recordRobotVeecSubmitted`, and
`storeRobotScreenshot` (PNG only, up to 8 MB). Every input is checked, and every guard from decision 272 stays on the
portal. Code: `src/routes/api/public/hooks/esc-robot.ts`, `src/lib/esc-robot-api.core.ts`,
`src/lib/esc-robot-api.server.ts`, client `scripts/esc-registry-robot.client.ts`. Tests: `tests/esc-robot-api.test.ts`,
`tests/esc-robot-api-server.test.ts`.

## Rotating the token

Set a new value in Lovable secrets and in the cloud environment at the same time. Until both sides match, runs fail
with HTTP 401 and change nothing.

## Fallback: direct mode

Without `ESC_ROBOT_TOKEN`, the runner imports the database helpers directly and needs `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`. Use this only on a machine the office controls, never in the cloud session.
