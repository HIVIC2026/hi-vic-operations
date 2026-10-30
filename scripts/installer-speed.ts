// Installer screens timing:  bun scripts/installer-speed.ts --base <url> --label <before|after-<screen>|after> [--screens home,job,day,business,money]
// READ-ONLY. Signs in as the TEST business owner and a TEST staff login, finds one active qa_test job on the TEST business,
// has a throttled phone browser (e2e/installer-speed/time.py) open each installer screen 5 times, and writes the table to
// qa/installer-speed/<date>-<label>.md. No inserts, updates, sends, Mitti or Xero. Needs SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and the server key.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { ALL_SCREENS, formatTable, parseArgs, reportFileName, summariseRuns, type Run } from "./installer-speed.core";

const HELP = `Usage: bun scripts/installer-speed.ts --base <url> --label <before|after-<screen>|after> [--screens ${ALL_SCREENS.join(",")}]
Read-only timing of the installer screens on a throttled phone (390x844, 4G-like). Writes qa/installer-speed/<date>-<label>.md.
Needs SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and the server key in the environment (runs in Lovable).`;

if (process.argv.includes("--help") || process.argv.includes("-h")) { console.log(HELP); process.exit(0); }
let args;
try { args = parseArgs(process.argv.slice(2)); } catch (e) { console.error((e as Error).message + "\n\n" + HELP); process.exit(2); }

const BIZ = "17793408-bf5c-4ddd-9bec-64199f64f9fb"; // [TEST PARTNER] Reinsulate
const OWNER_EMAIL = "deep-test@hivic.test";
const STAFF_EMAIL = "qa.staff.reinsulate@hivic-test.example";
const TEST_EMAIL = /@(hivic-test\.example|hivic\.test)$/i;

const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");

/** Same TEST-only magic-link sign-in as scripts/installer-test.ts (sessionFor). */
async function sessionFor(email: string) {
  if (!TEST_EMAIL.test(email)) throw new Error("SAFETY STOP: TEST accounts only.");
  const { createClient } = await import("@supabase/supabase-js");
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  const sb = createClient(process.env["SUPABASE_URL"]!, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (i, init) => { const h = new Headers(init?.headers); if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization"); h.set("apikey", key); return fetch(i, { ...init, headers: h }); } } });
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !link.properties?.hashed_token) throw new Error(`TEST sign-in ${email}: ${error?.message}`);
  const v = await sb.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (v.error) throw new Error(`TEST sign-in ${email}: ${v.error.message}`);
  return v.data.session;
}

async function userId(email: string) {
  const { data } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** First active qa_test job with an active installer assignment on the TEST business (read-only). Prefers one the staff login is assigned to. */
async function pickJob(staffId: string | null) {
  const { data: asg } = await admin.from("job_assignments").select("job_id, user_id").eq("business_id", BIZ).eq("role", "installer").eq("active", true).order("assigned_at", { ascending: false }).limit(200);
  const rows = asg ?? [];
  if (!rows.length) return null;
  const { data: jobs } = await admin.from("jobs").select("id, created_at").in("id", [...new Set(rows.map((r) => r.job_id))]).eq("source", "qa_test").is("qa_archived_at", null).is("deleted_at", null).neq("stage", "complete").order("created_at", { ascending: true });
  const ok = (jobs ?? []).map((j) => j.id);
  if (!ok.length) return null;
  const staffJob = staffId ? ok.find((id) => rows.some((r) => r.job_id === id && r.user_id === staffId)) : undefined;
  const jobId = staffJob ?? ok[0]!;
  return { jobId, staffAssigned: !!staffJob };
}

const ownerId = await userId(OWNER_EMAIL);
const staffId = await userId(STAFF_EMAIL);
if (!ownerId || !staffId) { console.error("STOP: the TEST owner or TEST staff login is missing. Nothing was run."); process.exit(2); }

const needsJob = args.screens.some((s) => s === "job" || s === "day");
const picked = await pickJob(staffId);
if (needsJob && !picked) { console.error(`STOP: no active qa_test job is assigned to the TEST business ${BIZ}. Make one in the Test Centre, then run again.`); process.exit(2); }

const sessions = { owner: await sessionFor(OWNER_EMAIL), staff: await sessionFor(STAFF_EMAIL) };
const date = new Date().toISOString().slice(0, 10);
const work = `/tmp/installer-speed/${date}-${args.label}`;
mkdirSync(work, { recursive: true });
const manifest = `${work}/manifest.json`;
const resultPath = `${work}/result.json`;
writeFileSync(manifest, JSON.stringify({
  base: args.base, screens: args.screens, jobId: picked?.jobId ?? "", staffAssigned: picked?.staffAssigned ?? false, resultPath,
  storageKey: `sb-${process.env["SUPABASE_PROJECT_ID"] ?? "wvuffpykgnqliikhodzl"}-auth-token`, sessions,
}));

console.log(`Timing ${args.screens.join(", ")} on ${args.base} (5 cold loads each, owner and staff)...`);
const py = spawnSync("python3", [new URL("../e2e/installer-speed/time.py", import.meta.url).pathname, manifest], { encoding: "utf8", stdio: ["ignore", "inherit", "inherit"], timeout: 60 * 60_000 });
writeFileSync(manifest, "{}"); // do not leave the sign-in tokens on disk
if (py.status !== 0) { console.error("The browser timing run failed."); process.exit(1); }

const results = JSON.parse(readFileSync(resultPath, "utf8")) as { screen: string; role: string; runs: Run[] }[];
const table = formatTable(results.map((r) => summariseRuns(r.screen, r.role, r.runs)));
const file = reportFileName(date, args.label);
mkdirSync("qa/installer-speed", { recursive: true });
writeFileSync(file, `# Installer screens timing: ${args.label} (${date})\n\nBase: ${args.base}. Phone 390x844, throttled to 1.6 Mbps down / 750 kbps up / 150 ms delay. 5 cold loads per screen and role. Time is from opening the page until the screen's main content shows. Server calls are the \`/_serverFn/\` requests.\n\n${table}\n`);
console.log("\n" + table + `\n\nWritten to ${file}`);
