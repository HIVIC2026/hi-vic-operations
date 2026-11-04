# Part 3 messages (electrical upgrades and the certificate)

Every message here is HELD: nothing goes to a real person until Jo approves it and its flag is turned on. TEST jobs and TEST partners still get them through the test sender. Wording below is copied exactly from the code. Placeholders in {braces} are filled in by the portal.

Installer offices are emailed, never texted. The electrician gets texts with their no-login link.

---

## 1. "Add your certificate" text to the electrician (Task 3)

- Code: `certificateAddLinkText` in `src/lib/certificate-later.core.ts` (sent by `textCertificateLink(jobId, "now")` in `src/lib/own-job-piesa-notices.server.ts`)
- Channel: text, with the electrician's link
- Goes to: the job's electrician, once, straight after the upgrades are recorded (Part C) on the safety check form or the upgrades form without a Certificate of Electrical Safety
- Approval flag: SMS type `electrician_certificate_link` has `wordingApproved: false` in `src/lib/sms.core.ts` (also `CERTIFICATE_ADD_LINK_TEXT_APPROVED = false` in `certificate-later.core.ts`). Note: message 5 shares this SMS type, so approving the type approves both.
- {first} is the electrician's first name (or "there"); {address} is the job address; {link} is their link

```
Hi {first}, thanks for doing the electrical upgrades at {address}. When you have the Certificate of Electrical Safety, add a photo or PDF here: {link}
```

## 2. Owner "You're booked" for the upgrades day (Task 3)

- Code: `bookingNotice` kind `upgrades` in `src/lib/in-house-booking.core.ts` (sent by `notifyOwnerBooked(jobId, "upgrades", …)` in `src/lib/in-house-booking.server.ts`, from `linkEnterUpgradesDay` in `src/lib/electrician-link.server.ts`)
- Channel: email and text (same notice as the other booking confirmations, new words for the upgrades day)
- Goes to: the owner, once, when the electrician enters the upgrades day on their link. Every job, HIV leads included.
- Approval flag: `OWNER_UPGRADES_BOOKED_APPROVED = false` in `src/lib/in-house-booking.core.ts`. While false the notice is saved as pending and goes once the flag is on. (The text uses SMS type `in_house_booked_owner`, already approved for the other bookings.)
- {when} looks like "Friday 13 November at 9:00 am"; {electrician} is the electrician's name, with ", phone {phone}" when there is one; {installer} is the installer's business, or "Home Insulation Victoria" when the job has no installer

Email subject:
```
You're booked — electrical upgrades
```
Email body:
```
You're booked for your electrical upgrades: {when}. Who's coming: {electrician}. Need a different time? Call {installer} on {phone}.
```
The last sentence changes when there is no phone on file:
- Installer with no phone: `Need a different time? Call {installer} on the number in your booking details.`
- No installer, no office phone: `Need a different time? Call Home Insulation Victoria.`

Text:
```
You're booked for your electrical upgrades: {when}. {electrician} is coming. Details in your email.
```

## 3. Upgrades day reminder text to the electrician (Task 5)

- Code: `upgradesDayLinkText` in `src/lib/certificate-chase.core.ts` (sent by `textUpgradesDayLink` in `src/lib/own-job-piesa-notices.server.ts`, from the tick sweep `sweepUpgradesDayChase`)
- Channel: text, with the electrician's link
- Goes to: the job's electrician, once, 1 business day (Victorian) after the safety check (PIESA) said upgrades are needed and not today, when no upgrades day is entered yet
- Approval flag: SMS type `electrician_upgrades_day_link` has `wordingApproved: false` in `src/lib/sms.core.ts` (also `UPGRADES_DAY_LINK_TEXT_APPROVED = false` in `certificate-chase.core.ts`)
- {first} is the electrician's first name (or "there"); {address} is the job address; {link} is their link

```
Hi {first}, the upgrades day for {address} isn't booked yet. Add it here: {link}
```

