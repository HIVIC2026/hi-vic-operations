import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

// Base44 website -> HI VIC portal. Signed with HMAC-SHA256 of the raw body using BASE44_WEBHOOK_SECRET,
// sent in header `x-hivic-signature` (hex).
export const Route = createFileRoute("/api/public/enquiry")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["BASE44_WEBHOOK_SECRET"];
        if (!secret) return Response.json({ error: "Webhook not configured" }, { status: 503 });
        const body = await request.text();
        const sig = request.headers.get("x-hivic-signature") ?? "";
        const expected = createHmac("sha256", secret).update(body).digest("hex");
        const a = Buffer.from(sig);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) return Response.json({ error: "Invalid signature" }, { status: 401 });

        const { enquirySchema, upsertEnquiry } = await import("@/lib/enquiry.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let json: unknown;
        try {
          json = JSON.parse(body);
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        const parsed = enquirySchema.safeParse(json);
        if (!parsed.success) {
          await supabaseAdmin.from("external_sync_logs").insert({ system: "base44", direction: "inbound", entity_type: "enquiry", status: "error", error: parsed.error.message });
          return Response.json({ error: "Validation failed", issues: parsed.error.flatten() }, { status: 400 });
        }
        try {
          const result = await upsertEnquiry(parsed.data, "base44", null);
          await supabaseAdmin.from("external_sync_logs").insert({ system: "base44", direction: "inbound", entity_type: "job", entity_id: result.job_id, status: "synced", payload: { external_enquiry_id: parsed.data.external_enquiry_id ?? null } });
          return Response.json({ ok: true, ...result });
        } catch (e) {
          console.error("enquiry webhook failed", e);
          await supabaseAdmin.from("external_sync_logs").insert({ system: "base44", direction: "inbound", entity_type: "enquiry", status: "error", error: String(e) });
          return Response.json({ error: "Failed to process enquiry" }, { status: 500 });
        }
      },
    },
  },
});
