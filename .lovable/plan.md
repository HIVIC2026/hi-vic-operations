# ReInsulate pilot readiness audit (read-only) and next actions

Nothing was changed. The checks that ran:
- all 272 automated tests pass, and the code type-check is clean;
- read-only database queries;
- the database security linter;
- a code search for leftover old-flow code.

A fresh production build was **not** run, because it writes files (the last one succeeded in the previous turn). No browser click-through was done.

## 1. Status
- Tests: 272 pass, 0 fail across 18 files. Type-check: clean. Build: not re-run this turn.

## 2. Architecture
- GOOD:
  - Workflow, pricing and payment gates are in one place.
  - Only admins can write directly; every other write goes through server functions.
  - Audit logs and immutable signed and measurement records.
  - The Xero business-unit barrier fails closed.
  - Customer communications are locked (`customer_comms_enabled=false`).
- PARTIAL: the pure rule modules are well tested, but the database and UI glue has no integration tests and no browser tests.
- CONCERN: the security linter flags 28 SECURITY DEFINER functions that signed-out and signed-in users can execute, and 2 functions with a mutable search_path. These need review.

## 3. ReInsulate pilot readiness (from the live data)
- Partner businesses: 3 records, all **draft** with **blank legal names**. None are approved.
- Team members: 0. Credentials and insurance: 0. AP participation agreements: 0.
- Partner measurement methods: 0. Measurement standard: not approved.
- Rate cards: 2 cards, 10 lines (not confirmed as ReInsulate's agreed rates).
- Imports: 0. Offers: 0. Only 1 installer user and 2 electrician users exist, and none is linked to a business.
- Xero supplier/contact sync: code exists but has never run. Xero install-date updates are off.
- EasyMate: file, CSV and paste import only. No API; source links are stored as references only.
- Electrician selection, 24/48h SLA, reassignment, offers, partner dashboard and co-branded quote are all built. Their logic is unit-tested, but none has been exercised end-to-end with real accounts.
- Verdict: **the software is PARTIAL; the setup is NOT READY.** Deep cannot usefully log in yet.

## 4. Core Activity 48 flow
- Gate 1: ready (all 22 real jobs are in `new_enquiry` awaiting review).
- Site scope and PIESA 30-day rule: ready.
- Mitti: token is present, but the measure-up-only template is not set.
- Quote acceptance and conditional assignment: **BLOCKED**. All 4 compliance templates are unapproved, so signing fails closed.
- ESC consent and notification: **BLOCKED** (the ESC consent template and ESC notification config are unapproved).
- Deposit and invoice: code ready. A real Xero invoice has never been written and read back under supervision.
- Evidence, AP review and VEEC: code ready, not exercised end-to-end.

## 5. UX
- The admin pipeline and job page show the next action and blockers.
- The partner, trade and owner screens are built mobile-first, but none has been tested on real accounts. This is unverified, not proven.

## 6. Contradictions and legacy code
- The signing model conflicts: the implementation and project rules sign a conditional VEEC assignment at quote stage, but the earlier "authoritative" request said final assignment only after installation. **You need to confirm which one wins.**
- Old Owner Authority code remains in several places (authority, consent, assignment, job file, panels). It is labelled as history but should be isolated.
- The 5% area and $1 price change thresholds were chosen by the agent and have no admin setting.
- The "second customer signature" switch has no UI.
- Measurement acceptance can pass on standard + method approval without an independent onsite check. This is intended for after the pilot, but needs a clear admin warning.

## 7. Blockers before Deep logs in
1. Create and approve the ReInsulate business (legal name, ABN, insurance, licences, signed AP agreement).
2. Create Deep's user account and team, and link them to the business.
3. Load ReInsulate's agreed rate card.
4. Onboard at least one electrician/REC business and link it as preferred.
5. Approve official wording for: the customer agreement/consumer rights, the conditional assignment, ESC consent and the installer declaration. Approve the ESC notification config.
6. Agree the measurement standard with Deep (optional for the pilot; dual verification works without it).

## 8. Security
- Review and revoke public EXECUTE on the SECURITY DEFINER helpers that don't need it.
- Set search_path on the 2 flagged functions.
- Run a security scan and test RLS with a real partner account (partner A must not see partner B's jobs).

## 9. Next 10 actions, in order
1. Decide the signing model (conditional assignment at quote vs final assignment post-install).
2. Harden the database functions flagged by the linter.
3. Fix the draft businesses: complete them or clean them up.
4. Onboard ReInsulate fully and approve it.
5. Create Deep's and the electricians' accounts and link them.
6. Load the rate card and record a signed AP agreement.
7. Approve the compliance templates and ESC config (your wording only).
8. Run a supervised dry run on a test job: import → confirm → electrician → assessment → quote → accept.
9. Do one supervised Xero invoice write and read-back, and check the deposit gate.
10. Continue the dry run through ESC consent/notice → install evidence → AP → final assignment, then decide on enabling communications.

## 10. Bottom line
- GOOD: architecture, fail-closed gates, audit trail, provisional measurements, communications lock, tests and type-check.
- PARTIAL: the partner pilot screens and Mitti/Xero live paths (built but never exercised), plus the leftover old-flow code.
- NOT READY: no approved partner, users, agreement or credentials; all compliance wording unapproved; the signing model decision is still open; database function permissions need review.

If approved, the next build step would carry out actions 1–3 (decision, database function hardening, clean-up of the draft businesses) before any pilot data entry.
