import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";

/** Office signal: installer jobs whose owner quote is drafted and waiting, or held because something is missing. Read-only. */
export const getInstallerQuotesToCheck = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: jobs, error } = await admin.from("jobs").select("id, job_number, stage, originating_installer_business_id, owners(full_name), properties(address_line, suburb)")
      .is("deleted_at", null).not("stage", "in", "(cancelled,complete)").or("source.is.null,source.neq.qa_test").is("qa_archived_at", null).limit(2000);
    if (error) throw new Error("Could not read installer jobs.");
    const ids = (jobs ?? []).map((j) => j.id);
    if (!ids.length) return { rows: [] };
    const [{ data: quotes, error: qe }, { data: held, error: he }, { data: assigned, error: ae }, { data: businesses, error: be }] = await Promise.all([
      admin.from("quotes").select("id, job_id, status, sent_at, release_state, customer_total_inc_gst, created_at, release_hold_reason").in("job_id", ids).eq("kind", "installation").in("status", ["draft", "issued", "accepted"]),
      admin.from("workflow_events").select("job_id, created_at, details").in("job_id", ids).in("event_type", ["installer_quote_held", "ready_check_needs_office"]).order("created_at", { ascending: false }),
      admin.from("job_assignments").select("job_id, business_id").in("job_id", ids).eq("role", "installer").eq("active", true),
      admin.from("businesses").select("id, name"),
    ]);
    if (qe || he || ae || be) throw new Error("Quotes to check could not be read.");
    const { quoteNeedsOfficeReview, quoteReviewReasons } = await import("./office-quote-review.core");
    const rows = [];
    for (const j of jobs ?? []) {
      const qs = (quotes ?? []).filter((q) => q.job_id === j.id);
      if (qs.some((q) => !quoteNeedsOfficeReview(q))) continue;
      const draft = qs.filter(quoteNeedsOfficeReview).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      const h = (held ?? []).find((e) => e.job_id === j.id);
      const owner = j.owners as { full_name: string | null } | null;
      const p = j.properties as { address_line: string | null; suburb: string | null } | null;
      const bizId = assigned?.find(a => a.job_id === j.id)?.business_id ?? j.originating_installer_business_id;
      const base = { jobId: j.id, jobNumber: j.job_number, owner: owner?.full_name ?? null, address: [p?.address_line, p?.suburb].filter(Boolean).join(", ") || null, installer: businesses?.find(b => b.id === bizId)?.name ?? null };
      const details = h?.details as { blockers?: string[]; reasons?: string[] } | null;
      const reasons = quoteReviewReasons(draft?.release_hold_reason, h ? { at: h.created_at, reasons: details?.blockers ?? details?.reasons ?? [] } : null, draft?.created_at ?? null);
      if (draft) rows.push({ ...base, quoteId: draft.id, total: Number(draft.customer_total_inc_gst), reasons, kind: reasons.length ? "missing" as const : "ready" as const, at: draft.created_at, note: reasons.join(" · ") || "Quote drafted — check it and send it to the owner" });
      else if (h) rows.push({ ...base, quoteId: null, total: null, reasons, kind: "missing" as const, at: h.created_at, note: reasons.join(" · ") || "details missing" });
    }
    rows.sort((a, b) => (a.kind === b.kind ? b.at.localeCompare(a.at) : a.kind === "ready" ? -1 : 1));
    const { officeQuoteBlockers } = await import("./office-quote-review.server");
    // Bound parallel readiness reads; each row and its opened draft use the same guards.
    for (let from = 0; from < rows.length; from += 10) await Promise.all(rows.slice(from, from + 10).map(async row => {
      const draft = (quotes ?? []).find(q => q.id === row.quoteId);
      if (!draft) return;
      row.reasons = await officeQuoteBlockers(row.jobId, { ...draft, id: draft.id });
      row.kind = row.reasons.length ? "missing" : "ready";
      row.note = row.reasons.join(" · ") || "Quote drafted — check it and send it to the owner";
    }));
    return { rows };
  });
