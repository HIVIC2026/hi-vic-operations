# Decision 388 — spot-only wording before release (for Jo to approve)

Jo, 25 Oct 2026, in capitals: **"WE ARE SAVING SPOTS NOT OFFERING READY CHECKS"**.

The process, in Jo's words: **"We save spots and then I will manually, slowly release one by one to a chosen installer while we staff."**

- Owners only ever save a spot.
- Jo releases spots herself, one at a time, to an installer she chooses. Automatic installer offers stay OFF.
- A Ready Check or installer times come up only after a spot is released.

**The rule.** Some messages and pages reach an owner before their spot is released. None of them may offer, promise or describe:

- a Ready Check
- an installer visit
- being offered times
- measuring
- when the quote comes

They also may not imply speed or a timeframe. That rules out "soon", "shortly", "this week", "as soon as", "jump the queue" and any promise about a place in the queue.

**What they may say:**

- Save your spot. It's free, with no obligation.
- Thousands of Victorians have registered.
- *"Spots are released in the order they were saved. We'll be in touch when your spot is released."*

**Not covered:** anything sent after release. That means Ready Check times and booking (O11, O12 and their texts), the quote (O18, O19), PIESA, install and completion. None of them were changed.

The shared wording is in `src/lib/spot-only-copy.core.ts`. `tests/decision-388-spot-only.test.ts` checks every pre-release message, constant and page against the banned words.

Line numbers are from the base commit `78dedb25` (branch `installer-mitti-workflow`).

---

## What Jo needs to decide

Some messages were already approved, were going out, and have an approval switch in the code. Their new wording is **held** until Jo approves it. Nothing goes to real owners until then. No database row or Settings switch was changed.

| Held message | Code flag (now `false`) | What is paused right now |
|---|---|---|
| O1 / O2 "Save my spot" estimate email (all variants) | `SAVE_SPOT_REAL_SEND_APPROVED` (`src/lib/hot-leads.core.ts`). Until now this flag only showed a label in Settings. **It now actually stops the real senders:** `realSendingOn()` (`hot-leads-send.server.ts`) and `sendInitialEstimateEmail()` (`followups.server.ts`). | **The first estimate email to every new enquiry.** Held emails are retried automatically once the flag is back on. |
| O2 "answer 3 quick questions" email (first invitation) | `INSULATION_DETAILS_REAL_SEND_APPROVED` (`hot-leads.core.ts`) | The automatic invitation |
| Automatic Save my spot after an owner answers the questions or uploads a photo | `INSULATION_QUESTIONS_SEND_APPROVED` (`insulation-questions-campaign.core.ts`) | That automatic email. Saving the answers and saving the spot still work. |
| O66 / O67 / O68 estimate reminders | `ESTIMATE_FOLLOWUP_APPROVED` (already paused in commit 78dedb25) | The day 2, 7 and 21 reminders |
| "Spot saved" text | `spot_saved` `wordingApproved: false` (`sms.core.ts`) | The text. A held text does not use up the owner's send key, so it can still go once approved. |
| One-off and automatic "Save my spot" reminder text | `save_spot_reminder` `wordingApproved: false` (`sms.core.ts`) | The reminder texts |
| O76a–O76d owner auto-replies | `OWNER_EMAIL_AUTO_REPLY_APPROVED` (already `false` under decision 386, never live) | Nothing new. They were never live. |

**When Jo approves:**

1. Set the six flags above back to `true`.
2. Set the two text types back to `wordingApproved: true`.
3. Run `bun scripts/render-decision-388-samples.ts` to refresh the sample designs.

`LAUNCH_COPY_APPROVED` stays `true` on purpose. It controls the Save my spot page itself (`/estimate/$token/campaign`) and photo/video handling. Turning it off would stop real owners saving spots, which is the opposite of what Jo asked for. The page's wording was changed directly instead.

**Changed directly (no flag).** Pages, the O10 Spot saved email, the not-in-area email, the "estimate not opened" follow-up and shared notes had no approval flag, so their wording was changed directly. These changes only remove promises. They are marked **CHANGED DIRECTLY — NO FLAG** below so Jo can still review them.

---

## 1. Emails and texts before release

