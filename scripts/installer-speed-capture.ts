// Installer screens same-information capture:  bun scripts/installer-speed-capture.ts --write | --compare [--screen <name>]
// READ-ONLY. Calls the installer screen loaders directly as the TEST owner and TEST staff login and saves what they return to
// qa/installer-speed/baseline/<screen>-<role>.json (--write), or checks the loaders still return exactly that (--compare).
// Volatile values (times, signed photo links) are normalised first. Needs SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and the server key.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

export const SCREENS = ["home", "job", "day", "business", "money"] as const;
export type Screen = (typeof SCREENS)[number];
export const ROLES = ["owner", "staff"] as const;
const BASELINE_DIR = "qa/installer-speed/baseline";
const BIZ = "17793408-bf5c-4ddd-9bec-64199f64f9fb"; // [TEST PARTNER] Reinsulate
const OWNER_EMAIL = "deep-test@hivic.test";
const STAFF_EMAIL = "qa.staff.reinsulate@hivic-test.example";
const TEST_EMAIL = /@(hivic-test\.example|hivic\.test)$/i;

const VOLATILE_KEYS = new Set(["week", "expiresAt", "goneIn"]);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
const SIGNED_URL = /^https?:\/\/\S*\/storage\/v1\/object\/sign\/\S*$/;
const WINDOW_MS = 2 * 60_000;
const FUTURE_SKEW_MS = 5_000;

/** Makes two captures of the same information comparable: volatile times and signed photo links become placeholders, jobId lists are ordered. Pure; does not change its input. */
export function normaliseForParity(value: unknown, now: Date): unknown {
  if (typeof value === "string") {
    if (SIGNED_URL.test(value)) return value.replace(/\?.*$/, "?<signed-token>"); // keep bucket and object path (which photo), drop the token
    if (ISO.test(value)) {
      const t = Date.parse(value);
      if (!Number.isNaN(t) && t <= now.getTime() + FUTURE_SKEW_MS && t >= now.getTime() - WINDOW_MS) return "<time>";
    }
    return value;
  }
  if (Array.isArray(value)) {
    const items = value.map((v) => normaliseForParity(v, now));
    const byJob = items.length > 0 && items.every((v) => typeof v === "object" && v !== null && !Array.isArray(v) && "jobId" in v);
    if (!byJob) return items;
    return items.map((v, i) => ({ v, i })).sort((a, b) => {
      const x = String((a.v as { jobId: unknown }).jobId), y = String((b.v as { jobId: unknown }).jobId);
      return x < y ? -1 : x > y ? 1 : a.i - b.i;
    }).map((e) => e.v);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = VOLATILE_KEYS.has(k) ? "<time>" : normaliseForParity(v, now);
    return out;
  }
  return value;
}

/** Path of the first difference between two JSON-like values, or null when they are the same. */
export function firstDifference(a: unknown, b: unknown, path = ""): string | null {
  if (a === b) return null;
  const isObj = (v: unknown) => typeof v === "object" && v !== null;
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) return path || "(root)";
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
    const p = path ? `${path}.${k}` : k;
    if (!(k in x) || !(k in y)) return p;
    const d = firstDifference(x[k], y[k], p);
    if (d) return d;
  }
  return null;
}

/** Names of loaders in a capture (loader name -> value) whose value is a thrown-error record `{ error }`. */
export function errorCaptures(captured: Record<string, unknown>): string[] {
  return Object.entries(captured).filter(([, v]) => typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 1 && typeof (v as { error?: unknown }).error === "string").map(([k]) => k);
}

/** Screens where an owner error stops --write and fails --compare: a baseline of an error proves nothing. */
export const OWNER_FATAL_SCREENS: readonly Screen[] = ["home", "job", "day", "business", "money"];

/** The owner errors in one capture that are fatal (screen-owner loader labels); none for staff, whose refusals can be expected. */
export function fatalOwnerErrors(screen: Screen, role: (typeof ROLES)[number], errs: string[]): string[] {
  return role === "owner" && OWNER_FATAL_SCREENS.includes(screen) ? errs.map((e) => `${screen}-owner ${e}`) : [];
}

