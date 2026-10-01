// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";

const TEARDOWN = /^(aborted|socket hang ?up|premature close|ECONNRESET|EPIPE)$|abortIncoming|socketOnClose/i;

// Dev only: when the browser drops a request mid-load (reload, HMR, flaky
// mobile signal) Node raises `Error: aborted`. Nobody is waiting for that
// reply, so it must never reach the browser's error overlay as a blank screen.
function ignoreClientDisconnects(): Plugin {
  return {
    name: "hiv-ignore-client-disconnects",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const swallow = () => {};
        req.on("error", swallow);
        res.on("error", swallow);
        next();
      });
      const ws = server.ws as unknown as { send: (...args: unknown[]) => void };
      const send = ws.send.bind(ws);
      ws.send = (...args: unknown[]) => {
        const payload = args[0] as { type?: string; err?: { message?: string; stack?: string } };
        if (payload && typeof payload === "object" && payload.type === "error") {
          const text = `${payload.err?.message ?? ""}\n${payload.err?.stack ?? ""}`;
          if (TEARDOWN.test(payload.err?.message?.trim() ?? "") || /abortIncoming|socketOnClose/.test(text)) return;
        }
        send(...args);
      };
    },
  };
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [ignoreClientDisconnects()],
  },
});