### O1 / O2 Save my spot (estimate email) — `src/lib/jo-outcome-email.core.ts` + shared cards in `src/lib/email-kit.core.ts`

Shown in the first estimate email, the 3 questions reminder email (O2 questions) and the media-received version. Sample designs: `docs/templates/owner/O1-save-my-spot.html`, `O2-save-my-spot-some-insulation.html`, `O2-save-my-spot-questions.html`, all re-rendered.

**Was approved and live (decisions 66–69, 172, 180). Now HELD** by `SAVE_SPOT_REAL_SEND_APPROVED`, `INSULATION_DETAILS_REAL_SEND_APPROVED` and `INSULATION_QUESTIONS_SEND_APPROVED`.

| file:line | Where | Current wording | Proposed spot-only wording |
|---|---|---|---|
| jo-outcome-email.core.ts:266 | O1 "Save your spot, it's free" box | Certified installers are in high demand, so we book homes in the order people save their spot. When one is free near you, they'll offer you times for your free Ready Check. No payment, no obligation. | Thousands of Victorians have registered, and spots are released in the order they were saved. Saving your spot is free, with no obligation. We'll be in touch when your spot is released. |
| jo-outcome-email.core.ts:267 | O2 (some insulation) same box | …When one is free near you, they'll offer you times for your free Ready Check, where they'll also check your existing insulation. No payment, no obligation. | Same as O1 (above). |
| jo-outcome-email.core.ts:268 | O2 questions box | Certified installers are in high demand, so we book homes in the order people save their spot. Tell us about your insulation and your spot is saved straight away. Just tap, no typing. | Thousands of Victorians have registered, and spots are released in the order they were saved. Tell us about your insulation and your spot is saved straight away. Just tap, no typing. |
| jo-outcome-email.core.ts:270 | Media-received version | …Our Office will review it and contact you about the next step. **Final eligibility will be confirmed at your free Ready Check.** If you want or need to add more evidence… | Same, with the bold sentence removed. |
| jo-outcome-email.core.ts:272 | O2 closing line | If your existing insulation is already R2.0 or above, the rebate isn't available and we'll let you know. We check all of this at your free Ready Check and tell you the exact price before you agree to anything. | If your existing insulation is already R2.0 or above, the rebate isn't available and we'll let you know. You'll know the exact price before you agree to anything. |
| jo-outcome-email.core.ts:273 and email-kit.core.ts:296, 303 | O1 closing line under the cards (also in O10) | We check these at your free Ready Check and tell you the exact price before you agree to anything. | You'll know the exact price before you agree to anything. |
| email-kit.core.ts:278 | "What's included in $X" card, first row (O1, O2, O10) | ✓ **Free Ready Check** — An installer visits to measure your ceiling and confirm the price. | Row removed. The card starts at "Licensed electrician safety check". |
| email-kit.core.ts:143 and jo-outcome-email.core.ts:312 | "Your existing insulation" card footnote (O2, O10) | Prices incl. GST. The installer checks this at your free Ready Check, and you'll know the exact cost before you agree to anything. | Prices incl. GST. You'll know the exact cost before you agree to anything. |
| jo-outcome-email.core.ts:260 | Price box basis line, typical size only (also used in O66–O68) | Based on a typical 150 m² ceiling (estimated, not measured), … | Based on a typical 150 m² ceiling (an estimate, not your actual size), … |

### O10 Spot saved email — `src/lib/spot-saved-messages.core.ts`

Sent once when the owner saves their spot. Design: `docs/templates/owner/O10-spot-saved.html`, re-rendered.

**Was approved and live (decision 70). There is no code flag (only the Settings switch `spot_saved_email`), so it was CHANGED DIRECTLY — NO FLAG.**

