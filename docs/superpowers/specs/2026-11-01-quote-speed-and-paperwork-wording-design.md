# Quote speed + owner paperwork wording — design

Date: 1 Nov 2026 · Asked by: Jo · Status: waiting for Jo's OK

## Why
Jo opened and sent the HV-3666 quote and tried accepting it. Every step took ages. The Customer agreement and Consumer rights pages also load slowly. While doing that she saw two wording problems on the owner paperwork: money printed without $, and a "lawyer" reference at the top of Consumer rights. Launch is Mon 2 Nov.

## What Jo asked for (stated)
1. Opening a quote, Send, Accept, Customer agreement and Consumer rights must all be fast. "Need this whole ordeal faster."
2. Remove every "lawyer" reference from all templates, everywhere (owner pages, office Templates page, version names).
3. Money must show with $ (she saw "5988" and "349").
4. Fix the same payment line's out-of-date wording too: "One Xero invoice" and "Electrical fixes".

## What we found (evidence, 31 Oct)
- `job_overview` view: ~2.9 s per read as Jo's login, run 231 times recently. Cause: `job_authority_status()` and `job_authority_expires_at()` each call `can_access_job()` once per job row (2,646 jobs, so 5,292 calls per read). Without those two functions the view is fast.
- Send (HV-3666): owner link prepared 12:45:13, quote marked sent 12:45:16, email sent 12:45:24. The checks before that ran too, so the server took 11+ s. `releaseQuoteToOwner` runs about 12 database steps one after another.
- Accept page: `buildAcceptancePackage` (assignment.server.ts) runs 5 reads one after another.
- `$` missing: `assignment.server.ts` `payment_terms` uses `total.toFixed(2)` and the PIESA amount the same way. That gives "One Xero invoice for 5988.00 inc GST… PIESA payment of 349.00". The line also breaks Jo's 29 Oct rules (separate invoices; "electrical upgrades", not "fixes").
- "lawyer": the `consumer_rights` template version is `lawyer-2026-10-06-v1`, with source note "Jo Lowe — lawyer sign-off 6 Oct 2026". The owner sees this in the heading "VEU information & your consumer rights (lawyer-2026-10-06-v1)". In code, `LAWYER_V` / `LAWYER_APPROVAL_NOTE` (owner-gates.core.ts) are spread onto about 10 owner paperwork items, and the office Templates page shows the note.

## Design

### 1. Wording
- Money: every owner-facing amount in the acceptance package and payment line uses the existing AUD money formatter (`$5,988.00`, `$349.00`).
- Payment line: replace the "One Xero invoice…" text with the current approved payment steps (`PAYMENT_TERMS_BODY` filled by `paymentTermsText`), so there is one source of truth. That text already uses "electrical fixes", which gets changed to "electrical upgrades" under the 29 Oct rule.
- Lawyer: rename the version `lawyer-2026-10-06-v1` to `2026-10-06-v1` and drop the lawyer approval note. The approval note becomes "Approved by Jo, 6 Oct 2026". This applies to the `consumer_rights` template row and every `GATE_DOCS` item. Approvals carry across so nothing goes back to Draft (renaming a version must not un-approve it).
- Not changed: copies the owner already signed (stored snapshots and PDFs). They are the legal record of what was signed.
- Live database change (renaming the template version) needs Jo's yes just before it runs.

### 2. Speed
- `job_overview`: rewrite the two authority functions so the access check runs once per query, not once per row. Access stays the same: the view and `jobs` row security already decide who sees which job. Result must match the old view row for row.
- Send: run independent checks in parallel (`officeQuoteBlockers` is already parallel inside). Also stage check, commercial blocker, owner link, delivery permission, and source/link reads. Same checks, same order of refusals, no check dropped.
- Accept page and Customer agreement / Consumer rights: read the acceptance package's 5 reads together. Time each page's server calls and fix the slowest calls found.
- Target: each of these opens or completes in under 2 s on a live-sized database.

### 3. Checks (tests)
- A test that the acceptance package and owner paperwork never show a bare number with no $, and never contain "lawyer".
- A test that `job_overview` gives identical rows before and after (admin, installer, electrician, owner logins).
- Timing tests for the job read, Send, Accept, Customer agreement and Consumer rights, run against TEST jobs.
- Send and Accept refuse exactly the same cases as before (existing tests stay green).

## Out of scope
Any other wording, page design, or new features. Bulk/k6 load testing (already planned after launch).

## Delivery
Pull request on GitHub (not merged by this chat). Database changes are made only after Jo says yes at that moment.
