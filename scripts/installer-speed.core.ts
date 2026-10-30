// Pure parts of the installer-screens timing tool (no database, no browser): numbers, table, arguments.
export const ALL_SCREENS = ["home", "job", "day", "business", "money"] as const;
export type Screen = (typeof ALL_SCREENS)[number];

export type Call = { name: string; ms: number };
export type Run = { ms: number; calls: Call[]; refused?: boolean; error?: string };
export type Row = { screen: string; role: string; medianMs: number | null; slowestMs: number | null; calls: number | null; slowest: Call | null; note: string | null };

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function maxOf(xs: number[]): number | null {
  return xs.length ? Math.max(...xs) : null;
}

/** Readable name of a server function from its request URL (the part after `--`, minus the generated suffix). */
export function serverFnName(url: string): string {
  const tail = url.split("?")[0]!.split("/_serverFn/")[1] ?? url;
  const afterDashes = tail.includes("--") ? tail.split("--").pop()! : tail;
  return afterDashes.replace(/_createServerFn_handler$/, "");
}

export function summariseRuns(screen: string, role: string, runs: Run[]): Row {
  const failed = runs.find((r) => r.error);
  if (failed) return { screen, role, medianMs: null, slowestMs: null, calls: null, slowest: null, note: `FAILED: ${failed.error}` };
  const times = runs.map((r) => r.ms);
  const all = runs.flatMap((r) => r.calls);
  const slowest = all.reduce<Call | null>((a, c) => (!a || c.ms > a.ms ? c : a), null);
  return {
    screen, role,
    medianMs: median(times), slowestMs: maxOf(times),
    calls: median(runs.map((r) => r.calls.length)),
    slowest,
    note: runs.length > 0 && runs.every((r) => r.refused) ? "refused (expected)" : null,
  };
}

export function formatTable(rows: Row[]): string {
  const head = ["| screen | role | median ms | slowest ms | server calls | slowest call (name, ms) |", "|---|---|---|---|---|---|"];
  const n = (v: number | null) => (v === null ? "-" : String(Math.round(v)));
  const body = rows.map((r) => {
    const last = r.note ?? (r.slowest ? `${r.slowest.name}, ${Math.round(r.slowest.ms)}` : "none");
    return `| ${r.screen} | ${r.role} | ${n(r.medianMs)} | ${n(r.slowestMs)} | ${n(r.calls)} | ${last} |`;
  });
  return [...head, ...body].join("\n");
}

export type Args = { base: string; label: string; screens: Screen[] };

export function parseArgs(argv: string[]): Args {
  const get = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const base = get("--base");
  if (!base || !/^https?:\/\//.test(base)) throw new Error("--base <url> is required, e.g. --base https://portal.homeinsulationvictoria.com.au");
  const label = get("--label");
  if (!label || !/^[a-z0-9-]+$/i.test(label)) throw new Error("--label is required (letters, numbers, dashes), e.g. before, after-home, after");
  const raw = get("--screens");
  const screens = raw ? raw.split(",").map((s) => s.trim()) : [...ALL_SCREENS];
  for (const s of screens) if (!(ALL_SCREENS as readonly string[]).includes(s)) throw new Error(`Unknown screen "${s}". Use: ${ALL_SCREENS.join(", ")}`);
  return { base: base.replace(/\/+$/, ""), label, screens: screens as Screen[] };
}

export const reportFileName = (date: string, label: string) => `qa/installer-speed/${date}-${label}.md`;
