# Preferred electrician invite and automatic teaming

## The idea
In installer onboarding, ask whether they already work with an electrician. If they do, we invite that electrician to sign up. Once the electrician accepts and HI VIC approves them, the two are teamed up and the installer's jobs go to that electrician automatically.

## Installer onboarding: new step "Your electrician"
- Question: "Do you have a preferred electrician, or one who works with or under you?"
  - **Yes, one or more**: for each, collect name, email, mobile and business name (optional). Add their licence and REC number too if known.
  - **No, match me with an HI VIC electrician**: the installer gets matched by area as usual.
  - **Not sure yet**: can be added later from their profile.
- Tick box, required when adding one: "I confirm this electrician has agreed to be contacted by Home Insulation Victoria."
- Pick one as **Main**. The others are backups.
- The same section sits on the installer's profile page for adding, removing or changing electricians later.

## The invite
- An email and a text to the electrician: "Hi {name}, {installer business} has chosen you as their preferred electrician for Home Insulation Victoria jobs. Sign up here to team up." It includes a personal link that expires after 14 days and can be sent again.
- The link opens the existing electrician onboarding with their details filled in. It shows the installer's name and asks one clear question: **"Do you want to team up with {installer}?"** The answers are Yes, or No, I'll decline.
- Already registered with us? The link skips signup and only asks the team-up question.
- **While messages to customers and partners are still locked, invites wait as drafts** in the To action list, with a "Copy link" button so staff can send it by hand. Nothing is sent automatically before launch.

## Teaming rules
- **Teamed up** means all four are true:
  - the installer nominated them
  - the electrician accepted
  - HI VIC approved the electrician's onboarding (licence, REC, insurance)
  - the electrician covers the job's area
- Once teamed, new installer-sourced jobs are **assigned to the Main electrician automatically**. The job history records that this came from the team-up.
- If the Main electrician is unavailable, suspended or outside the area, jobs go to a backup and then to HI VIC matching. The job never waits silently.
- The 24-hour and 48-hour no-reply rules still apply. "Request another electrician" still works, and the team-up stays in place.
- Either side can end the team-up from their profile. Existing jobs keep their electrician; only new jobs change.
- Jobs that HI VIC sourced still use normal matching. A preferred electrician only gets priority on these when they're in the area.

## Status the team sees
- Installer profile and the Partners admin page show each electrician as one of:
  - Invite drafted
  - Sent
  - Opened
  - Signed up
  - Awaiting HI VIC approval
  - Teamed up
  - Declined
  - Expired
- To action items:
  - "Send invite" (while messages are locked)
  - "Approve electrician onboarding — nominated by {installer}"
  - "Invite expired: resend or ask installer"
  - "Nominated electrician declined: tell installer"
- The installer sees plain status on their dashboard, for example "Waiting for Sam to sign up" or "Teamed up with Sam Electrical".

## Safety
- Being nominated never skips HI VIC's electrician checks.
- The invite link only opens that electrician's own onboarding. It can't be reused by anyone else, and it doesn't show any customer or job details.
- The same email can't be invited twice. An existing nomination is reused instead.
- PIESA pricing for the team-up is still set at electrician onboarding (their price, or $349 with an HI VIC electrician). It's never guessed.

## Technical details
- Reuse `electrician_nominations` for installer-level nominations (no job): add `invite_token_hash`, `expires_at`, `accepted_at`, `declined_at`, `is_primary` and `consent_confirmed_at`, and statuses for the lifecycle above.
- On electrician onboarding approval with accepted nomination: upsert `partner_relationships` (`preferred=true`, `active=true`, primary flag). Pure rule `planTeamUp` / `pickTeamElectrician` in a new `teaming.core.ts` with tests (area, suspension, backup order, HI VIC-sourced behaviour).
- Auto-assignment hook in the existing installer-sourced intake / `autoAdvanceJob` path, logging a `workflow_events` entry "auto-assigned via team-up".
- Public route `/electrician-onboarding?invite=<token>`: token looked up server-side (hashed), returns only first name and installer business name.
- Invite delivery goes through the existing comms lock (draft only until unlocked). The To action derivation gets the new task types.
- Test Centre: add a dummy installer, a nominated electrician and an accept flow, so the whole team-up path can be run from start to finish.
