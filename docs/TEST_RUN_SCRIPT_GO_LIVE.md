# Go-live TEST run (phone), 24 Oct 2026

Account: **deep-test@hivic.test** (TEST Reinsulate). Everything on this account is practice: forms go to the TEST Mitti
account, emails and texts go to the TEST inbox/phone only, real owners are never touched. Do it on your phone. I watch
the database at every step and tell you what I see.

Before you start: the PR is merged, the site has rebuilt (about 5 minutes after merge), and you have the Mitti app and
the TEST Mitti login handy.

| # | You do | You should see | I check |
|---|---|---|---|
| 1 | Sign in at estimate.homeinsulationvictoria.com.au/auth as deep-test@hivic.test | **My work** with the bottom menu | login row, role installer |
| 2 | Tap **Add a job**. Enter: a made-up owner name, a real-looking Victorian address picked from the list, your own mobile, your own email, tick the permission box. Leave the visit day empty. Tap Add. | "Job added" and the job in your list, status *Waiting for the Ready Check form* | job created, source qa_test, stage ready_check_ready_to_schedule |
| 3 | Wait up to 15 minutes (or tell me and I'll trigger it). Open the Mitti app on the TEST account. | A Ready Check form named with the address and HV number, owner details already filled | ceiling_measurements row linked, form id recorded |
| 4 | Back in the portal, open the job and enter a visit day/time (today). | "Day saved" | booking row; 6:30am text would include it |
| 5 | In Mitti: fill the Ready Check (area, product = one of the 8 options, your price, electrician = Home Insulation Victoria). Press **Complete**. | Mitti marks it complete | within 15 min: measurement synced, quote drafted, **quote sent** to the TEST inbox (auto-send on), job at quote stage |
| 6 | Open the quote email on your phone. Tap through, tick the two boxes, type your name, tap **Sign and pay $349**. Pay by bank transfer (or card if Stripe test keys are in). | "You're in" page and email; Deep-test gets the "accepted" email | acceptance recorded, $349 step requested, contact release to the electrician |
| 7 | Office (Chris or you on a laptop): Office → the job → **Choose trades** → send the PIESA to the TEST electrician. TEST electrician: accept, offer times. Owner: tap a time. | Safety check booked email | PIESA booking, PIESA copies queued for 24h-before rule |
| 8 | TEST electrician completes the PIESA on the portal form with **no fixes**. | Owner: PIESA copy email; installer: PIESA copy email | piesa_deliveries rows, clearance = cleared, 30-day deadline set |
| 9 | Installer (your phone): open the job → **Offer 3 install days**. Owner email: tap one. | Owner: "Your install is booked", day held 48h, deposit box with bank details. Installer: booked text | provisional booking, deposit step requested |
| 10 | Office: Record payment → deposit amount, bank transfer. | Owner: "Deposit received ✓ Your day is locked in" | booking confirmed, install_booking_confirmed event |
| 11 | Next morning 6:30am (or I trigger the daily text): the install-day text with the Mitti link. In Mitti: SWMS → PIISA → photos → Complete. | — | PIISA recorded, evidence rows |
| 12 | Office: **Complete installation**. | Owner: "All done" email with the sign-rebate-form box + text | VEEC request step recorded once; O44 sent once |
| 13 | Owner email: tap **Sign your rebate form**, enter the 6-digit code, tick, type name, sign. | "Signed" + "Here's your signed rebate form" email with the PDF attached | consumer_signed_at, copy email with attachment |
| 14 | Office: Record balance paid. | Completion pack email (flag permitting) | invoice paid, completion_pack_due |

Stop and tell me at any step where what you see doesn't match the middle column. Nothing in this run reaches a real
customer or installer.
