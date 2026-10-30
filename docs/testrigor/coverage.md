# testRigor coverage

Which test case checks which screen or action. Case IDs match the `###` titles in the role files.
Routes are from `src/routes/**`. Labels are copied from the source; see each case.

## Homeowner (`homeowner.txt`)

| Screen / function | Route | Cases |
| --- | --- | --- |
| Public calculator opens | `/calculator` | H-01 |
| Same calculator on the customer address | `estimate.…/` | H-02 |
| Staff address `/` opens sign-in (decision 381) | `/` on portal.… | H-03 |
| Estimate from three answers | `/calculator` | H-04 |
| Change an answer, Start again | `/calculator` | H-05 |
| Own ceiling size out of range | `/calculator` | H-06 |
| Register my interest: error messages (never sent) | `/calculator` | H-07, H-08 |
| Privacy policy | `/privacy` | H-09 |
| Bad My job / estimate / saved estimate / save-spot links | `/my-job/…`, `/estimate/…`, `/my-estimate/…`, `/save-spot` | H-10, H-11 |
| Signed-out owner area goes to sign-in | `/owner` | H-12 |
| My job home: At a glance, Your progress | `/my-job/$token` | H-20 |
| Spot saved: Your numbers, Remove my enquiry link | `/my-job/$token` | H-21 |
| Paperwork while waiting (Do it now) | `/my-job/$token` | H-22 |
| Save my spot screen | `/my-job/$token?screen=spot` | H-23 |
| Ready Check times from the installer | `/my-job/$token` | H-24, H-41, H-42 |
| Quote screen, Sign lock, Not for me | `/my-job/$token?screen=quote` | H-25, H-26, H-27 |
| Cancel my job (back out / do it) | `/my-job/$token` | H-28, H-54 |
| Booking screen (PIESA / install times) | `/my-job/$token?screen=book` | H-29, H-45, H-46, H-49 |
| Review screen, stars | `/my-job/$token?screen=review` | H-30, H-52 |
| Electrical fixes screen | `/my-job/$token?screen=fixes` | H-31 |
| ESC consent before install | `/my-job/$token` | H-32, H-50 |
| It's your turn: confirm / no longer interested | `/my-job/$token?screen=turn` | H-40, H-53 |
| Say yes to the quote and sign (TEST code shown on page) | `/my-job/$token?screen=quote` | H-43 |
| Decline the quote | `/my-job/$token?screen=quote` | H-44 |
| Confirm the PIESA | `/my-job/$token` | H-47 |
| Sign the rebate form (VEEC assignment) | `/my-job/$token` | H-51 |
| Signed-in owner view (Office "Open as owner") | `/owner`, `/owner/$jobId` | O-55 |

## Installer (`installer.txt`)

