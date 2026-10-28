# Seeing what was sent — design

Date: 28 Oct 2026
Status: waiting for Jo's approval
Part 1 of 3 in the email redesign (2 = AI replies, 3 = automatic emails — separate specs later).

## The problem

- Replies Jo sends from the portal go through the portal's email service (Resend), not Outlook, so they never appear in the info@ Outlook Sent folder. The owner's original email is then archived out of the inbox, so the whole conversation drops out of sight.
- The portal only ever records an email as "sent". It never learns whether it was delivered or bounced.
- Jo hasn't been using the job's contact history to check emails.

Checked 28 Oct: all 15 replies sent from the Emails tab were accepted by Resend with a delivery receipt — nothing was lost. The issue is visibility.

## What Jo decided

1. Replies she sends go out from info@ through Outlook, so they show in Sent and the owner's answer joins the same thread.
2. Only replies she sends change. Automatic emails (Save My Spot, quotes, reminders etc.) keep sending as they do now.
3. Sent emails are seen on each job's contact history — no separate Sent list.
4. Every email on a job shows whether it got there.

## What changes

### A. Replies go through Outlook

Applies to the two Send buttons in the Emails tab:
- reply to an owner with a job (`sendAiDraft`, via `sendJobEmailReply`)
- reply to someone with no job (`sendNoJobEmailReply`)

Each is sent as an Outlook **reply** to the owner's original message in the info@ mailbox (Microsoft Graph: create reply on the message, set body, send), through the existing Lovable Outlook connector.

Kept exactly as now:
- wording, layout, sign-off ("Cheers, the Home Insulation Victoria team") and unsubscribe link
- every safety check before sending: customer emails switch, test-recipient boundary, unsubscribed owners, test jobs (`qa_test` still go to the test address only), one website reply per person
- no 8pm hold on manual sends
- copy saved on the job's contact history
- owner's email archived out of the inbox after sending

Changed:
- history row records provider `outlook` and the Outlook message id
- if Outlook refuses or can't be reached: nothing is marked sent, the draft stays, and Jo sees "Not sent — Outlook couldn't send it. Try again." No quiet fallback to the old way.
- if the original message can't be found in Outlook (deleted, moved): send as a new Outlook email to the owner with the same subject, so it still lands in Sent.

Setup needed once: the Outlook connection must be allowed to send mail, not just read. If it isn't, Jo reconnects Outlook in Lovable. The build checks this first and stops if sending isn't allowed.

### B. Every email shows whether it arrived

Plain statuses on each outgoing email:

| Status | Meaning |
|---|---|
| Sent | Handed over. For Outlook replies this is the final state unless a bounce comes back. |
| Delivered | The owner's email provider accepted it (automatic emails only). |
| Bounced | It didn't get there — shown in red with a short reason, e.g. "Email address doesn't exist". |
| Not sent | Blocked or failed before going out. |

How the portal learns:
- **Automatic emails:** turn on Resend's delivery updates (webhook) for delivered and bounced. Each update is matched to its email by Resend's message id and updates the status. Updates are checked as genuinely from Resend before being trusted.
- **Outlook replies:** when the Outlook sync finds a bounce notice ("Undeliverable", mailer-daemon, postmaster) in info@, it matches it to the reply it's about, marks that reply Bounced, and archives the notice. Notices that can't be matched are left in the inbox untouched.

### C. Bounces are easy to spot

- A job with a bounced email shows a red "Email bounced" tag in Enquiries and Active jobs until a newer email to that owner is delivered or Jo clears it.
- No automatic text or other action — Jo decides what to do.

### D. Contact history Emails filter

- Contact history already has filter chips (All, Email, Text…). Outlook emails currently sit under a separate "Outlook" chip; they move under "Email" so every email in and out is in one place, and the "Outlook" chip goes.
- Each email row shows: who it went from/to, when, subject, first line, and its status pill.
- Must look right on phone and computer.

## Not included

- Moving automatic emails to Outlook
- A Sent list in the Emails tab
- AI reply quality (part 2)
- Changing what automatic emails go out (part 3)
- Tracking opens or clicks

## Testing

- Unit tests for: choosing reply vs new email, status mapping, bounce matching, Resend update checking.
- On a test job only: send a reply and confirm it appears in info@ Sent and the history shows Sent.
- Send one reply to a made-up address on the test domain and confirm it turns Bounced and the notice is archived.
- Confirm an automatic test email turns Delivered.
- Confirm a failed Outlook send leaves the draft and shows "Not sent".
- Nothing goes to a real owner during testing.

## Open risk

- Outlook has a daily sending limit (about 10,000 for business accounts) — far above reply volumes, so fine.
- If the Lovable Outlook connector can't be given send permission, part A needs rethinking before building. This is checked first.
