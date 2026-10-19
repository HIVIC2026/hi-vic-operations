# Read-only audit: can the 643 held backlog records be released?

Nothing is changed or sent. Only database reads and pure local rule checks are used.

## Steps
1. **Snapshot.** Record the held count (643), the runnable count (0), and the current number of customer email and outbound message records. These are the baseline.
2. **Exclusions (EXCLUDED_CLOSED_DUPLICATE_TEST).** Remove any held record that is:
   - closed or cancelled
   - in an advanced stage (outside the allowed stages for T1/T2/T5/T6/T7)
   - a test or `qa_test` job
   - on the legacy exclusion or hidden-duplicate lists (this includes HV-1437)
   - deleted
   - already sent or sending under any first-response purpose
   - a newer or older record for the same email that has already been answered (counted and reported, never suppressed automatically)
3. **Route check for the rest.** Gather each job's stored facts: eligibility outcome and source, desk check, latest media review, media received, insulation answer, owner size, estimate source and area, secure link, consent, opt-out, bounce, and email validity. Run them through the same pure route and blocker rules used by `selectLeadEmailRoute` and `maybeAutoRouteLeadEmail`, with the trusted backlog context. Use a local script that loads only the `*.core.ts` rule functions and never imports a sender, `syncStep3`, a queue, or a provider. A global network block stays in place the whole time. Each job goes into exactly one bucket:
   - **OFFER_SPOT_SAFE:** split by owner size vs labelled 150 m², and by no insulation (T1/T2) vs office-reviewed below R2 or loose-fill (T3/T4)
   - **REQUEST_PHOTOS_SAFE:** unknown or present insulation, no media received, and no review pending
   - **INELIGIBLE_SAFE:** only when a verified ineligible reason is recorded
   - **MANUAL_REVIEW:** media received but not reviewed, unclear eligibility, missing estimate or link, blocked consent or contact, missing answers, or any other fail-closed condition, each with a counted reason
4. **Final check.** Repeat the snapshot and confirm nothing changed: 643 held, 0 runnable, and no new email or message records.

## Report
- Counts only per bucket and sub-bucket, plus counts per reason. No names, emails or addresses.
- A recommendation for each safe bucket: release or not.
- An explicit statement on whether all 643 should be released together. The expected answer is no: release in buckets, each with its own approval.

## Technical notes
- The read-only queries cover `post_intake_work` (reason `ENQUIRY_BACKLOG_MANUAL`), `jobs`, `office_enquiry_index`, `customer_email_sends`, `lead_campaign_responses`, `customer_engagement_events` (`intake_media_reviewed`), `documents`/`evidence_files` (intake media), `customer_estimate_links`, `customer_email_optouts`, and `owner_contact_consents`.
- If the media manifest is uncertain, the job goes to MANUAL_REVIEW, matching `groupBMediaForJob`.
- Production server code can't be confirmed to match this source. The report will say so.
