/** Display-only selection from office_enquiry_index; never an eligibility or send rule. */
export const OFFICE_PENDING_PHOTOS_FILTER = 'and(office_bucket.eq.enquiry,media_to_review.eq.true,spot_offered.eq.false,enquiry_status.not.in.(offered_spot,spot_saved,ineligible),spot_saved.eq.false,removed.eq.false,deleted_at.is.null,owner_progressed.eq.false)';
export const OFFICE_REVIEW_FILTER = 'and(office_bucket.eq.enquiry,spot_offered.eq.false,enquiry_status.not.in.(offered_spot,spot_saved,ineligible),spot_saved.eq.false,removed.eq.false,deleted_at.is.null,owner_progressed.eq.false,or(media_to_review.eq.true,and(enquiry_status.eq.needs_attention,media_to_review.eq.false,needs_first_response.eq.false)))';

const SEARCH_FIELDS = ['owner_name', 'owner_email', 'owner_phone', 'property_address', 'job_number', 'external_enquiry_id'];
/** Same any-word-widens search as the RPC, with literal wildcard characters escaped. */
export function officeReviewSearch(search: string): string | null {
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return null;
  return terms.flatMap(term => {
    const pattern = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
    const quoted = JSON.stringify(pattern);
    return SEARCH_FIELDS.map(field => `${field}.ilike.${quoted}`);
  }).join(',');
}