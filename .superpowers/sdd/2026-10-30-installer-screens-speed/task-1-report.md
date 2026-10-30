# Task 1 report: installer screens timing script

Status: DONE_WITH_CONCERNS (live run not possible here; controller runs it in Lovable)

## Built
- scripts/installer-speed.core.ts: pure median/max, serverFnName, summariseRuns, formatTable, parseArgs, reportFileName.
- tests/installer-speed.test.ts: 9 tests.
- scripts/installer-speed.ts: CLI. --help and bad args work without the key (admin client is imported only after arg checks). Mints owner (deep-test@hivic.test) + staff (qa.staff.reinsulate@hivic-test.example) sessions with the TEST-only guard; picks the job read-only (job_assignments business_id = TEST biz, role installer, active; jobs source qa_test, not archived/deleted, stage != complete; prefers one the staff login is assigned to); stops with a clear message if none; writes manifest to /tmp (blanked to {} after the run so tokens do not stay on disk); runs time.py; writes qa/installer-speed/<date>-<label>.md.
- e2e/installer-speed/time.py: Chromium 390x844, CDP emulateNetworkConditions (150 ms, 1.6 Mbps down = 200000 B/s, 750 kbps up = 93750 B/s), fresh context per run, session set via add_init_script before app load, 5 runs per screen per role, time from goto(commit) to selector visible, /_serverFn/ requests timed request -> requestfinished (waits 300 ms after ready so in-flight calls are counted; does not affect the ms).
- qa/installer-speed/README.md.

## TDD
RED: `bun test tests/installer-speed.test.ts` -> "Cannot find module '../scripts/installer-speed.core'", 0 pass, 1 error.
GREEN: 9 pass, 0 fail, 19 expects.
Also: `bun scripts/installer-speed.ts --help` prints usage, exit 0; `python3 -m py_compile e2e/installer-speed/time.py` ok; tsc grep 'installer-speed' prints nothing.

## Selectors (all existing markup, no app changes, no data-speed attribute added)
- home /field: `[data-job-group="action"]` (installer view in field.index.tsx; present in empty state too).
- job /field/<jobId>: `main h1` (ScreenHead title; the Loading and refusal states have no h1).
- day /field/day/<jobId>: `main h1` (ScreenHead; Loading and error states have no h1).
- business /field/business: `main h1:has-text("My business")`.
- money /field/money: `[data-money-totals], [data-money-empty]`.
- Refusal detector: `[role="alert"], main p:has-text("isn't available to you"), main p:has-text("TEST sign-in can only")`. Staff + money is "refused (expected)"; staff + job/day is expected-refused only when the staff login is not assigned to the chosen job; anything else refused is a FAILED row.

## Concerns
1. sessionFor is copied (about 10 lines, no secrets) from scripts/installer-test.ts, not imported: that file runs a whole test suite at import time. Could be extracted later.
2. Business screen for staff: the page itself loads for staff (just without team/file sections), so it is timed normally, not "refused". Sub-pages (details/rates/team) are not timed (brief lists only 5 screens).
3. Home selector assumes the TEST business is an installer (eec_installer, verified in installer-test.ts); an electrician login would show a different view and fail.
4. Server-fn names: dev URLs carry a readable tail, production compiled builds may be opaque hashes; serverFnName falls back to the raw tail then. If the before table shows hash names, map them with scripts/qa-serverfn-resolve.ts.
5. Untested live (no server key); the selectors and the CDP/localStorage approach follow shoot.py and existing markup only. First live run should be watched for the staff job/day rows and the `main h1` on the day page.
6. The "wait for selector" times out at 45 s per run; a timeout shows as FAILED in the table.

## Fix round 1
Changes:
1. time.py: init script now sets the TEST token only when `location.origin` equals the origin of the manifest `base` (origin from urlparse, passed via json.dumps).
2. time.py: REFUSAL no longer contains `[role="alert"]`; only the specific texts ("isn't available to you", "TEST sign-in can only", "assigned to you"). After a refusal match, waits up to 1 s for READY before concluding refusal. The unexpected-refusal error text now reads the refusal paragraph.
3. installer-speed.ts: manifest written with `{ mode: 0o600 }`; python run wrapped in try/finally that blanks the manifest.
Commands/output: `bun test tests/installer-speed.test.ts` -> 9 pass, 0 fail; `python3 -m py_compile e2e/installer-speed/time.py` ok; `bun scripts/installer-speed.ts --help` prints usage; tsc grep 'installer-speed' prints nothing.
Note: a staff money refusal (getTradeMoneyView error) renders as a `role="alert"` paragraph without the specific texts, so it may not match the new REFUSAL list; if the first live run shows staff money timing out, add the refusal wording from getTradeMoneyView to REFUSAL for the money screen.