| file:line | Where | Current wording | Proposed spot-only wording |
|---|---|---|---|
| :24 | Demand line under the heading | Demand is high and installer capacity is limited, so we book homes in the order spots were saved. You've locked in your place, so there's nothing more you need to do right now. | Thousands of Victorians have registered. Spots are released in the order they were saved. You've locked in your place, so there's nothing more you need to do right now. |
| :49–51 (with :25) | "What happens next" steps | 1 **An installer offers you times** — When a certified installer is free near Glen Waverley, we'll text and email you their times for your free Ready Check. 2 **Tap the time that suits you** — Or suggest other days. No phone tag. 3 **Free Ready Check, then your exact price** — They measure your ceiling and check your insulation. You get your final quote. No payment, no obligation. | 1 **Your place is kept** — Saving your spot is free, with no obligation. 2 **We'll be in touch** — We'll be in touch when your spot is released, with your next step. |
| :53 | Note under the price box | Estimate incl. GST for 137 m². Confirmed at your free Ready Check. | Estimate incl. GST for 137 m². This is an estimate. You'll see your exact price before you agree to anything. |
| :69, :80 | Removal included line | …m² included in this estimate; scope confirmed at your free Ready Check.) | …m² included in this estimate; the scope and price are confirmed before you agree to anything.) |
| (cards) | Included / not included cards | See O1 (Ready Check row removed, new closing line). | — |

### "Spot saved" text — `src/lib/spot-saved-messages.core.ts:37`

**Was approved and live (decision 159). Now HELD** (`spot_saved` `wordingApproved: false`).

- **Current:** Spot saved, Helen! 🎉 Smart move: your $1,610 rebate is waiting. Demand is high and capacity is limited, but your place in line is locked in. We'll text you as soon as an installer is free in Glen Waverley. Your job: {link} – Home Insulation Victoria
- **Proposed:** Spot saved, Helen! 🎉 Smart move: your $1,610 rebate is waiting. Thousands of Victorians have registered. Spots are released in the order they were saved. We'll be in touch when your spot is released. Your job: {link} – Home Insulation Victoria

### O66 / O67 / O68 estimate reminders — `src/lib/estimate-followup.core.ts`

Designs: `docs/templates/owner/O66…O68`, re-rendered by `scripts/render-decision-238-drafts.ts`.

**Was approved and live (decisions 242/357). Paused in commit 78dedb25 and still HELD** (`ESTIMATE_FOLLOWUP_APPROVED = false`). 264 day-2/day-7 reminders had already gone out.

| file:line | Where | Current wording | Proposed spot-only wording |
|---|---|---|---|
| :146 | O66 (day 2) save box | Certified installers are in high demand, so we book homes in the order people save their spot. It takes a few seconds. No payment, no obligation. | Thousands of Victorians have registered, and spots are released in the order they were saved. It takes a few seconds. No payment, no obligation. |
| :152 | O67 (day 7) intro | It's been a week since we sent your estimate, so here it is again. The $1,610 rebate comes straight off the price, and nothing is locked in until after your free Ready Check. | …The $1,610 rebate comes straight off the price, and nothing is locked in until you've seen your exact price and agreed to it. |
| :154 | O67 save box | Save your spot and a certified installer will offer you times for your free Ready Check when one is free near you. No payment, no obligation. | Save your spot to keep your place in line. Spots are released in the order they were saved, and we'll be in touch when your spot is released. No payment, no obligation. |
| :159 | O68 (day 21) subject and heading | Helen, we'll close your estimate soon | Helen, we'll close your estimate in a week |
| (price box) | Typical-size basis line | (estimated, not measured) | (an estimate, not your actual size) |

### "Save my spot" reminder text (one-off and automatic) — `src/lib/save-spot-reminder-blast.core.ts:20`

**Was approved and live. Now HELD** (`save_spot_reminder` `wordingApproved: false`).

- **Current:** Home Insulation Victoria: Hi Helen, a warmer winter and cooler summer are close. Your ceiling insulation is just $2,188, with $1,610 off thanks to the rebate. Spots are filling fast — save yours now: {link}. Reply STOP to opt out.
- **Proposed:** Home Insulation Victoria: Hi Helen, your ceiling insulation estimate is $2,188, with $1,610 off thanks to the rebate. Thousands of Victorians have registered and spots are released in the order they were saved. Save yours, free and no obligation: {link}. Reply STOP to opt out.

### "3 questions" reminder — `src/lib/three-questions-reminder.core.ts:23` (text) and O2 questions (email)

- **Text:** "Hi Helen, 3 quick questions and your $1,610 rebate spot is saved: {link} Reply STOP to opt out." It already follows the rule, so it was **NOT CHANGED** and stays approved.
- **Email:** this is the O2 questions email above, held with O1/O2.

