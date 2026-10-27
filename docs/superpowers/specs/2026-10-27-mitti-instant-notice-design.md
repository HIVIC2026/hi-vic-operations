# Mitti instant notice — design (Jo, 27 Oct 2026)

## What Jo wants
When an installer finishes (or changes) a Ready Check in Mitti, they should see on their **installer portal job page**
that it's done — or what's still missing — within about a minute, while they're still on site.

Today it can take up to 15 minutes, because the portal only checks Mitti on the 15-minute Mitti pull
(`src/routes/api/public/hooks/mitti-pull.ts` → `syncPendingMitti`).

## Agreed with Jo
- Use Mitti's instant notices (webhooks: `audit.updated`, `audit.completed`). Chosen over a "Check now" button or a
  faster timer.
- Only forms the **portal made**. Installers can't start forms straight in Mitti, so Mitti-first pickup is out of scope.
- The 15-minute check stays as the backup.
- Nothing about the rules changes — quote holds, matching, "one job, one pile", no texts after 8pm. Only *when* the
  check runs changes.
- Own switch, off until tested. TEST Reinsulate job first; no real owner contacted while testing.

## How it works
1. Installer taps Complete (or changes an answer) in Mitti.
2. Mitti POSTs a notice to a new portal endpoint, e.g. `/api/public/hooks/mitti-audit`.
3. The endpoint:
   - checks the secret token in the URL (same pattern as `twilio/inbound.ts`, env `MITTI_WEBHOOK_TOKEN`); bad/missing → 401;
   - reads only the audit id from the body;
   - looks up the job whose `assessments.external_mitti_id` (or current Mitti `ceiling_measurements.external_id`)
     is that id. **Not found → ignore, return 200.** (Covers forms the portal didn't make.)
   - if the switch is off → return 200 and do nothing;
   - otherwise calls the existing `syncMittiAssessment(jobId, null)`, which re-reads the form from Mitti itself.
     The notice body is never trusted for answers.
   - always answers Mitti quickly (200), even if the sync fails; a failed sync is logged and the 15-minute check
     retries it.
4. The installer job page (`src/routes/_authenticated/field.$jobId.tsx`) already refreshes every 60 s, so
   "Needs finishing" clears with no screen change needed.

## Not doubling up
The notice and the 15-minute timer may sync the same job at nearly the same time. Before switching on, confirm
`syncMittiAssessment` cannot send a quote twice when run twice at once (it should already be guarded by the
existing "no duplicate sends" rule; if not, add a per-job lock).

The switch is a new `workflow_settings` column, added through `docs/pending-migrations/` (PGlite-proven, run live only
with Jo's OK). Until it exists, the switch reads as off.

## One-time setup
- Register the webhook with Mitti using the existing API token: `POST https://api.safetyculture.io/webhooks/v1`
  with the endpoint URL (including the token) and events `audit.updated`, `audit.completed`.
  Confirm the exact event names and whether Mitti signs notices against Mitti's own developer docs first.
- Set `MITTI_WEBHOOK_TOKEN`. Add the switch (off) next to the other Mitti switches in Settings.

## Testing
- Unit tests: bad token → 401; unknown audit id → 200, nothing synced; switch off → nothing synced;
  known id → `syncMittiAssessment` called once; sync error → still 200.
- Live on the TEST Reinsulate job: tap Complete in Mitti → installer page clears "Needs finishing" within about a
  minute; no second quote when the 15-minute check runs straight after.

## Not doing
- No Zapier. No "Check now" button. No faster timer. No Mitti-first pickup changes. No changes to the forms.
