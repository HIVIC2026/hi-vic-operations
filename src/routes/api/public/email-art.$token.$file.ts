import { createFileRoute } from "@tanstack/react-router";

// Public brand images for campaign emails: /api/public/email-art/{token}/{headline|spot|pay}.png
// The token is the owner's secure estimate link and must pass the same rules as the Save my spot page;
// otherwise a plain 404 (the email's alt text then shows the words). Only first name and amounts are drawn.
const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
const aud = (n: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(Math.floor(n));

export const Route = createFileRoute("/api/public/email-art/$token/$file")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const kind = /^(headline|spot|pay)\.png$/.exec(params.file)?.[1];
        if (!kind || !/^[A-Za-z0-9_-]{43,128}$/.test(params.token)) return notFound();
        try {
          const { campaignLink } = await import("@/lib/launch-campaign.server");
          const c = await campaignLink(params.token);
          if (!c) return notFound();
          const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
          const { savedPriceFromEstimate } = await import("@/lib/launch-campaign.core");
          const art = await import("@/lib/email-hero.core");
          const owner = c.job.owners as { full_name: string | null } | null;
          const firstName = owner?.full_name?.trim().split(/\s+/)[0] ?? null;
          let png: Uint8Array;
          if (kind === "spot") {
            const { data: r } = await admin.from("lead_campaign_responses").select("spot_saved_at, saved_veu_discount").eq("job_id", c.job.id).maybeSingle();
            if (!r?.spot_saved_at || !(Number(r.saved_veu_discount) > 0)) return notFound();
            png = art.renderHeaderArt(art.campaignHeroSpec("spot", firstName, aud(Number(r.saved_veu_discount))));
          } else {
            const { data: est } = await admin.from("indicative_estimates").select("id, area_m2, insulation_declared, scenarios").eq("job_id", c.job.id).eq("status", "current").maybeSingle();
            const price = savedPriceFromEstimate(est ?? null);
            if (!price || !(price.discount > 0)) return notFound();
            png = kind === "pay" ? art.renderAmountArt(aud(price.total)) : art.renderHeaderArt(art.campaignHeroSpec(c.group === "onsite" ? "onsite" : "likely", firstName, aud(price.discount)));
          }
          return new Response(png as unknown as BodyInit, { status: 200, headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" } });
        } catch (e) {
          console.error("email art render failed", (e as Error).message);
          return notFound();
        }
      },
    },
  },
});
