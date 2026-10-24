import { createFileRoute } from "@tanstack/react-router";

// Xero webhook (decision 139): invoice updates → re-sync the ONE linked invoice and record payments (append-only).
// Signature = HMAC-SHA256(raw body, XERO_WEBHOOK_KEY) base64 in x-xero-signature. No key / bad signature = 401, empty
// body, nothing touched (fails closed). Xero's "intent to receive" probe is answered by the same check. Only invoices
// already linked locally are looked at, and every sync still passes the Home Insulation Victoria business-unit barrier.
export const Route = createFileRoute("/api/public/hooks/xero-payments")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const { verifyXeroWebhookSignature, parseXeroWebhookEvents, webhookInvoiceIds, XERO_SIGNATURE_HEADER } = await import("@/lib/xero-webhook.core");
        const ok = await verifyXeroWebhookSignature(raw, request.headers.get(XERO_SIGNATURE_HEADER), process.env["XERO_WEBHOOK_KEY"]);
        if (!ok) return new Response(null, { status: 401 });
        const ids = webhookInvoiceIds(parseXeroWebhookEvents(raw));
        if (ids.length) {
          try {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { syncInvoiceFromXero } = await import("@/lib/xero.server");
            const { data: rows } = await supabaseAdmin.from("invoices").select("id").in("xero_invoice_id", ids.slice(0, 50));
            for (const r of rows ?? []) {
              try { await syncInvoiceFromXero(r.id, null); } catch (e) { console.error("xero webhook sync failed", r.id, (e as Error).message); }
            }
          } catch (e) {
            console.error("xero webhook handling failed", (e as Error).message);
          }
        }
        return new Response(null, { status: 200 });
      },
    },
  },
});
