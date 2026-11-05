// Database round counter for portal speed step 2 (spec 2026-11-05, rule 1 "no screen's loader has more than 3 sequential
// database rounds"). Wraps a Supabase-like client (in tests: the in-memory PostgREST, tests/helpers/memory-postgrest.ts,
// installed in place of `supabaseAdmin` with mock.module) and counts:
//   queries — every awaited query builder or rpc (a builder awaited twice runs, and counts, twice);
//   rounds  — sequential database round trips. A round = the set of queries started before the first of them resolves:
//             every query waits for the next timer tick, and queries started before that tick share the round.
// Test-only; never wraps a real database. Same round model as tests/helpers/wave-counter.ts.
type AnyClient = { from: (t: string) => unknown; rpc?: (...a: any[]) => unknown; [k: string]: unknown };
export type RoundLog = { table: string; round: number; site?: string }[];

/** The per-screen budget: no screen's first-draw loader may take more than this many sequential database rounds. */
export const ROUND_LIMIT = 3;

export function roundCounter(inner: AnyClient) {
  let round = 0;
  let log: RoundLog = [];
  let pending: (() => void)[] = [];
  let scheduled = false;
  const flush = () => { scheduled = false; round++; const p = pending; pending = []; for (const f of p) f(); };

  // Wraps a query builder: chain methods return wrapped builders; awaiting it waits for the round's tick first.
  // ROUND_TRACE=1: name where each query was built (the first src/lib frames), to find a round's caller.
  const siteNow = () => process.env["ROUND_TRACE"] ? (new Error().stack ?? "").split("\n").filter((l) => l.includes("/src/")).slice(0, 3).map((l) => l.replace(/.*\/src\/lib\//, "").replace(/\)$/, "")).join(" < ") : undefined;
  function builder<T extends object>(b: T, table: string, site = siteNow()): T {
    return new Proxy(b, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv);
        if (prop === "then" && typeof v === "function") {
          return (res?: (x: unknown) => unknown, rej?: (e: unknown) => unknown) =>
            new Promise<void>((go) => {
              log.push({ table, round, ...(site ? { site } : {}) });
              pending.push(go);
              if (!scheduled) { scheduled = true; setTimeout(flush, 0); }
            }).then(() => (v as (a?: unknown, b?: unknown) => Promise<unknown>).call(target, res, rej));
        }
        if (typeof v !== "function") return v;
        return (...a: unknown[]) => {
          const out = (v as (...x: unknown[]) => unknown).apply(target, a);
          return out && typeof out === "object" && typeof (out as { then?: unknown }).then === "function" ? builder(out as object, table, site) : out;
        };
      },
    });
  }

  /** Wraps another client (e.g. a signed-in user's client) so its queries count in the same rounds. */
  function wrap<C extends AnyClient>(c: C): C {
    return new Proxy(c, {
      get(target, prop, recv) {
        if (prop === "from") return (t: string) => builder(target.from(t) as object, t);
        if (prop === "rpc" && typeof target.rpc === "function") return (name: string, ...a: unknown[]) => builder(target.rpc!(name, ...a) as object, `rpc:${name}`);
        return Reflect.get(target, prop, recv);
      },
    });
  }

  function reset() { round = 0; log = []; pending = []; scheduled = false; }

  /** Runs `fn` from a clean count. */
  async function countRounds<T>(fn: () => Promise<T>): Promise<{ result: T; rounds: number; queries: number; log: RoundLog }> {
    reset();
    const result = await fn();
    const l = log;
    return { result, rounds: l.length ? Math.max(...l.map((x) => x.round)) + 1 : 0, queries: l.length, log: l };
  }

  const roundsOf = (l: RoundLog) => [...new Set(l.map((x) => x.round))].sort((a, b) => a - b)
    .map((r) => `${r + 1}: ${[...new Set(l.filter((x) => x.round === r).map((x) => (x.site ? `${x.table} [${x.site}]` : x.table)))].join(", ")}`).join("\n");

  return { client: wrap(inner), wrap, countRounds, roundsOf, reset };
}
