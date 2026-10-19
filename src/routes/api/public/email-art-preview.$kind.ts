import { createFileRoute } from "@tanstack/react-router";

// Preview-only brand artwork for the Office Templates preview.
//
// This is NOT a customer link: it takes no token, performs no database lookup and draws a fixed
// sample ("Alex", $2,600) with the exact same renderHeaderArt / campaignHeroSpec the real emails
// use. It exists so the Office preview shows the true campaign artwork (logo + FREE ESTIMATE pill +
// caps line + green-amount headline) instead of the logo-only fallback, without ever exposing a
// real customer's estimate token. kind matches the renderer: "headline" -> likely hero (T1–T6),
// "spot" -> Spot-saved hero (T8).
const aud = (n: number) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(Math.floor(n));

export const Route = createFileRoute("/api/public/email-art-preview/$kind")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        // The Office preview builds the URL with a .png suffix (a natural image URL); accept
        // both "headline"/"spot" and "headline.png"/"spot.png" so the preview image actually resolves.
        const kind = /^(headline|spot)(?:\.png)?$/.exec(params.kind)?.[1];
        if (!kind) return new Response("Not found", { status: 404, headers: { "X-Robots-Tag": "noindex" } });
        try {
          const { renderHeaderArt, campaignHeroSpec } = await import("@/lib/email-hero.core");
          const spec =
            kind === "spot"
              ? campaignHeroSpec("spot", "Alex", aud(2600))
              : campaignHeroSpec("likely", "Alex", aud(2600));
          const png = renderHeaderArt(spec);
          return new Response(png as unknown as BodyInit, {
            status: 200,
            headers: {
              "Content-Type": "image/png",
              "Cache-Control": "public, max-age=86400",
              "X-Robots-Tag": "noindex",
              "Referrer-Policy": "no-referrer",
            },
          });
        } catch (e) {
          console.error("preview art render failed", (e as Error).message);
          return new Response("Not found", { status: 404, headers: { "X-Robots-Tag": "noindex" } });
        }
      },
    },
  },
});
