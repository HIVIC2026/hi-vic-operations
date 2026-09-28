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
