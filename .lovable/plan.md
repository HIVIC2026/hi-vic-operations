# Team workers: full details, Mitti for lead installers, install-day text and safety documents

Plan only. Nothing changes until Jo approves. Only the 4 items below are covered.

## What already exists
- **Worker records** already hold: full legal name, mobile, email, trade (installer/electrician), a licence/certificate number and expiry, a certification record, approval status, and office approval. Workers can't see jobs until the office approves them. This stays as it is.
- **Worker invites** already hold the invitee name, contact, trade and signed declarations.
- **Mitti invite on approval** is already built (decisions 188, 331, 340): it finds an existing Mitti user by email and links them, and never invites anyone twice. It asks for a Lite seat, paid by Home Insulation Victoria. It is **switched OFF**, and the "create a new Mitti user" step is locked because that Mitti call hasn't been proven yet. Today, if someone isn't found in Mitti, the office gets an "invite by hand" to-do.
- **Install-day text** (decision 161) already goes to the mobile of the person the job is allocated to, if they have one. Otherwise it goes to the business owner. The no-texts-after-8pm rule already applies.
- **Safety plan (SWMS)** (decision 261): the portal writes it from the job's facts. It appears on the installer's job page and the install-day page, where the installer signs it.

## What's missing
1. There is **no Lead installer / Crew choice** on a worker. Their trade can only be installer or electrician. A certificate photo/file is only stored for PIISA, not for the CII. The plan adds a role (Lead installer / Crew) and a CII certificate file. It reuses the existing number and expiry boxes for the CII.
2. The Mitti invite doesn't check the role yet. It would be limited to Lead installers, and Crew would be skipped. The Team list doesn't show Mitti status yet: it would show Invited / Joined / Failed, and the office would be told in Needs me if it fails.
3. Anyone can currently be picked under "Who's doing this". It would be limited to approved Lead installers, and Crew would only appear on the PIISA crew list. The Mitti form would be assigned to the lead's linked Mitti login.
4. The install-day text has no safety-document link. The proposal is to add a link to the install-day page, which already shows the SWMS.

## Mitti limits
- Finding and linking an existing Mitti user works with our connection.
- Creating a new user needs one real test on a real email before it can be switched on. Until then, the office invites new people by hand.
- Each Lead installer uses one paid Lite seat. Crew use none.
- Turning this on also needs the Mitti auto-invite switch flipped. **I won't flip it without Jo saying so.**

## Questions for Jo
1. Should the Mitti invite switch be turned ON, and should we run the one real "create user" test (it uses a seat)?
   A. Yes, both  B. Linking existing Mitti users only  C. Leave it off for now
2. Safety documents for the lead: the portal holds the SWMS/safety plan, the job's PIESA result, and the hazards noted at the Ready Check. Which should the lead get?
   A. SWMS only  B. SWMS + PIESA result + Ready Check hazards  C. Something else
3. How should they get them?
   A. A link in the install-day text to the job page  B. Job page only  C. Also attached in Mitti
4. Existing approved installer workers have no role yet. What should they become?
   A. Lead installer  B. Crew  C. Office asks each business

## Technical details
- Add `worker_role` (lead/crew) and `cii_certificate_path` to `partner_workers`, then change the Team form and the office approval view. RLS/grants stay unchanged. These changes are proven on the practice database first.
- `mitti-invite.server.ts`: skip when the role isn't lead. Store the Mitti user id on the worker and show the status on Team.
- Allocation: limit the "Who's doing this" choices to lead workers, keep the decision 161 text routing, and add the page link to the text.
- Tests: only leads are invited, Crew are skipped, only leads can be picked, the text goes to the lead's mobile, and nothing is sent after 8pm.
