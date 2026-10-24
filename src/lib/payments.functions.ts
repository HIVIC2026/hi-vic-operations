// Office payments panel (decisions 139/140/141): read the payment steps + ledger, record a payment, refresh the Pay now link.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, requireAdmin } from "./workflow.server";

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

/** Office records a payment it has confirmed (bank statement / Xero). Append-only; never deletes or edits a record. */
export const recordOwnerPayment = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ invoiceId: uuid, amount: z.number().positive().max(1_000_000), source: z.enum(["bank", "card", "manual"]), paidAt: z.string().datetime({ offset: true }).optional(), note: z.string().trim().max(300).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { requireHivicInvoice } = await import("./xero.server");
    try { await requireHivicInvoice(data.invoiceId); } catch (e) { throw new WorkflowError((e as Error).message); }
    const { recordManualPayment } = await import("./payments.server");
    try {
      await recordManualPayment({ invoiceId: data.invoiceId, amountCents: Math.round(data.amount * 100), source: data.source, paidAt: data.paidAt ?? new Date().toISOString(), note: data.note?.trim() || null, actorId: context.userId });
    } catch (e) { throw new WorkflowError((e as Error).message); }
    return { ok: true };
  });

export const refreshPayNowLink = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ invoiceId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { refreshOnlineInvoiceUrl } = await import("./xero.server");
    try { return { url: await refreshOnlineInvoiceUrl(data.invoiceId, context.userId) }; }
    catch (e) { throw new WorkflowError((e as Error).message); }
  });
