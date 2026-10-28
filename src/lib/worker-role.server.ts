// Jo 28 Oct 2026: Lead/Crew on partner people. Reads the effective role and applies a switch (one audit row, then Mitti).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { WorkflowError } from "./workflow.server";
import { WORKER_ROLE_EVENT, effectiveWorkerRole, hasMittiAccessToday, roleChangeSummary, type WorkerRole } from "./worker-role.core";

/** Effective Lead/Crew for each worker id (installers; electricians read as Lead). */
export async function workerRoleMap(workerIds: string[]): Promise<Map<string, WorkerRole>> {
  const out = new Map<string, WorkerRole>();
  if (!workerIds.length) return out;
  const { data: ws, error } = await admin.from("partner_workers").select("id, trade_role, worker_role, profile_id").in("id", workerIds);
  if (error) throw new WorkflowError(`Lead/Crew could not be read: ${error.message}`);
  const pids = (ws ?? []).map((w) => w.profile_id).filter((x): x is string => !!x);
  const [{ data: profs }, { data: recs }] = await Promise.all([
    pids.length ? admin.from("profiles").select("id, mitti_user_id").in("id", pids) : Promise.resolve({ data: [] as { id: string; mitti_user_id: string | null }[] }),
    // Only needed for blank roles; the latest Mitti record per worker.
    admin.from("admin_config_events").select("event_type, created_at, details").like("event_type", "mitti_%").order("created_at", { ascending: false }).limit(1000),
  ]);
  const { priorInviteFor, MITTI_INVITE_EVENTS } = await import("./mitti-invite.core");
  const types = Object.values(MITTI_INVITE_EVENTS) as string[];
  const records = (recs ?? []).filter((r) => types.includes(r.event_type)).map((r) => {
    const d = (r.details ?? {}) as Record<string, unknown>;
    return { workerId: typeof d["worker_id"] === "string" ? (d["worker_id"] as string) : "", type: r.event_type as never, at: r.created_at, mittiUserId: typeof d["mitti_user_id"] === "string" ? (d["mitti_user_id"] as string) : null, email: typeof d["email"] === "string" ? (d["email"] as string) : null };
  });
  for (const w of ws ?? []) {
    const access = hasMittiAccessToday({ profileMittiUserId: (profs ?? []).find((p) => p.id === w.profile_id)?.mitti_user_id ?? null, prior: priorInviteFor(w.id, records) });
    out.set(w.id, effectiveWorkerRole(w, access));
  }
  return out;
}

/** Switch one installer person to Lead or Crew. Caller has already checked admin / business_admin. */
export async function changeWorkerRole(workerId: string, to: WorkerRole, actorId: string) {
  const { data: w, error } = await admin.from("partner_workers").select("id, business_id, full_legal_name, trade_role, approval_status, removed_at").eq("id", workerId).maybeSingle();
  if (error || !w) throw new WorkflowError("Person not found.");
  if (w.trade_role !== "installer") throw new WorkflowError("Only installer people are Lead or Crew.");
  if (w.removed_at) throw new WorkflowError("This person has been removed.");
  const from = (await workerRoleMap([w.id])).get(w.id) ?? "crew";
  const { error: ue } = await admin.from("partner_workers").update({ worker_role: to }).eq("id", w.id);
  if (ue) throw new WorkflowError(`Lead/Crew could not be saved: ${ue.message}`);
  if (from === to) return { ok: true, from, to, changed: false };
  const { error: ee } = await admin.from("admin_config_events").insert({ actor_id: actorId, event_type: WORKER_ROLE_EVENT, summary: roleChangeSummary(w.full_legal_name, from, to), details: { worker_id: w.id, business_id: w.business_id, from, to } as Json });
  if (ee) throw new WorkflowError(`The change was saved but could not be recorded: ${ee.message}`);
  // Mitti never fails the switch (same as approval/removal).
  const m = await import("./mitti-invite.server");
  const mitti = await (to === "lead" ? (w.approval_status === "approved" ? m.onPartnerPersonApproved(w.id, actorId) : Promise.resolve({ action: "skip", reason: "Not approved yet." })) : m.onPartnerPersonDemoted(w.id, actorId))
    .catch((e: Error) => ({ action: "fail", reason: e.message }));
  return { ok: true, from, to, changed: true, mitti: (mitti as { action: string }).action };
}
