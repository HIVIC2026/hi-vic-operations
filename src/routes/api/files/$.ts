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
        const headers: Record<string, string> = { ...servedFileHeaders(blob.type, name, download), "Accept-Ranges": "bytes" };
        // Phones only play videos when the server answers byte-range requests.
        const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
        if (range && (range[1] || range[2])) {
          const size = blob.size;
          let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
          let end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
          if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
          return new Response(blob.slice(start, end + 1).stream(), { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
        }
        return new Response(blob.stream(), { headers: { ...headers, "Content-Length": String(blob.size) } });
      },
    },
  },
});
