# Trade launch readiness

## Scope and assumptions
- Preserve all existing profiles, roles, business links, applications and signed agreements.
- Keep customer sending, payment gate and Xero off. Only partner account-invite/password emails become available after Jo approves their wording.
- Do not alter locked Step 1 or Gate 1, publish, or touch real jobs.

## Stage 1 — Access that works
- Add password reset and passwordless email sign-in to the current sign-in page; remove “Operations” from the sign-in brand.
- On partner activation, prepare one secure account invitation per approved worker email. Keep delivery approval-controlled and auditable.
- Link each account to the existing profile, role, worker and business records; never create shared accounts.
- Route installers and electricians to one `/field` home after sign-in.

## Stage 2 — One phone-first trade workspace
- Replace the overlapping “My jobs” and “Partner dashboard” entry points with “My work”.
- Order the screen: new offers, Needs you, Coming up, collapsed Waiting on others.
- Make owner times the primary offer actions; retain “None suit, I’ll call them” and “Not for me”.
- Use bottom navigation: Work, Add job (installers), Payments, Business.
- Remove internal stage codes, SLA pills and deposit badges from trade-facing cards.
- Load jobs through permission-aware server functions so contact-release rules are always enforced.

## Stage 3 — Add your own customer
- Replace the quick dialog with one staged form using the existing installer-import audit trail and canonical enquiry deduplication.
- Collect owner/property details once, then branch by Not visited, Measured, or Measured and quoted.
- Not visited creates the job and makes “Book the Ready Check” its next task.
- Measured branches collect the Ready Check A1 facts, required evidence references, scope and rate-card-backed price lines; quote agreement is recorded without inventing prices.
- Keep bulk upload below the form as “Many at once”.

## Stage 4 — Clear job and onsite forms
- Reduce the trade job page to status/waiting/time, one next action, current checklist, active-visit contacts, directions and key facts; keep history/documents behind links.
- Use Mitti for Ready Check A1 and PIESA. Remove the duplicate portal measure-up and long manual PIESA form, including manual Mitti ID entry.
- When a template is missing, fail closed with: “Form being set up — Home Insulation Victoria will send it before your visit,” and surface the missing setup in office To action.
- Align form names to A1 Ready Check priced, A2 Ready Check, B PIESA, C PIISA.

## Stage 5 — Contact and owner access
- Apply the approved active-visit contact notices verbatim; keep messages optional.
- Remove portal-only/no-calls wording from current screens and draft guidance, while preserving historical signed agreements.
- Extend the secure `/estimate/$token` owner journey to quote/sign, payment choice, electrician times, rectification approval, install days and status without a password.
- Show one “Your next step” card and a customer-safe six-step tracker with no internal badges.

## Stage 6 — Settings and launch data
- Set the retained historical partner lead-fee setting to $0 and align the deprecated expiry value to four hours while keeping the active four-business-hour rule.
- Verify the campaign response table is already applied and leave the working migration intact.
- Mark only clearly fake enquiry records as test without changing immutable signed application records.
- Show all 16 submitted applications, separate test from real, and show certificate, rates, bank and insurance requirements for each.

## Stage 7 — Proof before role re-test
- Add focused safety tests for invite/account linking, access isolation, contact release, Mitti setup fallback, staged intake and secure owner actions.
- Test each changed trade screen at 390px with TEST accounts and capture screenshots.
- Run the approved full role dummy scenarios against the fixed preview, using only existing TEST controls where disabled switches block progress.
- Report what changed, the exact new-tradie sign-in steps, screenshots, blockers, and Jo’s remaining approvals/Mitti IDs. Publish nothing.
