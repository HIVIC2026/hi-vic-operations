# Office-only Enquiry categories

- Keep existing evidence-based office lane rules unchanged and reuse their current read model.
- Add five exclusive Enquiry filters with counts, in the requested priority order: uploads to review, ready to offer, needs uploads, ineligible review, manual review.
- Derive the filters from persisted homeowner answers, screening, intake media and review records. Keep sent offers, saved spots and progressed jobs outside these filters.
- Preserve existing actions, templates, pricing and all workflow/compliance stages. No database writes, communications or publishing.

## Verification
- Add focused tests for exclusivity, priority and progressed-record exclusions; run the enquiry-group tests.
- Use read-only production facts to calculate current counts and compare with the supplied Base44 totals, reporting differences rather than forcing matches.
- Check the preview and automatic compilation/type checking; report any signed-in verification gap.

## Technical approach
- One pure presentation classifier; join the Leads rows to the existing shared operations query by job ID.
- Extend only the existing admin read projection for required intake facts; no category field or new persistence.