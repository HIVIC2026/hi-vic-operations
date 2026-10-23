import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";

/** Office signal: installer jobs whose owner quote is drafted and waiting, or held because something is missing. Read-only. */
export const getInstallerQuotesToCheck = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const readPage = (from: number) => admin.from("jobs").select("id, job_number, stage, originating_installer_business_id, owners(full_name), properties(address_line, suburb)")
      .is("deleted_at", null).not("stage", "in", "(cancelled,complete)").or("source.is.null,source.neq.qa_test").is("qa_archived_at", null).order("id").range(from, from + 499);
    const first = await readPage(0);
    if (first.error) throw new Error("Could not read installer jobs.");
    const jobs = [...(first.data ?? [])];
    if (jobs.length === 500) for (let from = 500; ; from += 500) {
      const page = await readPage(from);
      if (page.error) throw new Error("Could not read installer jobs.");
      jobs.push(...(page.data ?? []));
      if (!page.data || page.data.length < 500) break;
    }
    const ids = (jobs ?? []).map((j) => j.id);
    if (!ids.length) return { rows: [], waiting: [] };
    const batches = [];
    for (let from = 0; from < ids.length; from += 50) batches.push(ids.slice(from, from + 50));
    const parts = [];
    for (let from = 0; from < batches.length; from += 4) parts.push(...await Promise.all(batches.slice(from, from + 4).map(async batch => {
      const [quotes, held, assigned, basics] = await Promise.all([
        admin.from("quotes").select("id, job_id, status, sent_at, release_state, customer_total_inc_gst, created_at, release_hold_reason").in("job_id", batch).eq("kind", "installation").in("status", ["draft", "issued", "accepted"]),
        admin.from("workflow_events").select("job_id, created_at, details").in("job_id", batch).in("event_type", ["installer_quote_held", "ready_check_needs_office"]).order("created_at", { ascending: false }),
        admin.from("job_assignments").select("job_id, business_id").in("job_id", batch).eq("role", "installer").eq("active", true),
        admin.from("workflow_events").select("job_id, created_at, details").in("job_id", batch).eq("event_type", "ready_check_basics").order("created_at", { ascending: false }),
      ]);
      if (quotes.error || held.error || assigned.error || basics.error) throw new Error("Quotes to check could not be read.");
      return { quotes: quotes.data ?? [], held: held.data ?? [], assigned: assigned.data ?? [], basics: basics.data ?? [] };
    })));
    const quotes = parts.flatMap(p => p.quotes), held = parts.flatMap(p => p.held).sort((a,b) => b.created_at.localeCompare(a.created_at)), assigned = parts.flatMap(p => p.assigned), basicsEv = parts.flatMap(p => p.basics).sort((a,b) => b.created_at.localeCompare(a.created_at));
    const { data: businesses, error: be } = await admin.from("businesses").select("id, name");
    if (be) throw new Error("Installer names could not be read.");
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
      // Jo 23 Oct: every Ready Check comes here — a draft once the basics are in, otherwise exactly what is missing.
      const bEv = basicsEv.find((e) => e.job_id === j.id);
      const bd = bEv?.details as { missing?: string[]; stops?: string[]; notes?: string[]; ready?: boolean } | null;
      const notes = bd?.notes ?? [];
      if (draft) rows.push({ ...base, quoteId: draft.id, total: Number(draft.customer_total_inc_gst), reasons, notes, kind: reasons.length ? "missing" as const : "ready" as const, at: draft.created_at, note: reasons.join(" · ") || "Quote drafted — check it and send it to the owner" });
      else if (bEv && bd && !bd.ready) { const r2 = [...(bd.missing ?? []).map((m) => `Missing: ${m}`), ...(bd.stops ?? [])]; rows.push({ ...base, quoteId: null, total: null, reasons: r2, notes, kind: "missing" as const, at: bEv.created_at, note: r2.join(" · ") }); }
      else if (h) rows.push({ ...base, quoteId: null, total: null, reasons, notes, kind: "missing" as const, at: h.created_at, note: reasons.join(" · ") || "details missing" });
    }
    const { officeQuoteBlockers } = await import("./office-quote-review.server");
    const { WAITING_ON_INSTALLER } = await import("./installer-quote-approval.core");
    // Bound parallel readiness reads; each row and its opened draft use the same guards.
    for (let from = 0; from < rows.length; from += 10) await Promise.all(rows.slice(from, from + 10).map(async row => {
      const draft = (quotes ?? []).find(q => q.id === row.quoteId);
      if (!draft) return;
      const all = await officeQuoteBlockers(row.jobId, { ...draft, id: draft.id });
      (row as { waitingOnInstaller?: boolean }).waitingOnInstaller = all.includes(WAITING_ON_INSTALLER);
      row.reasons = all.filter((r) => r !== WAITING_ON_INSTALLER);
      row.kind = row.reasons.length ? "missing" : "ready";
      row.note = row.reasons.join(" · ") || "Quote drafted — check it and send it to the owner";
    }));
    rows.sort((a, b) => (a.kind === b.kind ? b.at.localeCompare(a.at) : a.kind === "ready" ? -1 : 1));
    // Jo 23 Oct: only installer-approved quotes are on the office list; the rest wait greyed under "Waiting on installer".
    const typed = rows as (typeof rows[number] & { waitingOnInstaller?: boolean })[];
    const { splitQuotesToCheck } = await import("./installer-quote-approval.core");
    const split = splitQuotesToCheck(typed);
    return { rows: split.ready, waiting: split.waiting };
  });
