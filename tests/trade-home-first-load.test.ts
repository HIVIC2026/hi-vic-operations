// Portal speed step 2B (installer My work, cold phone visit): the /field page's own code stays small. Two checks:
// (1) source scan, always runs — the static import graph of the home route (plain `import ... from`, not `import()`,
//     not `import type`; `*.server.*` not followed; `*.functions.ts` not followed because the build replaces their bodies
//     with RPC stubs) must stay under a source-byte budget and must not reach the heavy modules the home only needed a
//     few lines of (the rest of trade-view.core and installer-screens.core, the in-house booking row and its date/
//     compliance rules);
// (2) build scan, runs only when `bunx vite build` output is present — the gzip bytes of everything a cold /field visit
//     downloads (entry chunk closure + the route chunks) must stay under a budget set from the measured result.
// Budgets were set from the build on 3 Nov 2026 (see qa/installer-speed/2026-11-03-home-cold-path.md).
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const ROOT = resolve(import.meta.dir, "..");
const SRC = join(ROOT, "src");
const HOME_ROUTE = join(SRC, "routes", "_authenticated", "field.index.tsx");

/** Source bytes of the home route's static import graph: 335,328 on 3 Nov 2026 before this step; budget = 40% under. */
const SOURCE_BUDGET = 200_000;
/** Gzip bytes a cold /field visit downloads (entry + route chunks): 307,381 on 3 Nov 2026 before this step, 276,378
 *  after (246,000 of it the entry: react-dom, router, query, supabase-js, root). Budget = the result after this step + 3%. */
const COLD_PATH_GZ_BUDGET = 285_000;
/** Gzip bytes of the /field route chunks beyond the entry (the part the home's own imports decide): 60,400 before this
 *  step, 30,300 after; budget = 34% under before. */
const ROUTE_GZ_BUDGET = 40_000;

const EDGE = /(?:^|\n)[ \t]*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/g;

function resolveSpec(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

function homeGraph() {
  const seen = new Set<string>([HOME_ROUTE]);
  const parent = new Map<string, string>();
  const queue = [HOME_ROUTE];
  while (queue.length) {
    const file = queue.shift()!;
    const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const m of code.matchAll(EDGE)) {
      const target = resolveSpec(file, m[1]!);
      if (!target || seen.has(target)) continue;
      const name = basename(target);
      if (/\.server\.tsx?$/.test(name)) continue;
      seen.add(target);
      parent.set(target, file);
      if (!/\.functions\.ts$/.test(name)) queue.push(target);
    }
  }
  const chain = (f: string) => { const c = [f]; let x = f; while (parent.has(x)) { x = parent.get(x)!; c.push(x); } return c.reverse().map((p) => relative(ROOT, p)).join(" -> "); };
  return { files: seen, bytes: [...seen].reduce((t, f) => t + statSync(f).size, 0), chain };
}

/** Modules the home used a few lines of; those lines now live in small modules of their own (re-exported from here). */
const HEAVY = [
  "src/lib/trade-view.core.ts", "src/lib/installer-screens.core.ts",
  "src/components/trade/InHouseBookingCard.tsx", "src/components/trade/installer-kit.tsx",
  "src/lib/install-days.core.ts", "src/lib/piesa-windows.core.ts", "src/lib/worker-compliance.core.ts", "src/lib/in-house-booking.core.ts",
  "src/lib/display-name.core.ts", "src/lib/name-address-tidy.core.ts",
];

