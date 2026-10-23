# Installer jobs: Mitti workflow plan (Jo, 23 Oct 2026)

Agreed after Reinsulate's bulk upload of 15 jobs (HV-3136 to HV-3150) reached the portal without the office knowing.
Status: PLAN. Installer bulk upload was switched off on 23 Oct (`bulk-upload-switch.core.ts`); everything else below is to be built.

## Decisions (Jo, 23 Oct)
- Installers never need office approval before contacting the owner. The office is told, the installer carries on.
- The Ready Check (Mitti A1) holds everything a job needs, including the eligibility questions. The form's answers are enough; no separate office eligibility step before the quote.
- Jobs START in the portal and are FINISHED in Mitti. Starting in the portal creates the job and a labelled Mitti form; the installer completes it on site, whenever the visit is (now or weeks later).
- The installer does NOT approve the quote. When the form is complete the portal builds the quote and sends it to the owner automatically, unless a check holds it.
- Bulk upload is rebuilt (not retired): each row is treated exactly like a single portal-started job.
- Office keeps portal Add job for itself (e.g. phone enquiries).
- (Later 23 Oct) The automatic quote sends only once the installer marks the Mitti form **Complete** and the basics are in; photos may still be missing.
- Missing Ready Check photos stay install-day photos (existing rule): the quote may go before the existing-insulation photo; "Installation complete" stays locked until the install-day photos are in. Jo accepts the risk that an install-day photo shows R2.0+ after acceptance.
- Forms started straight in Mitti are still picked up, matched to the installer's own jobs by owner details, and flagged to the office. Never duplicated.

## The workflow
1. **Installer adds the job** (portal, one at a time or bulk): owner name, address, mobile, email, permission tick; optional visit date.
2. **Portal immediately:** creates the job (installer-led, assigned, source locked, contact permission recorded as an owner contact consent), creates the Mitti A1 form prefilled with job number, address and owner details, assigned to the installer. Nothing is sent to the owner.
3. **Office is told:** "New from installers" on Today and Active jobs, per job/batch, with warnings (possible duplicate, form not finished, quote held + reason). Reminder if the Ready Check hasn't started after **14 days**.
4. **Installer completes the form on site.** "Needs finishing…" shows what is missing and clears itself when complete.
5. **Quote built and sent automatically:**
   installer price + difficult access fee + PIESA price + $349 AP fee − VEU rebate (minimum contribution unchanged; PIESA price per the form's electrician choice: HIV $349 / usual electrician's saved price / form price).
   Sent by email and SMS with the owner's secure link only when every check passes, otherwise held on the office list with the reason:
   - form complete (area, product, price, owner name/mobile/email, permission);
   - eligibility answers on the form pass;
   - electrician choice made and priced;
   - installer price (EXCLUDING access fee) within **ceiling area × $15–$30 + removal area × $5–$15** per m² inc GST;
   - difficult access fee **≤ $500** inc GST;
   - job not flagged as a possible duplicate.
   If the form changes after a quote was sent, the new quote is **held for the office**, never auto-sent.
   Ships behind its own switch, OFF, until proven on the TEST Reinsulate account.
6. Unchanged from here: owner accepts and pays, then electrician/PIESA, install, final checks.

## Incomplete Ready Checks
- Quote basics: ceiling area, product, installer price, owner mobile + email + permission, no hard stop. Missing basic → quote held, installer sees "Needs finishing: …", office sees "Ready Check missing: …"; he can finish the form later from anywhere.
- Photos are optional at the Ready Check; each missing one becomes a required install-day photo (`ensureInstallDayPhotos`), and "Installation complete" is blocked until they are in (`installDayPhotoBlocker`).

## Mitti template changes (A1 – Ready Check | Installer-Supplied Customer)
Done 23 Oct (published): Portal Job Number is the first Title Page question (short text, not mandatory); difficult access Yes/No + "Difficult access fee ($ inc GST)" added; "Difficult access" removed from "What's included in your quote?"; inspection title format = Portal Job Number.
Still to do in Mitti: add a short-text **Title address** question on the Title Page and include it in the title format after the job number (Mitti's Inspection location type can't be used in titles). The portal will prefill it.

Original request (Mitti form editor only — the portal's API connection cannot edit templates):
1. Re-add a text question titled exactly **Portal Job Number** at the top (portal prefills it).
2. Set the inspection title to show **Portal Job Number + site address**, so the In progress list reads e.g. "HV-3141 – 12 Smith St, Essendon".
3. Add **Is there a difficult access charge?** (Yes/No) and, on Yes, **Difficult access fee ($ inc GST)** (number) — same wording as A2. Remove "Difficult access" from "What's included in your quote?".

## Build phases (separate branch; each phase tested before it goes live)
1. **Office visibility** — "New from installers" list; surface `mitti_pickup_clash` / installer-started form flags; 14-day not-started reminder. Display only.
2. **Portal start + labelled Mitti form** — prefill Portal Job Number and Title address; installer New job → job + prefilled A1 form; same for bulk rows (rebuilt bulk upload: consent row, office alert, labelled form per row, no skipped guards); create labelled forms for HV-3136…HV-3150.
3. **Mitti pickup fixes** — forms started in Mitti with an HV number typed in are currently skipped forever by the pickup scan (`classifyPortalJobNumber(...) === "linked"`): link them when the number is one of that installer's own jobs, otherwise office review; mark picked-up jobs installer-led; stop `holdAtMittiReadyCheck` forcing stages every tick; no re-adoption of released forms; same-business owner/phone/email/address matching, unsure → office; never overwrite owners; atomic claim per form; clear "Needs finishing…" when complete; read the difficult access fee.
4. **Automatic quote** — only after the form is marked Complete in Mitti; read the new A1 difficult access fee; build + checks + send through the existing guarded sender, switch OFF by default.
5. **Data repair (pending SQL, PGlite-proven, run live only with Jo's OK)** — owner contact consent rows for the 15 bulk jobs.

Testing: unit tests for every rule (price ranges, access fee limit, matching, holds, no duplicate sends), PGlite proof for any SQL, `bun run portal-qa` on TEST accounts. No real owner is contacted during testing.
