import { createFileRoute } from "@tanstack/react-router";

// Streams an uploaded document through the app's own domain. The link itself is the permission:
// it is only issued by server functions that already checked office/partner access, and it expires.
export const Route = createFileRoute("/api/files/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const [token, rawName] = (params._splat ?? "").split("/");
        const { verifyFileToken } = await import("@/lib/file-links.server");
        const f = token ? verifyFileToken(token) : null;
        if (!f) return new Response("This link has expired or is not valid. Close it and open the document again.", { status: 403, headers: { "Cache-Control": "no-store" } });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: blob, error } = await supabaseAdmin.storage.from(f.bucket).download(f.path);
        if (error || !blob) return new Response("File not found.", { status: 404, headers: { "Cache-Control": "no-store" } });
        const name = decodeURIComponent(rawName || f.path.split("/").pop() || "file");
        const { servedFileHeaders } = await import("@/lib/upload-safety.core");
        const download = new URL(request.url).searchParams.has("download");
        // Security review A: only PDFs/images inline, everything else downloads; never HTML/SVG; sandboxed.
        return new Response(blob.stream(), { headers: servedFileHeaders(blob.type, name, download) });
      },
    },
  },
});
