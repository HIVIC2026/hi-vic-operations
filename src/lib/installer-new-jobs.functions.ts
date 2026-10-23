// Office "New from installers" (Jo 23 Oct 2026). Read-only list of installer-brought jobs; nothing to tick off.
// Never changes stage, next step, quotes or sends.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";
import { A2_CORRECTION_EVENT, FLAG_EVENTS, FORM_CREATED_EVENTS, FORM_PROBLEM_EVENTS, FORM_STARTED_EVENTS, HELD_EVENTS, QUOTE_SENT_EVENTS, classifyNewInstallerJob, sortNewInstallerJobs, type NewJobFacts } from "./installer-new-jobs.core";

const EVENT_TYPES = [A2_CORRECTION_EVENT, ...FLAG_EVENTS, ...FORM_CREATED_EVENTS, ...FORM_PROBLEM_EVENTS, ...FORM_STARTED_EVENTS, ...HELD_EVENTS, ...QUOTE_SENT_EVENTS];

export const getNewInstallerJobs = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ showTestJobs: z.boolean().optional() }).optional().parse(d))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const readPage = (from: number) =>
      admin.from("jobs").select("id, job_number, created_at, source, stage, eligibility_outcome, originating_installer_business_id, owners(full_name), properties(address_line, suburb)")
        .eq("channel", "installer_sourced").is("deleted_at", null).is("qa_archived_at", null).not("stage", "in", "(cancelled,complete)")
        .order("id").range(from, from + 499);
    const jobs = [];
    for (let from = 0; ; from += 500) {
      const page = await readPage(from);
      if (page.error) throw new Error("Could not read installer jobs.");
      jobs.push(...(page.data ?? []));
      if (!page.data || page.data.length < 500) break;
    }
    if (!jobs.length) return { attention: [], fresh: [] };
    // Bulk lookups by job id are batched (50 ids per request, 4 at a time) so no URL grows unbounded.
    const batches: string[][] = [];
    for (let i = 0; i < jobs.length; i += 50) batches.push(jobs.slice(i, i + 50).map((j) => j.id));
    const parts = [];
    for (let i = 0; i < batches.length; i += 4) parts.push(...await Promise.all(batches.slice(i, i + 4).map(async (batch) => {
      const [events, forms, quotes, assigned] = await Promise.all([
        admin.from("workflow_events").select("job_id, event_type, created_at, summary, details").in("job_id", batch).in("event_type", EVENT_TYPES).order("created_at", { ascending: false }),
        admin.from("ceiling_measurements").select("job_id, external_id").in("job_id", batch).eq("is_current", true).eq("external_source", "mitti"),
        admin.from("quotes").select("job_id").in("job_id", batch).eq("kind", "installation"),
        admin.from("job_assignments").select("job_id, business_id").in("job_id", batch).eq("role", "installer").eq("active", true),
      ]);
      if (events.error || forms.error || quotes.error || assigned.error) throw new Error("New installer jobs could not be read.");
      return { events: events.data ?? [], forms: forms.data ?? [], quotes: quotes.data ?? [], assigned: assigned.data ?? [] };
    })));
    const events = parts.flatMap((p) => p.events), forms = parts.flatMap((p) => p.forms), quotes = parts.flatMap((p) => p.quotes), assigned = parts.flatMap((p) => p.assigned);
    const { data: businesses, error: be } = await admin.from("businesses").select("id, name, onboarding_notes");
    if (be) throw new Error("Installer names could not be read.");
    const { isTestPartner } = await import("./test-send.core");
    const byJob = new Map<string, NewJobFacts["events"]>();
    for (const e of events) {
      if (!e.job_id) continue;
      const list = byJob.get(e.job_id) ?? [];
      list.push({ type: e.event_type, at: e.created_at, summary: e.summary, details: e.details as Record<string, unknown> | null });
      byJob.set(e.job_id, list);
    }
    const quoted = new Set(quotes.map((q) => q.job_id));
    const now = new Date();
    const items = [];
    for (const j of jobs) {
      const owner = j.owners as { full_name: string | null } | null;
      const p = j.properties as { address_line: string | null; suburb: string | null } | null;
      const form = forms.find((f) => f.job_id === j.id);
      const bizId = assigned.find((a) => a.job_id === j.id)?.business_id ?? j.originating_installer_business_id;
      // Practice = qa_test OR a TEST partner's job (some Mitti pickups carry a live source); never mixed with live work.
      const practice = j.source === "qa_test" || isTestPartner(businesses?.find((b) => b.id === bizId));
      if (practice !== !!data?.showTestJobs) continue;
      const item = classifyNewInstallerJob({
        jobId: j.id, jobNumber: j.job_number, createdAt: j.created_at, source: j.source, stage: j.stage,
        owner: owner?.full_name ?? null, address: [p?.address_line, p?.suburb].filter(Boolean).join(", ") || null,
        installer: businesses?.find((b) => b.id === bizId)?.name ?? null, eligibility: j.eligibility_outcome,
        hasMittiForm: !!form?.external_id, mittiAuditId: form?.external_id ?? null, hasQuote: quoted.has(j.id),
        events: byJob.get(j.id) ?? [],
      }, now);
      if (item) items.push(item);
    }
    return sortNewInstallerJobs(items);
  });