### "Estimate not opened (3 days)" follow-up — `src/lib/followup-email.ts`

**Live, no flag: CHANGED DIRECTLY — NO FLAG.**

| file:line | Current | Proposed |
|---|---|---|
| :22 | ✓ Your next step: a Free Ready Check | ✓ Your next step: save your spot (free, no obligation) |
| :11 (not shown at the moment) | Demand is high. Installer availability is limited. | Thousands of Victorians have registered. Spots are released in the order they were saved. |

### O7 Not in your area yet — `src/lib/coverage-email.ts:18`

The office presses Send. **Approved (decision 74), no flag: CHANGED DIRECTLY — NO FLAG.** Design `docs/templates/owner/O7-not-in-area.html` updated.

- **Current:** We're adding installers across Victoria. As soon as one covers your area, we'll email you.
- **Proposed:** We're adding installers across Victoria. When one covers your area, we'll email you.

### O70 new-sender reply — `src/lib/new-sender-reply.core.ts:55–58`

**Live (decisions 292/356/387). Already follows the rule, so it was NOT CHANGED.** Current wording: "To get started, please submit your home on our website: {link}. There are thousands of people on the list, and spots are released in the order they're saved. If you have any questions, just reply to this email."

### O76 owner email auto-replies — `src/lib/owner-email-auto-reply.core.ts`

These are drafts under decision 386 and have never been live (`OWNER_EMAIL_AUTO_REPLY_APPROVED = false`), so they stay held. Drafts `docs/templates/drafts/O76a–O76d` were re-rendered.

| file:line | Where | Current | Proposed |
|---|---|---|---|
| :39 | Waiting line (O76a–d) | There's a long list of homes waiting, and spots are released in the order they were saved. | Thousands of Victorians have registered, and spots are released in the order they were saved. |
| :281 | Next step for owners who have saved their spot (O76c, O76d) | When an installer near you is free, they'll offer you times for your free Ready Check and we'll email you. | We'll be in touch when your spot is released. |
| :214 + :319–320 | "Where is my quote?" from an owner whose spot is saved but not released | Sent O76i: "Your quote comes after your free Ready Check, once the installer has measured your ceiling. There's a long list…" | Now sends O76c, the spot-saved answer ("Yes, your spot is saved… We'll be in touch when your spot is released."). O76i is kept only for owners whose spot is already released (times offered or Ready Check booked). |

---

## 2. Pages before release (all CHANGED DIRECTLY — NO FLAG)

### Public calculator (`/` on customer hosts and `/calculator`) — `src/components/portal/public-calculator.tsx`

| line | Current | Proposed |
|---|---|---|
| :27 | "Not sure" answer help: We'll confirm it at the free Ready Check | We'll confirm it before you agree to anything |
| :32 | What could change: The measured ceiling size | Your actual ceiling size |
| :288 | …Your installer will check it at your free Ready Check and confirm whether any removal is needed… | …Whether any removal is needed is confirmed before you agree to anything… |
| :313 | Estimated discount: $X — confirmed after your assessment. | Estimated discount: $X — confirmed before you agree to anything. |
| :324 | Estimate only. Eligibility, measurements and final pricing confirmed after assessment. | Estimate only. Eligibility and final pricing are confirmed before you agree to anything. |

### Register interest — `src/components/portal/register-interest.tsx`

| line | Current | Proposed |
|---|---|---|
| :143 | We'll contact you about your estimate and book your free Ready Check. Nothing has been booked and no payment is due. | We'll contact you about your estimate. It's free, with no obligation. Nothing has been booked and no payment is due. |
| :287 | We'll contact you to discuss your estimate and arrange your free Ready Check. | We'll contact you about your estimate. Free, no obligation. |

### `/estimate/$token` (and the signed-in owner estimate card) — `src/components/portal/estimate.tsx`, `src/lib/customer-quote-system.ts`, `src/lib/ready-check-booking-access.core.ts`

Before release, the Ready Check button area already shows the "spot held" message or a "Save my spot" link. The Ready Check confirmation screen (`ConfirmQuote`) only opens after release and was not changed.

