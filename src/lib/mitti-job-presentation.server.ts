import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { approvalCardLine } from "./installer-quote-approval.core";
import { needsFinishingTask, jobCardLine } from "./trade-view.core";

/** Presentation only; reads the linked form and existing next-action/approval rules. */
export async function mittiJobPresentation(jobId: string, userId: string) {
  const c = await (await import("./trade-view.server")).requireTradeJob(userId, jobId);
  const [{ data: m, error: me }, { data: j, error: je }, { data: e, error: ee }] = await Promise.all([
    admin.from("ceiling_measurements").select("external_source,external_id").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
    admin.from("jobs").select("next_action").eq("id", jobId).single(),
    admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "mitti_electrician_recorded").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (me || je || ee) throw new Error("Ready Check details could not load.");
  if (m?.external_source !== "mitti" || !m.external_id) return { applies: false as const };
  const a = await (await import("./installer-quote-approval.server")).loadQuoteApproval(jobId);
  const f = (await (await import("./job-status.server")).statusFactsFor(c, [jobId])).get(jobId);
  const next = a.applies ? approvalCardLine(a.state, a.sent)
    : needsFinishingTask(j?.next_action ?? "") ?? (f ? jobCardLine((await import("./job-status.server")).statusView(c, f)) : "You: finish the Ready Check in Mitti");
  const electrical = e?.details as unknown as import("./usual-electrician.core").MittiElectricianResolution | null;
  const electrician = electrical?.choice === "hivic" ? "Home Insulation Victoria electrician"
    : electrical?.name ? `${electrical.choice === "usual" ? "My usual electrician" : "A different electrician"} · ${electrical.name}${electrical.licence ? ` · ${electrical.licence}` : ""}${electrical.priceIncGst != null ? ` · $${electrical.priceIncGst.toFixed(2)} inc GST` : ""}` : "Not answered in Mitti yet";
  return { applies: true as const, auditId: m.external_id, next, electrician };
}