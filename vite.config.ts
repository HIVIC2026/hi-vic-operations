// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";
import { readdirSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cacheVersion, parseStartManifest, precacheList, serviceWorkerSource } from "./src/lib/installer-app-cache.core";

// S101 / B3-06: Prune orphaned server-only chunks from the PUBLIC client bundle.
//
// Server-only modules (src/integrations/supabase/client.server.ts and the
// *.server.ts helpers that statically import it) must never be downloadable
// from the public asset directory. The service-role admin client bypasses RLS;
// even though the emitted chunks contain only factory CODE (they read
// process.env at call-time and ship no literal secret), their presence in
// .output/public is a code-disclosure surface we eliminate.
//
// TanStack Start's server-function extraction can still emit code-split
// `*.server-*.js` chunks into the client output even when NO client/route/entry
// chunk references them (orphaned chunks). This plugin runs after the client
// build, builds the import graph of the public asset directory, and deletes any
// `*.server-*.js` chunk that is unreachable from every non-server (client)
// chunk. It is deliberately conservative: if ANY server chunk is actually
// reachable from a client chunk, it does NOT delete and instead throws, so a
// real client->server import edge can never be silently masked.
function pruneOrphanServerChunks(outDir = ".output/public/assets"): Plugin {
  return {
    name: "hiv-prune-orphan-server-chunks-s101",
    apply: "build",
    // Run late, after the whole build (client + nitro) has written assets.
    closeBundle: {
      order: "post",
      sequential: true,
      handler() {
        if (!existsSync(outDir)) return;
        const importRe =
          /(?:from|import)\s*\(?\s*["']\.\/([A-Za-z0-9._-]+\.js)["']/g;
        const files = readdirSync(outDir).filter((f) => f.endsWith(".js"));
        const graph = new Map<string, Set<string>>();
        for (const f of files) {
          const code = readFileSync(join(outDir, f), "utf8");
          const deps = new Set<string>();
          for (const m of code.matchAll(importRe)) {
            if (m[1]) deps.add(m[1]);
          }
          graph.set(f, deps);
        }
        const isServer = (f: string) => /\.server-[^/]*\.js$/.test(f);
        const clientChunks = files.filter((f) => !isServer(f));

        // Reachability from the union of all client (non-server) chunks.
        const reachable = new Set<string>();
        const stack = [...clientChunks];
        while (stack.length) {
          const x = stack.pop();
          if (!x || reachable.has(x)) continue;
          reachable.add(x);
          for (const d of graph.get(x) ?? []) stack.push(d);
        }

        const serverChunks = files.filter(isServer);
        const reachableServer = serverChunks.filter((f) => reachable.has(f));
        if (reachableServer.length > 0) {
          // A real client -> server edge exists. Removing these would break the
          // client at runtime, so fail the build loudly instead of masking it.
          throw new Error(
            `[s101-prune] Refusing to prune: ${reachableServer.length} server ` +
              `chunk(s) are reachable from client chunks and must be fixed at ` +
              `the source import level, not pruned: ${reachableServer.join(", ")}`,
          );
        }

        let removed = 0;
        for (const f of serverChunks) {
          rmSync(join(outDir, f), { force: true });
          removed++;
        }
        if (removed > 0) {
          // eslint-disable-next-line no-console
          console.log(
            `[s101-prune] Removed ${removed} orphaned server-only chunk(s) from ${outDir} (B3-06).`,
          );
        }
      },
    },
  };
}

// Installer app cache (Jo, 3 Nov 2026): after the whole build is written, generate .output/public/sw.js from this
// build's Start manifest (the shell routes' preloads, every chunk they import, the stylesheet) so a return visit on a
// bad signal draws My work from the phone. The worker is registered only when the switch in
// installer-app-cache.core is on; writing the file changes nothing until then. Rules in that core module.
function installerServiceWorker(outDir = ".output"): Plugin {
  return {
    name: "hiv-installer-app-cache-sw",
    apply: "build",
    closeBundle: {
      order: "post",
      sequential: true,
      handler() {
        const serverDir = join(outDir, "server");
        const assetsDir = join(outDir, "public", "assets");
        if (!existsSync(serverDir) || !existsSync(assetsDir)) return;
        const manifestFile = readdirSync(serverDir).find((f) => f.startsWith("_tanstack-start-manifest"));
        if (!manifestFile) return;
        const routes = parseStartManifest(readFileSync(join(serverDir, manifestFile), "utf8"));
        const assets = readdirSync(assetsDir);
        const importsOf = (assetPath: string) => {
          const file = join(outDir, "public", assetPath);
          if (!existsSync(file)) return [];
          return [...readFileSync(file, "utf8").matchAll(/from\s*["']\.\/([A-Za-z0-9._-]+\.js)["']/g)].map((m) => `/assets/${m[1]}`);
        };
        const precache = precacheList(routes, importsOf, assets);
        const version = cacheVersion(precache);
        writeFileSync(join(outDir, "public", "sw.js"), serviceWorkerSource({ version, precache }));
        console.log(`[installer-app-cache] wrote public/sw.js (cache ${version}, ${precache.length} files precached).`);
      },
    },
  };
}

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

// Speed (portal speed step 2B): the HTML preloads a route chunk and its DIRECT imports only (TanStack's manifest goes one
// level deep), so a shared chunk two levels down is fetched one round trip later. Two of those sat on every signed-in
// page's critical path: supabase-js (needed before the saved session is read, so before any server call can start) and
// the server-function runtime (needed to make the call). Each is kept in a chunk of its own that the entry and the route
// chunks import directly, so it is in the preload list. Behaviour unchanged: only which file holds which module.
const CLIENT_CHUNK_GROUPS = {
  // The deprecated name is `advancedChunks`; Vite 8 passes `codeSplitting` through to rolldown.
  groups: [
    { name: "supabase", test: (id: string) => /[\\/]node_modules[\\/]@supabase[\\/]/.test(id) || /[\\/]src[\\/]integrations[\\/]supabase[\\/](client|previewAuthStorage)\.ts$/.test(id) },
    { name: "start-client", test: (id: string) => /[\\/]node_modules[\\/]@tanstack[\\/](react-start|react-start-client|start-client-core|start-storage-context)[\\/]/.test(id) || /[\\/]src[\\/]integrations[\\/]supabase[\\/]auth-middleware\.ts$/.test(id) },
  ],
};

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [ignoreClientDisconnects(), pruneOrphanServerChunks(), installerServiceWorker()],
    environments: { client: { build: { rolldownOptions: { output: { codeSplitting: CLIENT_CHUNK_GROUPS } } } } },
  },
});