export function missingKeyMessage(env: Record<string, string | undefined>): string | null {
  const missing = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"].filter((k) => !env[k]);
  return missing.length ? `STOP: ${missing.join(", ")} not set. This tool needs the server key, so it runs in Lovable, not on a laptop or here. Nothing was run.` : null;
}

export function parseCaptureArgs(argv: string[]): { mode: "write" | "compare"; screens: Screen[] } {
  const write = argv.includes("--write"), compare = argv.includes("--compare");
  if (write === compare) throw new Error("Pick exactly one of --write or --compare.");
  const i = argv.indexOf("--screen");
  let screens: Screen[] = [...SCREENS];
  if (i >= 0) {
    const s = argv[i + 1] as Screen | undefined;
    if (!s || !SCREENS.includes(s)) throw new Error(`--screen must be one of ${SCREENS.join(", ")}.`);
    screens = [s];
  }
  return { mode: write ? "write" : "compare", screens };
}

const HELP = `Usage: bun scripts/installer-speed-capture.ts --write | --compare [--screen ${SCREENS.join("|")}]
Read-only. --write saves what each installer screen loader returns for the TEST owner and TEST staff login to ${BASELINE_DIR}/<screen>-<role>.json.
--compare re-reads them and exits 1, printing the first differing path, if anything changed. Needs SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and the server key (runs in Lovable).`;

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) { console.log(HELP); return 0; }
  let args;
  try { args = parseCaptureArgs(process.argv.slice(2)); } catch (e) { console.error((e as Error).message + "\n\n" + HELP); return 2; }
  const keyProblem = missingKeyMessage(process.env);
  if (keyProblem) { console.error(keyProblem); return 2; }

  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const tv = await import("@/lib/trade-view.server");
  const { tradeJobBundle } = await import("@/lib/trade-job-bundle.server");
  const { onsiteFormFor } = await import("@/lib/onsite-ready-check.server");

  const idOf = async (email: string) => {
    if (!TEST_EMAIL.test(email)) throw new Error("SAFETY STOP: TEST accounts only.");
    const { data } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  };
  const ownerId = await idOf(OWNER_EMAIL), staffId = await idOf(STAFF_EMAIL);
  if (!ownerId || !staffId) { console.error("STOP: the TEST owner or TEST staff login is missing. Nothing was run."); return 2; }

  /** Same pick as scripts/installer-speed.ts: first active qa_test job with an active installer assignment on the TEST business, preferring one the staff login holds. */
  const pickJob = async () => {
    const { data: asg } = await admin.from("job_assignments").select("job_id, user_id").eq("business_id", BIZ).eq("role", "installer").eq("active", true).order("assigned_at", { ascending: false }).limit(200);
    const rows = asg ?? [];
    if (!rows.length) return null;
    const { data: jobs } = await admin.from("jobs").select("id, created_at").in("id", [...new Set(rows.map((r) => r.job_id))]).eq("source", "qa_test").is("qa_archived_at", null).is("deleted_at", null).neq("stage", "complete").order("created_at", { ascending: true });
    const ok = (jobs ?? []).map((j) => j.id);
    if (!ok.length) return null;
    return ok.find((id) => rows.some((r) => r.job_id === id && r.user_id === staffId)) ?? ok[0]!;
  };
  const jobId = await pickJob();
  if (!jobId && args.screens.some((s) => s === "job" || s === "day" || s === "money")) { console.error(`STOP: no active qa_test job on the TEST business ${BIZ}. Make one in the Test Centre, then run again.`); return 2; }

  // tradeJobBundle reads as the signed-in user (RLS), as its server function does with context.supabase, so it needs a user session, not the admin client.
  // Same TEST-only magic-link sign-in as scripts/installer-speed.ts. (This creates an auth session; it writes no portal data.)
  const userClient = async (email: string) => {
    const { createClient } = await import("@supabase/supabase-js");
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
    const sb = createClient(process.env["SUPABASE_URL"]!, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (i, init) => { const h = new Headers(init?.headers); if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization"); h.set("apikey", key); return fetch(i, { ...init, headers: h }); } } });
    const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (error || !link.properties?.hashed_token) throw new Error(`TEST sign-in ${email}: ${error?.message}`);
    const v = await sb.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
    if (v.error) throw new Error(`TEST sign-in ${email}: ${v.error.message}`);
    return sb;
  };

  const attempt = async (fn: () => Promise<unknown>) => { try { return await fn(); } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; } };
  const J = jobId ?? "";
  const loaders: Record<Screen, (uid: string, email: string) => Promise<Record<string, unknown>>> = {
    home: async (uid) => ({ tradeHome: await attempt(() => tv.tradeHome(uid)) }),
    job: async (uid, email) => ({
      tradeJobPage: await attempt(() => tv.tradeJobPage(J, uid)),
      tradeJobBundle: await attempt(async () => tradeJobBundle((await userClient(email)) as never, uid, J)),
      tradeMittiInvited: await attempt(() => tv.tradeMittiInvited(uid)),
    }),
    day: async (uid) => ({
      tradeDayView: await attempt(() => tv.tradeDay(J, uid)),
      tradeDayExtras: await attempt(() => tv.tradeDayExtras(J, uid)),
      onsiteFormFor: await attempt(() => onsiteFormFor(J, uid, undefined, false)), // request=false: status read only, never schedules a form
    }),
    business: async (uid) => ({ tradeBusiness: await attempt(() => tv.tradeBusiness(uid)), tradeBusinessFile: await attempt(() => tv.tradeBusinessFile(uid)) }),
    money: async (uid) => ({ tradeMoneyView: await attempt(() => tv.tradeMoney(uid)), tradeMoneyExtras: await attempt(() => tv.tradeMoneyExtras(uid)), tradeMoneyJob: await attempt(() => tv.tradeMoneyJob(J, uid)) }),
  };
  const who = { owner: { uid: ownerId, email: OWNER_EMAIL }, staff: { uid: staffId, email: STAFF_EMAIL } };

  let failed = 0;
  const captures: { screen: Screen; role: (typeof ROLES)[number]; norm: unknown; file: string; now: Date }[] = [];
  const ownerErrors: string[] = [];
  for (const screen of args.screens) for (const role of ROLES) {
    const captured = JSON.parse(JSON.stringify(await loaders[screen](who[role].uid, who[role].email))); // plain JSON, as a server function would send it
    const now = new Date(); // after the loader returns, so times it made itself count as "just now"
    const errs = errorCaptures(captured);
    if (errs.length) console.log(`ERROR capture ${screen}-${role}: ${errs.join(", ")}`);
    ownerErrors.push(...fatalOwnerErrors(screen, role, errs));
    captures.push({ screen, role, norm: normaliseForParity(captured, now), file: `${BASELINE_DIR}/${screen}-${role}.json`, now });
  }
  if (args.mode === "write") {
    if (ownerErrors.length) { console.error(`STOP: the owner capture failed (${ownerErrors.join("; ")}). Nothing was saved; a baseline of an error proves nothing.`); return 1; }
    mkdirSync(BASELINE_DIR, { recursive: true });
    for (const c of captures) { writeFileSync(c.file, JSON.stringify(c.norm, null, 2) + "\n"); console.log(`Wrote ${c.file}`); }
  } else {
    for (const c of captures) {
      const name = `${c.screen}-${c.role}`;
      let base: unknown;
      try { base = normaliseForParity(JSON.parse(readFileSync(c.file, "utf8")), c.now); } catch (e) { console.error(`DIFFERENT ${name}: baseline ${c.file} is missing or unreadable (${(e as Error).message})`); failed++; continue; }
      const d = firstDifference(base, c.norm);
      if (d) { console.error(`DIFFERENT ${name}: first difference at ${d}`); failed++; } else console.log(`Same ${name}`);
    }
    if (ownerErrors.length) { console.error(`WARNING: owner captures are errors (${ownerErrors.join("; ")}).`); failed++; }
  }
  return failed ? 1 : 0;
}

if (import.meta.main) process.exit(await main());
