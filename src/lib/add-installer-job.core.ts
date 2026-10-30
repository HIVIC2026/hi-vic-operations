// A6 (installer pages part 1, Jo 29 Oct 2026): the payload for `public.add_installer_job`, the one-transaction Add a job
// save keyed by the phone's request key (docs/pending-migrations/add-installer-job-atomic.sql). Pure.
import type { ElectricianChoiceRecord } from "./electrician-choice.core";
import type { LeadOrigin } from "./onsite-ready-check.core";

export type AddInstallerJobPayload = {
  request_key: string;
  business_id: string;
  user_id: string;
  source: string;
  owner: { full_name: string; email: string; phone: string };
  property: { address_line: string; suburb: string; postcode: string };
  consent: { key: "owner_ticked" | "installer_confirmed"; by: "owner" | "installer"; text: string; sha256: string };
  electrician_choice: ElectricianChoiceRecord;
  lead_origin: LeadOrigin;
  visit_requested: boolean;
  /** A2: the internal `duplicate_address_linked` flag written on the NEW job when the address is an open HIV lead. */
  flag_event: { summary: string; details: Record<string, unknown> } | null;
};

export type AddInstallerJobInput = {
  requestKey: string; businessId: string; userId: string; source: string;
  owner: AddInstallerJobPayload["owner"]; property: AddInstallerJobPayload["property"]; consent: AddInstallerJobPayload["consent"];
  electricianChoice: ElectricianChoiceRecord; leadOrigin: LeadOrigin; visitRequested: boolean; flagEvent: AddInstallerJobPayload["flag_event"];
};

/** Same trimming as the step-by-step save: names, phone and address trimmed, email trimmed and lower-cased. */
export function addInstallerJobPayload(i: AddInstallerJobInput): AddInstallerJobPayload {
  return {
    request_key: i.requestKey, business_id: i.businessId, user_id: i.userId, source: i.source,
    owner: { full_name: i.owner.full_name.trim(), email: i.owner.email.trim().toLowerCase(), phone: i.owner.phone.trim() },
    property: { address_line: i.property.address_line.trim(), suburb: i.property.suburb.trim(), postcode: i.property.postcode.trim() },
    consent: i.consent, electrician_choice: i.electricianChoice, lead_origin: i.leadOrigin, visit_requested: i.visitRequested, flag_event: i.flagEvent,
  };
}
