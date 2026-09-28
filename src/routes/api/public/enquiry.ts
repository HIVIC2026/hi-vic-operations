import { createFileRoute } from "@tanstack/react-router";
import { BASE44_KEY_ID, verifyEd25519 } from "@/lib/enquiry.core";

// Base44 website -> HI VIC portal. Header `x-hivic-signature` = base64 Ed25519 signature of the exact raw
// UTF-8 body, verified against the trusted Base44 public key (no shared secret). Optional `x-hivic-key-id: base44-v1`.
// Only POST is handled; every other method gets the framework's 405/404.
export const Route = createFileRoute("/api/public/enquiry")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const keyId = request.headers.get("x-hivic-key-id");
        if (keyId && keyId !== BASE44_KEY_ID) return Response.json({ error: "Unknown key id" }, { status: 401 });
        const body = await request.text();
        if (body.length > 100_000) return Response.json({ error: "Payload too large" }, { status: 413 });
        // Verify BEFORE parsing anything.
        if (!(await verifyEd25519(body, request.headers.get("x-hivic-signature")))) {
          return Response.json({ error: "Invalid signature" }, { status: 401 });
        }

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
        const ref = { external_enquiry_id: parsed.data.external_enquiry_id ?? null, source_reference: parsed.data.source_reference ?? null, key_id: keyId ?? null };
        try {
          const result = await upsertEnquiry(parsed.data, "base44", null);
          await supabaseAdmin.from("external_sync_logs").insert({ system: "base44", direction: "inbound", entity_type: "job", entity_id: result.job_id, status: "synced", payload: { ...ref, created: result.created, eligibility_outcome: parsed.data.eligibility_outcome ?? null } });
          return Response.json({ ok: true, ...result });
        } catch (e) {
          console.error("enquiry webhook failed", e);
          await supabaseAdmin.from("external_sync_logs").insert({ system: "base44", direction: "inbound", entity_type: "enquiry", status: "error", payload: ref, error: String(e) });
          return Response.json({ error: "Failed to process enquiry" }, { status: 500 });
        }
      },
    },
  },
});
