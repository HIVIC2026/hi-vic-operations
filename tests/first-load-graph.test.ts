// Speed (portal speed step 1, task 1): the first open of the sign-in page loads only what that page needs.
// Source scan: the root layout does not pull in the router (and with it every route), sign-out handling does not pull
// in every installer server call, the sign-in card does not pull in the installer screen frame, and other pages are
// fetched when a link is about to be used (hover/touch), not up front.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = join(import.meta.dir, "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");

/** Files reached from `entry` through plain (not `import type`, not `import()`) imports inside src/. */
function staticGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [join(root, entry)];
  const resolveSpec = (from: string, spec: string): string | null => {
    const base = spec.startsWith("@/") ? join(root, "src", spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
    if (!base) return null;
    for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
      const p = base.replace(/\?.*$/, "") + ext;
      if (existsSync(p) && statSync(p).isFile()) return p;
    }
    return null;
  };
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.tsx?$/.test(file)) continue;
    const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const m of code.matchAll(/(?:^|\n)\s*(import|export)\s+(type\s+)?([^;'"]*?\bfrom\s+)?["']([^"']+)["']/g)) {
      if (m[2] || (m[1] === "export" && !m[3])) continue;
      const next = resolveSpec(file, m[4]);
      if (next) stack.push(next);
    }
  }
  return new Set([...seen].map((f) => f.slice(root.length + 1)));
}

describe("first load: only the page", () => {
  test("the root layout does not import the router (which brings every route with it)", () => {
    expect(src("src/routes/__root.tsx")).not.toMatch(/from\s+["'](\.\.\/router|@\/router)["']/);
    expect(src("src/routes/__root.tsx")).toMatch(/isStaleChunkError[^;]*from\s+["']@\/lib\/page-recovery\.core["']/);
  });

  test("sign-out handling does not statically pull in the installer server calls", () => {
    const graph = staticGraph("src/lib/auth-change.ts");
    expect(graph.has("src/lib/trade-view.functions.ts")).toBe(false);
    expect(staticGraph("src/lib/trade-route-prefetch.ts").has("src/lib/trade-view.functions.ts")).toBe(false);
  });

  test("the sign-in card does not import the installer screen frame", () => {
    expect(staticGraph("src/components/portal/SignInCard.tsx").has("src/components/trade/TradeShell.tsx")).toBe(false);
    expect(staticGraph("src/components/trade/trade-classes.ts").size).toBe(1);
  });

  test("the Templates route reads its address without loading every template (validateSearch loads with the app)", () => {
    const route = "src/routes/_authenticated/admin.templates.tsx";
    expect(src(route)).not.toMatch(/from\s+["']@\/lib\/template-hub\.core["']/);
    expect(staticGraph("src/lib/template-sections.core.ts").size).toBe(1);
  });

  test("route loaders (part of the app's first download) load their server calls at use time", () => {
    const pins = [
      { route: "src/routes/_authenticated/admin.in-house-batches.tsx", mod: "in-house-batch.functions", call: "getInHouseBatches" },
      { route: "src/routes/_authenticated/field.practice.$jobId.$auditId.tsx", mod: "mitti-practice.functions", call: "readPracticeForm" },
    ];
    for (const p of pins) {
      const code = src(p.route);
      const staticLine = code.split("\n").find((l) => /^import\s/.test(l) && l.includes(`@/lib/${p.mod}"`)) ?? "";
      expect(staticLine).not.toContain(p.call);
    }
  });

  test("other pages are fetched on intent (hover/touch), and an intent preload is reused for 30 s", () => {
    const r = src("src/router.tsx");
    expect(r).toMatch(/defaultPreload:\s*"intent"/);
    expect(r).toMatch(/defaultPreloadStaleTime:\s*30_000/);
  });
});
