import { createFileRoute } from "@tanstack/react-router";
import { handlePartnerEnquiry } from "@/lib/partner.core";

// Base44 partner enquiries (property manager / installer partner / electrician-REC). Same Ed25519 key + key id as
// /api/public/enquiry. Writes ONLY partner_enquiries — never a job.
export const Route = createFileRoute("/api/public/partner-enquiry")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        try {
          const res = await handlePartnerEnquiry(raw, request.headers, {
            upsert: async (row) => {
              const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
              const { data: existing } = await supabaseAdmin.from("partner_enquiries").select("id")
                .eq("source_system", row.source_system).eq("enquiry_type", row.enquiry_type).eq("submission_id", row.submission_id).maybeSingle();
              if (existing) {
                const { error } = await supabaseAdmin.from("partner_enquiries").update(row).eq("id", existing.id);
                if (error) throw new Error(error.message);
                return { id: existing.id, created: false };
              }
              const { data, error } = await supabaseAdmin.from("partner_enquiries").insert(row).select("id").single();
              if (error) throw new Error(error.message);
              return { id: data.id, created: true };
            },
            consumeNonce: async (nonce, signedAt) => {
              const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
              const { error } = await (supabaseAdmin as any).from("signed_webhook_nonces").insert({ source: "base44", purpose: "partner_enquiry", nonce, signed_at: signedAt });
              if (!error) return true;
              // Staged 0202 not applied: same fallback as the enquiry webhook (replays/other errors still rejected).
              const { isMissingDbObject } = await import("@/lib/schema-compat.core");
              if (isMissingDbObject(error)) { console.warn("signed_webhook_nonces not deployed (staged 0202); replay store unavailable"); return true; }
              return false;
            },
          });
          return Response.json(res.body, { status: res.status });
        } catch (e) {
          console.error("partner enquiry failed", e);
          return Response.json({ error: "Failed to process partner enquiry" }, { status: 500 });
        }
      },
    },
  },
});