## 4. Upgrades day email to the installer office (Task 5)

- Code: `upgradesDayOfficeEmail` in `src/lib/certificate-chase.core.ts` (sent through `emailInstallerOffice`, from `sweepUpgradesDayChase`)
- Channel: email (with an "Open the job" button)
- Goes to: the installer's office email, once, 2 business days after the safety check said upgrades are needed, when no upgrades day is entered yet
- Approval flag: `UPGRADES_DAY_OFFICE_EMAIL_APPROVED = false` in `src/lib/certificate-chase.core.ts`
- {electrician} is the electrician's name (or "The electrician"); {job link} is the installer's job page

Subject:
```
Upgrades day not set — {address}
```
Body:
```
{electrician} hasn't set the electrical upgrades day for {address} yet. Can you give them a nudge?
The install can't go ahead until the upgrades are done. The job: {job link}
```

## 5. Certificate reminder text to the electrician (Task 5)

- Code: `certificateChaseText` in `src/lib/certificate-chase.core.ts` (sent by `textCertificateLink(…, "chase-2bd", { text: "chase" })`, from `sweepCertificateChase`)
- Channel: text, with the electrician's link
- Goes to: the job's electrician, once, 2 business days after the electrical upgrades were recorded (Part C) when no Certificate of Electrical Safety file is on the job
- Approval flag: SMS type `electrician_certificate_link` has `wordingApproved: false` in `src/lib/sms.core.ts` (also `CERTIFICATE_CHASE_TEXT_APPROVED = false`). Note: this text shares its SMS type with Task 3's "add your certificate" text, so approving that type approves both.

```
Hi {first}, we still need the Certificate of Electrical Safety for {address}. Add it here: {link}
```

## Office Needs lines (Needs me, no approval flag — check the words)

- Own job, PIESA done in Mitti but the portal couldn't complete it (Today, `own_job_piesa_complete_held`, Task 4b): `PIESA done in Mitti but couldn't be completed — {reason}`
- Upgrades done on the safety check visit, but the Part C record couldn't be saved (Today, `same_day_part_c_failed`, Task 4b): `Same-day Part C record failed — {reason}. The portal retries it each tick.`
- After 2 business days with no upgrades day (This week, Task 5): `Upgrades day not set — {electrician} on {address}`
- 7 days or fewer left on the 30-day clock, still no upgrades day (Today, red, Task 5): `Upgrades day not set — 7 days left on the 30-day clock`
- 4 business days after the upgrades with no certificate file (Today, Task 5): `Certificate not in — call {electrician} ({phone})`

Each line goes away by itself once the problem is fixed (PIESA completed / Part C saved / day entered / certificate file on the job). Every button is "Open job".

## Office/installer lines (check the words)

On-screen words, no approval flag.

Job page status line (Task 3, office and installer job pages):
- `Waiting for {electrician}'s Certificate of Electrical Safety` (no name: "the electrician's")
- `Upgrades day not set yet`

Warning when an install is booked before the certificate is ticked (Task 4, pop-up after booking; booking still goes ahead):
- No file yet: `Certificate of Electrical Safety still to come — the install can't start without it`
- File in, not ticked: `Certificate of Electrical Safety not checked yet — the install can't start until it's ticked.`

Pre-start check, the day before (Task 4, on the existing pre-start Needs row):
- `Certificate of Electrical Safety not in yet`
- `Check electrical certificate — {why}` ({why} is e.g. "not checked yet")

Start lock (Task 4, shown when someone tries to start the install):
- `Not cleared to start: Certificate of Electrical Safety not in yet.`
- `Not cleared to start: check the electrical certificate — {why}.`

Office history only (Task 4): `Install form held until the Certificate of Electrical Safety is ticked`

Owner screen (Task 1, shown now, not held — tell us if it should be): on the owner's electrical upgrades page when we hold no quote: `Your electrician quotes and arranges the electrical upgrades with you directly.`
