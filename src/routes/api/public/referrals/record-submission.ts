import { createFileRoute } from "@tanstack/react-router";
import { verifyBase44Webhook } from "@/lib/enquiry.core";
import { submissionBody } from "@/lib/referral.core";

// Base44 backend → referred enquiry saved. Ed25519-signed (same Base44 key, header x-hivic-signature).
// Accepts ONLY {token, external_enquiry_id}; never receives or stores friend PII.
export const Route = createFileRoute("/api/public/referrals/record-submission")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        if (raw.length > 2048) return Response.json({ error: "Invalid request" }, { status: 400 });
        const signed = await verifyBase44Webhook(raw, request.headers);
        if (!signed.ok) return Response.json({ error: "Invalid signature" }, { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        if (signed.protocol === "timestamped") {
          const { error: nonceError } = await (supabaseAdmin as any).from("signed_webhook_nonces").insert({ source: "base44", purpose: "referral_submission", nonce: signed.nonce, signed_at: signed.timestamp });
          if (nonceError) {
            // Staged 0202 not applied: accept on the verified signature + timestamp window (the same trust as the legacy
            // protocol, which is accepted anyway) rather than rejecting every timestamped request. A duplicate nonce
            // (replay) or any other error is still rejected.
            const { isMissingDbObject } = await import("@/lib/schema-compat.core");
            if (!isMissingDbObject(nonceError)) return Response.json({ error: "Invalid signature" }, { status: 401 });
            console.warn("signed_webhook_nonces not deployed (staged 0202); replay store unavailable");
          }
        }
        let b: unknown = null;
        try { b = JSON.parse(raw); } catch { /* invalid */ }
        const body = submissionBody(b);
        if (!body) return Response.json({ error: "Invalid request" }, { status: 400 });
        const { recordReferralSubmission } = await import("@/lib/referral.server");
        try { await recordReferralSubmission(body.token, body.external_enquiry_id); }
        catch (e) { console.error("referral submission failed", (e as Error).message); return Response.json({ error: "Failed" }, { status: 500 }); }
        return Response.json({ ok: true });
      },
    },
  },
});