| file:line | Current | Proposed |
|---|---|---|
| estimate.tsx:19 | …Your Ready Check confirms the measured area and site details for your project estimate. | …Your ceiling area and site details are confirmed before you agree to anything. |
| estimate.tsx:20 | LIKELY ELIGIBLE — ONSITE CONFIRMATION NEEDED / …We just need to confirm the remaining items at your Ready Check. | LIKELY ELIGIBLE — A FEW DETAILS TO CONFIRM / …We just need to confirm a few remaining details before you agree to anything. |
| estimate.tsx:162 | Estimated discount: $X — confirmed after your assessment. | …confirmed before you agree to anything. |
| estimate.tsx:199 | Once the onsite facts are confirmed, your final quote is calculated from our set customer rate card. | Once your home's details are confirmed, your final price is calculated from our set customer rate card. |
| estimate.tsx:201 | Your final total still depends on the measured area, whether removal is needed… | …depends on your actual ceiling area, whether removal is needed… |
| estimate.tsx:210 | Eligibility, Ready Check, vetted trades, quoting… | Eligibility, vetted trades, quoting… |
| estimate.tsx:229 | …Your Ready Check confirms whether removal is actually needed. | …Whether removal is actually needed is confirmed before you agree to anything. |
| estimate.tsx:259 (owner portal, enquiry stages) | Card ended with a disabled "BOOK MY READY CHECK →" block | Ends with: Spots are released in the order they were saved. We'll be in touch when your spot is released. |
| customer-quote-system.ts:88 | …after we confirm the measured ceiling size, existing insulation… | …after we confirm your actual ceiling size, existing insulation… |
| ready-check-booking-access.core.ts:1 (`/estimate/$token`, `/my-estimate/$token` before release) | Spot held — we'll be in touch to book your Ready Check | Spot saved — we'll be in touch when your spot is released |
| ready-check-booking-access.core.ts:2 (error if someone tries to book before release) | Ready Check booking is not open. We'll be in touch when the office offers your booking. | Your spot hasn't been released yet, so booking is not open. We'll be in touch when your spot is released. |

### `/estimate/$token/campaign` (the Save my spot page) — `src/routes/estimate_.$token.campaign.tsx`

| line | Current | Proposed |
|---|---|---|
| :17 (meta description) | Review your preliminary ceiling insulation savings and save your place for a free onsite Ready Check. | Review your preliminary ceiling insulation savings and save your spot. It's free, with no obligation. |
| :50 | Your estimate is being updated. Please check back soon. | …Please check back later. |
| :68 (after saving) | Demand is high and installer capacity is limited, so we're approving homes in batches, in the order spots were saved. You've locked in your place… | Thousands of Victorians have registered. Spots are released in the order they were saved. You've locked in your place, so there's nothing more you need to do. |
| :69 | We're teaming up with more installers and electricians across Victoria, and we'll text you as soon as one is free in {suburb} to book your free Ready Check. | We'll be in touch when your spot is released. |
| :76 | Estimate only. Your final price is confirmed after the free Ready Check. | This is an estimate. You'll see your exact price before you agree to anything. |
| :77, :145 | Want to jump the queue? | Help us check your insulation |
| :104 | Jump the queue (kicker) | Check your insulation |
| :107 | Your enquiry is currently behind homes whose eligibility we can already confirm. Help us check your insulation so you could move up and save your spot. / Hundreds of homes have enquired since 1 October. Spots go in order. | Help us check your insulation so you can save your spot. / Thousands of Victorians have registered. Spots are released in the order they were saved. |
| :108 | …qualifies you for the preliminary queue. Final onsite checks and removal costs remain to be confirmed. | …qualifies you to save your spot. Your eligibility and any removal costs are confirmed before you agree to anything. |
| :133 | ✓ Free Ready Check — We measure your roof space and confirm the job. FREE | Row removed. |
| :146 | An onsite check is needed before we can offer Save my spot. | Our office needs to check a few more details before we can offer Save my spot. |
| :147 | One tap and you're in. We'll be in touch to book your free Ready Check as soon as an installer is free near you. / …will be checked onsite before the final price is confirmed. | One tap and you're in. Saving your spot is free, with no obligation. Spots are released in the order they were saved. We'll be in touch when your spot is released. / Your Yes answer qualifies you to save your spot. Your existing insulation and any removal needs are confirmed before you agree to a final price. |
| insulation-review.core.ts:34 (invitation text on this page) | …Not sure? You can upload photos or a video, or we can check onsite. Final onsite and compliance verification still apply. | …Not sure? You can upload photos or a video for office review. Final eligibility and compliance checks still apply before you agree to anything. |
| estimate-removal.core.ts:4 (removal note, also in O10) | …We'll assess this at your free Ready Check and confirm the area and cost before you approve any removal. | …We'll confirm the area and cost before you approve any removal. |
| estimate-removal.core.ts:6 | This qualifies you for the preliminary queue only. Your free Ready Check determines whether the existing insulation can remain and confirms eligibility and the final price… | This saves your place in line only. Whether your existing insulation can stay, your eligibility and your final price are all confirmed before you agree to anything… |
| estimate-removal.core.ts:17 | …Your free Ready Check confirms whether removal is required and the final scope and price before you agree to proceed. | …Whether removal is required, and the final scope and price, are confirmed before you agree to proceed. |
| estimate-removal-upto.core.ts:3 | …It may not need to come out at all — your free Ready Check confirms this, and you'll see the final price… | …It may not need to come out at all, and you'll see the final price before you agree to anything. |

