# Pack 1 — Jo's approval pictures (Parts 1, 2, 3, 4, 8)

Made 4 Nov 2026 from branch new-job-flow-joined (HEAD 3af1415 — Parts 1–8 + main joined; see the note at the end). Every email, text and PDF was built by its real code builder with the Templates hub's sample data, with the approval flag forced ON only through the builder's own option. Nothing was sent; nothing in src was changed.

Pictures: `NN-name.png` (emails/texts, 390 px wide, 2x) and `NN-name-p1.png` / `-p2.png` (PDF pages). Each has a `NN-name.md` with who gets it, the flag, and the full wording line by line marked APPROVED (Jo said it earlier) or DRAFT (needs her word). `NN-name.txt` is the plain wording; `.pdf` / `.html` are the built files.

## How to read the flag column
A flag is a code switch that is OFF today. When Jo approves the picture, the flag flips ON at go-live (Part 11) and that message/PDF starts going out; until then the old version (or nothing) goes out. 'none' = already live / approved wording, shown because it changed.

## Items (approval-list order)

| # | Item | Type | Part | Picture | Flag | What changed vs today |
|---|---|---|---|---|---|---|
| 1 | O77 It's your turn (area batch send) | Email | 3 | 01-o77-its-your-turn.png | IT_IS_YOUR_TURN_V2_APPROVED | Replaces the old quick taps email: new wording (decisions #21/#22), opens ?screen=taps. Old Release path keeps its old wording. |
| 2 | O77 It's your turn — day-2 reminder | Email | 3 | 02-o77-its-your-turn-day-2-reminder.png | IT_IS_YOUR_TURN_V2_APPROVED | Same email with the reminder opening line. |
| 3 | It's your turn (text) + day-2 reminder | Text | 3 | 03-its-your-turn-text.png | IT_IS_YOUR_TURN_V2_APPROVED (text switch spot_released) | New text with the batch send (replaces the quick_taps text). |
| 4 | {Installer} will call you (email) | Email | 3 | 04-installer-will-call-you-email.png | OWNER_WILL_CALL_APPROVED | New email (decision #23 + Fix 5): installer's OFFICE phone, contact block and the AP certificates line. Replaces the draft DB template in_house_partner_will_call. |
| 5 | {Installer} will call you (text) | Text | 3 | 05-installer-will-call-you-text.png | OWNER_WILL_CALL_APPROVED (text switch owner_will_call) | New text. |
| 6 | You're booked for your free Ready Check (email) | Email | 3 | 06-youre-booked-ready-check-email.png | OWNER_BOOKED_READY_CHECK_APPROVED | New layout and wording (decision #24 + Fix 5): office phone, contact block, AP line; 'Need to change it? Call {Installer} on {office phone}.' Replaces the current in-house 'You're booked'. |
| 7 | Your time has changed (Ready Check) | Email | 3 | 07-youre-booked-ready-check-time-changed.png | OWNER_BOOKED_READY_CHECK_APPROVED | Same email headed 'Your time has changed' (layout is a draft — Jo picture). |
| 8 | You're booked for your free Ready Check (text) | Text | 3 | 08-youre-booked-ready-check-text.png | OWNER_BOOKED_READY_CHECK_APPROVED (text switch in_house_booked_owner) | New wording. |
| 9 | See you tomorrow (text) — Ready Check / safety check / install | Text | 3 | 09-see-you-tomorrow-texts.png | none (approved wording, decision #25) — text switch visit_tomorrow_owner | Business office phone and 'electrical safety check (PIESA)' naming (decision #25). Part 4 T16: in-house (new-flow) owners now get it too. |
| 10 | O18 Your quote is ready (v4: What's changed + documents) | Email | 3 | 10-o18-v4-your-quote-is-ready.png | OWNER_QUOTE_EMAIL_V4_APPROVED | 'Your rebate'/'Rebate' labels, Next names the electrical safety check (PIESA), 'What's changed from your estimate' box, the 30-day line, documents attached (decisions #29/#33). v3 keeps going out until the flag is on. |
| 11 | O19 Quote reminder (day 3) | Email | 3 | 11-o19-quote-reminder-day-3.png | none (approved, decision #30) | 'Your rebate' label; 30-day quotes say 'Your quote is valid for 30 days, until {date}'. |
| 12 | O19 Quote reminder (2 days before expiry) | Email | 3 | 12-o19-quote-reminder-2-days-before-expiry.png | none (approved, decision #30) | Same changes as day 3. |
| 13 | I23 Good news — the owner accepted (installer office books the PIESA) | Email | 3 | 13-i23-owner-accepted-office-books.png | INSTALLER_ACCEPTED_V2_APPROVED | New wording (decision #36): who books the safety check. Old I23 goes out until the flag is on. |
| 14 | I23 Good news — the owner accepted (electrician books the PIESA) | Email | 3 | 14-i23-owner-accepted-electrician-books.png | INSTALLER_ACCEPTED_V2_APPROVED | Variant naming the electrician. |
| 15 | Ready Check: nearly there (installer office email) | Email | 3 | 15-ready-check-nearly-there-office-email.png | READY_CHECK_CHASE_EMAIL_APPROVED | New email to the office (decision #27). Until the flag is on the earlier text goes out instead. |
| 16 | O10 Spot saved (email) | Email | 3 | 16-o10-spot-saved-email.png | none (approved wording, decisions 12/19) — switch spot_saved_email | Rewritten (Part 3 Task 15): step 2 + PIESA/upgrades wording, no 'needs fixing' sentence; one-tap save from the email link. |
| 17 | Spot saved (text) | Text | 3 | 17-o10-spot-saved-text.png | none (approved, decision 20) — text switch spot_saved | No link any more (decision 20). |
| 18 | A few quick questions about your home (text, installer's own customer) | Text | 3 | 18-own-customer-rental-questions-text.png | OWN_CUSTOMER_RENTAL_TAPS_APPROVED (SMS type own_customer_rental_taps, switch off) | New text (answer 24). |
| 19 | You're booked for your electrical safety check (PIESA) (email) | Email | 4 | 19-youre-booked-piesa-email.png | OWNER_BOOKED_PIESA_APPROVED | New layout/wording (decision #38): the ELECTRICIAN's office phone on the change line; the 30-day rule names the installer. Replaces the current in-house wording. |
| 20 | You're booked for your PIESA (text) | Text | 4 | 20-youre-booked-piesa-text.png | OWNER_BOOKED_PIESA_APPROVED (text switch in_house_booked_owner) | New wording. |
| 21 | You're booked for your insulation install (email) | Email | 4 | 21-youre-booked-install-email.png | OWNER_BOOKED_INSTALL_APPROVED | New layout/wording (decision #46), no install duration; 'Lead Installer' row; balance on install day. |
| 22 | You're booked for your insulation install (text) | Text | 4 | 22-youre-booked-install-text.png | OWNER_BOOKED_INSTALL_APPROVED (text switch in_house_booked_owner) | New wording. |
| 23 | You're clear to install (email) | Email | 4 | 23-youre-clear-to-install-email.png | CLEAR_TO_INSTALL_EMAIL_APPROVED | New one email (touchpoint 40) instead of the standalone PIESA copy + the old 10% deposit request. Until the flag is on the old PIESA copy and deposit request go out. |
| 24 | You're clear to install (text) | Text | 4 | 24-clear-to-install-text.png | CLEAR_TO_INSTALL_EMAIL_APPROVED (text switch install_deposit_request) | Request text now says 'You're clear to install'. |
| 25 | Your safety check found electrical upgrades needed (email) | Email | 4 | 25-upgrades-needed-email.png | UPGRADES_NEEDED_EMAIL_APPROVED | New email (touchpoint 42) sent instead of the standalone PIESA copy. |
| 26 | Electrical upgrades needed (text) | Text | 4 | 26-upgrades-needed-text.png | UPGRADES_NEEDED_EMAIL_APPROVED (text switch upgrades_needed) | New text. |
| 27 | One last step to book your install (deposit reminder, day 3) | Email | 4 | 27-deposit-reminder-v2-day-3.png | DEPOSIT_MESSAGES_V2_APPROVED | New wording (touchpoint 43) for the two reminders; same purpose and key. |
| 28 | One last step to book your install (reminder, upgrades still to come) | Email | 4 | 28-deposit-reminder-v2-upgrades-to-come.png | DEPOSIT_MESSAGES_V2_APPROVED | Variant without the opening sentence. |
| 29 | Deposit received, thanks! (email) | Email | 4 | 29-deposit-received-v2.png | DEPOSIT_MESSAGES_V2_APPROVED (+ PDF_LOOK_APPROVED.receipts for the receipt) | New wording (touchpoint 44) replacing 'Install deposit received'; email only; held if the installer office phone is missing. |
| 30 | Deposit in, ready to book (installer office email) | Email | 4 | 30-deposit-in-ready-to-book-installer.png | DEPOSIT_MESSAGES_V2_APPROVED | New wording (touchpoint 45) replacing 'Deposit paid — book the install day'. |
| 31 | O65 We couldn't get in today (installer will call) (email) | Email | 4 | 31-o65-v2-couldnt-get-in-email.png | INSTALL_NO_ACCESS_V2_APPROVED | Installer calls to rebook (touchpoint 51) instead of 'pick new days on My job'. |
| 32 | We couldn't get in today (text) | Text | 4 | 32-o65-v2-couldnt-get-in-text.png | INSTALL_NO_ACCESS_V2_APPROVED (text switch install_no_access) | No link; installer will call. |
| 33 | Your visit can't go ahead (email) | Email | 4 | 33-visit-cant-go-ahead-email.png | VISIT_CANCELLED_OWNER_APPROVED | New email (answer 4). |
| 34 | All done. Enjoy a warmer home! (balance owing) | Email | 4 | 34-all-done-v2-balance-owing.png | ALL_DONE_V2_APPROVED (+ PDF_LOOK_APPROVED.taxInvoice / veecForm for those attachments) | One email replaces O44 + the O45 final invoice email (touchpoint 52). |
| 35 | All done. Enjoy a warmer home! (paid in full — 'One last thing') | Email | 4 | 35-all-done-v2-paid-in-full.png | ALL_DONE_V2_APPROVED | Variant when the balance is already paid. |
| 36 | Just 2 things left (after-install reminder, day 1, both undone) | Email | 4 | 36-after-install-reminder-day-1-both.png | AFTER_INSTALL_REMINDERS_APPROVED | Replaces the balance day-5/due emails and the separate rebate-form reminders (O61). After day 7 the office sees 'Balance overdue'. |
| 37 | One thing left (after-install reminder, day 7, balance only) | Email | 4 | 37-after-install-reminder-day-7-balance-only.png | AFTER_INSTALL_REMINDERS_APPROVED | One-thing-left version. |
| 38 | Just 2 things left (after-install reminder, text) | Text | 4 | 38-after-install-reminder-text.png | AFTER_INSTALL_REMINDERS_APPROVED (text switch after_install_reminder) | New text. |
| 39 | Something on your job didn't meet the rules (email) | Email | 4 | 39-non-compliance-notice-email.png | NON_COMPLIANCE_NOTICE_APPROVED | New compliance email (answer 9). |
| 40 | You're booked (text to the person who lets the trades in) | Text | 4 | 40-access-person-booked-texts.png | ACCESS_PERSON_TEXTS_APPROVED | New texts (answer 7). Reworded by Jo 3 Nov 23:18 ('the … at {street} is booked for …', never 'your'). |
| 41 | See you tomorrow (text to the person who lets the trades in) | Text | 4 | 41-access-person-tomorrow-texts.png | ACCESS_PERSON_TEXTS_APPROVED | New texts (answer 7), Jo's 3 Nov 23:18 reword. |
| 42 | Your install day is booked (email to the tenant, cl 23) | Email | 4 | 42-tenant-notice-email.png | TENANT_NOTICE_APPROVED | New compliance email (cl 23, answers 7/22). |
| 43 | Your install day is booked (text to the tenant, cl 23) | Text | 4 | 43-tenant-notice-text.png | TENANT_NOTICE_APPROVED | New text. |
| 44 | O28 Your safety check copy (old-flow / Do-not-contact owners) | Email | 4 | 44-o28-piesa-copy-upgrades-label.png | none (live, unflagged) | Row label 'Repairs needed' → 'Electrical upgrades needed' (global term). Open for Jo: the headline still says 'repairs completed' after fixes. |
| 45 | O22 You're in! (quote accepted) | Email | 2 | 45-o22-youre-in.png | none (ACCEPTANCE_EMAIL_APPROVED on; receipt attached only with PDF_LOOK_APPROVED.receipts) | Next steps rewritten to decision 34 (electrician calls to book; electrical upgrades only if needed; installer calls to book the install day); balance due on install day; receipt attached. |
| 46 | O1 Save my spot (no existing insulation) — with the VEU box | Email | 2 | 46-o1-save-my-spot-veu-box.png | none (HELD by decision 388 — spot-only rewording awaiting Jo) | Part 2 Task 5: the VEU box appended at the end of every Save my spot email. |
| 47 | Change or cancel reply (email) | Email | 2 | 47-change-or-cancel-reply.png | none (EMAIL_CHANGE_REPLY_APPROVED on) | Part 2 Task 6: buttons/links changed (My job link, no calculator); 'electrical upgrades' term. |
| 48 | Customer Agreement v1.3 + payment terms (PDF attached to the quote email) | PDF | 1 | 48-pdf-customer-agreement-v1-3-p1.png (+p2 of 4 pages) | OWNER_QUOTE_EMAIL_V4_APPROVED (attachment); customer-agreement v1.3 SQL (DO NOT RUN until approved) | New website-look PDF built from the approved sample (customer-agreement-v1.3-final.pdf). Page 4 business block keeps 'Accredited Person A003654'. |
| 49 | Signed acceptance (PDF attached to O22) | PDF | 1 (+3) | 49-pdf-signed-acceptance-p1.png (+p2 of 5 pages) | PDF_LOOK_APPROVED.signedAcceptance | Website look (acceptance-sample.pdf): typed name as signature (Part 3 T12), two ticks, AP countersign, agreement pages follow. Deposit = 10% after the $349 (Jo answer 1 — the approved sample's 10%-of-total was the sample's error). |
| 50 | Receipt — $349 electrical safety check (PIESA) | PDF | 1 | 50-pdf-receipt-safety-check-p1.png | PDF_LOOK_APPROVED.receipts | New receipt layout; wording 'Still to pay … on install day'. Part 1 Task 5: the $349 receipt layout/wording is unapproved — Jo picture. |
| 51 | Receipt — 10% deposit | PDF | 1 | 51-pdf-receipt-deposit-p1.png | PDF_LOOK_APPROVED.receipts | Approved sample receipt-deposit.pdf rebuilt by the live builder. |
| 52 | Receipt — final payment | PDF | 1 | 52-pdf-receipt-final-p1.png | PDF_LOOK_APPROVED.receipts | Approved sample receipt-balance.pdf rebuilt by the live builder ('Paid in full ✓'). |
| 53 | Tax invoice (PDF attached to All done) | PDF | 1 | 53-pdf-tax-invoice-p1.png | PDF_LOOK_APPROVED.taxInvoice | New website-look tax invoice (tax-invoice-sample.pdf): every ESC Table 4 field; GST worked out on the price before the rebate. |
| 54 | VEEC assignment form (ESC v1.1) — website look, with the Mitti Part B signature picture | PDF | 1 (+8) | 54-pdf-veec-form-p1.png (+p2 of 5 pages) | PDF_LOOK_APPROVED.veecForm (+ pending 0225 SQL for the AP name) | New layout (veec-form-sample.pdf). AP name everywhere 'DC Construction Solutions Pty Ltd trading as Home Insulation Victoria' (ESC-approved sample). Part 8 Task 8: the Lead Installer's drawn Mitti signature lands in Part B (page 4). |
| 55 | ESC Owner's Consent Form — signed copy (PDF) | PDF | 1 | 55-pdf-esc-consent-p1.png | PDF_LOOK_APPROVED.escConsent | New website-look consent PDF (esc-consent-final.pdf); AP signature role 'Director'; AP name as in Jo's approved sample. |
| 56 | Official DEECA PIESA — filled as a PDF | PDF | 1 | 56-pdf-official-piesa-p1.png (+p2 of 8 pages) | PDF_LOOK_APPROVED.officialFormPdf | The DEECA form drawn as a PDF (measured positions from LibreOffice's own layout); 8 pages vs Word's 7 (one page break differs, wording unchanged). |
| 57 | Official DEECA PIISA — filled as a PDF | PDF | 1 | 57-pdf-official-piisa-p1.png (+p2 of 5 pages) | PDF_LOOK_APPROVED.officialFormPdf | As the PIESA: the DEECA PIISA drawn as a PDF. |

Counts: 32 emails, 15 text pictures (some show 2–3 texts), 10 PDFs. Failed: 0.

## Flags in this pack (flip only after Jo OKs the picture)

Part 3: IT_IS_YOUR_TURN_V2_APPROVED (1–3), OWNER_WILL_CALL_APPROVED (4–5; switch the owner_will_call text on first), OWNER_BOOKED_READY_CHECK_APPROVED (6–8), OWNER_QUOTE_EMAIL_V4_APPROVED (10, attaches 48 + the ESC Statement of rights), INSTALLER_ACCEPTED_V2_APPROVED (13–14), READY_CHECK_CHASE_EMAIL_APPROVED (15), OWN_CUSTOMER_RENTAL_TAPS_APPROVED (18).
Part 4: OWNER_BOOKED_PIESA_APPROVED (19–20), OWNER_BOOKED_INSTALL_APPROVED (21–22), CLEAR_TO_INSTALL_EMAIL_APPROVED (23–24), UPGRADES_NEEDED_EMAIL_APPROVED (25–26), DEPOSIT_MESSAGES_V2_APPROVED (27–30), INSTALL_NO_ACCESS_V2_APPROVED (31–32), VISIT_CANCELLED_OWNER_APPROVED (33), ALL_DONE_V2_APPROVED (34–35), AFTER_INSTALL_REMINDERS_APPROVED (36–38), NON_COMPLIANCE_NOTICE_APPROVED (39), ACCESS_PERSON_TEXTS_APPROVED (40–41), TENANT_NOTICE_APPROVED (42–43).
Part 1: PDF_LOOK_APPROVED.signedAcceptance (49), .receipts (50–52), .taxInvoice (53), .veecForm (54), .escConsent (55), .officialFormPdf (56–57). The agreement PDF (48) goes with picture 10's flag; its v1.3 SQL stays DO-NOT-RUN until approved.
GO-LIVE note (Part 4 Task 14): the old owner senders are gone, so CLEAR_TO_INSTALL / UPGRADES_NEEDED / ALL_DONE_V2 / AFTER_INSTALL_REMINDERS must flip at go-live or installs hold and no invoice email goes.

## Approved wording shown without a flag (changed, already live or live at merge)
9 See you tomorrow texts (decision #25), 11–12 O19 quote reminders (#30), 16–17 Spot saved (12/19/20), 44 O28 label, 45 O22 next steps (decision 34), 46 Save my spot VEU box, 47 Change/cancel reply (54–58).

## Not rendered in this pack (and why)
- ESC Statement of rights (attached to O18 v4): the ESC's own PDF (docs/esc-forms/veu-statement-of-rights.pdf, 'xx' removed), not built by us — open it directly.
- Payment terms (Gate B paperwork, Part 2 T2): shown on the My job page, not an email/PDF on its own; its text is inside the agreement PDF (48). Open question from Part 2: signed gate bodies still say "VEU discount" (new version needed).
- Outlook reply draft wording (Part 4 T17, email-reply.core 'Ready Check done … your boss enters the price'): an office draft behind EMAIL_REPLY_DRAFTS_ENABLED, not sent to anyone — read the line in src/lib/email-reply.core.ts.
- Quote reminder texts (decision #32): unchanged, approved as is.
- O71 PIESA owner-confirm email/text: retired in Part 4 Task 14 (the confirm-and-pay page covers it).
- Part 3 Task 11 non-verbatim quote-page strings (signLabel, signSub, lockHint, PDF-not-ready text, "Estimate → Quote") and Part 4's "{Installer} will call you to book your install day." line: owner SCREEN wording — Pack 2.

## Pack 2 (needs the running portal, or not on this branch's Parts 1–4/8 scope)
- Owner My job screens: quote page (P2 two ticks, typed name, What's changed box, documents links), quick taps + rental taps (RENTAL_TAPS_APPROVED), confirm-and-pay page (?screen=clear: consent ticks, PIESA tick "View the full form"), Sign and pay page (?screen=finish, two ticks), owner stage lines. Why: screens need the running portal.
- Installer screens (Part 5): My work, job page Next step box, Money, My business, Team, Add a job wording; Part 5 T6/T8/T9/T10 drafts in JO-APPROVAL-LIST. Why: screens + Part 5 not in this pack.
- Part 6 (electricians): electrician job link text (ELECTRICIAN_LINK_TEXT_APPROVED), "Can't do this one" email (ELECTRICIAN_CANT_DO_EMAIL_APPROVED), upgrades nudge text / office email / red-flag email (UPGRADES_*), PIESA booked office email (PIESA_BOOKED_EMAIL_APPROVED) + "Lets you in" rows (ELECTRICIAN_ACCESS_ROWS_APPROVED), "Change the time" drafts. Why: Part 6 scope.
- Part 7 (Lead Installer / crew): SWMS website-look PDF (PDF_LOOK_APPROVED.swms + SWMS_NOV2_WORDING_ON — show the kit PDF, not the HTML print), Lead Installer confirm email (LEAD_INSTALLER_CONFIRM_EMAIL_APPROVED), 6:30am texts recipient rule, SWMS sign page drafts, NO_FORM_NO_PAY_V2 wording. Why: Part 7 scope.
- Part 8 Mitti labels: the new A1/A2/A3/A5 question wording lives in docs/mitti-paste-2026-11-02-part8.md (Jo pastes into Mitti; nothing to render). The only Part 8 output in this pack is the Mitti Part B signature picture on the VEEC form (54). veec_b_held office row wording: office screen.
- Part 10 (own customers): "Enter your price" email (ENTER_PRICE_EMAIL_APPROVED), own-customer quote email/co-branding, invoice labels. Why: not in Parts 1–4/8.
- Part 1 deferred: P4 owner signing-page AP name change (owner-pages sample); ESC Statement of rights accepted as the ESC file.

## Note on the branch
The task named HEAD e88a913 (Parts 1–5 + 8 + main). When this pack was made the branch had moved on to 3af1415 (Parts 6 and 7 merged in, plus uncommitted speed-stream files staged). The pictures were built from the working tree at 3af1415; the Parts 1–4/8 builders above were not touched by Parts 6–7 except the hub register (entries only). Nothing was committed.

## JO APPROVALS (4 Nov)
- Batch 1 (items 1–5): APPROVED 08:50 — IT_IS_YOUR_TURN_V2_APPROVED, OWNER_WILL_CALL_APPROVED (+ owner_will_call text switch).
- Batch 2 (items 6–10): APPROVED — OWNER_BOOKED_READY_CHECK_APPROVED, OWNER_QUOTE_EMAIL_V4_APPROVED (+ agreement PDF 48 attachment).
- Batch 3 (13–16): 13/14 CHANGE (Jo 4 Nov): "has paid the $349 for the PIESA" → "has paid for the PIESA" — never show our PIESA price to installers (installer-accepted-email v2). 15, 16 approved.
- Batch 3 confirmed: 13/14 APPROVED with the change; 15, 16 APPROVED (INSTALLER_ACCEPTED_V2_APPROVED after the fix, READY_CHECK_CHASE_EMAIL_APPROVED).
- Batch 4 (17–20): APPROVED — OWN_CUSTOMER_RENTAL_TAPS_APPROVED, OWNER_BOOKED_PIESA_APPROVED.
- Batch 5 (21–24): APPROVED — OWNER_BOOKED_INSTALL_APPROVED, CLEAR_TO_INSTALL_EMAIL_APPROVED.
- Batch 6 (25–29): APPROVED — UPGRADES_NEEDED_EMAIL_APPROVED, DEPOSIT_MESSAGES_V2_APPROVED.
- Batch 7 (30–33): APPROVED — INSTALL_NO_ACCESS_V2_APPROVED, VISIT_CANCELLED_OWNER_APPROVED.
- Batch 8 (34–38): APPROVED — ALL_DONE_V2_APPROVED, AFTER_INSTALL_REMINDERS_APPROVED.
- Batch 9 (39–43): 40–43 APPROVED (ACCESS_PERSON_TEXTS_APPROVED, TENANT_NOTICE_APPROVED). 39 REDRAFT APPROVED (Jo 4 Nov): subject "About your ceiling insulation — one thing we need to put right"; body "Hi {first}, We've checked your job and found one thing that doesn't meet the program's rules: {what}. We'll fix it at no cost to you: {fix}. {Installer} will call you to arrange a time. Nothing else changes — your rebate and your price stay as they are. Questions? Reply to this email or call {Installer} on {office phone}." → code change in non-compliance-notice.core (NON_COMPLIANCE_NOTICE_APPROVED after the change).
- Batch 10 (44–47): APPROVED. 44 REDRAFT (Jo 4 Nov): subject "Your electrical upgrades are done — updated safety check attached"; heading "{first}, your electrical upgrades are done"; result "Safe to insulate ✓" (no "(after repairs)"); intro "Here's your updated copy of your electrical safety check (PIESA), now that the upgrades are complete. Please keep it: the VEU program says you must have it at least 24 hours before your install."; row "Electrical upgrades: Completed · certificate {no}"; never "repairs". → code change in the O28 post-rectification variant (piesa-delivery.core / owner copy builder). 45 (O22), 46 (O1 VEU box), 47 (auto reply) as shown.
- Batch 11 (48–52): APPROVED — agreement PDF with quote email (OWNER_QUOTE_EMAIL_V4_APPROVED attachment; customer-agreement v1.3 SQL at go-live), PDF_LOOK_APPROVED.signedAcceptance, PDF_LOOK_APPROVED.receipts (incl. the 'Still to pay … later' line on the $349 receipt).
- Batch 12 (53–57): APPROVED — PDF_LOOK_APPROVED.taxInvoice, .veecForm (+0225 AP-name SQL), .escConsent, .officialFormPdf.
- Items 11–12 (O19 reminders): already approved (decision #30), no draft lines — not re-asked. PACK 1 COMPLETE 4 Nov: items 1–57 all approved; code changes owed: installer-accepted-email $349 line (13/14), non-compliance redraft (39), O28 post-rectification redraft (44).
