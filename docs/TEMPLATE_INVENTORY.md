# Every message the portal can send — review list for Jo

Prepared 24 Oct 2026 (Melbourne) from the code on branch `installer-mitti-workflow` and read-only checks of the live database. Nothing was sent or changed.

## Summary

- **38 portal messages** can go out: 25 emails, 11 texts, and 2 groups of TEST copies to Jo. Another 3 come from outside services that use their own wording: Supabase password-reset email, Supabase sign-in-link email, and Twilio's automatic STOP reply.
- **7 portal messages can still reach real people today**, even though the master switch (`customer_comms_enabled`) is OFF:
  1. Photos/insulation request to **new** website enquiries (T5/T6).
  2. "Not eligible" result to **new** website enquiries (T7).
  3. Electrician invitation email. An installer sends it by adding a new electrician.
  4. Partner welcome + set-password link.
  5. Application "quick change needed".
  6. Application declined.
  7. Office's own typed email to an applicant or partner.

  Also still working today: the Office's hand-sent Outlook copies, Jo's TEST copies, and the 3 outside senders.

  Items 1–2 get past the master switch through a separate setting: "automatic enquiry emails" (`customer_delivery_settings.enabled` = **ON**, start date 19 Oct). Items 3–7 go through the office email sender, which never checks the master switch.
- **Why emails went out on 23 Oct.** The master switch was **ON** for all of 23 Oct UTC. The 264 Spot saved emails and the launch emails were not bypassing it. The live records show:
  - Texts were blocked as "Customer communications are switched off" until 18 Oct.
  - The switch was on from about 19 Oct.
  - The last real send was a 24-hour reminder text at 21:01 UTC.
  - The first "held: Customer emails are switched off" record is at 21:40 UTC.

  So it was switched off between **8:01 and 8:40 am Melbourne time on Fri 24 Oct**. Nothing records who changed it or when: there is no audit row, and `workflow_settings.updated_at` still says 28 Sep. Every Save-my-spot, Spot saved and reminder path checks the switch.
- **What fires the moment the master switch goes back ON:**
  - **4 held first replies** to new website enquiries go out within about 2 minutes. They are HV-3166, HV-3167, HV-3168 and HV-3169, all "Save my spot" offers. Any new enquiries that arrive before then are added to this.
  - **24-hour Save My Spot reminder texts**: 70 offered-but-not-saved enquiries have had no reminder yet.
    - About 29 of them are already over 24 hours old.
    - About 41 more come due within the next day.
    - At most 10 go per hour, between 8am and 7pm Melbourne time.
    - Consent, link and duplicate-phone checks will remove some, so these are the most that could go.
  - The Step-3 estimate worker scans 20 enquiries every 10 minutes. It sent **0** while the switch was on (20 scanned, 20 blocked each run), so expect 0.
  - **Nothing else queues up**:
    - 3-day follow-ups: 0 rows.
    - Outbox: 3 rows, none sendable, and the outbox sender isn't installed.
    - Spot saved confirmations: 3 emails and 22 texts were recorded "not sent" since the switch went off. They are **never** retried automatically.
    - The 639 old "manual backlog" enquiries stay held until the Office releases them.
    - The 67 electrician nominations marked "invite pending" never resend by themselves.

## Things Jo should know first (risks found)

1. **Owner "Your quote is ready" email: the approval flag disagrees with the wording file.** The code flag says approved (`OWNER_QUOTE_EMAIL_APPROVED = true`). The wording file says "draft, 24 Oct, NOT approved by Jo yet". With the switch on, Office "Send quote" would email the draft.
2. **Existing-insulation Save my spot line is marked DRAFT but is live.** The line is "You told us there is some existing insulation…". 2 owners received it on 23 Oct (10:12–11:20 UTC).
3. **The electrician invitation goes out immediately** when an installer adds an electrician. It never checks the master switch.
4. **The installer "please check the quote" 48-hour reminder skips the master switch.** It is OFF in code today. If someone turns that code switch on, it sends even with the master switch off.
5. **The Spot saved text has two problems.** It has no "Reply STOP" line. It also says "Home Insulation Victoria" twice, because the portal adds it at the start and the wording adds it at the end. The Ready Check incomplete text has the same double name.
6. **The 15-minute timer runs the preview build, not the published one.** The schedule calls the `…-dev.lovable.app` address. It runs the Daily Mitti texts, the installer reminder and the Mitti sweeps.
7. **Three installer texts can never send.** "Ready Check form incomplete" (28 times it would have fired), "Add your usual electrician" and the Daily Mitti texts look for a setting (`mitti_auto_quote_enabled`) that doesn't exist in the database, or need switches that are off.
8. **The Templates page shows an email nothing sends.** It shows a plain "Your portal login" email. The real welcome email is a different, designed one.
9. **Spot saved confirmations are never retried.** A save made while switches are off is recorded "not sent" and then dropped.