describe("installer My work: first load stays small (source scan)", () => {
  test("the home route's static import graph is under the source budget", () => {
    const g = homeGraph();
    const rows = [...g.files].map((f) => `${String(statSync(f).size).padStart(7)} ${relative(ROOT, f)}`).sort().join("\n");
    if (g.bytes > SOURCE_BUDGET) console.log(`home graph ${g.bytes} bytes over ${SOURCE_BUDGET}:\n${rows}`);
    expect(g.bytes).toBeLessThanOrEqual(SOURCE_BUDGET);
  });

  test("the heavy modules the home only needed a few lines of are not on the path", () => {
    const g = homeGraph();
    const reached = HEAVY.filter((h) => g.files.has(join(ROOT, h))).map((h) => g.chain(join(ROOT, h)));
    expect(reached).toEqual([]);
  });

  test("the home's helpers are the same values as their old homes export", async () => {
    const words = await import("../src/lib/trade-home-words.core");
    const tv = await import("../src/lib/trade-view.core");
    expect(tv.tradeGreeting).toBe(words.tradeGreeting);
    expect(tv.goneIn).toBe(words.goneIn);
    expect(tv.dayTile).toBe(words.dayTile);
    expect(tv.ELECTRICIAN_WORK_WORDS).toBe(words.ELECTRICIAN_WORK_WORDS);
    const line = await import("../src/lib/installer-status-line.core");
    const screens = await import("../src/lib/installer-screens.core");
    expect(screens.installerStatusLine).toBe(line.installerStatusLine);
    expect(screens.DO_READY_CHECK_TITLE).toBe(line.DO_READY_CHECK_TITLE);
    expect(screens.ENTER_PRICE_TITLE).toBe(line.ENTER_PRICE_TITLE);
    expect(screens.WAITING_BOSS_TITLE).toBe(line.WAITING_BOSS_TITLE);
    // Both small modules import nothing.
    for (const f of ["src/lib/trade-home-words.core.ts", "src/lib/installer-status-line.core.ts"]) {
      expect(readFileSync(join(ROOT, f), "utf8")).not.toMatch(/(?:^|\n)\s*(?:import|export)\s[^;]*\sfrom\s/);
    }
  });
});

// ---- Build scan (needs `bunx vite build`; skipped, not passed, when the output is absent) ----
const ASSETS = join(ROOT, ".output", "public", "assets");
const MANIFEST = existsSync(join(ROOT, ".output", "server")) ? readdirSync(join(ROOT, ".output", "server")).find((f) => f.startsWith("_tanstack-start-manifest")) : undefined;
const built = existsSync(ASSETS) && !!MANIFEST;

/** Everything a cold /field visit downloads: the entry chunk's static closure plus the field layout and home route
 *  chunks' closures (the route chunks are what the manifest preloads and Vite's preload helper fetch). */
function coldFieldPath(assets: string) {
  const files = readdirSync(assets).filter((f) => f.endsWith(".js"));
  const code = new Map(files.map((f) => [f, readFileSync(join(assets, f), "utf8")]));
  const staticRe = /(?:^|[;\n])import\s*(?:[^;'"]*?\s*from\s*)?["']\.\/([A-Za-z0-9._-]+\.js)["']/g;
  const edges = new Map<string, string[]>();
  for (const f of files) edges.set(f, [...code.get(f)!.matchAll(staticRe)].map((m) => m[1]!));
  const closure = (start: string[]) => { const seen = new Set<string>(); const stack = [...start]; while (stack.length) { const f = stack.pop()!; if (seen.has(f)) continue; seen.add(f); for (const d of edges.get(f) ?? []) stack.push(d); } return seen; };
  const chunk = (p: string) => files.find((f) => f.startsWith(`${p}-`))!;
  const entry = closure([chunk("index")]);
  const route = new Set([...closure([chunk("field"), chunk("field.index")])].filter((f) => !entry.has(f)));
  const gz = (s: Set<string>) => [...s].reduce((t, f) => t + gzipSync(code.get(f)!).length, 0);
  const list = (s: Set<string>) => [...s].map((f) => ({ f, gz: gzipSync(code.get(f)!).length })).sort((a, b) => b.gz - a.gz);
  return { entry, route, entryGz: gz(entry), routeGz: gz(route), totalGz: gz(entry) + gz(route), list };
}

describe("installer My work: first load stays small (build scan)", () => {
  (built ? test : test.skip)("a cold /field visit downloads at most the gzip budget", () => {
    const p = coldFieldPath(ASSETS);
    const show = (s: Set<string>) => p.list(s).map((x) => `${String((x.gz / 1024).toFixed(1)).padStart(7)} kB gz  ${x.f}`).join("\n");
    if (p.totalGz > COLD_PATH_GZ_BUDGET) console.log(`entry ${p.entryGz} + route ${p.routeGz} = ${p.totalGz} bytes gz\n--- entry\n${show(p.entry)}\n--- route\n${show(p.route)}`);
    expect(p.totalGz).toBeLessThanOrEqual(COLD_PATH_GZ_BUDGET);
    expect(p.routeGz).toBeLessThanOrEqual(ROUTE_GZ_BUDGET);
  });

  (built ? test : test.skip)("the moved modules are not in the /field route chunks", () => {
    const p = coldFieldPath(ASSETS);
    const names = [...p.route, ...p.entry];
    const bad = names.filter((f) => /^(installer-screens\.core|trade-view\.core|InHouseBookingCard|installer-kit|install-days\.core|worker-compliance\.core)-/.test(f));
    expect(bad).toEqual([]);
  });
});