### `/estimate/$token/video` (3 questions / photos page) — `src/routes/estimate_.$token.video.tsx`, `src/lib/owner-pages.core.ts`

| line | Current | Proposed |
|---|---|---|
| video :94 | …Final eligibility is confirmed at your free Ready Check. | …Your eligibility is confirmed before you agree to anything. |
| video :109 (spot saved) | …We've emailed your confirmation. Final eligibility is confirmed at your free Ready Check. | …We've emailed your confirmation. Spots are released in the order they were saved, and we'll be in touch when your spot is released. |
| owner-pages.core.ts:32 (P1, also in `docs/templates/owner/P1-questions-page.html`) | It helps the installer prepare. Only if it's safe… | It helps us check your insulation. Only if it's safe… |

### `/estimate/$token/calculator` — `src/routes/estimate_.$token.calculator.tsx`, `src/lib/save-spot-offer.core.ts`

| line | Current | Proposed |
|---|---|---|
| calculator :60 | No payment, no obligation. Saving your spot does not book a visit. | No payment, no obligation. Spots are released in the order they were saved. |
| save-spot-offer.core.ts:45 (saved state, `owner-calculator-view.tsx`) | You're now in our queue for a free Ready Check. We'll contact you when installer availability is confirmed in your area. There's nothing to pay… Your eligibility, ceiling area and final price will be confirmed before you decide to go ahead. | You've saved your place in line. Thousands of Victorians have registered, and spots are released in the order they were saved. We'll be in touch when your spot is released. There's nothing to pay now, and you're under no obligation to proceed. Your eligibility and final price will be confirmed before you decide to go ahead. |

### Save-spot pages — `src/routes/save-spot-preliminary.$token.tsx`, `src/lib/preliminary-save-spot.core.ts` (`/save-spot` has no such wording)

| line | Current | Proposed |
|---|---|---|
| :12 (meta + og description) | Save your spot for a free Ready Check. | Save your spot. It's free, with no obligation. |
| :57 (saved) | You're now in our queue for a free Ready Check. We'll contact you when installer availability is confirmed in your area. There's nothing to pay now… | You've saved your place in line. Spots are released in the order they were saved, and we'll be in touch when your spot is released. There's nothing to pay now… |
| preliminary-save-spot.core.ts:15 | The installer will confirm the ceiling area, existing insulation and eligibility at your free Ready Check. We'll confirm the pricing then too. There's no payment or obligation to go ahead. | Spots are released in the order they were saved, and we'll be in touch when your spot is released. Your ceiling area, existing insulation, eligibility and price are all confirmed before you agree to anything. There's no payment or obligation to go ahead. |

### My job before release — `src/routes/my-job.$token.tsx`, `src/lib/owner-myjob.core.ts`, `src/lib/owner-myjob.server.ts`, `src/lib/job-wording.ts`

