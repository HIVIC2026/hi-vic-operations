// Persistence for 3-instalment plans. The service client is used only after the caller is verified
// (office via requireAdmin, owner via is_job_owner). Never sends messages, calls Xero, or moves stage.
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { currentApprovedQuote, logEvent, WorkflowError } from "./workflow.server";
import { paymentRouteFor } from "./payment-gate.core";
import {
  applyPlanAction,
  planChecklist,
  proposeBlocker,
  OWNER_PLAN_TERMS_VERSION,
  type PlanAction,
  type PlanRow,
} from "./instalment-plan.core";

const admin = supabaseAdmin as unknown as SupabaseClient;
const COLS =
  "id, job_id, quote_id, invoice_id, status, instalment_count, office_approved_at, office_approved_by, owner_accepted_at, owner_accepted_by, first_instalment_amount, first_instalment_verified_at, collection_arrangement, collection_recorded_at, status_reason, created_at, updated_at";

async function facts(jobId: string) {
  const [{ data: job }, quote] = await Promise.all([
    admin.from("jobs").select("channel").eq("id", jobId).maybeSingle(),
    currentApprovedQuote(jobId),
  ]);
  if (!job) throw new WorkflowError("Job not found");
  const { data: inv } = quote
    ? await admin
        .from("invoices")
        .select("id, quote_id, total_inc_gst")
        .eq("quote_id", quote.id)
        .maybeSingle()
    : { data: null };
  return {
    route: paymentRouteFor(job.channel as string),
    quote,
    invoice: inv as { id: string; quote_id: string; total_inc_gst: number } | null,
  };
}

async function plans(jobId: string): Promise<(PlanRow & { created_at: string })[]> {
  const { data, error } = await admin
    .from("instalment_plans")
    .select(COLS)
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as never;
}

export async function assertOwner(jobId: string, userId: string) {
  const { data } = await admin.rpc("is_job_owner", { _job: jobId, _user: userId });
  if (!data) throw new WorkflowError("Not your job.");
}

export async function officeView(jobId: string) {
  const [f, list] = await Promise.all([facts(jobId), plans(jobId)]);
  const open = list.find((p) => p.status === "proposed" || p.status === "active") ?? null;
  return {
    route: f.route,
    currentQuote: f.quote,
    invoice: f.invoice,
    proposeBlocker: proposeBlocker({
      route: f.route,
      currentQuoteId: f.quote?.id ?? null,
      invoiceQuoteId: f.invoice?.quote_id ?? null,
      openPlanExists: !!open,
    }),
    plans: list.map((p) => ({ ...p, checklist: planChecklist(p, f.quote?.id ?? null) })),
  };
}

/** Owner sees only the open plan on their own job, with no office actor ids. */
export async function ownerView(jobId: string) {
  const [f, list] = await Promise.all([facts(jobId), plans(jobId)]);
  const p = list.find((x) => x.status === "proposed" || x.status === "active");
  if (!p || f.route !== "hiv_lead") return null;
  return {
    id: p.id,
    status: p.status,
    officeApproved: !!p.office_approved_at,
    ownerAcceptedAt: p.owner_accepted_at,
    forCurrentQuote: p.quote_id === f.quote?.id,
    total: f.quote?.customer_total_inc_gst ?? null,
  };
}

export async function proposePlan(jobId: string, actorId: string) {
  const [f, list] = await Promise.all([facts(jobId), plans(jobId)]);
  const open = list.some((p) => p.status === "proposed" || p.status === "active");
  const b = proposeBlocker({
    route: f.route,
    currentQuoteId: f.quote?.id ?? null,
    invoiceQuoteId: f.invoice?.quote_id ?? null,
    openPlanExists: open,
  });
  if (b) throw new WorkflowError(b);
  const { data, error } = await admin
    .from("instalment_plans")
    .insert({
      job_id: jobId,
      quote_id: f.quote!.id,
      invoice_id: f.invoice!.id,
      status: "proposed",
      instalment_count: 3,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await logEvent(
    jobId,
    actorId,
    "instalment_plan_proposed",
    "3-instalment plan proposed (does not clear the payment gate).",
    { plan_id: data.id, quote_id: f.quote!.id },
    { internal: true },
  );
  return { id: data.id as string };
}

export async function actOnPlan(
  planId: string,
  action: PlanAction,
  actorId: string,
  asOwner: boolean,
) {
  const { data: row, error } = await admin
    .from("instalment_plans")
    .select(COLS)
    .eq("id", planId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new WorkflowError("Plan not found");
  const plan = row as unknown as PlanRow;
  if (asOwner) {
    if (action.kind !== "owner_accept")
      throw new WorkflowError("Owners can only accept plan terms.");
    await assertOwner(plan.job_id, actorId);
    if (!plan.office_approved_at)
      throw new WorkflowError("This plan is not yet available to accept.");
  } else if (action.kind === "owner_accept") {
    throw new WorkflowError("Only the owner can accept the plan terms.");
  }
  const f = await facts(plan.job_id);
  const res = applyPlanAction(plan, action, {
    route: f.route,
    currentQuoteId: f.quote?.id ?? null,
    now: new Date().toISOString(),
    actorId,
  });
  if (!res.ok) throw new WorkflowError(res.error);
  const { error: uerr } = await admin
    .from("instalment_plans")
    .update({ ...res.patch, updated_at: new Date().toISOString() })
    .eq("id", planId)
    .eq("status", plan.status);
  if (uerr) throw new Error(uerr.message);
  await logEvent(
    plan.job_id,
    actorId,
    `instalment_plan_${action.kind === "mark" ? action.status : action.kind}`,
    `Instalment plan: ${action.kind === "mark" ? `marked ${action.status}` : action.kind.replace(/_/g, " ")}${res.patch.status === "active" ? " – all conditions met, plan active" : ""}.`,
    {
      plan_id: planId,
      ...res.patch,
      ...(action.kind === "owner_accept" ? { terms_version: OWNER_PLAN_TERMS_VERSION } : {}),
    },
    { internal: !asOwner },
  );
  return { status: (res.patch.status ?? plan.status) as string };
}
