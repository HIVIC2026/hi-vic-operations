// Target-specific TanStack Start server-function ID resolution for QA scripts (20 Oct 2026).
// The framework (start-plugin-core start-compiler generateFunctionId) uses two formats:
//   dev   : base64url(JSON {file:"/<path>?tss-serverfn-split", export:"<name>_createServerFn_handler"})
//   build : sha256("<filename>--<name>_createServerFn_handler") hex, possibly de-duplicated or custom.
// We never guess: a dev ID is read from the SERVED client transform of the module; a build ID is accepted only when
// the exact candidate appears in the SERVED compiled client JavaScript. Anything else is "unresolved" — a
// diagnostic failure, never a permission result.
import { createHash } from "node:crypto";

export type FnSpec = { file: string; name: string };
export type Resolution = { mode: "dev" | "build" | "unresolved"; ids: Record<string, string>; missing: string[]; detail: string };
export const fnKey = (s: FnSpec) => `${s.file}#${s.name}`;

export function decodeDevId(id: string): { file: string; export: string } | null {
  try {
    const v = JSON.parse(Buffer.from(id, "base64url").toString("utf8")) as { file?: unknown; export?: unknown };
    return typeof v.file === "string" && typeof v.export === "string" ? { file: v.file, export: v.export } : null;
  } catch { return null; }
}

/** All dev IDs in a served client module, by function name, checked against the expected file. */
export function devIdsFromModule(text: string, file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/createClientRpc\(\s*"([A-Za-z0-9_-]+)"\s*\)/g)) {
    const d = decodeDevId(m[1]!);
    if (!d || !d.export.endsWith("_createServerFn_handler")) continue;
    if (d.file.split("?")[0]!.replace(/^\//, "") !== file.replace(/^\//, "")) continue;
    out[d.export.slice(0, -"_createServerFn_handler".length)] = m[1]!;
  }
  return out;
}

export const buildCandidate = (s: FnSpec) => createHash("sha256").update(`${s.file}--${s.name}_createServerFn_handler`).digest("hex");

type Fetcher = (url: string) => Promise<{ status: number; text: () => Promise<string> }>;

/** Collect served compiled client JS reachable from the root page (bounded). */
async function servedClientJs(base: string, fetcher: Fetcher, cap = 400): Promise<string[]> {
  const root = await fetcher(`${base}/`); if (root.status !== 200) return [];
  const html = await root.text();
  const queue = [...html.matchAll(/(?:src|href)="(\/[^"]+\.js)"/g)].map((m) => m[1]!);
  const seen = new Set<string>(); const bodies: string[] = [];
  while (queue.length && seen.size < cap) {
    const p = queue.shift()!; if (seen.has(p)) continue; seen.add(p);
    const r = await fetcher(`${base}${p}`).catch(() => null); if (!r || r.status !== 200) continue;
    const t = await r.text(); bodies.push(t);
    const dir = p.slice(0, p.lastIndexOf("/") + 1);
    for (const m of t.matchAll(/["'`](\.{1,2}\/[^"'`]+\.js|\/assets\/[^"'`]+\.js)["'`]/g)) {
      const ref = m[1]!; const abs = ref.startsWith("/") ? ref : new URL(ref, `http://x${dir}`).pathname;
      if (!seen.has(abs)) queue.push(abs);
    }
  }
  return bodies;
}

export async function resolveServerFns(base: string, specs: FnSpec[], fetcher: Fetcher = (u) => fetch(u)): Promise<Resolution> {
  const ids: Record<string, string> = {};
  // 1) dev: the served transform of each source module carries the exact IDs.
  let dev = false;
  for (const file of [...new Set(specs.map((s) => s.file))]) {
    const r = await fetcher(`${base}/${file}`).catch(() => null);
    if (!r || r.status !== 200) continue;
    const found = devIdsFromModule(await r.text(), file);
    if (Object.keys(found).length) dev = true;
    for (const s of specs.filter((x) => x.file === file)) if (found[s.name]) ids[fnKey(s)] = found[s.name]!;
  }
  if (dev) {
    const missing = specs.filter((s) => !ids[fnKey(s)]).map(fnKey);
    return { mode: "dev", ids, missing, detail: missing.length ? `dev transform served but IDs missing for ${missing.join(", ")}` : "dev IDs read from served transforms" };
  }
  // 2) build: accept the sha256 candidate only when it is present in the served compiled client code.
  const bodies = await servedClientJs(base, fetcher);
  if (!bodies.length) return { mode: "unresolved", ids: {}, missing: specs.map(fnKey), detail: "no served dev transform and no compiled client JavaScript reachable" };
  for (const s of specs) { const c = buildCandidate(s); if (bodies.some((b) => b.includes(`"${c}"`) || b.includes(`'${c}'`))) ids[fnKey(s)] = c; }
  const missing = specs.filter((s) => !ids[fnKey(s)]).map(fnKey);
  return { mode: missing.length === specs.length ? "unresolved" : "build", ids, missing, detail: missing.length ? `compiled client does not contain the build IDs for ${missing.join(", ")} (custom/deduplicated IDs are not guessed)` : "build IDs confirmed in served compiled client" };
}
