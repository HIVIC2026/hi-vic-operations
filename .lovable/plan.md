# Team workers: full details, Mitti for lead installers, install-day text and safety documents

Plan only. Nothing is built until Jo approves it. Updated with Jo's answers from 27 Oct, 04:31.

## What already exists
- **Worker records** already hold: full legal name, mobile, email, trade, a certificate number and expiry, and approval status. Workers can't see jobs until the office approves them. Approval stays exactly as it is today.
- **Mitti invite on approval** is already built. It finds an existing Mitti user by email and links them, and never invites anyone twice. It asks for a Lite seat, paid by Home Insulation Victoria. It is switched OFF, and creating new Mitti users is locked until it is tested once.
- **Install-day text** already goes to the mobile of the person the job is allocated to, and is never sent after 8pm.
- **Safety plan (SWMS)** is written by the portal from the job's facts and shown on the install-day page.

## What changes

### 1. Full worker details (Team / Your staff)
- Required for every installer worker, Lead installer **and** Crew: full legal name, mobile, email, role, CII number, CII expiry and CII certificate file.
- Adds a role (Lead installer / Crew) and a CII certificate file. Reuses the existing number and expiry boxes.
- Existing approved installer workers with no role show **"Role needed"** until their business sets one. The business is asked to choose on its Team page, and the office sees the to-do.

### 2. Mitti for Lead installers only
- First, one real "create user" test on a real lead installer's email. This uses one paid Lite seat. After it passes, the auto-invite is turned **ON for Lead installers only**.
- When the office approves a Lead installer, the portal links their existing Mitti user, or invites them if they don't have one. Their Mitti login is saved on their record.
- Crew are never added to Mitti.
- The Team list shows Mitti status: Invited / Joined / Failed. If an invite fails, the office is told in Needs me.

### 3. Who's doing the install
- Only approved Lead installers can be picked under "Who's doing this". The Mitti form goes to that lead's Mitti login.
- Crew are picked on the crew list for that install. They also feed the PIISA crew list.
- **Everyone on the install**, the lead and each picked crew member, gets the 6:30am install-day text on their own mobile. Each person gets it once only. No texts after 8pm still applies.

### 4. Safety documents
- The install-day text includes a link to a page that shows:
  - the SWMS
  - the PIESA result
  - the Ready Check hazards
- The lead and every crew member on that install can open it. Nobody else can. It shows no prices, rates or bank details.

## Mitti limits
- Linking existing users works today.
- Creating users needs the one real test first.
- Each lead uses one paid Lite seat. Crew use none.

## Questions for Jo
None left. One thing Jo needs to confirm before the Mitti test: which lead installer's real email to use.

## Technical details
- Add `worker_role` (lead / crew / null = "Role needed") and `cii_certificate_path` to `partner_workers`, proven on the practice database first. RLS and grants stay unchanged.
- Require the CII fields for installer workers on the Team form. Office approval logic is unchanged.
- `mitti-invite.server.ts`: skip anyone whose role isn't lead. Set `MITTI_USER_API_VERIFIED` only after the probe passes. Jo has approved switching the auto-invite on for leads.
- Allocation: the lead picker shows leads only. Add a crew list per install. The install-day text goes to each person, with its own send-once key, the existing 8pm guard, and the page link.
- The safety page is reachable by the allocated lead and crew only (role-checked).
- Tests:
  - Crew are refused without CII details.
  - Only leads are invited to Mitti.
  - Only leads can be picked.
  - The lead and the crew each get one text.
  - No text after 8pm.
  - Crew on the job can open the safety page; others can't.
- Add these tasks to the roadmap when the build starts.
