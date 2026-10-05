import { createFileRoute } from "@tanstack/react-router";

const TYPES: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic",
  mp4: "video/mp4", mov: "video/quicktime", zip: "application/zip", json: "application/json", csv: "text/csv", txt: "text/plain",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

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
        const ext = name.split(".").pop()?.toLowerCase() ?? "";
        const type = blob.type && blob.type !== "application/octet-stream" ? blob.type : TYPES[ext] ?? "application/octet-stream";
        const download = new URL(request.url).searchParams.has("download");
        return new Response(blob.stream(), {
          headers: {
            "Content-Type": type,
            "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name.replace(/"/g, "")}"`,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
