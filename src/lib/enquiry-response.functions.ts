// Communications overview of enquiry responses. Uses the SAME open-website-enquiry scope and response semantics as the
// main Enquiries page (office_enquiry_page / office_enquiry_index, 0208): exact server-side counts (no 1000-row
// truncation, one category per enquiry, so one email in two logs is never double counted) and a 50-row page of
// genuinely unanswered enquiries. Read failures throw — the UI shows "unavailable", never zero.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "@/lib/workflow.server";
import type { ResponseCounts } from "./enquiry-response.core";

export type EnquiryOverviewRow = {
  id: string; jobNumber: string | null; createdAt: string | null;
  ownerName: string | null; address: string | null; eligibilityOutcome: string | null;
  /** Status of the most recent attempt by timestamp (null = never attempted). */
  latestAttemptStatus: string | null; latestAttemptAt: string | null;
  hasEmail: boolean;
  /** True when a send would actually go out now (same rules the dispatch action applies). */
  dispatchReady: boolean;
};
export type EnquiryResponseOverview = {
  /** Open website enquiries (the main Enquiries "All" scope). */
  total: number;
  responses: ResponseCounts;
  /** Ready to send now. `null` = the check could not be read (nothing is sendable then). */
  dispatchReady: number | null;
  awaiting: EnquiryOverviewRow[];
  page: number; totalPages: number;
  loadedAt: string;
};

export const getEnquiryResponseOverview = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ page: z.number().int().min(1).default(1) }).parse(d ?? {}))
  .handler(async ({ context, data }): Promise<EnquiryResponseOverview> => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { parseResponseCounts } = await import("./enquiry-response.core");
    const { data: raw, error } = await admin.rpc("office_enquiry_page", { p_view: "new", p_search: "", p_page: data.page });
    if (error) throw new Error(`Enquiry responses could not be loaded: ${error.message}`);
    const r = raw as unknown as { ids?: string[]; page?: number; totalPages?: number; counts?: { all?: number }; responses?: unknown };
    const responses = parseResponseCounts(r?.responses);
    if (!responses || !Array.isArray(r.ids) || typeof r.counts?.all !== "number") throw new Error("Enquiry response counts are unavailable.");
    const ids = r.ids;
    const [facts, readyIds] = await Promise.all([
      ids.length ? admin.from("office_enquiry_index").select("id, job_number, created_at, owner_name, owner_email, property_address, eligibility_outcome, latest_attempt_status, latest_attempt_at").in("id", ids) : Promise.resolve({ data: [], error: null }),
      (async () => { const d = await import("./enquiry-dispatch.server"); return d.sendableFrom(await d.candidateJobIds()); })().catch(() => null as string[] | null),
    ]);
    if (facts.error) throw new Error("Enquiry response rows could not be loaded.");
    // Ready-to-send is reported only inside the same unanswered scope (a correspondence-only reply is not "ready").
    let ready = new Set<string>(), readyCount: number | null = null;
    if (readyIds) {
      const scoped = readyIds.length ? await admin.from("office_enquiry_index").select("id").in("id", readyIds).eq("needs_first_response", true).eq("office_bucket", "enquiry") : { data: [], error: null };
      if (!scoped.error) { ready = new Set((scoped.data ?? []).flatMap((x) => (x.id ? [x.id] : []))); readyCount = ready.size; }
    }
    const byId = new Map((facts.data ?? []).map((f) => [f.id, f]));
    const awaiting = ids.flatMap((id) => {
      const f = byId.get(id);
      return f ? [{ id, jobNumber: f.job_number, createdAt: f.created_at, ownerName: f.owner_name, address: f.property_address, eligibilityOutcome: f.eligibility_outcome,
        latestAttemptStatus: f.latest_attempt_status, latestAttemptAt: f.latest_attempt_at, hasEmail: !!f.owner_email?.trim(), dispatchReady: ready.has(id) }] : [];
    });
    return { total: r.counts.all, responses, dispatchReady: readyCount, awaiting, page: r.page ?? data.page, totalPages: r.totalPages ?? 1, loadedAt: new Date().toISOString() };
  });
