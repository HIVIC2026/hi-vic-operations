// Office payments panel (decisions 139/140/141): read the payment steps + ledger and refresh the Xero online invoice link.
// Decision 368 (audit F18): there is NO office payment entry — payments reach the ledger only from Xero (sync / webhook /
// poll) and Stripe (verified webhook); the QA-only simulateXeroPayment (qa_test jobs) stays in portal.functions.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, requireAdmin, requireJobRole } from "./workflow.server";

const uuid = z.string().uuid();

export const getJobPayments = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { jobPaymentView } = await import("./payments.server");
    const v = await jobPaymentView(data.jobId);
    if (!v) return null;
    const ids = [...new Set(v.ledger.map((r) => r.recordedBy).filter((x): x is string => !!x))];
    const { data: profs } = ids.length ? await admin.from("profiles").select("id, full_name").in("id", ids) : { data: [] as { id: string; full_name: string | null }[] };
    type Row = (typeof v.ledger)[number] & { recordedByName: string | null };
    type Out = Omit<typeof v, "ledger"> & { ledger: Row[] };
    const out: Out = { ...v, ledger: v.ledger.map((r) => ({ ...r, recordedByName: profs?.find((p) => p.id === r.recordedBy)?.full_name ?? null })) };
    return JSON.parse(JSON.stringify(out)) as Out;
  });

/** The owner's own job only (requireJobRole "owner"): the install deposit (10% of the install price, never the fixes) and the balance. Figures only. */
export const getOwnerPaymentPlan = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, data.jobId, ["owner"]);
    const { jobPaymentView } = await import("./payments.server");
    const v = await jobPaymentView(data.jobId);
    return v ? { invoiceId: v.invoiceId, installDepositCents: v.plan.installDepositCents, balanceCents: v.plan.balanceCents } : null;
  });

export const refreshPayNowLink = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ invoiceId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { refreshOnlineInvoiceUrl } = await import("./xero.server");
    try { return { url: await refreshOnlineInvoiceUrl(data.invoiceId, context.userId) }; }
    catch (e) { throw new WorkflowError((e as Error).message); }
  });

/** Office: an unclear card + Xero pair is really TWO separate payments (one append-only event; both then count). */
export const markPaymentsSeparateFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ invoiceId: uuid, pairKey: z.string().min(3).max(300) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { data: inv } = await admin.from("invoices").select("id, job_id").eq("id", data.invoiceId).maybeSingle();
    if (!inv) throw new WorkflowError("Invoice not found.");
    const { markPaymentsSeparate } = await import("./payments.server");
    try { return { marked: await markPaymentsSeparate(inv.job_id, inv.id, data.pairKey, context.userId) }; }
    catch (e) { throw new WorkflowError((e as Error).message); }
  });