| Screen / function | Route | Cases |
| --- | --- | --- |
| Sign in, lands on My work | `/auth` → `/field` | rule, I-01 |
| Menu tabs (business owner) | all trade pages | I-02 |
| Account menu, sign out | all trade pages | I-03, I-38 |
| Sign out from My business | `/field/business` | I-39 |
| Job offer panel, More offers | `/field` | I-04, I-05 |
| Offer page: view, Not for me (back out), accept with 3 times, decline | `/field/offer/$offerId` | I-04, I-06, I-40, I-41 |
| Job page: header, contact buttons, staff job links | `/field/$jobId` | I-07, I-08, I-09 |
| Ready Check group, Mitti form row | `/field/$jobId` | I-10 |
| Quote group | `/field/$jobId` | I-11 |
| Owner's suggested Ready Check days: book / offer others | `/field/$jobId` | I-42, I-43 |
| Change a booked Ready Check time | `/field/$jobId` | I-44 |
| Your price (own job) | `/field/$jobId` | I-47 |
| Ready Check time on own job | `/field/$jobId` | I-48 |
| Offer 3 install days | `/field/$jobId` | I-49 |
| Who's doing this | `/field/$jobId` | I-50 |
| Safety plan (SWMS): view, note, sign | `/field/$jobId` | I-12, I-51, I-52 |
| Today's job page, Couldn't get in? | `/field/day/$jobId` | I-13, I-54 |
| Check my form now | `/field/$jobId` | I-53 |
| The install is finished | `/field/$jobId` | I-55 |
| Sign your part of the rebate form | `/field/$jobId` | I-56 |
| Add a job: fields, empty form refused, add, add with visit time | `/partner/import` | I-14, I-15, I-45, I-46 |
| Money, all paid jobs | `/field/money` | I-16, I-17 |
| My business, Taking new jobs | `/field/business` | I-18, I-57 |
| My usual electrician | `/field/business/electrician` | I-19, I-58 |
| Business details, change request | `/field/business/details` | I-20, I-59 |
| Your rates, change request | `/field/business/rates` | I-21, I-60 |
| Bank details | `/field/business/bank` | I-22, I-61 |
| Insurance and licences | `/field/business/insurance` | I-23 |
| Your agreement | `/field/business/agreement` | I-24 |
| ESC privacy notice, acknowledge | `/field/business/esc-notice` | I-25, I-62 |
| Team, invite link | `/field/business/team` | I-26, I-63 |
| Old staff address (opens Team) | `/partner/workers` | I-27 |
| Installer guide | `/field/guide` | I-28 |
| Welcome page | `/field/welcome` | I-29 |
| Old links redirect | `/partner`, `/partner/add`, `/partner/payments`, `/partner/profile`, `/field/setup` | I-30 |
| Refused: office, Test Centre, Users | `/admin/*` | I-31, I-32 |
| Refused: bulk upload (switched off) | `/partner/bulk-import` | I-33 |
| Refused: owner area | `/owner` | I-34 |
| Refused: someone else's job | `/field/<other id>` | I-35 |
| Signed out: My work goes to sign-in | `/field` | I-36 |
| Bad staff / safety plan / invite links | `/w/…`, `/sp/…`, `/join/…` | I-37 |

## Electrician (`electrician.txt`)

| Screen / function | Route | Cases |
| --- | --- | --- |
| Sign in, My work tiles | `/auth` → `/field` | rule, E-01 |
| Menu (no Add a job) | all trade pages | E-02 |
| Account menu, sign out | all trade pages | E-03, E-27 |
| Your jobs filters | `/field` | E-04 |
| PIESA offer: view, send 3 times, pick owner's time, suggest a time, decline | `/field/offer/$offerId` | E-05, E-40, E-41, E-42, E-43 |
| Job page, History and documents | `/field/$jobId` | E-06, E-07 |
| Safety check document | `/field/$jobId` | E-08 |
| Safety check times: card, send 3 times, book owner's day | `/field/$jobId` | E-09, E-44, E-45 |
| Ask for an owner reminder | `/field/$jobId` | E-46 |
| Visit changes: card, cancel (back out), I've arrived, Owner not home | `/field/$jobId` | E-10, E-11, E-47, E-57 |
| Evidence upload | `/field/$jobId` | E-48 |
| Electrical fixes items: add / remove | `/field/$jobId` | E-49, E-50 |
| Manual PIESA entry, Complete PIESA | `/field/$jobId` | E-51, E-53 |
| Electrical fixes times | `/field/$jobId` | E-52 |
| PIESA sign-off after fixes | `/field/$jobId` | E-54 |
| Start of the install day: back out, I'll be there, Can't make it | `/field/$jobId` | E-12, E-55, E-56 |
| Money | `/field/money` | E-13 |
| My business, Taking new jobs | `/field/business` | E-14, E-58 |
| Business details, rates, bank, insurance, agreement | `/field/business/*` | E-15 to E-19, E-59, E-60, E-61 |
| Usual electrician page is installer-only | `/field/business/electrician` | E-20 |
| Team | `/field/business/team` | E-21 |
| Guide | `/field/guide` | E-22 |
| Refused: Add a job | `/partner/import` | E-23 |
| Refused: office | `/admin/*` | E-24 |
| Refused: owner area | `/owner` | E-25 |
| Refused: someone else's job | `/field/<other id>` | E-26 |

