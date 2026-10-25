// Decision 282 (Jo 25 Oct 2026): the one duplicate lookup every intake path uses (Add a job, Upload jobs, website,
// Add one job, Mitti pickup fallback). Reads properties at the same postcode (or suburb), then the pure rule decides;
// the flag is one internal workflow event on the EXISTING job, carrying where the request came from.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { extractPostcode, suburbFromLine, type AddressKeyInput } from "./address.core";
import { DUPLICATE_ADDRESS_EVENT, duplicateAddressSummary, openJobAtAddress, type AddressJobCandidate, type DuplicateAddressFrom } from "./duplicate-address.core";
import { logEvent } from "./workflow.server";

export type OpenAddressJob = { id: string; job_number: string; stage: string | null; property_id: string };
const CHECK_FAILED = "We couldn't check this address for an existing job. Please try again.";

/** The open job at this address, or null. `source` keeps practice (qa_test) and real jobs apart. */
export async function findOpenJobAtAddress(request: AddressKeyInput & { source: string | null }): Promise<OpenAddressJob | null> {
  // A one-line address ("5 Smith St, Bundoora VIC 3083") carries its own postcode.
  const postcode = String(request.postcode ?? "").match(/\d{4}/)?.[0] || extractPostcode(String(request.address_line ?? "")) || null;
  const suburb = request.suburb?.trim() || suburbFromLine(String(request.address_line ?? ""));
  if (!postcode && !suburb) return null;
  const propsQ = admin.from("properties").select("id, address_line, suburb, postcode");
  const { data: props, error: pe } = await (postcode ? propsQ.eq("postcode", postcode) : propsQ.ilike("suburb", suburb)).limit(2000);
  if (pe) throw new Error(CHECK_FAILED);
  const ids = (props ?? []).map((p) => p.id);
  if (!ids.length) return null;
  const { data: jobs, error: je } = await admin.from("jobs").select("id, job_number, stage, source, deleted_at, created_at, property_id").in("property_id", ids).limit(2000);
  if (je) throw new Error(CHECK_FAILED);
  const byProp = new Map((props ?? []).map((p) => [p.id, p]));
  const candidates: (AddressJobCandidate & { job_number: string; property_id: string })[] = (jobs ?? []).map((j) => {
    const p = byProp.get(j.property_id);
    return { id: j.id, job_number: j.job_number, stage: j.stage ?? null, source: j.source ?? null, deleted_at: j.deleted_at ?? null, created_at: j.created_at ?? null, property_id: j.property_id, address_line: p?.address_line ?? null, suburb: p?.suburb ?? null, postcode: p?.postcode ?? null };
  });
  const hit = openJobAtAddress(request, candidates);
  return hit ? { id: hit.id, job_number: hit.job_number, stage: hit.stage, property_id: hit.property_id } : null;
}

export type DuplicateRequest = { from: DuplicateAddressFrom; business_id?: string | null; business_name?: string | null; request_key?: string | null; full_name?: string | null; email?: string | null; phone?: string | null; address_line?: string | null; suburb?: string | null; postcode?: string | null };

/** ONE office flag per request (idempotent on `request_key`, e.g. a bulk row id); nothing is sent to anyone. */
export async function flagDuplicateAddress(existing: OpenAddressJob, actorId: string | null, req: DuplicateRequest): Promise<void> {
  if (req.request_key) {
    const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", existing.id).eq("event_type", DUPLICATE_ADDRESS_EVENT).contains("details", { request_key: req.request_key });
    if (count) return;
  }
  await logEvent(existing.id, actorId, DUPLICATE_ADDRESS_EVENT, duplicateAddressSummary(req.from, req.business_name ?? null), {
    from: req.from, business_id: req.business_id ?? null, business: req.business_name ?? null, request_key: req.request_key ?? null,
    request: { full_name: req.full_name ?? null, email: req.email ?? null, phone: req.phone ?? null, address_line: req.address_line ?? null, suburb: req.suburb ?? null, postcode: req.postcode ?? null },
    existing_job_number: existing.job_number, existing_stage: existing.stage, needs_office: true,
  }, { internal: true });
}

/** Business name for the flag wording (never shown to the installer). */
export async function businessNameFor(businessId: string | null | undefined): Promise<string | null> {
  if (!businessId) return null;
  const { data } = await admin.from("businesses").select("name").eq("id", businessId).maybeSingle();
  return data?.name ?? null;
}
