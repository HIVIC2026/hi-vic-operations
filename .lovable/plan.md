# Job 2 — Owner eligibility link for installer-supplied customers (PLAN ONLY)

## What it is
A short web link the office (or installer) sends to an installer-supplied customer. The owner answers a few quick questions so we can work out eligibility before anyone visits. **Questions only — no consent forms, no VEEC assignment signatures.** Those are signed only at quote acceptance, as Jo locked in.

## What the owner sees
- Branded Home Insulation Victoria page (co-branded with the installer's name where the job is installer-sourced).
- A handful of questions, mobile-first, one per screen:
  1. Do you own and live in the home? (owner-occupied / rental)
  2. Is the house more than 5 years old?
  3. Has the home had a VEU insulation upgrade before? (Yes → office review, per 3 Oct decision)
  4. Is there existing insulation in the ceiling? (none / some / not sure)
  5. Roughly how big is the ceiling? (m² or "not sure")
  6. Anyone on life support at the address?
  7. Anything we should know? (access, hazards — free text, optional)
- A plain "thanks, we'll be in touch" finish. No prices, no commitments, nothing to sign.

## What happens with the answers
- Answers are stored on the job as **declared, not verified** (same rule as the Base44 handoff).
- The job gets a result the office can see:
  - **Likely eligible** — answers look fine
  - **Needs an assessment** — something needs a look on site (insulation present/unknown, previous upgrade, life support, rental)
  - **Does not appear eligible** — clear disqualifier, with the reason
- The installer is told the result (portal notice; email/SMS wording needs Jo's approval before anything is switched on — sending stays off).
- Nothing progresses the job by itself; the office still decides the next step.

## How it fits what exists
- Reuses the existing Gate 1 question set and outcome wording (Likely Eligible / Needs Onsite Confirmation / Does Not Appear Eligible) so there is one set of rules.
- One link per job, works without a login, expires after use or after a set number of days.
- If the customer doesn't respond, the existing follow-up chase applies (queued only, wording pending Jo).

## Database change (practice DB first, with undo file)
- New table for the link + answers: token, job, who/when created, opened/answered times, the answers, the result. RLS: office and the sourcing installer can read their own jobs' results; the public link writes only via the token.

## Not in this step
- No signatures, no consent capture, no VEEC wording.
- No automatic emails to customers (all wording awaits Jo's approval).
- No changes to the existing Ready Check or quote flows.

## Open questions for Jo
1. Exact question wording — reuse the website/Base44 wording, or does Jo want to approve fresh wording for this link?
2. Should the installer be able to send the link themselves from their portal, or office-only to start?
3. Link expiry: 14 days?
