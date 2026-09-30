import { createFileRoute } from "@tanstack/react-router";

// One-click unsubscribe for customer emails. GET shows a confirm button (mail scanners prefetch GETs, so GET never
// opts out); POST records the opt-out (also RFC 8058 List-Unsubscribe-Post). Token is opaque; nothing personal is shown.
const page = (body: string) => new Response(`<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Email preferences — Home Insulation Victoria</title></head><body style="margin:0;background:#FBFCFA;font-family:'Open Sans',Arial,sans-serif;color:#22376B;"><main style="max-width:480px;margin:48px auto;padding:28px;background:#fff;border:2px solid #3C51C4;border-radius:18px;text-align:center;">${body}</main></body></html>`, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" } });
const safe = (t: string | null) => (t && /^[A-Za-z0-9_-]{20,128}$/.test(t) ? t : null);

export const Route = createFileRoute("/api/public/unsubscribe")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const t = safe(new URL(request.url).searchParams.get("t"));
        if (!t) return page(`<h1 style="font-size:20px;">Link not recognised</h1><p>Please contact info@homeinsulationvictoria.com.au and we’ll update your preferences.</p>`);
        return page(`<h1 style="font-size:20px;">Unsubscribe from Home Insulation Victoria emails?</h1><p style="font-size:14px;">You won’t receive further estimate reminders or updates by email.</p><form method="post" action="/api/public/unsubscribe?t=${t}"><button type="submit" style="margin-top:12px;padding:14px 22px;border:0;border-radius:8px;background:#07BF61;color:#fff;font-weight:800;font-size:15px;cursor:pointer;">Unsubscribe</button></form>`);
      },
      POST: async ({ request }) => {
        const t = safe(new URL(request.url).searchParams.get("t"));
        let ok = false;
        if (t) {
          const { recordUnsubscribe } = await import("@/lib/emailsafety.server");
          try { ok = await recordUnsubscribe(t); } catch (e) { console.error("unsubscribe failed", (e as Error).message); }
        }
        return ok
          ? page(`<h1 style="font-size:20px;">You’re unsubscribed</h1><p style="font-size:14px;">We won’t send you further Home Insulation Victoria emails about this enquiry.</p>`)
          : page(`<h1 style="font-size:20px;">We couldn’t update your preferences</h1><p style="font-size:14px;">Please contact info@homeinsulationvictoria.com.au and we’ll remove you straight away.</p>`);
      },
    },
  },
});
