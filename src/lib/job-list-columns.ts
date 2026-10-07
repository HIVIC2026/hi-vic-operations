// Columns job LISTS read from job_overview. Leaves out the three per-job paperwork/payment
// lookups (authority status/expiry, deposit cleared) that made each list read ~2.5s; single-job
// pages still read them. Speed fix, 7 Oct.
export const JOB_LIST_COLUMNS =
  "id, job_number, stage, next_action, eligibility_outcome, life_support, last_activity_at, created_at, hold_reason, property_id, property_address, owner_id, owner_name, owner_phone, owner_email, electrician_id, electrician_name, installer_id, installer_name, piesa_date, install_deadline, days_remaining, urgency, piesa_expired, payment_status, channel, commercial_model, originating_installer_user_id, originating_business_name, source, eligibility_review_required, eligibility_flags" as const;
