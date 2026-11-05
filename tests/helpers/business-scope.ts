// Portal speed step 2 (plan Review Focus 5): a screen's merged reads must stay business-scoped. Adds another business with
// its own sign-in, job, booking, offer, worker, credential, bank details and payout event to an in-memory fixture (only
// into tables the fixture already has, so no read changes shape), and finds any trace of it in a screen's answer.
import type { Tables } from "./memory-postgrest";

export const FOREIGN_BIZ = "00000000-0000-4000-8000-0000000000f3";
export const FOREIGN_JOB = "00000000-0000-4000-8000-0000000000ff";
export const FOREIGN_USER = "00000000-0000-4000-8000-0000000000f1";
const MARK = "Foreign";

export function addForeignBusiness(t: Tables, at: string): void {
  const rows: Record<string, Record<string, unknown>[]> = {
    businesses: [{ id: FOREIGN_BIZ, name: `${MARK} Co`, legal_name: `${MARK} Co Pty Ltd`, trading_name: `${MARK} Trading`, business_type: "eec_installer", capabilities: ["installer"], base_suburb: `${MARK}ville`, accepting_new_jobs: true, onboarding_notes: null, in_house: false, pays_own_electricians: false, approved_at: at }],
    business_members: [{ id: "m-foreign", business_id: FOREIGN_BIZ, user_id: FOREIGN_USER, member_role: "business_admin", active: true }],
    user_roles: [{ user_id: FOREIGN_USER, role: "installer" }],
    profiles: [{ id: FOREIGN_USER, full_name: `${MARK} Person`, phone: null, email: "foreign@example.com" }],
    owners: [{ id: "o-foreign", full_name: `${MARK} Owner` }],
    properties: [{ id: "p-foreign", address_line: `9 ${MARK} St`, suburb: `${MARK}ville`, postcode: "3000" }],
    jobs: [{ id: FOREIGN_JOB, job_number: "HV-9999", stage: "installation_booked", source: "website", channel: "hivic_sourced", qa_archived_at: null, deleted_at: null, updated_at: at, created_at: at, next_action: null, owner_id: "o-foreign", property_id: "p-foreign", electrician_choice: null, originating_installer_business_id: FOREIGN_BIZ, installation_completed_at: null }],
    job_assignments: [{ id: "a-foreign", job_id: FOREIGN_JOB, business_id: FOREIGN_BIZ, user_id: FOREIGN_USER, role: "installer", active: true }],
    bookings: [{ id: "b-foreign", job_id: FOREIGN_JOB, business_id: FOREIGN_BIZ, kind: "installation", status: "completed", scheduled_start: at, created_at: at }],
    partner_offers: [{ id: "po-foreign", job_id: FOREIGN_JOB, business_id: FOREIGN_BIZ, kind: "installer", status: "accepted", offered_at: at, responded_at: at, summary: { installer_pay_inc_gst: 1234 } }],
    partner_workers: [{ id: "w-foreign", business_id: FOREIGN_BIZ, full_legal_name: `${MARK} Worker`, trade_role: "installer", approval_status: "approved", profile_id: FOREIGN_USER, email: "foreign@example.com", mobile: null, certification: null, removed_at: null, licence_expires_on: null }],
    business_credentials: [{ id: "c-foreign", business_id: FOREIGN_BIZ, kind: "public_liability", label: `${MARK} cover`, expires_at: at, verification: null }],
    business_bank_details: [{ id: "bb-foreign", business_id: FOREIGN_BIZ, account_name: MARK, bsb: "999-999", account_number: "99999999" }],
    workflow_events: [{ id: "we-foreign", job_id: FOREIGN_JOB, event_type: "payout_marked_paid", created_at: at, details: { amount: 1234 } }],
  };
  for (const [table, add] of Object.entries(rows)) if (t[table]) t[table]!.push(...add);
}

/** Every trace of the other business in a screen's answer (empty = scoped). */
export function foreignTraces(out: unknown): string[] {
  const s = JSON.stringify(out) ?? "";
  return [FOREIGN_BIZ, FOREIGN_JOB, FOREIGN_USER, MARK, "HV-9999", "99999999"].filter((x) => s.includes(x));
}
