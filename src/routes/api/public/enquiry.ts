import { createFileRoute } from "@tanstack/react-router";
import { BASE44_KEY_ID, verifyBase44Webhook } from "@/lib/enquiry.core";
import type { EnquiryInput } from "@/lib/enquiry.server";

// Base44 website -> Home Insulation Victoria portal. Header `x-hivic-signature` = base64 Ed25519 signature of the exact raw
// UTF-8 body, verified against the trusted Base44 public key (no shared secret). Optional `x-hivic-key-id: base44-v1`.
// Only POST is handled; every other method gets the framework's 405/404.
export const Route = createFileRoute("/api/public/enquiry")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const keyId = request.headers.get("x-hivic-key-id");
        if (keyId && keyId !== BASE44_KEY_ID) return Response.json({ error: "Unknown key id" }, { status: 401 });
        const body = await request.text();
        if (body.length > 400_000) return Response.json({ error: "Payload too large" }, { status: 413 });
        // Verify BEFORE parsing anything. Base44 legacy signs the raw body; the new protocol signs timestamp + nonce + raw body.
        const signed = await verifyBase44Webhook(body, request.headers);
        if (!signed.ok) {
          return Response.json({ error: "Invalid signature" }, { status: 401 });
        }

        const { enquirySchema, enquiryWithoutEmailSchema, mistypedEmailOnly, upsertEnquiry } = await import("@/lib/enquiry.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        if (signed.protocol === "timestamped") {
          const { error: nonceError } = await (supabaseAdmin as any).from("signed_webhook_nonces").insert({ source: "base44", purpose: "enquiry", nonce: signed.nonce, signed_at: signed.timestamp });
          if (nonceError) {
            // Staged 0202 not applied: accept on the verified signature + timestamp window (the same trust as the legacy
            // protocol, which is accepted anyway) rather than rejecting every timestamped request. A duplicate nonce
            // (replay) or any other error is still rejected.
            const { isMissingDbObject } = await import("@/lib/schema-compat.core");
            if (!isMissingDbObject(nonceError)) return Response.json({ error: "Invalid signature" }, { status: 401 });
            console.warn("signed_webhook_nonces not deployed (staged 0202); replay store unavailable");
          }
        }
        let json: unknown;
        try {
          json = JSON.parse(body);
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        let parsed = enquirySchema.safeParse(json) as { success: true; data: Omit<EnquiryInput, "email"> & { email: string | null } } | { success: false; error: import("zod").ZodError };
        // Jo 23 Oct: a mistyped email alone (with a phone number) no longer loses the lead.
        let mistypedEmail: string | undefined;
        if (!parsed.success) {
          const typed = mistypedEmailOnly(json, parsed.error);
          const lenient = typed == null ? null : enquiryWithoutEmailSchema.safeParse(json);
          if (typed != null && lenient?.success) {
            mistypedEmail = typed;
            parsed = { success: true, data: lenient.data };
          } else {
            await supabaseAdmin.from("external_sync_logs").insert({ system: "base44", direction: "inbound", entity_type: "enquiry", status: "error", error: parsed.error.message });
            return Response.json({ error: "Validation failed" }, { status: 400 });
          }
        }
        const ref = { external_enquiry_id: parsed.data.external_enquiry_id ?? null, source_reference: parsed.data.source_reference ?? null, key_id: keyId ?? null, signature_protocol: signed.protocol, ...(mistypedEmail != null ? { mistyped_email: true } : {}) };
        try {
          const result = await upsertEnquiry(parsed.data, "base44", null, undefined, { mistypedEmail });
          await supabaseAdmin.from("external_sync_logs").insert({ system: "base44", direction: "inbound", entity_type: "job", entity_id: result.job_id, status: "synced", payload: { ...ref, created: result.created, preliminary_outcome: parsed.data.preliminary_outcome ?? parsed.data.eligibility_outcome ?? null, life_support_status: parsed.data.life_support_status ?? null } });
          // Referral share link is best-effort: never fail the enquiry over it.
          let referral_share_url: string | null = null;
          try {
            const { referralUrlForJob } = await import("@/lib/referral.server");
            referral_share_url = await referralUrlForJob(result.job_id);
          } catch (e) {
            console.error("referral link creation failed", e);
          }
          // Truthful customer messaging: Base44 may only promise an email when delivery is really possible.
          let customer_email_enabled = false;
          try {
            const [{ customerCommsEnabled, hasCurrentOwnerContactConsent }, { configuredDeliveryAdapter }] = await Promise.all([import("@/lib/comms.server"), import("@/lib/delivery.server")]);
            customer_email_enabled = mistypedEmail == null && (await customerCommsEnabled()) && !!(await configuredDeliveryAdapter()) && (await hasCurrentOwnerContactConsent(result.job_id));
          } catch { customer_email_enabled = false; }
          return Response.json({ ok: true, ...result, referral_share_url, customer_email_enabled });
        } catch (e) {
          console.error("enquiry webhook failed", e);
          await supabaseAdmin.from("external_sync_logs").insert({ system: "base44", direction: "inbound", entity_type: "enquiry", status: "error", payload: ref, error: String(e) });
          return Response.json({ error: "Failed to process enquiry" }, { status: 500 });
        }
      },
    },
  },
});
