# Installer-supplied jobs in bulk — plan only

## What exists today
- **Single-job import** (Partner > Import): one job at a time from pasted text, one CSV row, an EasyMate reference or attached files. Simple pattern reading only, no AI. PDFs and photos are stored with the job but not read. A short confirm screen comes before the job is created, and supplied measure-ups stay provisional until the office approves them.
- **Installer-supplied channel:** permanent attribution to the installer, and payment is blocked with "Commercial setup required" until that installer's commercial setup exists. This stays.
- **Owner consent and VEEC assignment signing** are in place, but only at quote acceptance.
- **Not built yet:** bulk upload, AI reading, matching photos to jobs, reading a photo's GPS location and date, an owner self-confirm link, a per-job "have it / missing" Ready Check checklist, or a Mitti install-day step that asks only for missing items.
- Office bulk actions exist (cancel, hold, mark as test). They are unrelated and stay as they are.

## Proposed split (each part ships, gets tested and is approved on its own)
1. **Upload and AI reading (nothing created).** The installer drops a spreadsheet, PDFs, photos or a photo of a handwritten list into one upload. AI pulls out the jobs. Photo GPS and date are read automatically. Addresses are checked with the existing address checker. Everything is kept as a draft batch only.
2. **One review table and confirm.** For example, "112 jobs found, 9 need something": fix only the gaps, see duplicates, and tick owner permission once per job. The VEEC rule is shown before confirming (point 5). Confirming creates draft installer-supplied jobs, one by one.
3. **Owner confirmation link.** A phone-first tap-through: owns or lives there, house type, existing insulation, life support, not already installed, not already claimed, then consent and VEEC assignment signature. "Not sure" is allowed. Messages are queued only, and the office can copy the link. Reminders on day 2, 5 and 10 are queued, and after day 14 the job goes to needs-attention. Each job ends as **Ready to go / Check on install day / Not eligible**.
4. **Ready Check evidence checklist.** Each item is marked "have it" or "missing". A photo counts only if AI says it shows the right thing, its GPS is within the property distance, and its date is recent enough. No GPS means it doesn't count. The office can overrule with a reason.
5. **Mitti install day: missing items only.** These are shown before the PIISA. A "not eligible" finding shows "Stop, don't install" and sends the job to needs-attention. Jobs with nothing missing get no extra steps. Existing hard gates are unchanged.
6. **Joining the normal flow.** The installer's preferred electrician comes first, the owner picks PIESA times and install days, and the quoted installer is this installer. Mostly this connects things that already exist.

## Edge cases
- **Bad or unreadable upload:** the file is kept and marked "couldn't read". The rest of the batch carries on. Nothing is guessed, and every AI value shows as "please check" until the installer confirms it. Size and type limits apply, as well as a maximum of 300 jobs per batch.
- **Handwritten list:** read as low confidence, so every field needs the installer's confirmation.
- **Wrong photo match:** a photo is matched only when its GPS is close to one job's address. Date and file name are used only to break ties. Unclear photos go to an "unmatched photos" tray and the installer drags each to a job. The Part 4 GPS check still applies, so a wrong match can never count as evidence.
- **Duplicate in the upload:** the same checked address is merged into one row, and the installer chooses which details to keep.
- **Already in the portal (same installer):** linked to the existing job, never a second job.
- **Multiple installers claiming the same address:** no second job is created. The row is marked "already with another business" without showing that business or the owner's details, and the office sees it in needs-attention. The first owner-confirmed job wins only if the office decides.
- **Owner disagrees with the installer's info:** the owner's answer is kept as the declared answer, and the installer's version is kept as source context. Key differences (house type, life support, insulation) go to the office review flag. "Not sure" becomes "Check on install day".
- **Owner never responds:** queued reminders, then needs-attention at day 14. The job is never progressed and no PIESA is offered without the owner's signed consent.
- **Already installed:** the upload marks hints such as "installed" or a past install date, and the owner's "already installed" answer settles it. The job is excluded as "Not eligible: already installed (no PIESA/notification before install)", and it stays visible in the batch.
- **Already claimed under VEU:** "Yes" goes to office review (existing rule). "Not sure" becomes "Check on install day".
- **Attached homes (townhouse, unit, duplex):** the existing Gate 1 property rules apply unchanged. Apartments are flagged "Not eligible / office review", and shared ceiling space is a Ready Check item.
- **Owner isn't the person the installer listed, or there's no contact details:** the row needs fixing. No link is sent without a phone number or email.
- **Rental or landlord:** the owner's answer drives the existing occupancy rules.
- **Bulk confirm part-fails:** each job is created separately and failures are listed. Retrying never makes duplicates.

## Parts touched
- New partner page **Bulk import** and a new office view of batches.
- New import-batch and photo-evidence records (Part 1 and Part 4): additive new tables, proven on a practice database first.
- AI reading through the built-in AI service. No new key is needed.
- Owner link page, and a Mitti install-day step for missing items.
- The existing single-job import, Gate 1, payment gate and pre-start check rules are reused, not changed.

## Effect on existing records
None. Existing jobs, imports, consents and evidence stay as they are. Only new batches use the new path. Sending and the payment gate stay off.

## Privacy
- Uploads go to private job storage, and photos are only ever viewed through short-lived links.
- AI receives only what it needs to read. Results are not used to train models.
- Owner details are hidden from other businesses, including on duplicate warnings.
- Photo GPS and date are kept as evidence data and never shown to other trades.
- Permission tick is recorded per job (who and when). The owner's own consent on the link is still required before any customer contact other than the link itself.
- Discarded batches have their files removed after 30 days. The audit record of the discard stays.

## Undo
Roll back each part in History. Each database part has its own undo file that removes only its new tables. Jobs created from a batch can be cancelled the normal way.

## Things Jo may have missed (please decide)
1. **Photo "recent enough":** suggested 6 months for existing-insulation and access photos. Before-install photos must be taken on install day.
2. **GPS distance:** suggested 50 m from the property centre. Rural blocks may need more.
3. **Owner permission tick:** what wording, and is a tick enough or does the installer have to upload proof?
4. **Who pays for AI reading** of large batches. Small cost, but worth noting.
5. **Supplied measure-ups:** still provisional until the AP measurement standard is approved (existing rule). Should a bulk job with an area but no Ready Check visit use install-day measuring as the record?
6. **Installer doing their own PIESA booking:** confirm that the owner still picks the times (as for all visits).
7. **Messages:** owner link, reminder and "not eligible" wording need approval before sending is turned on.
8. **Bulk job lead fee:** none, per the installer channel rule. Confirm.
9. **Stop on install day:** who tells the owner, and is there any call-out charge? Today there is none.
