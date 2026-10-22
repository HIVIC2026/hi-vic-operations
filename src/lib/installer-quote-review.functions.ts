import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";

/** Office signal: installer jobs whose owner quote is drafted and waiting, or held because something is missing. Read-only. */
export const getInstallerQuotesToCheck = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: jobs, error } = await admin.from("jobs").select("id, job_number, stage, owners(full_name), properties(address_line, suburb)")
      .eq("channel", "installer_sourced").is("deleted_at", null).not("stage", "in", "(cancelled,complete)").limit(500);
    if (error) throw new Error("Could not read installer jobs.");
    const ids = (jobs ?? []).map((j) => j.id);
    if (!ids.length) return { rows: [] };
    const [{ data: quotes }, { data: held }] = await Promise.all([
      admin.from("quotes").select("job_id, status, created_at, release_hold_reason").in("job_id", ids).eq("kind", "installation").in("status", ["draft", "issued", "accepted"]),
      admin.from("workflow_events").select("job_id, created_at, details").in("job_id", ids).eq("event_type", "installer_quote_held").order("created_at", { ascending: false }),
    ]);
    const rows = [];
    for (const j of jobs ?? []) {
      const qs = (quotes ?? []).filter((q) => q.job_id === j.id);
      if (qs.some((q) => q.status !== "draft")) continue; // already sent or accepted
      const draft = qs.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      const h = (held ?? []).find((e) => e.job_id === j.id);
      const owner = j.owners as { full_name: string | null } | null;
      const p = j.properties as { address_line: string | null; suburb: string | null } | null;
      const base = { jobId: j.id, jobNumber: j.job_number, owner: owner?.full_name ?? null, address: [p?.address_line, p?.suburb].filter(Boolean).join(", ") || null };
      if (draft) rows.push({ ...base, kind: "ready" as const, at: draft.created_at, note: "Quote drafted — check it and send it to the owner" });
      else if (h) rows.push({ ...base, kind: "missing" as const, at: h.created_at, note: `Quote can't be drafted yet: ${(((h.details as { blockers?: string[] } | null)?.blockers) ?? []).join(" · ") || "details missing"}` });
    }
    rows.sort((a, b) => (a.kind === b.kind ? b.at.localeCompare(a.at) : a.kind === "ready" ? -1 : 1));
    return { rows };
  });
