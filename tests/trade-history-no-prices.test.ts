// Launch blocker Task 8 (QA 7 Nov 2026): installers must never read the owner's price in job history. Trades can read
// non-internal workflow_events rows directly (RLS "job_access_non_internal", drizzle 0000) and electricians see the latest
// non-internal summaries on their no-login link (worker-links.functions), so every logEvent carrying an owner amount is
// written internal. Static source checks + the data fix proven on PGlite (real policy text + append-only trigger).
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const LIB = new URL("../src/lib/", import.meta.url).pathname;
const DATA_FIX = readFileSync(new URL("../docs/pending-migrations/2026-11-07-hide-owner-prices-from-trades.sql", import.meta.url), "utf8");
const ROLLBACK_FIX = (() => { try { return readFileSync(new URL("../docs/pending-migrations/2026-11-07-hide-owner-prices-from-trades.rollback.sql", import.meta.url), "utf8"); } catch { return ""; } })();
const CORE = readFileSync(new URL("../drizzle/migrations/0000_hivic_core_schema.sql", import.meta.url), "utf8");

type Call = { file: string; line: number; eventType: string; summary: string; details: string; opts: string };

/** Top-level arguments of the call whose "(" is at `open` (strings, template literals and nesting respected). */
function callArgs(src: string, open: number): string[] {
  const args: string[] = []; const mode: string[] = []; let depth = 0, cur = "";
  for (let i = open; i < src.length; i++) {
    const c = src[i]!, top = mode[mode.length - 1];
    if (top === "'" || top === '"') { cur += c; if (c === "\\") cur += src[++i]; else if (c === top) mode.pop(); continue; }
    if (top === "`") { cur += c; if (c === "\\") cur += src[++i]; else if (c === "`") mode.pop(); else if (c === "$" && src[i + 1] === "{") { cur += src[++i]; mode.push("${"); } continue; }
    if (c === "'" || c === '"' || c === "`") { mode.push(c); cur += c; continue; }
    if (c === "{") { if (top === "${" || top === "{") mode.push("{"); else depth++; cur += c; continue; }
    if (c === "}") { if (top === "${" || top === "{") mode.pop(); else depth--; cur += c; continue; }
    if (c === "(" || c === "[") { depth++; if (i !== open) cur += c; continue; }
    if (c === ")" || c === "]") { depth--; if (depth === 0) { args.push(cur.trim()); return args; } cur += c; continue; }
    if (c === "," && depth === 1 && (!mode.length)) { args.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  return args;
}
const files = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : []; });
const calls: Call[] = files(LIB).flatMap((file) => {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(/\blogEvent\(/g)].filter((m) => !/function\s+$/.test(src.slice(Math.max(0, m.index! - 16), m.index!))).map((m) => {
    const a = callArgs(src, m.index! + "logEvent".length);
    return { file: file.slice(LIB.length), line: src.slice(0, m.index!).split("\n").length, eventType: a[2] ?? "", summary: a[3] ?? "", details: a[4] ?? "", opts: a.slice(5).join(",") };
  });
});
const isInternal = (c: Call) => /internal:\s*true/.test(c.opts);
/** An owner amount in the title: a "$" figure, "inc GST"/"ex GST", or an interpolated money value. */
function titleHasAmount(summary: string): boolean {
  const interps = [...summary.matchAll(/\$\{([^}]*)\}/g)].map((x) => x[1]).join(" ");
  return /\$\$\{|\$\d/.test(summary) || /\b(inc|ex) GST\b/i.test(summary) || /total|price|amount|deposit|cents|_gst|dollars|aud\(|balance|owing|charge/i.test(interps);
}
/** An owner amount in the details object a trade can also read. */
const detailsHaveAmount = (details: string) => /\b(total_inc_gst|customer_total|amount_paid|price|unit_price_inc_gst|owner_charge_inc_gst|deposit_amount)\b/.test(details);
/** Installer-pay amounts may be shown to the trade they are paid to (none written through logEvent today). */
const INSTALLER_PAY_ALLOWLIST = new Set<string>([]);
const find = (file: string, eventType: string) => calls.filter((c) => c.file === file && c.eventType === eventType);

describe("trade job history never carries the owner's price (Task 8)", () => {
  test("the scan sees the calls it checks", () => {
    expect(calls.length).toBeGreaterThan(300);
    expect(find("xero.server.ts", '"invoice_created_local"').length).toBe(3);
  });

  test("invoice raised event is internal", () => {
    for (const c of [...find("xero.server.ts", '"invoice_created_local"'), ...find("xero.server.ts", '"deposit_paid"')]) expect({ at: `${c.file}:${c.line}`, internal: isInternal(c) }).toEqual({ at: `${c.file}:${c.line}`, internal: true });
  });

  test("quote accepted event with amount is internal", () => {
    const accepted = find("portal.functions.ts", "ASSIGNMENT_EVENTS.QUOTE_ACCEPTED");
    expect(accepted.length).toBe(1);
    expect(accepted[0]!.details).toContain("total_inc_gst");
    expect(isInternal(accepted[0]!)).toBe(true);
    for (const t of ['"rectification_scope_approved"', '"rectification_item_priced"', '"installer_quoted_answer"']) for (const c of find("portal.functions.ts", t)) expect(`${t}:${isInternal(c)}`).toBe(`${t}:true`);
    for (const c of find("repeat-piesa.server.ts", "REPEAT_PIESA_ACCEPTED_EVENT")) expect(isInternal(c)).toBe(true);
  });

  test("no non-internal logEvent title contains a dollar owner amount", () => {
    const leaks = calls.filter((c) => !isInternal(c) && !INSTALLER_PAY_ALLOWLIST.has(`${c.file}:${c.eventType}`) && (titleHasAmount(c.summary) || detailsHaveAmount(c.details)))
      .map((c) => `${c.file}:${c.line} ${c.eventType}`);
    expect(leaks).toEqual([]);
    // The detector itself catches the shapes QA found.
    expect(titleHasAmount("`Invoice raised for ${q.option_label}: ${row.total_inc_gst} inc GST.`")).toBe(true);
    expect(titleHasAmount("`Installer quoted $${p} inc GST`")).toBe(true);
    expect(titleHasAmount("`Owner picked the electrical fixes time ${when}`")).toBe(false);
  });
});

describe("data fix 2026-11-07-hide-owner-prices-from-trades.sql (PGlite, real RLS policy + append-only trigger)", () => {
  test("hides exactly the owner-price rows from an assigned installer, keeps the append-only guard, re-run is a no-op", async () => {
    const db = new PGlite();
    const policy = /create policy "job_access_non_internal" on public\.workflow_events[^;]+;/.exec(CORE)![0];
    const guard = /create or replace function public\.prevent_mutation\(\)[\s\S]+?for each row execute function public\.prevent_mutation\(\);/.exec(CORE)![0];
    const J = "10000000-0000-4000-8000-000000000002", INST = "30000000-0000-4000-8000-000000000001";
    await db.exec(`
      CREATE SCHEMA auth; CREATE TABLE auth.me (id uuid); INSERT INTO auth.me VALUES (NULL);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM auth.me LIMIT 1 $$;
      CREATE ROLE authenticated;
      CREATE TABLE public.job_assignments (job_id uuid, user_id uuid, role text, active boolean);
      CREATE TABLE public.workflow_events (id serial primary key, job_id uuid not null, event_type text not null, summary text not null, details jsonb not null default '{}', internal boolean not null default false, created_at timestamptz not null default now());
      CREATE FUNCTION public.can_access_job(_job uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
        SELECT EXISTS (SELECT 1 FROM public.job_assignments WHERE job_id=_job AND user_id=auth.uid() AND active) $$;
      ${guard}
      ALTER TABLE public.workflow_events ENABLE ROW LEVEL SECURITY;
      ${policy}
      GRANT USAGE ON SCHEMA public, auth TO authenticated; GRANT SELECT ON ALL TABLES IN SCHEMA public, auth TO authenticated;
      INSERT INTO public.job_assignments VALUES ('${J}','${INST}','installer',true);
      -- the exact titles/details the code wrote before Task 8
      INSERT INTO public.workflow_events (job_id,event_type,summary,details) VALUES
        ('${J}','invoice_created_local','Invoice raised for R5.0 ceiling insulation: 4321.00 inc GST. Safety check payment (349.00) due – owner pays on My job.','{"total_inc_gst":4321}'),
        ('${J}','QUOTE_ACCEPTED','R5.0 ceiling insulation accepted with signed Customer Agreement / Quote Acceptance','{"quote_id":"q","total_inc_gst":4321}'),
        ('${J}','rectification_scope_approved','Owner approved electrical fixes scope (880.00 inc GST)','{}'),
        ('${J}','deposit_paid','Safety check payment confirmed in Xero (349.00)','{"amount_paid":349}'),
        ('${J}','repeat_piesa_accepted','Owner accepted the new safety check (PIESA) — $349 inc GST added to their bill','{"payer":"owner","owner_charge_inc_gst":349}'),
        ('${J}','rectification_item_priced','Office priced: Replace downlight','{"unit_price_inc_gst":120,"reason":"quoted"}'),
        ('${J}','installer_quoted_answer','Installer quoted $3900 inc GST','{"answer":"yes","price":3900}'),
        -- rows that must stay visible
        ('${J}','QUOTE_ACCEPTED','Old acceptance without an amount','{"quote_id":"q0"}'),
        ('${J}','repeat_piesa_accepted','Owner accepted the new safety check (PIESA) at no cost to them','{"payer":"installer","owner_charge_inc_gst":0}'),
        ('${J}','installer_quoted_answer','Installer has not quoted — quote needed from installer','{"answer":"no","price":null}'),
        ('${J}','balance_paid','Invoice fully paid in Xero','{}'),
        ('${J}','stage_changed','Install booked','{}');`);
    const visible = async () => { await db.exec(`UPDATE auth.me SET id='${INST}'; SET ROLE authenticated;`); const r = (await db.query<{ summary: string }>("SELECT summary FROM public.workflow_events ORDER BY id")).rows.map((x) => x.summary); await db.exec("RESET ROLE;"); return r; };
    expect((await visible()).length).toBe(12);
    // Read-back count Jo sees before the fix (the file's first statement).
    const preview = /--\s*PREVIEW:\s*(SELECT[^;]+;)/.exec(DATA_FIX)?.[1];
    expect(preview).toBeTruthy();
    expect((await db.query<{ n: number }>(preview!)).rows[0]!.n).toBe(7);
    await db.exec(DATA_FIX);
    expect(await visible()).toEqual([
      "Old acceptance without an amount",
      "Owner accepted the new safety check (PIESA) at no cost to them",
      "Installer has not quoted — quote needed from installer",
      "Invoice fully paid in Xero",
      "Install booked",
    ]);
    expect((await db.query<{ n: number }>(preview!)).rows[0]!.n).toBe(0);
    // Fix round 1: the ids it hid are recorded, so the fix can be undone exactly.
    const BK = "public._bk_20261107_hidden_owner_prices";
    const recorded = async () => (await db.query<{ id: number }>(`SELECT id FROM ${BK} ORDER BY id`)).rows.map((r) => Number(r.id));
    expect(await recorded()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect((await db.query<{ rls: boolean }>(`SELECT relrowsecurity AS rls FROM pg_class WHERE oid = '${BK}'::regclass`)).rows[0]!.rls).toBe(true);
    await db.exec(DATA_FIX); // idempotent
    expect(await recorded()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // The append-only guard is back on after the fix.
    await expect(db.exec("UPDATE public.workflow_events SET summary='x' WHERE id=1")).rejects.toThrow(/append-only/);
    // Rollback: exactly the recorded rows are visible to the trade again, the record is dropped, the guard is back on.
    expect(ROLLBACK_FIX).toMatch(/DISABLE TRIGGER workflow_events_immutable/);
    await db.exec(ROLLBACK_FIX);
    expect((await visible()).length).toBe(12);
    expect((await db.query<{ t: string | null }>(`SELECT to_regclass('${BK}')::text AS t`)).rows[0]!.t).toBeNull();
    await expect(db.exec("UPDATE public.workflow_events SET summary='x' WHERE id=1")).rejects.toThrow(/append-only/);
    await db.exec(ROLLBACK_FIX); // re-run: no record, no change, no error
    expect((await visible()).length).toBe(12);
    // A row the office had marked internal itself stays internal through fix + rollback.
    await db.exec("ALTER TABLE public.workflow_events DISABLE TRIGGER workflow_events_immutable; INSERT INTO public.workflow_events (job_id,event_type,summary,details,internal) VALUES ('" + J + "','invoice_created_local','Invoice raised: 10.00 inc GST','{}',true); ALTER TABLE public.workflow_events ENABLE TRIGGER workflow_events_immutable;");
    await db.exec(DATA_FIX); await db.exec(ROLLBACK_FIX);
    expect((await db.query<{ internal: boolean }>("SELECT internal FROM public.workflow_events WHERE summary = 'Invoice raised: 10.00 inc GST'")).rows[0]!.internal).toBe(true);
    expect((await visible()).length).toBe(12);
  });
});
