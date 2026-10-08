# Recurring whole-portal QA runner

## Safe invocation (the only supported command)
```
bun run portal-qa -- --label morning|midday|afternoon|release [--base <url>] [--skip-installer]
```
- Run from the project root in the Lovable sandbox (needs the project's backend env). Bounded: ~10 min, no AI calls.
- Exit 0 = every row PASSED. Exit 1 = anything FAILED, BLOCKED or NOT_RUN (a harness that does not finish is a failure).
- Output: `/mnt/documents/portal-qa/<stamp>/results.json`, `report.md`, `screens/*.png` (390px + 1280px), logs; `/mnt/documents/portal-qa/latest.json` holds the newest run plus `last_successful_run`.
- Each row: area, route/action, persona, status (`passed|failed|blocked|not_run`), detail, reproducible steps, screenshots. Header: timestamp, label, target (preview sandbox vs deployed), source revision.

## What it checks
1. Real TEST sign-ins (read-only preflight, never creates/changes accounts): office `admin@hivic.test`, REC `qa.rec.delta@hivic-test.example`, installer `deep-test@hivic.test`, first TEST owner with an open `qa_test` job. Missing → BLOCKED with the setup action.
2. Authenticated screen visits as each role, phone + desktop: required labels, case-sensitive retired/invented wording (`HI VIC`, `undefined`, `NaN`, `[object`, `50% deposit`, `Lorem ipsum`, `TODO`), sign-in bounce, error pages, page errors. Read-only.
3. Installer click-through with persistence readback: existing `installer-test --runs 1 --installer-app-only` (snapshot/restore, qa_test jobs, nothing sent).
4. Isolated email rule tests (PGlite/renderers): Step 3 parity, Group A supplied/no-size, Group B original-media exclusion, declaration vs media routing, after-review removal wording, idempotency, opt-outs/consent, links.
5. Read-only live delivery log: failed/uncertain `customer_email_sends` in the last 24h.
6. Retired-term source scan.
7. Coverage gaps always reported NOT_RUN (never PASS): REC onboarding click-through, office write actions, owner signing/booking/payment, installer onboarding signing (run `bun run installer-test --runs 3` deliberately).

## Scheduling / release hook
The runner does not schedule itself. External schedulers (morning, midday, late afternoon, after a deployed-version change) must start the command above in a Lovable agent session; there is no public HTTP endpoint for it by design (it mints TEST sessions with server credentials). For deployed checks pass `--base https://hi-vic-operations.lovable.app`. No publishing workflow was changed.

## Baseline findings (8 Oct 2026 23:41 / 23:53 UTC, preview sandbox, rev ced7e85a)
- 51 passed incl. all 27 installer journey groups and email rule tests; retired-term source scan clean.
- FAILED (data, not code — not changed): office Operations shows a job named "HI VIC FINAL LOCK QA" (HV-1048); Partners shows business "DC Construction Solutions (HI VIC)".
- FAILED (live log): 8 `existing_leads_launch_v1` sends on 8 Oct 05:14–05:15 UTC were refused by the email service (422, example.com recipient on base44 jobs).
- NOT_RUN: the four coverage gaps above.