## The inventory

Live-switch values read 23 Oct 23:18 UTC:

| Setting | Value |
|---|---|
| `customer_comms_enabled` | **OFF** |
| `save_my_spot_real_send_enabled` | ON |
| Automatic Save-my-spot rules | ON (since 20 Oct) |
| `customer_delivery_settings.enabled` | ON (Base44 bridge, enquiries from 19 Oct) |
| Text switches | `save_spot_reminder` ON, `spot_saved` OFF, `spot_saved_email` ON. `owner_code`, `quote_ready`, `daily_mitti` and the others are not set (= OFF). |
| `daily_mitti_text_enabled` | OFF |
| `auto_send_quote`, `auto_send_mitti`, `auto_send_installer`, `auto_send_rec` | all ON. These release work inside the portal; they don't send messages themselves. |

"30-day use" counts real sends to 23 Oct (TEST copies excluded).

### Owners (homeowners)

| # | Message | Channel | When it goes | Switches needed | Can send today? | Wording status | Design | 30-day use (last) | Problem / note | Files |
|---|---|---|---|---|---|---|---|---|---|---|
| O1 | Save my spot offer — no existing insulation (Jo T1/T2) | Email | Automatically after a new enquiry's eligibility result; or Office buttons (Hot leads, Dispatch, Office catch-up) | Master + Save-my-spot switch + automatic rules + consent | No | Approved (Jo templates) | Jo template layout (V2 shell + Spot Saved header art) | 311 (23 Oct) | Most-sent offer. 4 held, fire when switch ON | `jo-email-templates.core.ts:217,402`; `hot-leads-send.server.ts:55,99`; `lead-email-routing.server.ts:105` |
| O2 | Save my spot — existing insulation (thin/patchy, declared existing, or reviewed below R2: T1/T2 variant, T3/T4) | Email | Automatically for new enquiries declaring insulation; Office "existing insulation" button | Master + consent + campaign permission | No | **"Declared existing" line is DRAFT**; thin/patchy approved 22 Oct | Jo template layout | 233 + 10 Office-sent (23 Oct) | Draft line already sent to 2 owners | `jo-email-templates.core.ts:213-215,256`; `hot-leads-send.server.ts:69`; `lead-email-routing.server.ts:101` |
| O3 | "Help us check your insulation" — photos/video request (T5/T6), plus "thanks, we have your photos" variant | Email | Automatically after a new enquiry's result when insulation is unconfirmed; Office "send held" | Master + automatic-enquiry setting, **or for new enquiries only the automatic-enquiry setting** | **Yes — new enquiries (19 Oct on, under 14 days old)** | Approved (T5/T6); acknowledgement wording swap | Jo template layout | 1,111 + 10 Office-sent (23 Oct) | Skips master switch for new enquiries | `jo-email-templates.core.ts:299`; `jo-outcome-email.core.ts:570`; `hot-leads-send.server.ts:489`; `enquiry-auto-reply.core.ts` |
| O4 | Office "more photos please" (T5/T6 with Office-edited text) | Email | Office button on a reviewed enquiry | Master + automatic-enquiry setting | No | Template approved; Office types the body | Jo template layout | 27 (20 Oct, sent from Outlook) | Body is free text each time | `hot-leads-send.server.ts:76`; `more-photos-request.core.ts` |
| O5 | "Tell us about your insulation" questions campaign (T5/T6 variant) | Email | Office batch button | Code approval flag (OFF) + master | No | **DRAFT** | Jo template layout | 0 | Waiting on Jo's wording | `insulation-questions-campaign.core.ts:5`; `jo-email-templates.core.ts:291` |
| O6 | Your eligibility result — not eligible (T7) | Email | Automatically after a new enquiry is found ineligible (reason recorded); Office "reviewed ineligible" button | Master + delivery; **or for new enquiries only the automatic-enquiry setting** | **Yes — new enquiries** | Approved (T7) | Jo template layout | 20 (21 Oct, via Base44 bridge) | Skips master switch for new enquiries | `jo-email-templates.core.ts:343,453`; `followups.server.ts:356,369` |
| O7 | Step 3 estimate email (T1–T6 through the old estimate path) | Email | Timer every 10 min (oldest 20 active links); Office "send estimate" | Master + Base44 bridge + consent + 14-day window | No | Approved (Jo templates) | Jo template layout | 0 ever | Duplicates O1/O3; scans the same 20 blocked links each run | `followups.server.ts:161,315`; `hooks/customer-followups.ts` |
| O8 | "Just checking you received your estimate" (3-day follow-up) | Email | Timer, 3 days after O7 | Master + bridge | No | Not marked approved | Older estimate layout | 0 (no rows queued) | Only queued after O7, which never sends | `followup-email.ts:16`; `followups.server.ts:253` |
| O9 | "Great news — book your free Ready Check" (T8) | Email | Office button for owners who saved a spot | Master + Save-my-spot switch + consent + bridge | No | Approved (T8) | Jo template layout | 0 | Never used yet | `jo-email-templates.core.ts:360`; `ready-check-invitation.server.ts:140` |
| O10 | Spot saved confirmation | Email | When the owner taps Save my spot (once per owner) | Master + `spot_saved_email` (ON) + consent | No | Approved 7 Oct | Spot Saved campaign art (V2 theme) | 264 (23 Oct) | Not retried if blocked | `spot-saved-messages.core.ts:49`; `spot-saved-send.server.ts:54`; `launch-campaign.server.ts:341` |
| O11 | Your quote is ready | Email | Office "Send quote"; automatic Ready Check release (code OFF) | Master + consent | No | **Flag says approved, file says DRAFT** | Own quote layout + campaign button | 0 real (2 TEST) | Fix the approval mismatch | `owner-quote-email.core.ts:2-10,93`; `quote-ready-notify.server.ts:71` |
| O12 | Your signing code | Email | Owner asks for a code on My job | Master + consent + bridge | No | Not marked approved | Simple email (welcome style) | 0 | — | `owner-code-delivery.core.ts:9`; `owner-code-delivery.server.ts:9` |
| O13 | No partner in your area yet | Email | Office button on Coverage | Master + consent + bridge | No | Not marked approved | Older estimate layout | 0 | — | `coverage-email.ts:8`; `coverage.functions.ts:80` |
| O14 | Installer's Ready Check times request ("choose a time…") | Email | Installer button | Code approval flag (OFF); real sending not connected | No (TEST only) | **DRAFT** | Simple layout | 0 real (19 TEST, 8 Oct) | Not wired for real owners | `installer-ready-check.core.ts:13,60`; `installer-ready-check.server.ts:70` |
| O15 | Office manual email (portal prepares Jo's template; Office sends it from Outlook) | Email | Office "prepare email to copy" | None — a person sends it | Yes (by hand) | Approved templates | Jo template layout | 2 recorded (20 Oct) | Recorded only; Outlook copier | `manual-communication.server.ts:45` |
| O16 | 24-hour Save My Spot reminder | Text | Hourly timer, 8am–7pm Melbourne, more than 24h after the offer; Office one-off blast | Master + `save_spot_reminder` (ON) + consent | No | Approved | Plain text (brand at start, STOP line) | 323 (24 Oct 8:01am Melb) | ~70 waiting; up to 10/hour when ON | `save-spot-reminder-blast.core.ts:17`; `save-spot-reminder-blast.server.ts:96`; `routes/api/public/save-spot-reminders.ts` |
| O17 | Spot saved text | Text | With O10 | Master + `spot_saved` (OFF) | No | Approved | Plain text | 246 (23 Oct) | No STOP line; brand name twice | `spot-saved-messages.core.ts:43` |
| O18 | Signing code text | Text | Owner asks for a code | Master + `owner_code` (not set) + consent | No | Approved (code list) | Plain text | 0 | Switch not set, so owners can't get a code by text | `owner-code-delivery.core.ts:5`; `sms.core.ts:13` |
| O19 | Quote ready text | Text | With O11 | Master + `quote_ready` switch + wording approval | No | **Not approved** (blocked in code) | Plain text | 0 | — | `quote-ready-notify.server.ts:14`; `sms.core.ts:15` |
| O20 | Ready Check booking confirmation text | Text | Nothing sends it yet | Wording approval + switch | No | Not approved | Plain text | 0 | Listed but unused | `sms.core.ts:14` |
| O21 | Twilio's automatic STOP reply | Text | Owner texts STOP | Twilio account setting | Yes | Twilio's own wording | — | n/a | Not in portal; check in Twilio | `routes/api/public/twilio/inbound.ts:4` |

### Installers

| # | Message | Channel | When it goes | Switches needed | Can send today? | Wording status | Design | 30-day use (last) | Problem / note | Files |
|---|---|---|---|---|---|---|---|---|---|---|
| I1 | Daily Mitti links text (6:30am) and update text | Text | 15-min timer at the set time; update when jobs change | Master + `daily_mitti_text_enabled` (OFF) + `daily_mitti`/`daily_mitti_update` switches | No | Approved | Plain text | 0 (1 TEST) | Timer runs the preview build | `daily-mitti-text.core.ts:54,77`; `daily-mitti-text.server.ts:87` |
| I2 | "Ready Check booked" text | Text | 15-min timer after a Ready Check is confirmed | Same as I1 | No | Approved 23 Oct | Plain text | 0 | — | `daily-mitti-text.server.ts:121,150` |
| I3 | Ready Check form is missing answers/photos | Text | Mitti sync finds gaps | Missing setting `mitti_auto_quote_enabled` + master + switch | No — can never send | Approved 22 Oct | Plain text | 0 (28 times recorded) | Brand name twice; setting doesn't exist | `ready-check-chase.core.ts:35`; `ready-check-chase.server.ts:37` |
| I4 | Add your usual electrician's details | Text | Quote prep finds no electrician | Missing setting + master + approval | No | **Not approved** | Plain text | 0 | — | `usual-electrician.core.ts:39`; `usual-electrician-reminder.server.ts` |
| I5 | Please check the quote for HV-… (48h reminder) | Email | 15-min timer, 48h after the quote is ready | Code switch only (OFF) | No | Not marked approved | Simple email | 0 | **Skips master switch** if turned on | `installer-quote-approval.core.ts:8`; `installer-quote-approval.server.ts:69,96` |
| I6 | Trade worker sign-in invite (Supabase invite email) | Email | Office "invite" on Workers | Code approval (OFF) + master | No | Not approved; wording in Supabase | Supabase template | 0 | Office copies the link instead | `trade-access.core.ts:4`; `trade-access.functions.ts:39` |

### Electricians

| # | Message | Channel | When it goes | Switches needed | Can send today? | Wording status | Design | 30-day use (last) | Problem / note | Files |
|---|---|---|---|---|---|---|---|---|---|---|
| E1 | "[Installer] has invited you to Home Insulation Victoria" | Email | **Installer** adds a new electrician (Add job / My business) | None (office email sender) | **Yes** | Not marked approved | Simple email | 2 (21 Oct) | Skips master switch; triggered by installers | `job-electrician.core.ts:54`; `job-electrician-invite.server.ts`; `bulk-import.functions.ts:149` |
| E2 | New job offer text to a trade | Text | Nothing sends it yet | Wording approval + switch | No | Not approved | Plain text | 0 | Listed but unused | `sms.core.ts:18` |

### Partner applicants and approved partners

| # | Message | Channel | When it goes | Switches needed | Can send today? | Wording status | Design | 30-day use (last) | Problem / note | Files |
|---|---|---|---|---|---|---|---|---|---|---|
| P1 | "You're approved — welcome" + set-password link | Email | Office "send login link" | None | **Yes** | Approved 8 Oct | Partner layout (logo, portal fonts) | 4 (22 Oct) | Skips master switch | `partner-email.core.ts:47`; `partner-activation.functions.ts:196` |
| P2 | "Your application – a quick change needed" | Email | Office "send back for changes" | Code approval (ON) | **Yes** | Approved | Partner layout | 0 real (41 TEST) | Skips master switch | `application-review.core.ts:20`; `application-review.server.ts:56` |
| P3 | "Your Home Insulation Victoria application" (declined) | Email | Office "decline" | Code approval (ON) | **Yes** | Approved | Partner layout | 0 real (41 TEST) | Skips master switch | `application-review.core.ts:32` |
| P4 | Office's own typed email to an applicant or partner | Email | Office "email" on Partners | None | **Yes** | Office types it | Simple email | 5 (22 Oct) | Skips master switch | `office-email.core.ts:22`; `partner-activation.functions.ts:236` |
| P5 | Rate offer email | Email | — | Code switch (OFF); no sender built | No | — | — | 0 | Office copies a link | `rate-offer.functions.ts:14,87` |
| P6 | Partner recruitment emails (installers / electricians) | Email | Office downloads the HTML and sends it from its own mail | None (not portal-sent) | n/a | Stored HTML | Recruitment layout | n/a | Not sent by the portal | `partner-templates.ts:21,30` |
| P7 | Plain "Your portal login" email | Email | Shown on the Templates page only | — | No | — | Plain text | 0 | Not the email actually sent (P1 is) | `partner-login-email.core.ts:4`; `template-hub.tsx:168` |

### Office and Jo (TEST) / sign-in

| # | Message | Channel | When it goes | Switches needed | Can send today? | Wording status | Design | 30-day use (last) | Problem / note | Files |
|---|---|---|---|---|---|---|---|---|---|---|
| T1 | TEST copies of any message (Save my spot, quote, Spot saved, partner welcome, Daily Mitti, etc.) | Email + Text | TEST jobs, TEST partners, "send me a test" buttons | Only Jo's allow-list (`jolowexo@hotmail.com`, `jo@actpropertyinspections.com.au`, `+61477511901`) | Yes (Jo only) | Same as the real message | Same as the real message | 148 emails, 2 texts (23 Oct) | Fine — never reaches anyone else | `test-send.core.ts:5`; `test-send.server.ts` |
| T2 | Jo "tradie" practice messages (welcome, new job, booked, see you tomorrow, all clear) | Email + Text | Jo's practice buttons | TEST only | Yes (Jo only) | Practice | Simple email | in T1 | — | `jo-tradie.server.ts:84-201` |
| T3 | Password reset email | Email | Anyone presses "Forgot password" | Supabase (no portal switch) | **Yes** | Supabase template (not in code) | Supabase | not logged | Wording isn't in this codebase | `SignInCard.tsx:57`; `reset-password.tsx:102` |
| T4 | Email sign-in link | Email | Anyone presses "email me a link" | Supabase | **Yes** | Supabase template | Supabase | not logged | Same | `SignInCard.tsx:65` |

There are no automatic alert emails or texts to the Office; Office alerts appear inside the portal. Earlier one-off Office bulk sends were recorded from Outlook: 927 "capacity update" emails on 13 Oct and 46 "backlog clear" emails on 20 Oct. They are history, not templates.

## Suggested review order (biggest reach first)

1. **O3** Photos/insulation request (1,111 sent; still live for new enquiries).
2. **O1** Save my spot offer (311; first to fire when switched on).
3. **O16** 24-hour reminder text (323; about 70 waiting).
4. **O10 + O17** Spot saved email and text (264 / 246). Add STOP and fix the double brand name.
5. **O2** Existing-insulation Save my spot (233). Approve or replace the DRAFT line.
6. **O6** Not-eligible result (20; live for new enquiries).
7. **O11 + O19** Quote ready email and text. Settle the draft/approved mismatch before any quote is sent.
8. **E1** Electrician invitation (live; sent by installers).
9. **P1–P4** Partner and applicant emails (live; office-triggered).
10. **O9, O4, O5, O15** Office-button owner emails.
11. **I1–I6** Installer texts and emails (all off or broken today).
12. **O7, O8, O12, O13, O14, O18, O20, E2, P5–P7** Rare, unused or retired. Decide keep or delete.
13. **T3, T4, O21** Supabase and Twilio wording (check in those consoles).

## Could not determine

- Who switched the master switch off, and exactly when. No audit row exists. Live records narrow it to 21:01–21:40 UTC on 23 Oct.
- What the Base44 bridge adds when it delivers O6, O7, O9, O12 and O13. Its sender address and wrapper live in Base44. The Base44 website may also send its own enquiry emails.
- Supabase auth email wording (T3, T4, I6) and Twilio's STOP reply wording (O21).
- The exact reminder backlog after the consent, link and phone-duplicate checks. The numbers above are upper bounds.
- Which of the 1,111 T5/T6 sends went out through the new-enquiry bypass rather than with the master switch on. The switch was on 19–23 Oct, so most were sent with it on.
