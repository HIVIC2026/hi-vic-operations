// Public, no-login: the owner's page to pick their full address (my-address/<token>). The token is their estimate-link
// token and the only credential. Resolving it has none of the estimate page's side effects (no Gate 1, no view count).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withRequestMeta } from "./request-meta";

/** The job behind a usable owner link, or null (bad / unknown / expired / revoked link, or a deleted job). */
async function jobIdForAddressToken(token: string): Promise<string | null> {
  const { LINK_PURPOSE, isWellFormedToken, linkUsable } = await import("./estimatelink.core");
  if (!isWellFormedToken(token)) return null;
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const { data: l } = await admin.from("customer_estimate_links").select("job_id, status, expires_at").eq("token", token).eq("purpose", LINK_PURPOSE).maybeSingle();
  if (!l || !linkUsable(l)) return null;
  const { jobDeletedBlocker } = await import("./job-live.server");
  if (await jobDeletedBlocker(l.job_id)) return null;
  return l.job_id;
}

/** The job's existing owner name (saveEnquiryDetails needs it; never taken from the page). */
async function ownerFullName(jobId: string): Promise<string> {
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const { data: job } = await admin.from("jobs").select("owners(full_name)").eq("id", jobId).maybeSingle();
  return (job?.owners as { full_name?: string | null } | null)?.full_name ?? "";
}

/** answered: the owner already gave it. open: this job is really waiting for the owner's address (a website/email
 *  enquiry since go-live with no street). Anything else is unavailable, so a link holder can never change the address of
 *  a job that isn't asking for it. */
async function addressRequestStatus(jobId: string): Promise<"answered" | "open" | "unavailable"> {
  const { loadAddressRequestFacts } = await import("./address-request.server");
  const { addressRequestOpen } = await import("./address-request.core");
  const facts = await loadAddressRequestFacts(jobId);
  if (!facts) return "unavailable";
  if (facts.answeredAt) return "answered";
  return addressRequestOpen(facts) ? "open" : "unavailable";
}

export type OwnerAddressState = { state: "open" | "answered" | "unavailable" };
export type SaveOwnerAddressResult = { ok: true } | { ok: false; error: string };

/** What the page shows on load: the search, the thank-you, or the unavailable message. */
export const getOwnerAddressState = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token: z.string().max(200) }).parse(d))
  .handler(async ({ data }): Promise<OwnerAddressState> => {
    const jobId = await jobIdForAddressToken(data.token);
    if (!jobId) return { state: "unavailable" };
    return { state: await addressRequestStatus(jobId) };
  });

export const searchOwnerAddress = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token: z.string().max(200), query: z.string().max(200) }).parse(d))
  .handler(async ({ data }) => {
    const { LINK_UNAVAILABLE } = await import("./estimatelink.core");
    if (!(await jobIdForAddressToken(data.token))) throw new Error(LINK_UNAVAILABLE);
    const query = data.query.trim();
    if (query.length < 3) return [];
    const { searchAddressSuggestions } = await import("./address-lookup.server");
    return searchAddressSuggestions(query);
  });

export const saveOwnerAddress = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token: z.string().max(200), placeId: z.string().min(1).max(600) }).parse(d))
  .handler(async ({ data }): Promise<SaveOwnerAddressResult> => {
    const { LINK_UNAVAILABLE } = await import("./estimatelink.core");
    const jobId = await jobIdForAddressToken(data.token);
    if (!jobId) return { ok: false, error: LINK_UNAVAILABLE };
    const status = await addressRequestStatus(jobId);
    if (status === "answered") return { ok: true };
    if (status !== "open") return { ok: false, error: LINK_UNAVAILABLE };
    const { lookupAddressDetails } = await import("./address-lookup.server");
    const place = await lookupAddressDetails(data.placeId);
    if (!place) return { ok: false, error: "We couldn't find that address. Please try again." };
    const fullName = await ownerFullName(jobId);
    const { ADDRESS_REQUEST_ANSWERED_EVENT } = await import("./address-request.core");
    const { WorkflowError } = await import("./workflow.server");
    const { saveEnquiryDetails } = await import("./office-actions.server");
    try {
      await saveEnquiryDetails(jobId, null, { fullName, street: place.street ?? "", suburb: place.suburb ?? "", postcode: place.postcode ?? "" },
        { type: ADDRESS_REQUEST_ANSWERED_EVENT, summary: "Owner gave their full address" });
    } catch (e) {
      if (e instanceof WorkflowError) return { ok: false, error: e.message };
      throw e;
    }
    return { ok: true };
  });
