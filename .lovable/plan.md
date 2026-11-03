# Automatic Mitti invite for Leads — plan

## What I found (read-only)
- The code is ready but switched off three ways: the "Mitti calls checked" flag is off in the code, the auto-invite setting isn't saved, and the HIV trades group ID isn't saved either. The Mitti login secrets (token + user ID) are saved.
- With the switch off, approving a Lead does nothing: no Mitti call, no message, no record.

## 1) Checking the Mitti user API safely (TEST person only)
- One-off script, dry run by default, that refuses to run unless the person is a reserved TEST identity (TEST domain / TEST business). It would only ever use the persistent Mitti simulator otherwise.
- Steps on Jo's "go", one at a time: (a) find by email for an existing TEST user (TEST Bravo Lead, already in Mitti) — read only; (b) create one new TEST Lite user at the TEST inbox jolowexo@hotmail.com (Mitti emails that inbox only); (c) add it to the trades group; (d) deactivate it again. Each step's result shown to Jo before the next.
- MITTI_TRADES_GROUP_ID is NOT set. Jo/office needs to give us the HIV trades group ID from Mitti and add it in Settings → Secrets first.

## 2) Switching it on
- Needs all three: Mitti-checked flag turned on in code (after step 1 passes), MITTI_AUTO_INVITE_ENABLED=true added as a secret, group ID saved. Then publish (Jo publishes).
- What a new Lead gets, when the office approves them:
  - Mitti's own email (Mitti's wording, from Mitti) asking them to set a password — we don't control it.
  - Our one message, by text if they have an Australian mobile, otherwise email. Wording: "You've been invited to Mitti, the app you'll use for Home Insulation Victoria job forms. Check your email from Mitti, set your password, and download the Mitti app." Email subject: "You've been invited to Mitti".
  - Sent once only (recorded before sending), normal quiet hours/STOP/switches apply. Crew get nothing.

## 3) Lead with no email of their own — question for Jo
Today it uses the business's email (Jo 28 Oct). Then Mitti's set-password email goes to the boss, and the Lead's Mitti login is the business email. Options:
- A) Keep business email fallback (as today).
- B) Wait: record "Mitti invite waiting for Lead's own email" on the office/Team page, invite as soon as the boss adds it (the new "Add email" box).
I'd recommend B, but won't decide.

## 4) Existing Leads not in Mitti (live, nothing sent)
- Approved, marked Lead: none live (only TEST Bravo, already in Mitti).
- Approved with no Lead/Crew set (older records): Silver Spirit Investments — Dominic Doherty (not in Mitti). Chris Lowe is already in Mitti.
- Pending Leads (would be invited when approved): RAPID — James Sachinidis; Reinsulate — Manminder Singh, Wayne Fletcher (no own email, so question 3 applies).
- Turning it on does NOT invite already-approved people; only new approvals. Any catch-up for Dominic would be a separate step for Jo's OK.

## 5) Trade-message pause
While "pause all trade messages" is on (it is now), nothing happens on approval — no Mitti user, no message, nothing recorded — and it does not auto-retry when unpaused. The office would need to re-approve or invite in Mitti. Question for Jo: keep that, or have paused Leads listed in office Needs me as "Mitti invite waiting for pause to lift" (still nothing sent until she un-pauses and confirms)?

## 6) Tests (before any switch-on)
- Switch off → nothing read/called/sent.
- Lead approved → one create, one group add, one message; approved twice → no second invite or message.
- Crew approved → no invite.
- Paused → no create, no message.
- No own email → behaviour per Jo's answer to Q3.
- TEST people only reach the simulator; checker script refuses real people.
- Removal deactivates once.

## Not doing in this plan
No code, sends, Mitti calls, data changes or publishing until Jo approves each step.
