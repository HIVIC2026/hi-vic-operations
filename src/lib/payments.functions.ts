// Office payments panel (decisions 139/140/141): read the payment steps + ledger and refresh the Xero online invoice link.
// Decision 368 (audit F18): there is NO office payment entry — payments reach the ledger only from Xero (sync / webhook /
// poll) and Stripe (verified webhook); the QA-only simulateXeroPayment (qa_test jobs) stays in portal.functions.ts.
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

export const refreshPayNowLink = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ invoiceId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { refreshOnlineInvoiceUrl } = await import("./xero.server");
    try { return { url: await refreshOnlineInvoiceUrl(data.invoiceId, context.userId) }; }
    catch (e) { throw new WorkflowError((e as Error).message); }
  });
