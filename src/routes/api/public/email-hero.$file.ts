import { createFileRoute } from "@tanstack/react-router";

// Public header image for the Save my spot email (Group A): GET /api/public/email-hero/{token}.png.
// The token is the owner's secure estimate link; invalid, expired, closed or non-campaign links get a plain 404.
// Only the owner's first name and rebate amount are drawn — nothing else personal.
const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

export const Route = createFileRoute("/api/public/email-hero/$file")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const m = /^([A-Za-z0-9_-]{43,128})\.png$/.exec(params.file);
        if (!m) return notFound();
        const token = m[1];
        try {
          const { campaignLink } = await import("@/lib/launch-campaign.server");
          const c = await campaignLink(token);
          if (!c || c.group !== "likely") return notFound();
          const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
          const { data: est } = await admin.from("indicative_estimates").select("id, area_m2, insulation_declared, scenarios").eq("job_id", c.job.id).eq("status", "current").maybeSingle();
          const { savedPriceFromEstimate } = await import("@/lib/launch-campaign.core");
          const price = savedPriceFromEstimate(est ?? null);
          if (!price || !(price.discount > 0)) return notFound();
          const owner = c.job.owners as { full_name: string | null } | null;
          const firstName = owner?.full_name?.trim().split(/\s+/)[0] ?? null;
          const rebate = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(price.discount);
          const { renderEmailHeroPng } = await import("@/lib/email-hero.core");
          const png = renderEmailHeroPng(firstName, rebate);
          return new Response(png as unknown as BodyInit, { status: 200, headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" } });
        } catch (e) {
          console.error("email hero render failed", (e as Error).message);
          return notFound();
        }
      },
    },
  },
});
