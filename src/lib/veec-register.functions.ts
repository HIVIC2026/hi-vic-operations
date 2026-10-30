import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";

export type VeecRow = {
  jobId: string; jobNumber: string | null; address: string | null; owner: string | null; stage: string | null;
  bucket: "lodged" | "outstanding" | "pending_acceptance" | "potential"; veecs: number | null; discount: number | null; basis: string;
  paid: "paid" | "part_paid" | "unpaid" | "no_invoice"; lodgementStatus: string | null;
  quoteState: "accepted" | "issued" | "none";
};

const CLOSED = ["cancelled", "on_hold"];

/** Read-only VEEC register. VEEC counts are estimates (discount ÷ VEEC value) until a lodgement quantity is recorded. */
export const getVeecRegister = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await requireAdmin(context.supabase);
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const [jobs, est, quotes, inv, lodg] = await Promise.all([
    admin.from("job_overview").select("id,job_number,property_address,owner_name,stage,source,eligibility_outcome"),
    admin.from("indicative_estimates").select("job_id,veec_value,applied_discount,created_at,superseded_at").is("superseded_at", null),
    admin.from("quotes").select("job_id,status,veec_discount_inc_gst,kind,created_at").eq("kind", "installation"),
    admin.from("invoice_status").select("job_id,total_inc_gst,total_paid,effective_status,created_at").eq("kind", "installation").order("created_at", { ascending: false }),
    admin.from("veec_lodgements").select("job_id,quantity,status"),
  ]);
  for (const r of [jobs, est, quotes, inv, lodg]) if (r.error) throw new Error(`VEEC register could not be loaded: ${r.error.message}`);
  const rows: VeecRow[] = [];
  for (const j of jobs.data ?? []) {
    if (!j.id || j.source === "qa_test" || CLOSED.includes(j.stage ?? "") || j.eligibility_outcome === "does_not_appear_eligible") continue;
    const e = (est.data ?? []).filter((x) => x.job_id === j.id).sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0];
    const qs = (quotes.data ?? []).filter((x) => x.job_id === j.id);
    const accepted = qs.find((x) => x.status === "accepted");
    const issued = qs.filter((x) => x.status === "issued").sort((a, b) => (b.veec_discount_inc_gst ?? 0) - (a.veec_discount_inc_gst ?? 0))[0];
    const l = (lodg.data ?? []).find((x) => x.job_id === j.id);
    const i = (inv.data ?? []).find((x) => x.job_id === j.id);
    const value = Number(e?.veec_value) || null;
    const q = accepted ?? issued;
    const discount = q ? Number(q.veec_discount_inc_gst) : e ? Number(e.applied_discount) : null;
    const lodgedQty = l && l.status !== "not_submitted" && l.quantity != null ? Number(l.quantity) : null;
    const veecs = lodgedQty ?? (discount != null && value ? Math.round((discount / value) * 100) / 100 : null);
    const quoteState: VeecRow["quoteState"] = accepted ? "accepted" : issued ? "issued" : "none";
    const bucket: VeecRow["bucket"] = lodgedQty != null || j.stage === "complete" ? "lodged" : accepted ? "outstanding" : issued ? "pending_acceptance" : "potential";
    const paid: VeecRow["paid"] = !i ? "no_invoice" : Number(i.total_paid) >= Number(i.total_inc_gst) && Number(i.total_inc_gst) > 0 ? "paid" : Number(i.total_paid) > 0 ? "part_paid" : "unpaid";
    rows.push({ jobId: j.id, jobNumber: j.job_number, address: j.property_address, owner: j.owner_name, stage: j.stage, bucket, veecs, discount, basis: lodgedQty != null ? "Lodged quantity" : accepted ? "Accepted quote" : issued ? "Issued quote" : e ? "Preliminary estimate" : "No estimate yet", paid, lodgementStatus: l?.status ?? null, quoteState });
  }
  return rows;
});
