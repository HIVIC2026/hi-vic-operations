// Installer app cache (Jo, 3 Nov 2026): a service worker keeps the installer app's shell on the phone so a return visit
// on a bad signal draws My work without downloading the ~260 kB again. Behind a switch (nothing changes until Jo flips
// it). Three checks here: (1) the pure precache-list generator from a fixture manifest, (2) the generated sw.js from a
// real build lists only hashed assets + the shell (skipped, never passed, without `bunx vite build` output), (3) source:
// registration is gated by the switch and happens only under /field. The offline browser check is its own file.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  CACHE_PREFIX, HASHED_ASSET, SERVICE_WORKER_ENABLED, SHELL_PATH, SHELL_ROUTES, SW_PATH, SW_SCOPE,
  appCachePlan, cacheVersion, parseStartManifest, precacheList, serviceWorkerSource, underScope,
} from "../src/lib/installer-app-cache.core";

const ROOT = resolve(import.meta.dir, "..");

const FIXTURE_MANIFEST = `var tsrStartManifest = () => ({ routes: {
	__root__: {
		filePath: "/x/src/routes/__root.tsx",
		children: ["/", "/_authenticated"],
		preloads: [
			"/assets/index-Do0m7UrM.js",
			"/assets/rolldown-runtime-hePW80VL.js",
			"/assets/supabase-BhhYoqSE.js"
		],
		scripts: [{ attrs: { type: "module", async: !0, src: "/assets/index-Do0m7UrM.js" } }]
	},
	"/": {
		filePath: "/x/src/routes/index.tsx",
		children: void 0,
		preloads: ["/assets/routes-Be21VLjB.js", "/assets/public-calculator-page-CsCWZg8C.js"]
	},
	"/_authenticated": {
		filePath: "/x/src/routes/_authenticated/route.tsx",
		children: ["/_authenticated/field"],
		preloads: ["/assets/route-Chp63uBP.js"]
	},
	"/_authenticated/field": {
		filePath: "/x/src/routes/_authenticated/field.tsx",
		children: ["/_authenticated/field/"],
		preloads: ["/assets/field-Chp63uBP.js"]
	},
	"/_authenticated/field/": {
		filePath: "/x/src/routes/_authenticated/field.index.tsx",
		children: void 0,
		preloads: [
			"/assets/field.index-iPdTvAmz.js",
			"/assets/trade-view.functions-CUvuyoPL.js"
		]
	},
	"/_authenticated/field/$jobId": {
		filePath: "/x/src/routes/_authenticated/field.$jobId.tsx",
		children: void 0,
		preloads: ["/assets/field._jobId-CKz9_tX4.js"]
	}
} });
export { tsrStartManifest };`;

/** The chunks' static imports, as the build writes them (`from"./x.js"`). */
const IMPORTS: Record<string, string[]> = {
  "/assets/index-Do0m7UrM.js": ["/assets/rolldown-runtime-hePW80VL.js", "/assets/supabase-BhhYoqSE.js"],
  "/assets/supabase-BhhYoqSE.js": ["/assets/tslib.es6-Tae09705.js"],
  "/assets/field.index-iPdTvAmz.js": ["/assets/index-Do0m7UrM.js", "/assets/installer-home.core-DUiOHs8e.js", "/assets/trade-view.functions-CUvuyoPL.js"],
  "/assets/installer-home.core-DUiOHs8e.js": ["/assets/installer-status-line.core-C4_7SSFy.js"],
  "/assets/installer-status-line.core-C4_7SSFy.js": ["/assets/job-wording-Br94nWd5.js"],
  "/assets/trade-view.functions-CUvuyoPL.js": ["/assets/index-Do0m7UrM.js"],
  "/assets/field._jobId-CKz9_tX4.js": ["/assets/huge-office-thing-AAAAAAAA.js"],
};