| file:line | Current | Proposed |
|---|---|---|
| owner-myjob.core.ts:48 (not yet saved) | Save your spot — Pick at least 3 times for your free Ready Check. | Save your spot — It's free, with no obligation. Spots are released in the order they were saved. |
| owner-myjob.core.ts:49 | We'll text you once a time is locked in. | We'll be in touch with your next step. |
| owner-myjob.core.ts:77 (progress step 2) | Free Ready Check — We measure your roof space | Spot released — Spots are released in the order they were saved. We'll be in touch when your spot is released. |
| owner-myjob.server.ts:61 (progress bar before saving) | Step 1 of 5 · Ready Check | Step 1 of 5 · Save your spot |
| job-wording.ts:14 (owner status for spot saved / ready_check_ready_to_schedule) | Spot saved – we'll be in touch to book your free Ready Check | Spot saved – we'll be in touch when your spot is released |
| my-job :502–503 (Save my spot screen) | Pick at least 3 times that suit you for your free Ready Check. Each time is a 2-hour window… / [Pick my times] | Saving your spot is free, with no obligation. Thousands of Victorians have registered. Spots are released in the order they were saved. We'll be in touch when your spot is released. / [See my estimate and save my spot] |
| my-job :863 | **The waiting list is huge.** We book in order and we're teaming up with more installers and electricians across Victoria to speed it up. We'll text you when it's your turn. | **Thousands of Victorians have registered.** Spots are released in the order they were saved. We'll be in touch when your spot is released. |
| my-job :867 | …Do it now and you can book the moment it's your turn. | …Do it now and it's out of the way when your spot is released. |
| my-job :872 | Nothing else to do until we text you. | Nothing else to do until your spot is released. |
| my-job :875 | Jump the queue: send a quick video | Help us check your insulation: send a quick video |
| my-job :890 | Estimate only. Your exact price comes after the free Ready Check. | This is an estimate. You'll see your exact price before you agree to anything. |

### `/my-estimate/$token` — `src/routes/my-estimate.$token.tsx`

| line | Current | Proposed |
|---|---|---|
| :57 | — estimated, not measured | — an estimate, not your actual size |
| :63 | Price table row "Ready Check — Free" | Shown only after release (`bookingAllowed`) |
| :70 | …We have retained this pricing; your Ready Check will confirm the measurements and work required. | …We have retained this pricing; your exact price is confirmed before you agree to anything. |

### Page meta descriptions

Two descriptions mentioned a Ready Check: the campaign page and the preliminary save page (both above). All other owner page descriptions were checked and already follow the rule:

- `/estimate/$token`: "Your personal indicative ceiling insulation estimate…"
- the video page
- the calculator
- `/my-estimate/$token`
- My job
- `/save-spot`

---

## 3. Checked and not changed

- **Retired or internal, never shown to owners:**
  - `src/lib/estimate-email.ts` and `email-art.core.ts` / `email-hero.core.ts`: the retired Step 3 likely/onsite email. No live sender (template hub: "Retired step-3 estimate email (P1-S77)").
  - `src/lib/jo-email-templates.core.ts` bodies: only an internal step of `renderJoOutcomeEmail` to check links; the owner never sees that text.
  - `step3-email-samples.ts`
  - office review notes such as "Final onsite verification required"
  - stage names like `needs_onsite_confirmation`
- **After release (out of scope, untouched):**
  - `FREE_CHECK_CONFIRM_COPY` / `ConfirmQuote` on `/estimate/$token#confirm` (opens only when booking is allowed)
  - `OwnerReadyCheckTimes`
  - O11 / O12 and the Ready Check texts
  - the quote screen and O76e–O76j (O76i is now used only after release)
  - PIESA / install / completion
- **Shared with after-release screens:** the neutral wording ("confirmed before you agree to anything") is also accurate after release. It now shows on `/estimate/$token` and in removal notes after release too. Nothing it says is untrue at any stage.

## 4. How this is kept in sync

- Sample designs: `bun scripts/render-decision-388-samples.ts` rewrites O1, O2 (some insulation), O2 (questions), O10, O66–O68 and O76a–j from the live code.
- `docs/templates/owner/O7-not-in-area.html` and `P1-questions-page.html` were edited by hand to match.
- Test: `tests/decision-388-spot-only.test.ts` checks:
  - every pre-release message, constant and page string against the banned words
  - the held flags
  - that `SAVE_SPOT_REAL_SEND_APPROVED` really stops the real senders
