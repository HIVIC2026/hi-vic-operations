// Installer app cache (Jo, 3 Nov 2026): a service worker keeps the installer app's shell (the /field HTML, the entry and
// My work's route chunks, the stylesheet) on the phone, so a return visit on a bad signal draws My work from the phone
// instead of downloading the ~260 kB again. PURE, no imports: read by the build (vite.config.ts writes sw.js from it),
// by the browser registration (installer-app-cache.ts) and by the tests.
//
// Rules: hashed /assets/ files are cache-first (a hash never changes meaning); the /field HTML is network-first with the
// kept copy as the fallback; nothing else is touched — server functions (/_serverFn), /api, Supabase (another origin)
// and anything with auth go straight to the network, always. A new build gets a new cache (version = hash of its
// precache list); the new worker takes over at once (skipWaiting + clients.claim) and deletes the old caches. The
// existing stale-chunk recovery (page-recovery.core, __root's early recovery) still works: its reload is a navigation
// with `?_v=<now>`, which the worker sends to the network first, so a fresh shell is fetched whenever there is signal.

/** The switch. OFF until Jo flips it: a one-line change here and a publish (no settings read the installer screens
 *  already make carries a global flag, and a new database switch would need a migration first). */
export const SERVICE_WORKER_ENABLED = false;

export const SW_PATH = "/sw.js";
/** Pages the worker controls: /field and everything under it (the installer app), nothing else. */
export const SW_SCOPE = "/field";
/** The HTML kept as the app shell. */
export const SHELL_PATH = "/field";
export const CACHE_PREFIX = "hiv-installer-app:";
/** A build asset: `/assets/<name>-<8-char hash>.<ext>`. Only these are ever cached first. */
export const HASHED_ASSET = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/;
/** The routes whose chunks make up the shell: the document, the signed-in area, the trade area and My work. */
export const SHELL_ROUTES = ["__root__", "/_authenticated", "/_authenticated/field", "/_authenticated/field/"] as const;

export function underScope(pathname: string): boolean {
  return pathname === SW_SCOPE || pathname.startsWith(`${SW_SCOPE}/`);
}

export type StartManifestRoutes = Record<string, { preloads: string[] }>;

/** The route → preloads map from TanStack Start's built manifest module (`_tanstack-start-manifest_v-*.mjs`). */
export function parseStartManifest(text: string): StartManifestRoutes {
  const routes: StartManifestRoutes = {};
  const heads = [...text.matchAll(/(?:"([^"]+)"|(__root__)): \{/g)];
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i]!;
    const id = h[1] ?? h[2]!;
    const block = text.slice(h.index!, i + 1 < heads.length ? heads[i + 1]!.index! : text.length);
    const p = block.indexOf("preloads:");
    const preloads: string[] = [];
    if (p >= 0) {
      const end = block.indexOf("]", p);
      for (const m of block.slice(p, end).matchAll(/"(\/assets\/[^"]+)"/g)) preloads.push(m[1]!);
    }
    routes[id] = { preloads };
  }
  return routes;
}

/** Everything a cold My work visit downloads from this build: the shell routes' preloads, every chunk they import
 *  (any depth; `importsOf` reads a chunk's `from "./x.js"` edges) and the stylesheet(s). Sorted, unique. Throws when a
 *  shell route is missing from the manifest, so a build never ships an empty or partial shell. */
export function precacheList(routes: StartManifestRoutes, importsOf: (assetPath: string) => string[], assetFiles: string[]): string[] {
  const out = new Set<string>();
  const queue: string[] = [];
  for (const id of SHELL_ROUTES) {
    const r = routes[id];
    if (!r) throw new Error(`installer app cache: route ${id} is not in the Start manifest`);
    queue.push(...r.preloads);
  }
  while (queue.length) {
    const f = queue.pop()!;
    if (out.has(f)) continue;
    out.add(f);
    queue.push(...importsOf(f));
  }
  for (const f of assetFiles) if (f.endsWith(".css")) out.add(`/assets/${f}`);
  return [...out].filter((f) => HASHED_ASSET.test(f)).sort();
}

/** FNV-1a (32-bit) of the list: a new build (new hashes) gives a new cache name, the same build the same name. */
export function cacheVersion(list: string[]): string {
  let h = 0x811c9dc5;
  for (const ch of list.join("\n")) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

export type AppCachePlan = "register" | "unregister" | "none";
/** What the browser does on a /field page: register when the switch is on (production, service workers available),
 *  unregister a worker left from an earlier ON when the switch is off, nothing anywhere else. */
export function appCachePlan(f: { enabled: boolean; supported: boolean; production: boolean; pathname: string }): AppCachePlan {
  if (!f.supported || !f.production || !underScope(f.pathname)) return "none";
  return f.enabled ? "register" : "unregister";
}

/** The service worker, with this build's cache version and precache list inlined. */
export function serviceWorkerSource(o: { version: string; precache: string[] }): string {
  return `// Home Insulation Victoria installer app cache. Generated at build time (vite.config.ts, installer-app-cache.core.ts).
// Hashed /assets/ files: cache-first. The /field HTML: network-first, kept copy as the fallback. Nothing else is touched.
const CACHE = "${CACHE_PREFIX}${o.version}";
const CACHE_PREFIX = "${CACHE_PREFIX}";
const SHELL = "${SHELL_PATH}";
const SCOPE = "${SW_SCOPE}";
const PRECACHE = ${JSON.stringify(o.precache)};
const HASHED = ${HASHED_ASSET.toString()};

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(PRECACHE); // every file or none: a missing file fails the install and the old worker stays
    // The shell: best effort here (it is also kept on every visit); the HTML of /field holds no user data (the signed-in
    // area is client-rendered), and a signed-out answer is the same shell.
    try { const r = await fetch(SHELL, { cache: "no-store", credentials: "same-origin" }); if (r.ok && r.type === "basic") await cache.put(SHELL, r); } catch (_) {}
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith(CACHE_PREFIX) && name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});

const underScope = (pathname) => pathname === SCOPE || pathname.startsWith(SCOPE + "/");

async function shellNetworkFirst(request, url) {
  const cache = await caches.open(CACHE);
  const key = url.origin + url.pathname; // the recovery reload adds ?_v=…: same page, same kept copy
  try {
    const fresh = await fetch(request);
    if (fresh.ok && fresh.type === "basic") { await cache.put(key, fresh.clone()); return fresh; }
    if (fresh.status < 500) return fresh; // a real answer (redirect, not found): never replaced by a kept copy
    return (await cache.match(key)) || (await cache.match(SHELL)) || fresh;
  } catch (e) {
    const kept = (await cache.match(key)) || (await cache.match(SHELL));
    if (kept) return kept;
    throw e;
  }
}

async function assetCacheFirst(request) {
  const cache = await caches.open(CACHE);
  const kept = await cache.match(request);
  if (kept) return kept;
  const fresh = await fetch(request);
  if (fresh.ok && fresh.type === "basic") await cache.put(request, fresh.clone());
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase, fonts, anything else: untouched
  if (request.mode === "navigate") {
    if (underScope(url.pathname)) event.respondWith(shellNetworkFirst(request, url));
    return;
  }
  if (url.pathname.startsWith("/assets/") && HASHED.test(url.pathname)) event.respondWith(assetCacheFirst(request));
  // Everything else (server functions, the API, files, images) goes to the network as if there were no worker.
});
`;
}
