// 3-instalment payment plan: pure rules for office/owner actions. No database, no sending, no Xero calls.
// Whether a plan clears the payment-option gate is decided ONLY by instalmentPlanActive (payment-gate.core.ts).
import { instalmentPlanActive, type PaymentRoute } from "./payment-gate.core";

export const OWNER_PLAN_TITLE = "Payment plan agreement";
export const OWNER_PLAN_INTRO =
  "You are choosing to pay your confirmed Home Insulation Victoria insulation quote in 3 automatic instalments.";
export const OWNER_PLAN_LEAD = "By accepting this payment plan, you agree that:";
export const OWNER_PLAN_TERMS = [
  "this plan applies to the current confirmed quote version only;",
  "the first instalment must be paid and verified before Home Insulation Victoria requests the Pre Insulation Electrical Safety Assessment (PIESA);",
  "the remaining instalments must be paid by the due dates shown in the portal;",
  "if an instalment is missed, failed or overdue, your job may be paused until the payment issue is resolved;",
  "this payment plan does not change the requirement for Pre Insulation Electrical Safety Assessment (PIESA), electrical fixes if required, final checks or program eligibility;",
  "any electrical fixes work is quoted separately unless expressly included in a later approved quote;",
  "if the quote is changed or superseded, this payment plan may need to be replaced.",
] as const;
export const OWNER_PLAN_CHECKBOX =
  "I have read and accept the 3-instalment payment plan for this quote.";
export const OWNER_PLAN_BUTTON = "Accept payment plan";

export const OFFICE_PLAN_TITLE = "Approve instalment plan";
export const OFFICE_PLAN_NOTE =
  "Approving this plan does not clear the payment gate by itself. The payment gate clears only when:";
export const OFFICE_PLAN_CONDITIONS = [
  "office has approved the plan;",
  "the owner has accepted the plan terms;",
  "the first instalment has been verified in Xero; and",
  "the collection arrangement has been recorded.",
] as const;
export const OFFICE_PLAN_QUOTE_NOTE =
  "The plan must belong to the current confirmed quote version. If the quote is superseded, the plan no longer clears the gate.";

/** Version of the owner wording stored with each acceptance. */
export const OWNER_PLAN_TERMS_VERSION = "HIV-PLAN-3-2026-10-03";

export type PlanStatus = "proposed" | "active" | "cancelled" | "failed" | "overdue" | "superseded";
export const CLOSED_STATUSES: PlanStatus[] = ["cancelled", "failed", "overdue", "superseded"];

export type PlanRow = {
  id: string;
  job_id: string;
  quote_id: string;
  invoice_id: string;
  status: PlanStatus;
  instalment_count: number;
  office_approved_at: string | null;
  office_approved_by: string | null;
  owner_accepted_at: string | null;
  owner_accepted_by: string | null;
  first_instalment_amount: number | null;
  first_instalment_verified_at: string | null;
  collection_arrangement: string | null;
  collection_recorded_at: string | null;
  status_reason: string | null;
};

export type PlanContext = {
  route: PaymentRoute;
  currentQuoteId: string | null; // owner-approved current confirmed quote
  now: string;
  actorId: string;
};

export type PlanAction =
  | { kind: "approve" }
  | { kind: "owner_accept"; confirmed: boolean }
  | { kind: "record_collection"; arrangement: string }
  | { kind: "verify_first"; amount: number }
  | { kind: "mark"; status: "failed" | "overdue" | "cancelled" | "superseded"; reason: string };

export type ActionResult = { ok: true; patch: Partial<PlanRow> } | { ok: false; error: string };

export const OWNER_ACTIONS: PlanAction["kind"][] = ["owner_accept"];

/** Can office propose a new plan? Home Insulation Victoria leads only, current quote with its invoice, no open plan. */
export function proposeBlocker(i: {
  route: PaymentRoute;
  currentQuoteId: string | null;
  invoiceQuoteId: string | null;
  openPlanExists: boolean;
}): string | null {
  if (i.route !== "hiv_lead")
    return "Payment rule exception – instalment plans apply to Home Insulation Victoria leads only.";
  if (!i.currentQuoteId) return "Owner has not approved the current confirmed quote.";
  if (i.invoiceQuoteId !== i.currentQuoteId)
    return "No Xero invoice for the current confirmed quote.";
  if (i.openPlanExists) return "This quote already has an open instalment plan.";
  return null;
}

/** Validate one action and return the fields to save. Status becomes active only when all four conditions hold. */
export function applyPlanAction(plan: PlanRow, action: PlanAction, ctx: PlanContext): ActionResult {
  if (CLOSED_STATUSES.includes(plan.status))
    return { ok: false, error: `This plan is ${plan.status} and can no longer change.` };
  if (action.kind === "mark") {
    const reason = action.reason.trim();
    if (reason.length < 3) return { ok: false, error: "A reason is required." };
    return { ok: true, patch: { status: action.status, status_reason: reason } };
  }
  if (ctx.route !== "hiv_lead")
    return {
      ok: false,
      error:
        "Payment rule exception – instalment plans apply to Home Insulation Victoria leads only.",
    };
  if (plan.quote_id !== ctx.currentQuoteId)
    return {
      ok: false,
      error:
        "This plan belongs to an older quote version. Mark it superseded and propose a new plan.",
    };
  let patch: Partial<PlanRow>;
  switch (action.kind) {
    case "approve":
      if (plan.office_approved_at) return { ok: false, error: "Already approved by office." };
      patch = { office_approved_at: ctx.now, office_approved_by: ctx.actorId };
      break;
    case "owner_accept":
      if (!action.confirmed)
        return { ok: false, error: "Tick the box to accept the payment plan." };
      if (plan.owner_accepted_at) return { ok: false, error: "Payment plan already accepted." };
      patch = { owner_accepted_at: ctx.now, owner_accepted_by: ctx.actorId };
      break;
    case "record_collection": {
      const a = action.arrangement.trim();
      if (a.length < 3) return { ok: false, error: "Describe the collection arrangement." };
      patch = { collection_arrangement: a, collection_recorded_at: ctx.now };
      break;
    }
    case "verify_first":
      if (!(action.amount > 0))
        return { ok: false, error: "Enter the first instalment amount shown in Xero." };
      patch = {
        first_instalment_amount: Math.round(action.amount * 100) / 100,
        first_instalment_verified_at: ctx.now,
      };
      break;
  }
  const next = { ...plan, ...patch };
  if (
    next.status === "proposed" &&
    next.instalment_count === 3 &&
    next.office_approved_at &&
    next.owner_accepted_at &&
    next.first_instalment_verified_at &&
    next.collection_recorded_at
  )
    patch.status = "active";
  return { ok: true, patch };
}

/** Checklist for office/owner screens. clearsGate comes from the single gate rule. */
export function planChecklist(plan: PlanRow, currentQuoteId: string | null) {
  return {
    items: [
      { label: "Office approved", done: !!plan.office_approved_at },
      { label: "Owner accepted plan terms", done: !!plan.owner_accepted_at },
      { label: "First instalment verified in Xero", done: !!plan.first_instalment_verified_at },
      { label: "Collection arrangement recorded", done: !!plan.collection_recorded_at },
      {
        label: "Belongs to current confirmed quote",
        done: !!currentQuoteId && plan.quote_id === currentQuoteId,
      },
    ],
    clearsGate: !!currentQuoteId && instalmentPlanActive(plan, currentQuoteId),
  };
}
