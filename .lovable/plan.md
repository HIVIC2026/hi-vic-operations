# Make both installer job paths clear and complete

## Audit findings
- The owner quote already has separate installation, AP management and PIESA lines, with the rebate deducted. The customer's PIESA price is currently $349 inc GST; the electrician's own agreed pay remains private.
- Agreeing to the installer's price is not the same as knowing about Home Insulation Victoria's added fees. There is no recorded fee-awareness confirmation before quote issuance today.
- Add one job uploads attachments but its reader only extracts pasted text and CSV. A PDF or photo alone therefore reaches a largely blank confirmation screen.
- Bulk upload reads customer information, but the initial files are represented by names rather than stored job-file uploads. File-to-job matching needs verification, particularly when one document contains multiple customers.
- Some quote-release paths set a sent date without calling a sender. That is not proof the owner received a quote.
- Owner acceptance records the exact quote and updates the job, but no dedicated automatic installer approval message is connected.
- The automatic planner lacks the current Ready Check → measured quote stages. Supplied-job quote preparation differs between single upload, bulk upload and Mitti.
- Extras exist in the Ready Check specification, but the quote builder does not yet use those specific answers to hold or price extras. Reporting extras alone must not silently produce a quote without them.

## 1. Clear owner fee awareness
- Show the installer what Home Insulation Victoria will issue: installation price, rebate, AP management fee, separate PIESA fee and final owner total, all inc GST.
- Add an unticked confirmation: **“The owner is aware of Home Insulation Victoria’s AP management fee and the $349 inc GST electrical safety check (PIESA) fee.”** Display the actual current fees when settings or Jo's authorised per-job AP fee differ.
- Record who confirmed, when, the wording and fee amounts. Never interpret the existing “owner agreed to my price” tick as this confirmation.
- Require this confirmation before issuing the owner quote on either channel. Allow intake to be saved without it; show the missing confirmation in Needs me. Reuse it across screens rather than asking again, and require a new confirmation if the disclosed fees change.
- Keep the owner's own exact-version approval and signing separate and unchanged.

## 2. Installer-supplied customer path
1. Upload/paste → extract each customer's details → installer checks and confirms them.
2. Already measured: office reviews supplied measurements; no unnecessary Ready Check booking. Otherwise the same supplying installer completes the Ready Check.
3. Installer provides their own quoted price and scope. No Home Insulation Victoria markup on that price.
4. Office verifies eligibility and quote inputs; missing eligibility or price facts remain blocking. Permitted install-day evidence stays on the existing carry-over list.
5. Recorded fee awareness + complete inputs → prepare the co-branded owner quote, with exceptions held for office review.
6. Actual owner issuance follows existing sending controls → owner approves the exact version → installer receives a portal update, with the external approval notice queued while sending is off.

## 3. Home Insulation Victoria lead path
1. Keep the existing enquiry, owner Ready Check request, assignment and confirmed booking flow.
2. Installer completes measurements and reports access, removal and extras—never answers “Quoted?” or sets the owner's price.
3. Office verifies eligibility; extras needing pricing hold the quote for office review and an audited adjustment. Never drop reported extras.
4. Recorded fee awareness + complete inputs → prepare the measured quote from current owner prices and the assigned installer's agreed rates.
5. Actual issuance → owner's exact-version approval → installer portal update and queued approval notice.

## 4. Upload repairs
- Reuse the existing supported-file readers for Add one job and bulk upload; avoid introducing another extraction system.
- Extract owner name, contact details, property, supplied area, site-check status/date, quoted price/scope and available source references without inventing missing answers.
- If a single-job upload contains multiple customers, stop before creating a job and direct the installer to the existing bulk upload page.
- Store the actual uploaded files privately and link them to the appropriate confirmed job; flag ambiguous matches rather than attaching another customer's files automatically.
- Show what was read from each file and preserve editable confirmation. Unreadable files must be clearly identified, not presented as successfully extracted.

## 5. Automatic next steps and safeguards
- Fill the gaps in the existing guarded progression, not a parallel workflow.
- Automatically prepare eligible quotes and update stages from validated records; never automate office eligibility judgement, owner acceptance, AP approval or overrides.
- Approval advances to the existing invoice/payment step. PIESA remains payment-gated; installation remains electrical-clearance and timing-gated.
- Keep pending offers and future confirmed visits visible in their correct My work groups; add fee-awareness tasks without duplicating jobs or changing the separate jobs-list layout.
- “Sent” requires an actual successful sending record. Disabled sending means queued, never falsely sent.
- No publishing, real customer/trade messages, live invoicing or switch changes. Mitti templates remain Jo's placeholders; do not edit them.

## Verification and report
- Test both channels, single/bulk/Mitti input paths, fee confirmation missing/present/stale, reported extras, quote versions, approval updates and every guarded next step.
- Prove any required database changes on PGlite before applying them; do not rewrite historical quotes or consents.
- Click the upload buttons on preview as the TEST installer, using known PDF/photo/CSV fixtures and multiple-customer files; compare extracted and stored details per job.
- Check phone and desktop screens and re-run the installer test.
- Report both paths in plain English, a TEST job → next step → why table, upload extraction results, test results and any remaining blockers. No claim of completion based on source-only checks.

## Technical approach
- Keep pure handoff/fee-awareness rules in tested `*.core.ts`, persistence in `*.server.ts`, authenticated RPC in literal `*.functions.ts` chains.
- Extend existing quote release, job presentation and `autoAdvanceJob` guards; use existing permanent audit and notification infrastructure.
- Scope fee confirmations to the active assigned installer/business and the current disclosed fee amounts. Enforce at every issuance path, including office approval and queued release.
- Preserve private storage, role checks, TEST isolation, commercial-route gates and launch locks.