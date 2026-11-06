# TEST-only portal audit — 6 November 2026

## Safety
No hosted record mutations, external sends, publication or switch changes during this audit. The firm-quote activation was read back as NULL. Local browser checks use synthetic role hooks and disposable localStorage fixtures, with external requests blocked. They do not prove real authentication, RLS, provider calls or persisted payment workflows.

## What ran
- Full isolated suite before repairs: 13,820 passed, 473 failed, 1,354 files, 255 seconds. Log: `/tmp/overnight-qa/full-before.log`. This is not a clean baseline.
- Final browser audit: 28 PASS, 6 FAIL, 2 BLOCKED across 390×844 and 1280×1800. Report: `/tmp/overnight-qa/browser-final/report.json`; screenshots and traces alongside it.
- Chooser regression checks: 8 passed, zero failed.
- Combined chooser/Templates tests: 27 passed, 2 failed. Existing Templates expectations forbid previously approved switch controls; not changed to conceal failures.
- Retired-term scan completed with existing internal/document warnings, no new visible term violations. Preview build OK.

## Repairs verified
1. A Choose installer dialog outside the embedded job-panel stage gate no longer silently disappears: it shows existing failed-load feedback and Retry. It does not reveal the legacy owner Send action or alter the normal embedded gate. Regression failed before repair and passed after. This is a feedback repair, NOT proof that firm-quote handover works.
2. Templates mobile approval notes wrap long internal names rather than widening the page. The same 390px bounds check failed before and passed after; screenshot `390-17.png` confirms the repaired rendering. No wording, email design, approval state or delivery changed.
3. Isolated fixture/selector maintenance uses current home data and approved button labels; browser outcomes are no longer inflated by these obsolete selectors. Timing is recorded for successful checks; no historical fix count is hard-coded.

## Remaining browser gaps
- Six failures: saved-price home/second-tab/back-navigation fixture checks and safety-booking assertions, at both widths. They are not established production failures. Price submit, Change input readback, portal Ready Check save, private synthetic Team save, error/retry and refresh checks passed.
- Two blocked office job drilldowns: the isolated office job fixture is absent. Office Send and handover are NOT RUN.
- Whole-process auth/RLS two-user isolation, owner acceptance/payments, PIESA/rectification/install evidence and real-provider integration remain NOT RUN. Electrician onboarding start is checked, not electrician job completion.
- Source route/control inventory is not coverage: unvisited routes and unclicked controls remain NOT RUN.

## Speed findings
Published human web vitals were collapsed to one peak per metric series, then p75 calculated with counts:

| Page | Metric | Count | p75 | Good rate |
|---|---|---:|---:|---:|
| /auth | FCP | 41 | 4.872 s | 36.6% |
| /auth | LCP | 35 | 5.064 s | 45.7% |
| /field | FCP | 23 | 3.550 s | 39.1% |
| /field | LCP | 19 | 5.734 s | 42.1% |
| /admin/needs-me | FCP | 9 | 8.416 s | 44.4% |
| /admin/needs-me | LCP | 7 | 12.722 s | 28.6% |
| /admin/enquiries | LCP | 8 | 7.364 s | 12.5% |

Google thresholds: FCP 1.8 s, LCP 2.5 s. Auth has sufficient readings and is slow. Other listed pages have too little data to rank confidently. These published readings are not local browser timings. One final local Add-job draft-refresh scenario took 3.015 s; this includes navigation, editing and reload, not a Save measurement. No speed improvement is claimed: the potential independent rate-card read optimization still needs a dedicated concurrency test and controlled timing proof. Payment/safety caches were not loosened.

## Release status
Not ready to claim every button, every role or a whole journey works. Repairs are saved for preview only. No publishing recommendation until blocking coverage and failures are resolved.