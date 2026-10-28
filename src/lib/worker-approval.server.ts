// Partner person (worker) login approval, shared by the office's Approve in Needs me (`decideWorker`) and decision 402
// (Jo 26 Oct 2026): approving/activating a business approves every pending person on it whose certification is already
// office-verified, in the same action. Pure selection rule in worker-auto-approve.core.ts.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { melbourneToday } from "./worker-compliance.core";
import { AUTO_APPROVE_DECISION, AUTO_APPROVE_SUMMARY, selectAutoApprove, type AutoApprovePerson } from "./worker-auto-approve.core";

export type ApproveHow = { kind: "office"; reason?: string | null } | { kind: "with_business"; businessId: string };

/**
 * Approve one person's login: the update, ONE `worker_approved` admin_config_events row, then the Mitti auto-invite hook
 * (decisions 188/331), which never fails the approval. `office` = exactly the office Approve (decideWorker).
 * `with_business` (decision 402) only moves a person who is still pending; returns false when nobody was moved.
 */
export async function approvePartnerWorker(workerId: string, actorId: string | null, how: ApproveHow): Promise<boolean> {
  const now = new Date().toISOString();
  const patch = { approval_status: "approved", approved_by: actorId, approved_at: now, rejection_reason: null };
  if (how.kind === "office") {
    const { error } = await admin.from("partner_workers").update(patch).eq("id", workerId);
    if (error) throw new Error(error.message);
    await admin.from("admin_config_events").insert({ actor_id: actorId, event_type: "worker_approved", summary: "Worker approved", details: { worker_id: workerId, reason: how.reason ?? null } });
  } else {
    const { data, error } = await admin.from("partner_workers").update(patch).eq("id", workerId).eq("approval_status", "pending").is("removed_at", null).select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) return false;
    await admin.from("admin_config_events").insert({ actor_id: actorId, event_type: "worker_approved", summary: AUTO_APPROVE_SUMMARY, details: { worker_id: workerId, reason: null, business_id: how.businessId, automatic: "business_approved", decision: AUTO_APPROVE_DECISION } });
  }
  // Decisions 188/331: approved partner person → Mitti access (env switch MITTI_AUTO_INVITE_ENABLED, off = no-op). Never fails the approval.
  await import("./mitti-invite.server").then((m) => m.onPartnerPersonApproved(workerId, actorId)).catch((e) => console.error("Mitti auto-invite skipped", (e as Error).message));
  return true;
}

type PersonRow = { id: string; full_legal_name: string; email: string | null; trade_role: string; approval_status: string; removed_at: string | null; certification_status: string | null };

/** Decision 153 facts: latest office CII check per person (by id or email) + the latest level/expiry recorded against it. Read-only. */
async function ciiFacts(people: PersonRow[]) {
  const out = new Map<string, AutoApprovePerson["cii"]>();
  const installers = people.filter((w) => w.trade_role === "installer");
  if (!installers.length) return out;
  // Jo 28 Oct: a person may have no email — match their checks by id only then.
  const { certOrFilter, sameWorkerEmail } = await import("./worker-role.core");
  const { data: certs, error } = await admin.from("partner_worker_certifications").select("id, worker_id, worker_email, status, recorded_at")
    .or(certOrFilter(installers)).order("recorded_at", { ascending: false });
  if (error) throw new Error(`Could not read CII checks: ${error.message}`);
  const ids = (certs ?? []).map((c) => c.id);
  const { data: levels, error: le } = ids.length ? await admin.from("worker_certification_levels").select("certification_id, level, expires_on, recorded_at").in("certification_id", ids).order("recorded_at", { ascending: false }) : { data: [], error: null };
  if (le) throw new Error(`Could not read CII levels: ${le.message}`);
  for (const w of installers) {
    const c = (certs ?? []).find((r) => r.worker_id === w.id || sameWorkerEmail(w.email, r.worker_email)) ?? null;
    const l = c ? (levels ?? []).find((r) => r.certification_id === c.id) ?? null : null;
    out.set(w.id, c ? { certStatus: c.status, level: l?.level ?? null, expiresOn: l?.expires_on ?? null } : null);
  }
  return out;
}

export type AutoApproveResult = {
  businessId: string;
  businessApproved: boolean;
  approved: { id: string; name: string; role: string }[];
  left: { id: string; name: string; role: string; approval: string; reason: string }[];
  errors: string[];
};

/**
 * Decision 402: approve every PENDING person on an APPROVED business whose certification is office-verified (rules:
 * worker-auto-approve.core). Rejected / removed / unverified people and all electricians are left as they are.
 * Never throws: anything that goes wrong is logged and returned in `errors`, so it never fails the business approval.
 * `dryRun` reads and reports only. Also run once for an already-approved business by scripts/approve-verified-people.ts.
 */
export async function autoApproveVerifiedPeople(businessId: string, actorId: string | null, opts: { dryRun?: boolean; today?: string } = {}): Promise<AutoApproveResult> {
  const res: AutoApproveResult = { businessId, businessApproved: false, approved: [], left: [], errors: [] };
  try {
    const { data: biz, error: be } = await admin.from("businesses").select("id, onboarding_status").eq("id", businessId).maybeSingle();
    if (be) throw new Error(`Could not read the business: ${be.message}`);
    if (biz?.onboarding_status !== "approved") { res.errors.push("The business is not approved; nobody was approved."); return res; }
    res.businessApproved = true;
    const { data: rows, error } = await admin.from("partner_workers").select("id, full_legal_name, email, trade_role, approval_status, removed_at, certification_status").eq("business_id", businessId).order("created_at");
    if (error) throw new Error(`Could not read the people: ${error.message}`);
    const people = (rows ?? []) as PersonRow[];
    const facts = await ciiFacts(people);
    const { approve, left } = selectAutoApprove(people.map((p) => ({ ...p, cii: facts.get(p.id) ?? null })), opts.today ?? melbourneToday());
    for (const { person: p, reason } of left) res.left.push({ id: p.id, name: p.full_legal_name, role: p.trade_role, approval: p.approval_status, reason });
    for (const p of approve) {
      const who = { id: p.id, name: p.full_legal_name, role: p.trade_role };
      if (opts.dryRun) { res.approved.push(who); continue; }
      try {
        if (await approvePartnerWorker(p.id, actorId, { kind: "with_business", businessId })) res.approved.push(who);
        else res.left.push({ ...who, approval: p.approval_status, reason: "Changed by someone else just now; left as is." });
      } catch (e) {
        res.errors.push(`${p.full_legal_name}: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    res.errors.push((e as Error).message);
  }
  if (res.errors.length) console.error(`Decision 402 auto-approval for business ${businessId}:`, res.errors.join(" | "));
  return res;
}