## Office (`office.txt`)

| Screen / function | Route | Cases |
| --- | --- | --- |
| Sign-in page, email checks, wrong password | `/auth` | O-01, O-02, O-03 |
| Signed out: office pages go to sign-in | `/admin/*` | O-04 |
| Needs me | `/admin/needs-me` | O-10 |
| Top menu, More menu | all office pages | O-11, O-12 |
| Enquiries list and search | `/admin/enquiries` | O-13 |
| New phone enquiry form (opened, not saved) | `/admin/enquiries` | O-14 |
| Jobs > Active, stage filter | `/admin/jobs/active` | O-15, O-16 |
| Jobs > Closed piles | `/admin/jobs/closed` | O-17 |
| Choose installer list | `/admin/jobs/choose-installer` | O-18 |
| Job page: six stage cards, Enquiry, Ready Check, Quote, PIESA, More menu, Money | `/admin/jobs/$jobId` | O-19 to O-24, O-26 |
| Log a call or note | `/admin/jobs/$jobId` | O-25, O-52 |
| Put on hold, Resume | `/admin/jobs/$jobId` | O-53 |
| Release to the TEST installer | `/admin/jobs/$jobId` | O-58 |
| Send the PIESA offer to the TEST electrician | `/admin/jobs/$jobId` | O-60 |
| Cancel job, Reopen | `/admin/jobs/$jobId` | O-65, O-66 |
| Partners tabs, business file, applications | `/admin/partners*` | O-27, O-28, O-29 |
| Money tabs, Prices (look only) | `/admin/money` | O-30, O-31 |
| Communications tabs | `/admin/communications` | O-32 |
| Templates | `/admin/templates` | O-33 |
| Settings tabs | `/admin/settings` | O-34 |
| Users & access | `/admin/users` | O-35 |
| Test Centre, TEST roles dialog | `/admin/test-centre` | O-36, O-37 |
| Create dummy journey | `/admin/test-centre` | O-50 |
| Prepare missing TEST associations | `/admin/test-centre` | O-51 |
| Simulate a deadline, PIESA expired | `/admin/test-centre` | O-54, O-62 |
| Open as owner / installer boss / electrician (no password) | `/admin/test-centre` → `/qa-access` | O-55, O-56, O-57 |
| Jo as a fake tradie: new TEST job + offer | `/admin/test-centre` | O-59 |
| Simulate payment (TEST only) | `/admin/test-centre` | O-61 |
| Onboarding staff link: create, revoke | `/admin/test-centre` | O-63, O-64 |
| Archive a TEST journey | `/admin/test-centre` | O-67 |
| Pages outside the menu | `/admin/interests`, `/admin/ap-queue`, `/admin/electrician-rates`, `/admin/save-my-spot-rules`, `/admin/save-spot-reminder-blast` | O-38 |
| Old office links redirect | `/admin/today`, `/admin/board`, `/admin/workers`, `/admin/pricing`, `/admin/deleted` | O-39 |
| Office can look at the owner area | `/owner` | O-40 |
| Sign out | all office pages | O-41 |

## One TEST job, start to finish

Run the state-changing cases in this order. Each needs the one before it.