describe("installer app cache: precache list (pure)", () => {
  test("parses the Start manifest's routes and their preloads", () => {
    const routes = parseStartManifest(FIXTURE_MANIFEST);
    expect(Object.keys(routes).sort()).toEqual(["/", "/_authenticated", "/_authenticated/field", "/_authenticated/field/", "/_authenticated/field/$jobId", "__root__"]);
    expect(routes["__root__"]!.preloads).toEqual(["/assets/index-Do0m7UrM.js", "/assets/rolldown-runtime-hePW80VL.js", "/assets/supabase-BhhYoqSE.js"]);
    expect(routes["/_authenticated/field/"]!.preloads).toEqual(["/assets/field.index-iPdTvAmz.js", "/assets/trade-view.functions-CUvuyoPL.js"]);
  });

  test("the list is the shell routes' preloads, everything they import (any depth) and the stylesheet — sorted, no repeats, nothing else", () => {
    const routes = parseStartManifest(FIXTURE_MANIFEST);
    const list = precacheList(routes, (f) => IMPORTS[f] ?? [], ["styles-D8QXDGIw.css", "index-Do0m7UrM.js"]);
    expect(list).toEqual([
      "/assets/field-Chp63uBP.js",
      "/assets/field.index-iPdTvAmz.js",
      "/assets/index-Do0m7UrM.js",
      "/assets/installer-home.core-DUiOHs8e.js",
      "/assets/installer-status-line.core-C4_7SSFy.js",
      "/assets/job-wording-Br94nWd5.js",
      "/assets/rolldown-runtime-hePW80VL.js",
      "/assets/route-Chp63uBP.js",
      "/assets/styles-D8QXDGIw.css",
      "/assets/supabase-BhhYoqSE.js",
      "/assets/trade-view.functions-CUvuyoPL.js",
      "/assets/tslib.es6-Tae09705.js",
    ]);
    // Not the job page (visited screens are kept as they are fetched), not the public calculator.
    expect(list.some((f) => f.includes("field._jobId") || f.includes("huge-office") || f.includes("calculator"))).toBe(false);
    expect(SHELL_ROUTES).toEqual(["__root__", "/_authenticated", "/_authenticated/field", "/_authenticated/field/"]);
    expect(list.every((f) => HASHED_ASSET.test(f))).toBe(true);
  });

  test("a missing shell route is an error, never an empty list", () => {
    const routes = parseStartManifest(FIXTURE_MANIFEST);
    delete routes["/_authenticated/field/"];
    expect(() => precacheList(routes, () => [], [])).toThrow(/\/_authenticated\/field\//);
  });

  test("the cache version follows the list, so a new build gets a new cache and the old one is deleted", () => {
    const a = cacheVersion(["/assets/a-AAAAAAAA.js"]);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(cacheVersion(["/assets/a-AAAAAAAA.js"])).toBe(a);
    expect(cacheVersion(["/assets/a-BBBBBBBB.js"])).not.toBe(a);
    expect(cacheVersion(["/assets/a-AAAAAAAA.js", "/assets/b-AAAAAAAA.js"])).not.toBe(a);
  });

  test("the worker source: versioned cache, precache list, shell network-first, hashed assets cache-first, nothing else touched", () => {
    const src = serviceWorkerSource({ version: "0badf00d", precache: ["/assets/a-AAAAAAAA.js"] });
    expect(src).toContain(`"${CACHE_PREFIX}0badf00d"`);
    expect(src).toContain(`["/assets/a-AAAAAAAA.js"]`);
    expect(src).toContain(`"${SHELL_PATH}"`);
    for (const must of ["skipWaiting", "clients.claim", "caches.delete", "mode === \"navigate\"", "/assets/", "cache: \"no-store\""]) expect(src).toContain(must);
    // Server functions, the API and anything cross-origin are never handled: only same-origin navigations under /field
    // and hashed /assets/ files.
    expect(src).toContain("url.origin !== self.location.origin) return");
    expect(src).not.toMatch(/_serverFn|\/api\//);
  });

  test("scope: /field and everything under it, nothing else", () => {
    expect(underScope("/field")).toBe(true);
    expect(underScope("/field/")).toBe(true);
    expect(underScope("/field/money")).toBe(true);
    expect(underScope("/fields")).toBe(false);
    expect(underScope("/admin")).toBe(false);
    expect(underScope("/")).toBe(false);
    expect(SW_SCOPE).toBe("/field");
    expect(SW_PATH).toBe("/sw.js");
  });

  test("registration plan: only when the switch is on, in a production build, in a browser with service workers, under /field; switching off unregisters", () => {
    const on = { enabled: true, supported: true, production: true, pathname: "/field" };
    expect(appCachePlan(on)).toBe("register");
    expect(appCachePlan({ ...on, pathname: "/field/money" })).toBe("register");
    expect(appCachePlan({ ...on, pathname: "/admin" })).toBe("none");
    expect(appCachePlan({ ...on, supported: false })).toBe("none");
    expect(appCachePlan({ ...on, production: false })).toBe("none");
    expect(appCachePlan({ ...on, enabled: false })).toBe("unregister");
    expect(appCachePlan({ ...on, enabled: false, pathname: "/admin" })).toBe("none");
    expect(appCachePlan({ ...on, enabled: false, supported: false })).toBe("none");
  });

  test("the switch is off until Jo flips it", () => {
    expect(SERVICE_WORKER_ENABLED).toBe(false);
  });
});

describe("installer app cache: registration source", () => {
  const src = (p: string) => readFileSync(join(ROOT, p), "utf8");
  test("only the /field layout route registers, through registerInstallerAppCache, and the client module decides with appCachePlan", () => {
    const routes = join(ROOT, "src", "routes");
    const users: string[] = [];
    const walk = (dir: string) => { for (const f of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, f.name); if (f.isDirectory()) walk(p); else if (/\.tsx?$/.test(f.name) && readFileSync(p, "utf8").includes("installer-app-cache")) users.push(p.slice(ROOT.length + 1)); } };
    walk(routes); walk(join(ROOT, "src", "components")); walk(join(ROOT, "src", "hooks"));
    expect(users).toEqual(["src/routes/_authenticated/field.tsx"]);
    expect(src("src/routes/_authenticated/field.tsx")).toMatch(/registerInstallerAppCache\(\)/);
    const client = src("src/lib/installer-app-cache.ts");
    expect(client).toMatch(/appCachePlan\(/);
    expect(client).toMatch(/enabled:\s*SERVICE_WORKER_ENABLED/);
    expect(client).toMatch(/serviceWorker\.register\(SW_PATH,\s*\{\s*scope:\s*SW_SCOPE\s*\}\)/);
    // The core module (also read by the build) imports nothing.
    expect(src("src/lib/installer-app-cache.core.ts")).not.toMatch(/(?:^|\n)\s*(?:import|export)\s[^;]*\sfrom\s/);
  });
});

// ---- Build scan: needs `bunx vite build` (skipped, not passed, without it) ----
const PUBLIC = join(ROOT, ".output", "public");
const SERVER = join(ROOT, ".output", "server");
const MANIFEST = existsSync(SERVER) ? readdirSync(SERVER).find((f) => f.startsWith("_tanstack-start-manifest")) : undefined;
const built = existsSync(join(PUBLIC, "assets")) && !!MANIFEST;

describe("installer app cache: generated sw.js (build scan)", () => {
  (built ? test : test.skip)("sw.js is written next to the assets and lists exactly the shell routes' chunks (hashed) + the stylesheet, with the shell path", () => {
    const swPath = join(PUBLIC, "sw.js");
    expect(existsSync(swPath)).toBe(true);
    const sw = readFileSync(swPath, "utf8");
    const m = /const PRECACHE = (\[[^\]]*\]);/.exec(sw);
    expect(m).not.toBeNull();
    const precache = JSON.parse(m![1]!) as string[];
    expect(precache.length).toBeGreaterThan(5);
    expect(precache.every((f) => HASHED_ASSET.test(f))).toBe(true);
    for (const f of precache) expect(existsSync(join(PUBLIC, f))).toBe(true);
    expect(sw).toContain(`const SHELL = "${SHELL_PATH}";`);
    // The same list the generator gives from this build's manifest and chunks.
    const routes = parseStartManifest(readFileSync(join(SERVER, MANIFEST!), "utf8"));
    const assets = readdirSync(join(PUBLIC, "assets"));
    const importsOf = (f: string) => [...readFileSync(join(PUBLIC, f), "utf8").matchAll(/from\s*["']\.\/([A-Za-z0-9._-]+\.js)["']/g)].map((x) => `/assets/${x[1]}`);
    const expected = precacheList(routes, importsOf, assets);
    expect(precache).toEqual(expected);
    expect(sw).toContain(`"${CACHE_PREFIX}${cacheVersion(expected)}"`);
    // Never a server-function, API or cross-origin URL.
    expect(precache.some((f) => /_serverFn|\/api\/|^https?:/.test(f))).toBe(false);
  });
});
