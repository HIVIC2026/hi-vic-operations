// Task 9 (Jo 28 Oct 2026, spec rule 3): the "Your price" card for the electrician repair work — reading it and saving it.
// Who: the office, or the owner of the electrician business on THIS job (`canPriceFixItems` → `ownsJobBusiness`). Staff
// get null (nothing about the price reaches them) and saving is refused. The card shows the ticked work list from the A3
// read-only, the total inc GST box, and any "Other" items still waiting for a price after the PIESA is complete. Saving
// is the append-only `electrician_repair_price_set` event (latest wins, tied to the A3 form), then the held fixes quote is
// rebuilt from it. Nothing here sends anything: the decision-354 automatic send (15-minute tick) and the office Send keep
// their own checks, including the unpriced / $0 blocker (fixes-quote-release.server `fixesQuoteSendBlocker`).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent, requireJobRole } from "./workflow.server";
import { REPAIR_PRICE_EVENT, REPAIR_PRICE_LOCKED, REPAIR_PRICE_NO_WORK, REPAIR_PRICE_REBUILD_FAILED, REPAIR_PRICE_STAGES, REPAIR_PRICE_STAGE_REFUSED, repairPriceNeeded, validateRepairPrice } from "./electrician-repair-price.core";
import { a3ForJob, readRepairPrice, type StoredRepairPrice } from "./electrician-repair-price.server";

type Sb = Parameters<typeof requireJobRole>[0];

/** Where a repair total may BUILD a fixes quote that doesn't exist yet (the decision-354 stages). */
const BUILD_STAGES: readonly string[] = ["piesa_complete", "electrical_variation_pending", "rectification_required"];

/** A fixes quote that has been sent or accepted is never changed. */
const sentOrAccepted = (q: { status: string; accepted_at?: string | null } | null) => !!q && (q.status !== "draft" || !!q.accepted_at);

/** The rebuild failed: every unsent fixes draft on the job is held with a reason, so it can't go out with the old figures.
 *  (`fixesQuoteSendBlocker` refuses a draft carrying this reason; Re-price on the office page builds a fresh one.) */
async function holdUnsentFixesDrafts(jobId: string): Promise<void> {
  const { error } = await admin.from("quotes").update({ release_state: "held", release_hold_reason: REPAIR_PRICE_REBUILD_FAILED }).eq("job_id", jobId).eq("kind", "rectification").eq("status", "draft");
  if (error) console.error("could not hold the fixes draft after a failed rebuild", error.message);
}

/**
 * Rebuild the held (unsent) fixes quote after a price is set, so the office never has to Regenerate by hand: any existing
 * draft at EVERY stage where a price can be set (`REPAIR_PRICE_STAGES`); a missing one is built only at the decision-354
 * stages when `build` (the repair total). Never touches a sent or accepted quote; never sends. This never throws: the
 * price is already saved. If the rebuild (or reading the newest quote) fails, the draft is held with a reason so it can't be
 * sent with old figures, and "failed" is returned.
 */
export async function rebuildHeldFixesQuote(jobId: string, actorId: string, stage: string, opts: { build: boolean }): Promise<"rebuilt" | "kept" | "failed"> {
  if (!REPAIR_PRICE_STAGES.includes(stage)) return "kept";
  try {
    const current = await (await import("./fixes-quote-current.server")).currentFixesQuote(jobId);
    if (sentOrAccepted(current)) return "kept";
    if (!current && !(opts.build && BUILD_STAGES.includes(stage))) return "kept";
    await (await import("./quotes.server")).generateRectificationQuote(jobId, actorId);
    return "rebuilt";
  } catch (e) {
    console.error("held fixes quote not rebuilt", (e as Error).message);
    await holdUnsentFixesDrafts(jobId).catch((he) => console.error("could not hold the fixes draft", (he as Error).message));
    return "failed";
  }
}

/** The office (admin) or the owner of the job's electrician business; anyone else = null. */
async function pricer(sb: Sb, jobId: string, userId: string): Promise<"office" | "owner" | null> {
  const role = await requireJobRole(sb, jobId, ["admin", "electrician"]).catch(() => null);
  if (!role) return null;
  if (!(await (await import("./electrician-fix-items.server")).canPriceFixItems(jobId, userId, role))) return null;
  return role === "admin" ? "office" : "owner";
}

export type RepairPriceView = {
  canSet: boolean;
  lockedReason: string | null;
  /** The ticked work list from the A3, read-only. */
  workList: string[];
  /** Why the ticks can't be read into a work list (e.g. downlights ticked with no count), else null. */
  workIssue: string | null;
  current: StoredRepairPrice | null;
  /** An old form's own price (the fallback while no portal price exists). */
  formPrice: number | null;
  /** "Other" items still waiting for a price (owner/office price them on this card after the PIESA is complete). */
  unpricedItems: { id: string; description: string; quantity: number }[];
};

