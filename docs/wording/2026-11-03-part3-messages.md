# Part 3 messages (electrical upgrades and the certificate)

Every message here is HELD: nothing goes to a real trade until Jo approves it and its flag is turned on. TEST jobs and TEST partners still get them through the test sender. Wording below is copied exactly from the code. Placeholders in {braces} are filled in by the portal.

Installer offices are emailed, never texted. The electrician gets texts with their no-login link.

Task 6 completes this file (the other Part 3 messages).

---

## 1. Upgrades day reminder text to the electrician (Task 5)

- Code: `upgradesDayLinkText` in `src/lib/certificate-chase.core.ts` (sent by `textUpgradesDayLink` in `src/lib/own-job-piesa-notices.server.ts`, from the tick sweep `sweepUpgradesDayChase`)
- Channel: text, with the electrician's link
- Goes to: the job's electrician, once, 1 business day (Victorian) after the safety check (PIESA) said upgrades are needed and not today, when no upgrades day is entered yet
- Approval flag: SMS type `electrician_upgrades_day_link` has `wordingApproved: false` in `src/lib/sms.core.ts` (also `UPGRADES_DAY_LINK_TEXT_APPROVED = false` in `certificate-chase.core.ts`)
- {first} is the electrician's first name (or "there"); {address} is the job address; {link} is their link

```
Hi {first}, the upgrades day for {address} isn't booked yet. Add it here: {link}
```

## 2. Upgrades day email to the installer office (Task 5)

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

## 3. Certificate reminder text to the electrician (Task 5)

- Code: `certificateChaseText` in `src/lib/certificate-chase.core.ts` (sent by `textCertificateLink(…, "chase-2bd", { text: "chase" })`, from `sweepCertificateChase`)
- Channel: text, with the electrician's link
- Goes to: the job's electrician, once, 2 business days after the electrical upgrades were recorded (Part C) when no Certificate of Electrical Safety file is on the job
- Approval flag: SMS type `electrician_certificate_link` has `wordingApproved: false` in `src/lib/sms.core.ts` (also `CERTIFICATE_CHASE_TEXT_APPROVED = false`). Note: this text shares its SMS type with Task 3's "add your certificate" text, so approving that type approves both.

```
Hi {first}, we still need the Certificate of Electrical Safety for {address}. Add it here: {link}
```

## Office lines (Needs me, no approval flag — check the words)

- After 2 business days with no upgrades day (This week): `Upgrades day not set — {electrician} on {address}`
- 7 days or fewer left on the 30-day clock, still no upgrades day (Today, red): `Upgrades day not set — 7 days left on the 30-day clock`
- 4 business days after the upgrades with no certificate file (Today): `Certificate not in — call {electrician} ({phone})`

Each line goes away by itself once the day is entered / the certificate file is on the job.
