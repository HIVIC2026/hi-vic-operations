// Wave counter over the in-memory PostgREST client (tests/helpers/memory-postgrest.ts), for speed tests that count how many
// sequential database round trips ("waves") a loader makes. Every read waits for the next timer tick; reads issued before
// that tick share a wave. Optional: fail chosen reads (`failWhen`), and make chosen columns missing (`missingColumns`, e.g.
// "partner_workers.declarations_due") so a select naming them answers with Postgres' "column does not exist" error.
// `details->>key` `.in()` filters are applied after the helper's own filters (the JSON column must be selected).
import { memoryPostgrest, type Tables } from "./memory-postgrest";

export type WaveLog = { table: string; sel: string; info: string; wave: number }[];

export function waveCounter(tables: Tables, backKeys: Record<string, string> = {}) {
  let wave = 0;
  let log: WaveLog = [];
  let pending: (() => void)[] = [];
  let scheduled = false;
  const s = {
    failWhen: null as ((table: string, sel: string, info: string) => boolean) | null,
    missingColumns: new Set<string>(),
  };
  function flush() { scheduled = false; wave++; const p = pending; pending = []; for (const f of p) f(); }
  function later<T>(table: string, sel: string, info: string, run: () => Promise<T> | T, failed: T): Promise<T> {
    return new Promise((resolve) => {
      log.push({ table, sel, info, wave });
      const fail = s.failWhen?.(table, sel, info) ?? false;
      pending.push(() => resolve(fail ? failed : run()));
      if (!scheduled) { scheduled = true; setTimeout(flush, 0); }
    });
  }
  function from(table: string) {
    const q = memoryPostgrest(tables, backKeys).from(table);
    let sel = "*";
    let info = "";
    const jsonIn: { col: string; key: string; vals: unknown[] }[] = [];
    const select = q.select;
    q.select = (c?: string, o?: unknown) => { sel = c ?? "*"; return select(c, o); };
    for (const m of ["eq", "contains", "in"] as const) {
      const orig = q[m];
      q[m] = (c: string, v: unknown) => {
        info += ` ${m} ${c} ${JSON.stringify(v)}`;
        if (m === "in" && c.includes("->>")) { const [col, key] = c.split("->>") as [string, string]; jsonIn.push({ col, key, vals: v as unknown[] }); return q; }
        return orig(c, v);
      };
    }
    const run = q.run;
    q.run = async () => {
      const missing = [...s.missingColumns].find((tc) => { const [t, c] = tc.split(".") as [string, string]; return t === table && new RegExp(`\\b${c}\\b`).test(sel); });
      if (missing) return { data: null, error: { code: "42703", message: `column ${missing} does not exist` } };
      const r = await run();
      if (!jsonIn.length || !Array.isArray(r.data)) return r;
      return { ...r, data: r.data.filter((row: Record<string, unknown>) => jsonIn.every((f) => f.vals.includes(String((row[f.col] as Record<string, unknown> | null)?.[f.key] ?? "")))) };
    };
    q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => later(table, sel, info, () => q.run(), { data: null, count: null, error: { message: "read failed", code: "XX000" } }).then(res, rej);
    return q;
  }
  const client = {
    from,
    rpc: (name: string) => later(`rpc:${name}`, "", "", () => ({ data: null, error: null }), { data: null, error: { message: "read failed" } }),
    storage: { from: () => ({}) },
  };
  function reset() { wave = 0; log = []; pending = []; scheduled = false; }
  /** Runs `f` from a clean count. `waves` counts every wave; `afterCtx` leaves out the first (the sign-in context). */
  async function measured<T>(f: () => Promise<T>) {
    reset();
    const out = await f();
    const waves = log.length ? Math.max(...log.map((l) => l.wave)) + 1 : 0;
    return { out, waves, afterCtx: Math.max(0, waves - 1), log };
  }
  const wavesOf = (l: WaveLog) => [...new Set(l.map((x) => x.wave))].sort((a, b) => a - b)
    .map((w) => `${w + 1}: ${l.filter((x) => x.wave === w).map((x) => x.table).join(", ")}`).join("\n");
  return { client, state: s, reset, measured, wavesOf, get log() { return log; } };
}

/** The loader's value, or the refusal message. */
export const outcome = async <T,>(f: () => Promise<T>) => { try { return { ok: await f() }; } catch (e) { return { refused: (e as Error).message }; } };