1. O-50 create a TEST job (or use an existing one) → O-51 prepare TEST associations.
2. Owner saves the spot (H-23 shows the screen; answering the 3 questions is done by hand, see below).
3. O-58 Release → H-40 owner confirms.
4. I-40 installer sends 3 Ready Check times → H-41 owner books one (or the owner presses "None of these suit – suggest other days" by hand → I-42).
5. Ready Check and quote happen in Mitti (not tested) → H-43 owner signs the quote → O-61 TEST payment.
6. O-60 PIESA offer → E-40 electrician sends 3 times → H-45 owner picks one.
7. E-47, E-48, E-49, E-51/E-53 the PIESA visit → H-47 owner confirms the PIESA.
8. I-49 install days → H-49 owner picks one → H-50 ESC consent → I-52 safety plan → E-55 electrician confirms.
9. I-55 install finished → I-56 rebate Part B → H-51 owner signs the rebate form → H-52 stars.
10. Last of all: the one-way cases on a spare TEST job, then O-67 archive.

## Not covered, and why

| What | Why |
| --- | --- |
| Mitti forms (Ready Check, PIESA, fixes, install day) | Separate app. Tests only check the **Open Mitti form** link is there. |
| Real emails and texts arriving | TEST jobs and TEST partners only send to Jo's own phone and email (test allowlist); customer messages stay off until switched on. testRigor's inbox isn't on the allowlist. |
| Card payments (Stripe), owner deposits, fixes paid in full | Needs Stripe test keys. O-61 records a TEST payment instead. |
| Xero invoices and sync | Needs the Xero Demo Company connected. |
| Calculator "Register my interest" send | Sending makes a REAL enquiry on the live portal. Only the error messages are tested. |
| Office "New enquiry (phone)" save | Saving makes a REAL enquiry. Only the form is opened. TEST jobs come from the Test Centre. |
| Owner's 3 questions page (`/estimate/$token/video`) and "Save my free spot" | Reached from the estimate link with photo uploads; the stored link is the My job link. Check by hand, or store the `/estimate/…/video` link and copy H-23. |
| Owner paperwork details ("Do it now") and landlord details | Only the card is checked (H-22); the form changes by owner type. |
| Settings > Switches, Communications > Cancel these, Money > Mark paid, Publish new prices, Xero settings | Change live sending, real held messages or real money. Never automate. |
| Partner application approve / decline, rate offers (`/rate-offer/$token`), onboarding (`/installer-onboarding`, `/electrician-onboarding`) | Real applicants, or links that only arrive by email. O-63 makes a TEST onboarding link; following it is a separate long form. |
| Worker job link (`/w/$token`), crew safety plan link (`/sp/$token`), team invite (`/join/$token`), ESC notice link (`/notice/$token`) | Links only arrive by text. Bad-link checks are in I-37. The Test Centre's "Open as worker" gives a 15-minute TEST worker link to try by hand. |
| Bulk upload (`/partner/bulk-import`) | Switched off (`INSTALLER_BULK_UPLOAD_ENABLED = false`). I-33 checks it is refused. |
| Google sign-in | Needs a Google account; only the button is checked (O-01). |
| Magic link and password reset emails | TEST addresses aren't real inboxes. The reset page itself is used when setting Deep's TEST password (README). |
| Day tiles and time menus | Labels change daily ("Tue 28 Oct"). Steps pick by position; may need one fix in the editor. |
| Exact money amounts, dates, owner names | Change per job. Checks use the fixed words around them. |
| Electrician manual PIESA field values | Field types vary; E-51 checks the form is there, E-53 completes it once results are in. |
| Office pages kept only as redirects (`/admin/list`, `/admin/pipeline`, `/admin/quotes`, `/admin/operations*`, `/admin/hot-leads`, `/admin/launch-campaign`, `/admin/campaign-emails`, `/admin/compliance`, `/admin/owner-paperwork`, `/admin/coverage`, `/admin/businesses`, `/admin/team-ups`, `/admin/partners-overview`, `/admin/veec`, `/admin/todo`, `/admin/ready-check`, `/admin/enquiry-groups`, `/admin/index`) | Same pages as the menu; five are spot-checked in O-39. |
| Preview-only pages (`/installer-preview`, `/campaign-preview`, `/step3-email-preview`) and API hooks (`/api/**`) | Not user screens. |
