# Sealed installer attachment regressions

No live server, storage, customer, communications or Mitti actions. The fixture uses local browser storage and explicit fault controls.

From project root:

```sh
node tests/installer-intake-races.vite.mjs
# In another terminal:
python3 tests/installer-intake-races.browser.py
INTAKE_PHONE=1 INTAKE_SCREENSHOTS=/tmp/browser/intake-phone python3 tests/installer-intake-races.browser.py
```

Seven groups assert: delayed restore blocks editing; upload and optional AI read block navigation and retain saved attachments on read failure/reload; interrupted batch preserves successful files in a single draft and retries only the failed file; double removal runs once and failed removal retains the file; removing extraction clears derived values without deleting typed scope; file-only Yes submits a null financial price and prevents double-submit/summary Edit; removing a multi-customer quote allows valid replacement.

Checked desktop and phone on 8 October 2026. Both runs passed, without page errors. Related intake, repairs, progress and add-job tests: 56 passed. Business-load Retry is present in the actual Add job route; its service failure was not injected into a real signed-in session. No publication, sends, audits, approvals, migrations or native activation.
