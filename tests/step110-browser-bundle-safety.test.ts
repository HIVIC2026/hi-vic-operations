// STEP 110/111 — regression test for the STEP 109 blank-Preview incident.
//
// env-guard.ts statically imported background.server.ts (node:async_hooks), which the
// bundler externalized for the browser and crashed the whole Lovable Preview before React
// mounted. This test walks the STATIC import graph of the browser-reachable entry modules
// and fails if any module in that graph:
//   1. statically imports a `node:*` specifier, or
//   2. statically imports src/lib/background.server.ts (the node:async_hooks carrier), or
//   3. is env-guard.ts while statically importing node:/background.server.
//
// Compiler boundary (verified against the STEP 110 production build): TanStack Start strips
// the server closures of `*.functions.ts` createServerFn modules from the client bundle, so
// static imports FROM a *.functions.ts file INTO a *.server.ts file never reach the browser
// (.output/public contains no AsyncLocalStorage / upsertEnquiry / node: imports). That edge
// shape is therefore exempt. The STEP 109 pattern — a SHARED module (env-guard.ts) that
// browser code like client.ts imports directly pulling in server-only code — is NOT exempt
// and is exactly what these tests catch.
//
// `import type` statements and dynamic `import()` are ignored (they do not put the target
// module into the browser bundle's evaluation path at load time).
import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";

const ROOT = import.meta.dir + "/..";
const SRC = resolve(ROOT, "src");

// Browser-reachable entry modules (client bundle evaluation roots).
const ENTRIES = [
  "src/router.tsx",
  "src/routes/__root.tsx",
  "src/integrations/supabase/client.ts",
  "src/lib/interest.functions.ts",
];

const STATIC_IMPORT_RE = /^\s*import\s+(?!type\b)(?:[\s\S]*?\sfrom\s*)?["']([^"']+)["']/gm;

/** TanStack Start compiler boundary: server closures of createServerFn modules are stripped. */
function isStrippedServerEdge(fromFile: string, target: string): boolean {
  return /\/[^/]*\.functions\.(ts|tsx)$/.test(fromFile) && /\/[^/]*\.server\.(ts|tsx)$/.test(target);
}

function resolveSpecifier(fromFile: string, spec: string): string | null {
  if (spec.startsWith("@/")) {
    return resolveIfExists(join(SRC, spec.slice(2)));
  }
  if (spec.startsWith(".")) {
    return resolveIfExists(resolve(dirname(fromFile), spec));
  }
  return null; // bare specifier (node_modules) — not project source
}

function resolveIfExists(base: string): string | null {
  for (const ext of ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"]) {
    const p = base + ext;
    try {
      if (statSync(p).isFile()) return p;
    } catch {
      /* candidate does not exist */
    }
  }
  return null;
}

function staticImports(file: string): string[] {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(STATIC_IMPORT_RE)].map((m) => m[1]);
}

/** BFS over the static import graph starting at `entries`. */
function browserGraph(entries: string[]): { files: string[]; edges: Array<{ from: string; spec: string }> } {
  const queue = entries.map((e) => resolve(ROOT, e)).filter((p) => existsSync(p));
  const seen = new Set<string>(queue);
  const badEdges: Array<{ from: string; spec: string }> = [];
  while (queue.length) {
    const file = queue.shift() as string;
    for (const spec of staticImports(file)) {
      if (spec.startsWith("node:")) {
        badEdges.push({ from: file, spec });
        continue;
      }
      const target = resolveSpecifier(file, spec);
      if (target && !isStrippedServerEdge(file, target)) {
        if (!seen.has(target)) {
          seen.add(target);
          queue.push(target);
        }
      }
    }
  }
  return { files: [...seen], edges: badEdges };
}

describe("STEP 110/111: browser-bundle safety (no node:/server-only imports in client graph)", () => {
  test("no browser-reachable module statically imports a node:* builtin", () => {
    const { edges } = browserGraph(ENTRIES);
    expect(edges).toEqual([]);
  });

  test("background.server.ts (node:async_hooks carrier) is absent from the browser graph", () => {
    const { files } = browserGraph(ENTRIES);
    const offender = files.find((f) => f.endsWith("src/lib/background.server.ts"));
    expect(offender).toBeUndefined();
  });

  test("env-guard.ts statically imports no node: builtin and no server-only module", () => {
    const guard = join(SRC, "integrations/supabase/env-guard.ts");
    const specs = staticImports(guard).filter((s) => s.startsWith("node:") || s.includes("background.server") || s.endsWith(".server"));
    expect(specs).toEqual([]);
  });

  test("server requests resolve a request-scoped hostname through the registered ALS adapter (no process-global)", () => {
    // Simulates server boot: register the adapter, then a request sets a hostname in
    // AsyncLocalStorage. resolveHostname() must return THAT request's hostname while the
    // request is in flight, and null (no stale/global value) afterwards.
    const { requestContext } = require("@/lib/background.server") as typeof import("@/lib/background.server");
    // Explicit install (server.ts calls this at boot); idempotent, safe to call again.
    const { installEnvGuardServerAdapter } = require("@/integrations/supabase/env-guard.server") as typeof import("@/integrations/supabase/env-guard.server");
    installEnvGuardServerAdapter();
    const guard = require("@/integrations/supabase/env-guard") as typeof import("@/integrations/supabase/env-guard");

    const PREVIEW = "fb35adfe-10bf-4d4c-987d-28567ca1ddeb.lovableproject.com";
    let inside: { resolved: string | null; mode: string } | undefined;
    requestContext.run({ hostname: PREVIEW }, () => {
      inside = { resolved: guard.resolveHostname(), mode: guard.detectRuntimeMode({}) };
    });
    expect(inside?.resolved).toBe(PREVIEW);
    expect(inside?.mode).toBe("lovable-preview");
    // After the request completes, nothing leaks: no request, no hostname.
    expect(guard.resolveHostname()).toBe(null);
    expect(guard.detectRuntimeMode({})).toBe("local");
  });
});