/** The card. Staff and anyone else: null. Shown once the A3 is completed with repair work. */
export async function repairPriceView(sb: Sb, jobId: string, userId: string): Promise<RepairPriceView | null> {
  const who = await pricer(sb, jobId, userId);
  if (!who) return null;
  const [{ data: job }, a3] = await Promise.all([admin.from("jobs").select("stage, deleted_at").eq("id", jobId).maybeSingle(), a3ForJob(jobId)]);
  if (!job || job.deleted_at || !a3.completed || !repairPriceNeeded(a3.short)) return null;
  const { fixesInclusionsFromTicks, parseFixesPrice } = await import("./fixes-price.core");
  const { OWNER_PRICE_STAGES } = await import("./electrician-fix-items.server");
  const [current, quote, { data: items }] = await Promise.all([
    readRepairPrice(jobId, a3.auditId),
    (await import("./fixes-quote-current.server")).currentFixesQuote(jobId),
    admin.from("rectification_items").select("id, description, quantity, created_at").eq("job_id", jobId).eq("status", "required").eq("is_other", true).eq("needs_office_pricing", true).order("created_at"),
  ]);
  const ticks = fixesInclusionsFromTicks(a3.short ?? {});
  const stageOk = REPAIR_PRICE_STAGES.includes(job.stage);
  const locked = sentOrAccepted(quote) ? REPAIR_PRICE_LOCKED : !stageOk ? REPAIR_PRICE_STAGE_REFUSED : null;
  return {
    canSet: !locked, lockedReason: locked,
    workList: ticks.ok ? ticks.lines : [], workIssue: ticks.ok ? null : ticks.reason,
    current, formPrice: parseFixesPrice(a3.short?.["fixesPriceIncGst"]),
    unpricedItems: (who === "office" || OWNER_PRICE_STAGES.includes(job.stage)) ? (items ?? []).map((i) => ({ id: i.id, description: i.description, quantity: Number(i.quantity) })) : [],
  };
}

/** Office or the electrician business owner only. Append-only; the latest event is the price. Then the held fixes quote
 *  is rebuilt from it (never sent from here). */
export async function setRepairPrice(sb: Sb, jobId: string, userId: string, raw: unknown): Promise<StoredRepairPrice> {
  const who = await pricer(sb, jobId, userId);
  if (!who) throw new WorkflowError((await import("./electrician-fix-items.server")).STAFF_PRICING_REFUSED);
  const v = validateRepairPrice(raw);
  if (!v.ok) throw new WorkflowError(v.issue);
  const { data: job, error } = await admin.from("jobs").select("stage, deleted_at").eq("id", jobId).maybeSingle();
  if (error || !job) throw new WorkflowError("Job not found.");
  if (job.deleted_at) throw new WorkflowError("This job is closed.");
  if (!REPAIR_PRICE_STAGES.includes(job.stage)) throw new WorkflowError(REPAIR_PRICE_STAGE_REFUSED);
  const a3 = await a3ForJob(jobId);
  if (!a3.auditId || !a3.completed || !repairPriceNeeded(a3.short)) throw new WorkflowError(REPAIR_PRICE_NO_WORK);
  // The repair list must read in full (counts, "Other" description) — the same rule as completing the PIESA.
  const listed = (await import("./fixes-price.core")).fixesInclusionsFromTicks(a3.short ?? {});
  if (!listed.ok) throw new WorkflowError(listed.reason ?? REPAIR_PRICE_NO_WORK);
  // A quote that has been sent or accepted is never changed.
  if (sentOrAccepted(await (await import("./fixes-quote-current.server")).currentFixesQuote(jobId))) throw new WorkflowError(REPAIR_PRICE_LOCKED);
  const { data: asg } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "electrician").eq("active", true).limit(1).maybeSingle();
  await logEvent(jobId, userId, REPAIR_PRICE_EVENT, `Repair price entered by the ${who === "office" ? "office" : "electrician business owner"}: $${v.price.toLocaleString("en-AU")} inc GST`, { price_inc_gst: v.price, audit_id: a3.auditId, business_id: asg?.business_id ?? null, set_by: userId, by: who }, { internal: true });
  const stored = await readRepairPrice(jobId, a3.auditId);
  if (!stored) throw new WorkflowError("The price was not saved.");
  await rebuildHeldFixesQuote(jobId, userId, job.stage, { build: true });
  return stored;
}
