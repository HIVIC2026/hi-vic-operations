---
name: hivic-workflow-audit
description: Audit that the Home Insulation Victoria job flow does the right thing end to end, across roles, automations, Mitti, Xero and email, with evidence and a ranked issue list. Use when asked for a workflow audit, launch-readiness check, "does the whole business work", or a re-audit after a publish. Builds on `bun run portal-qa`; for screen looks use design-review.
---

# HIVIC workflow audit

An audit proves **outcomes**, not clicks. Pressing "Send" proves nothing; the email row, its delivery status, the event on the right job and the stage change that follows are the proof. Every scenario ends in exactly one verdict: **passed**, **failed**, **blocked** (could not be checked, and why) or **not run**. A scenario with no evidence is never passed.

## Guardrails

Every action that writes, sends or charges touches TEST data only: jobs with `source = 'qa_test'`, accounts on `@hivic-test.example` / `@hivic.test`, Stripe test mode. Real customer, trade and business records are read-only. On the live site, stop before any submit, the electrician form's "Start registration", or a switch change; see the tools' own safety stops (`scripts/portal-qa-safety.ts`, `qa-session.ts`). When a scenario needs a real write you can't make safely, mark it **blocked** with the setup it needs.

## 1. Read the rules

The rules are the yardstick; the code is what's on trial.

- `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md`: the 29-step order, eligibility, payment, PIESA 30-day rule, contact sharing, communications, prices. Later dated decisions in that file override earlier ones.
- `src/config/workflow-decisions.ts`: `hardStops` and the payment settings. Each hard stop is a difficult case to test.
- `docs/STATUS.md`: what is built versus pending. A rule marked pending is **blocked (not built)**, not failed.
- `src/AGENTS.md` before reading any flow code.

Done when you can state, for every one of the 29 steps, who acts, what state the job must be in first, and what must exist afterwards.

## 2. Build the workflow map

One row per step of the approved order: step, actor, gate (what must be true first), expected outcome (stage / next action, record, message, Mitti form, invoice line), and the tool that proves it. Mark steps no tool proves as **gap**. [`SCENARIOS.md`](SCENARIOS.md) is the starting catalogue and its coverage column; update it when a gap closes.

Done when every step has a row and every row names its proof or says gap.

## 3. Run the existing tools

Where the audit runs decides what it can reach:

- **Lovable sandbox** (has TEST logins and server keys): run everything below.
- **Cloud Claude session**: the live site is reachable but there are no TEST logins or server keys. Only the signed-out sweep, secure-link bad-input checks, local calculator, sign-up `?sample=` pages and unsigned probes of the automation endpoints are possible. Everything signed-in is **blocked**.

Commands (read `--help`/file headers for flags):

1. `bun run portal-qa -- --label audit --budget 1500 [--base https://hi-vic-operations.lovable.app]`: every role's screens at 390px and 1280px, office writes with restore, installer click-through, email rules, live email log. The default 540s budget left 216 rows not run on 26 Oct.
2. `bun run journey`: one fresh TEST job from calculator to installer payout through the portal's own server steps, with screenshots.
3. `bun run test`: rule tests (prices, emails, payment gate, Mitti, Xero).
4. `bun scripts/scan-retired-terms.ts`: retired wording.

Leftover TEST jobs from earlier runs (for example a duplicate-address refusal on a TEST address) are test-data failures: report them as such and name the job to close.

Done when each command has finished or its non-finish is recorded as a failed row with the reason.

## 4. Prove the outcome

For each scenario, gather the **evidence triple**:

1. **Screen**: screenshot at the role's real width (owners, installers and electricians on 390px), with the URL it landed on.
2. **Saved record**: read back the job's `stage`/`next_action`, the `workflow_events` rows, and the record the step creates (booking, quote version, Mitti audit, invoice/payment).
3. **Log**: `customer_email_sends` / SMS status for messages; Xero or Stripe ids for money; Mitti audit id and job for forms.

Then check **exactly once**: count emails, tasks (Needs me rows) and events for that step on that job before and after. Two of anything, or the right thing on the wrong job, is failed. Remember from the rules: sent ≠ delivered, delivered ≠ read, a link opened ≠ approved, and sending never moves a job forward.

For **roles**, prove both halves: the role can do its task, and it is refused (server-side, not just hidden) on another party's job, the office pages, and the money it shouldn't see (electricians see only their own agreed rate, never the $349 customer price; installer staff see no rates, bank or Money).

For **speed and phones**, record time to usable screen, failed network requests and sideways scroll per screen.

Done when every scenario in the map has a verdict and every passed verdict has all three kinds of evidence its outcome calls for.

## 5. Report

Write to `/mnt/project-files/qa/<YYYY-MM-DD>-workflow-audit/`: `report.md`, plus `screens/` and logs beside it. Header: date, target (preview or live), source revision and served bundle name.

- **Scorecard**: the workflow map with a verdict and evidence link per row.
- **Issues, ranked by launch impact**:
  - **Stop launch**: money wrong, a gate skipped (PIESA before payment, install before clearance), a customer message to the wrong person, one role seeing another's data, lost evidence.
  - **Fix soon**: a step that needs office work-arounds, a duplicate message, a confusing or broken screen on a phone.
  - **Polish**: wording, slowness under 5 seconds, layout.
  Each issue has exact reproduction steps, expected vs seen, and its evidence files.
- **Blocked and not run**: each with what would unblock it.

Write for Jo: plain words, no code names in the summary, lead with the verdict. The audit shows the listed scenarios passed on this version; say so, and don't claim the portal has no other bugs.
