import { createFileRoute } from "@tanstack/react-router";
import { verifyEd25519 } from "@/lib/enquiry.core";
import { submissionBody } from "@/lib/referral.core";

// Base44 backend → referred enquiry saved. Ed25519-signed (same Base44 key, header x-hivic-signature).
// Accepts ONLY {token, external_enquiry_id}; never receives or stores friend PII.
export const Route = createFileRoute("/api/public/referrals/record-submission")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        if (raw.length > 2048) return Response.json({ error: "Invalid request" }, { status: 400 });
        if (!(await verifyEd25519(raw, request.headers.get("x-hivic-signature")))) return Response.json({ error: "Invalid signature" }, { status: 401 });
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
