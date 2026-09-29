import { createFileRoute } from "@tanstack/react-router";
import { pixelResponse, pixelToken } from "@/lib/engagement.core";

// Open pixel /t/o/<token>.gif — supporting signal only. HEAD requests are never counted.
export const Route = createFileRoute("/t/o/$file")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const token = pixelToken(params.file);
        if (token) {
          const { recordOpen } = await import("@/lib/engagement.server");
          await recordOpen(token, request.headers.get("user-agent")).catch(() => {});
        }
        return pixelResponse("GET");
      },
      HEAD: async () => pixelResponse("HEAD"),
    },
  },
});
