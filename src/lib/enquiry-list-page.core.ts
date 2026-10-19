/**
 * Client-safe constants for the enquiries workspace. The loader in enquiry-groups.server.ts imports
 * these too, so the tile row, the URL whitelist and the server-side view filter cannot drift apart.
 */
import { STATUS_ORDER, type EnquiryStatus } from "./enquiry-groups.core";

export type EnquiryPageView = EnquiryStatus | "all" | "new" | "photos" | "removed";

/** Every tile the enquiries workspace offers, in display order. Routes whitelist against this. */
export const ENQUIRY_VIEWS: EnquiryPageView[] = ["all", "new", ...STATUS_ORDER, "photos", "removed"];

export const ENQUIRY_VIEW_KEYS = ENQUIRY_VIEWS as string[];

export const ENQUIRY_SORT_KEYS = ["created_at", "job_number", "eligibility_set_at"] as const;
export type EnquirySortKey = (typeof ENQUIRY_SORT_KEYS)[number];
export const ENQUIRY_SORT_LABEL: Record<EnquirySortKey, string> = {
  created_at: "Received",
  job_number: "Job number",
  eligibility_set_at: "Outcome decided",
};

/** Whitelisted search columns — exactly what the office can see in an enquiry row. */
export const ENQUIRY_SEARCH_COLUMNS = [
  "job_number",
  "external_enquiry_id",
  "owners.full_name",
  "owners.email",
  "owners.phone",
  "properties.address_line",
  "properties.suburb",
  "properties.postcode",
] as const;
