import { createFileRoute } from "@tanstack/react-router";

// Task 9 (installer screens): a partner's logo for co-branded quotes, served for good at a public, unguessable path
// (/api/public/partner-logo/{32 hex}.{png|jpg}) — the same kind of public image path the email art uses, so email clients
// can load it years later. The bytes live in the private job-files bucket; this route is the only public reader and it
// never hands out a signed URL. Unknown key → plain 404.
const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

export const Route = createFileRoute("/api/public/partner-logo/$key")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const m = /^([0-9a-f]{32})\.(png|jpg)$/.exec(params.key);
        if (!m) return notFound();
        try {
          const { partnerLogoByKey } = await import("@/lib/trade-view.server");
          const logo = await partnerLogoByKey(m[1]!);
          if (!logo) return notFound();
          const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await admin.storage.from("job-files").download(logo.path);
          if (error || !data) return notFound();
          return new Response(data, { status: 200, headers: { "Content-Type": logo.type, "Cache-Control": "public, max-age=604800", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" } });
        } catch (e) {
          console.error("partner logo not served", (e as Error).message);
          return notFound();
        }
      },
    },
  },
});
