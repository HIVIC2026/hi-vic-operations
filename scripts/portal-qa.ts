// Whole-portal recurring QA — ONE bounded command (no AI, no sends, no publishing):
//   bun scripts/portal-qa.ts [--label morning|midday|afternoon|release] [--base http://localhost:8080] [--skip-installer]
//                            [--office-only] [--budget 540] [--personas installer,rec,owner]
// --personas excludes unselected trade/owner accounts from sign-in, screens and journeys; excluded checks stay NOT_RUN.
// Office remains required. The exact persona list is also passed to qa-office-writes.
// Single run at a time (lock file). One overall budget: every step gets min(its cap, time left); steps that no longer
// fit are reported NOT_RUN. results.json/report.md are rewritten after every row and again in finally, so a killed
// run still leaves its partial results. Each row carries its real environment.
// Safety: TEST accounts only (@hivic.test / @hivic-test.example), read-only screen visits; writes only through the
// installer-test harness and qa-office-writes (both snapshot + restore, qa_test jobs). Never toggles switches or sends.
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { READ_ONLY_PATHS, uiRouteInventory, completedRouteCoverage } from './portal-qa-coverage';

type Status = "passed" | "failed" | "blocked" | "not_run";
type Result = { area: string; route_or_action: string; persona: string; status: Status; detail: string; steps: string; screenshots: string[]; environment: string };
const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1]! : d; };
const LABEL = arg("--label", "manual");
const BASE = arg("--base", "http://localhost:8080");
const OFFICE_ONLY = process.argv.includes("--office-only");
const READ_ONLY = process.argv.includes("--read-only");
const REVIEW_GAPS = process.argv.includes('--review-gaps');
const REVIEW_RETRY = process.argv.includes('--review-retry');
if (REVIEW_GAPS && !READ_ONLY) throw new Error('Review gaps requires read-only mode.');
if (process.argv.includes('--allow-test-email') || process.argv.includes('--setup-fixtures')) throw new Error('Portal QA never permits recipient emails or fixture setup flags.');
if (READ_ONLY && BASE !== 'http://localhost:8080') throw new Error('Read-only expanded performance QA targets localhost preview only.');
const PERSONA_LIST = arg("--personas", "installer,rec,owner");
const ALLOWED_PERSONAS = new Set(PERSONA_LIST.split(",").map((s) => s.trim()));
const personaAllowed = (persona: string) => persona === "office" || ALLOWED_PERSONAS.has(persona);
const BUDGET_MS = Number(arg("--budget", "540")) * 1000;
const START = Date.now(), DEADLINE = START + BUDGET_MS;
const left = () => DEADLINE - Date.now();
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const ROOT = "/mnt/documents/portal-qa";
const OUT = `${ROOT}/${stamp}`;
const DEPLOYED = !BASE.includes("localhost");
const ENV_BASE = DEPLOYED ? `deployed ${BASE}` : "local preview sandbox (unpublished working copy)";
const ENV_LOCAL = "local preview sandbox (localhost:8080) — never the deployed site";
const ENV_ISOLATED = "isolated local tests (mocks/PGlite, no network)";
const ENV_DB = "live database, read-only";

// ---- single-run lock ----
const LOCK = "/tmp/portal-qa.lock";
if (existsSync(LOCK)) {
  const pid = Number(readFileSync(LOCK, "utf8").split(" ")[0]);
  let alive = false; try { process.kill(pid, 0); alive = true; } catch { /* stale */ }
  if (alive) { console.error(`BLOCKED another portal-qa run is active (pid ${pid}); not starting a parallel run`); process.exit(2); }
}
writeFileSync(LOCK, `${process.pid} ${new Date().toISOString()}`);
mkdirSync(OUT, { recursive: true });

const TEST_EMAIL = /@(hivic-test\.example|hivic\.test)$/i;
const results: Result[] = [];
const sh = (cmd: string[], cap: number) => spawnSync(cmd[0]!, cmd.slice(1), { encoding: "utf8", timeout: Math.max(1_000, Math.min(cap, left() - 15_000)), maxBuffer: 64 * 1024 * 1024 });
const fits = (needMs: number) => left() > needMs;

type EmailFileResult = { file: string; status: "passed" | "failed" | "not_run"; pass: number; fail: number; detail: string };
/** Bun module mocks are process-wide. Each file gets a fresh child, within one shared phase/overall budget. */
function isolatedEmailFiles(files: string[], io: {
  now: () => number; leftMs: () => number; exists: (file: string) => boolean;
  run: (file: string, cap: number) => { status: number | null; stdout?: string | null; stderr?: string | null; error?: { message: string }; signal?: string | null };
  record: (row: EmailFileResult) => void; log: (text: string) => void;
}) {
  const deadline = io.now() + 120_000, rows: EmailFileResult[] = [], logs: string[] = [];
  for (const file of files) {
    const cap = Math.min(deadline - io.now(), io.leftMs()), available = io.exists(file);
    let row: EmailFileResult;
    if (!available || cap < 1_000) {
      row = { file, status: "not_run", pass: 0, fail: 0, detail: !available ? "test file is missing" : "email phase or overall budget exhausted" };
      logs.push(`NOT_RUN ${file}: ${row.detail}`);
    } else {
      let result: ReturnType<typeof io.run>;
      try { result = io.run(file, cap); }
      catch (error) { result = { status: null, error: { message: error instanceof Error ? error.message : String(error) } }; }
      const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
      const plain = output.replace(/\u001b\[[0-9;]*m/g, "");
      const pass = Number(plain.match(/^\s*(\d+) pass\b/m)?.[1] ?? 0), fail = Number(plain.match(/^\s*(\d+) fail\b/m)?.[1] ?? 0);
      const status = result.status === 0 && !result.error && !result.signal && pass > 0 && fail === 0 ? "passed" : "failed";
      row = { file, status, pass, fail, detail: `${pass} pass, ${fail} fail; exit ${result.status ?? "none"}${result.signal ? ` (${result.signal})` : ""}${result.error ? `; stopped: ${result.error.message}` : ""}` };
      logs.push(`\n=== ${file} (${row.status}) ===\n${row.detail}\n${output}`);
    }
    rows.push(row); io.log(logs.join("\n")); io.record(row);
  }
  const passedFiles = rows.filter(r => r.status === "passed").length, failedFiles = rows.filter(r => r.status === "failed").length, notRunFiles = rows.filter(r => r.status === "not_run").length;
  const status = failedFiles ? "failed" : notRunFiles || !rows.length ? "not_run" : "passed";
  return { status, pass: rows.reduce((n, r) => n + r.pass, 0), fail: rows.reduce((n, r) => n + r.fail, 0), passedFiles, failedFiles, notRunFiles } as const;
}

// ---- version / environment (editor revision is NOT the production version) ----
const git = spawnSync("git", ["log", "-1", "--format=%h %cI"], { encoding: "utf8" }).stdout.trim();
let production_fingerprint: Record<string, unknown> = { note: "not fetched (local target)" };
if (DEPLOYED) {
  try {
    const html = await (await fetch(`${BASE}/`, { signal: AbortSignal.timeout(20_000) })).text();
    const idx = html.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
    if (idx) { const buf = Buffer.from(await (await fetch(`${BASE}${idx}`, { signal: AbortSignal.timeout(20_000) })).arrayBuffer()); production_fingerprint = { fetched_at: new Date().toISOString(), index: idx.split("/").pop(), bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex"), server_only_changes: "UNKNOWN (no authoritative server version metadata)" }; }
    else production_fingerprint = { error: "index asset not found in served HTML" };
  } catch (e) { production_fingerprint = { error: (e as Error).message }; }
}
const env = { label: LABEL, base: BASE, target: ENV_BASE, editor_revision: git || "unknown", production_fingerprint, budget_s: BUDGET_MS / 1000, office_only: OFFICE_ONLY, personas: PERSONA_LIST, started_at: new Date().toISOString() };

function writeReport(final: boolean) {
  const counts = results.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {} as Record<string, number>);
  const overall: Status = results.some((r) => r.status === "failed") ? "failed" : results.length && results.every((r) => r.status === "passed") ? "passed" : "blocked";
  const prev = existsSync(`${ROOT}/latest.json`) ? JSON.parse(readFileSync(`${ROOT}/latest.json`, "utf8")) as { last_successful_run?: string | null } : {};
  const doc = { ...env, finished_at: final ? new Date().toISOString() : null, complete: final, overall, counts, last_successful_run: final && overall === "passed" ? env.started_at : prev.last_successful_run ?? null, out_dir: OUT, results };
  writeFileSync(`${OUT}/results.json`, JSON.stringify(doc, null, 2));
  if (final) writeFileSync(`${ROOT}/latest.json`, JSON.stringify(doc, null, 2));
  writeFileSync(`${OUT}/report.md`, [`# Portal QA ${LABEL} — ${env.started_at}${final ? "" : " (IN PROGRESS / INTERRUPTED)"}`, `Target: ${env.target} · editor revision ${env.editor_revision} (not production proof) · production ${JSON.stringify(production_fingerprint)} · overall **${overall.toUpperCase()}**`, `Counts: ${JSON.stringify(counts)}`, "", "| Status | Area | Route/action | Who | Environment | Detail |", "|---|---|---|---|---|---|", ...results.map((r) => `| ${r.status} | ${r.area} | ${r.route_or_action} | ${r.persona} | ${r.environment} | ${r.detail.replace(/\|/g, "/").slice(0, 200)} |`)].join("\n"));
  return { overall, counts };
}
const add = (r: Omit<Result, "screenshots" | "environment"> & { screenshots?: string[]; environment?: string }) => { results.push({ screenshots: [], environment: ENV_BASE, ...r }); writeReport(false); console.log(`${r.status.toUpperCase().padEnd(8)} ${r.area} — ${r.route_or_action}${r.status === "passed" ? "" : `: ${r.detail}`}`); };
const notRun = (area: string, what: string, why: string, environment = ENV_BASE) => add({ area, route_or_action: what, persona: "-", status: "not_run", detail: why, steps: "", environment });

let finalized = false;
function finalize() {
  if (finalized) return; finalized = true;
  const { overall, counts } = writeReport(true);
  const FIXLOG = `${ROOT}/fix-log.json`;
  type Fix = { key: string; status: string; first_seen: string; last_seen: string; repeats: number; detail: string; notes?: string[] };
  const fixes: Fix[] = existsSync(FIXLOG) ? JSON.parse(readFileSync(FIXLOG, "utf8")) : [];
  for (const r of results.filter((x) => x.status === "failed")) {
    const key = `${r.area} | ${r.route_or_action.replace(/ \((phone|desktop)\)$/, "")}`;
    const f = fixes.find((x) => x.key === key);
    if (!f) fixes.push({ key, status: "detected", first_seen: env.started_at, last_seen: env.started_at, repeats: 1, detail: r.detail });
    else if (f.last_seen !== env.started_at) { f.last_seen = env.started_at; f.repeats++; f.detail = r.detail; if (f.status !== "blocked") f.status = f.status === "detected" ? "detected" : "regressed"; }
  }
  writeFileSync(FIXLOG, JSON.stringify(fixes, null, 2));
  const repeated = fixes.filter((f) => f.last_seen === env.started_at && f.repeats >= 2);
  if (repeated.length) console.log(`\nALERT repeated failures (tell Jo):\n${repeated.map((f) => ` - ${f.key} ×${f.repeats}: ${f.detail}`).join("\n")}`);
  try { if (readFileSync(LOCK, "utf8").startsWith(`${process.pid} `)) rmSync(LOCK, { force: true }); } catch { /* gone */ }
  console.log(`\nOVERALL ${overall.toUpperCase()} ${JSON.stringify(counts)}\n${OUT}/results.json`);
  return overall;
}
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { add({ area: "runner", route_or_action: "interrupted", persona: "-", status: "failed", detail: `received ${sig}`, steps: "" }); finalize(); process.exit(1); });

let exitCode = 1;
try {
  // ---- TEST personas (verified read-only; never created or changed here) ----
  const PERSONAS: Record<string, { email: string; role: string; job?: string }> = {
    office: { email: "admin@hivic.test", role: "admin" },
    rec: { email: "qa.rec.delta@hivic-test.example", role: "electrician" },
    installer: { email: READ_ONLY ? "qa.installer.alpha@hivic-test.example" : "deep-test@hivic.test", role: "installer" },
  };
  async function sessionFor(email: string) {
    if (!TEST_EMAIL.test(email)) throw new Error("SAFETY STOP: TEST accounts only");
    const { createClient } = await import("@supabase/supabase-js");
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
    const sb = createClient(process.env["SUPABASE_URL"]!, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (i, init) => { const h = new Headers(init?.headers); if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization"); h.set("apikey", key); return fetch(i, { ...init, headers: h }); } } });
    if (REVIEW_GAPS) {
      const file = email === PERSONAS.office?.email ? '/tmp/browser/performance/office-session.json' : '/tmp/browser/performance/installer-session.json';
      if (!existsSync(file)) throw new Error('Existing approved TEST session unavailable; no new session issued');
      const stored = JSON.parse(readFileSync(file, 'utf8'));
      const session = stored.session;
      if (!session?.access_token || !session.expires_at || session.expires_at <= Date.now() / 1000) throw new Error('Existing approved TEST session expired; no auth repair');
      const verified = await sb.auth.getUser(session.access_token);
      if (verified.error || verified.data.user?.email !== email || verified.data.user?.id !== session.user?.id) throw new Error('Existing TEST session identity failed read-only verification');
      return session;
    }
    const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (error || !link.properties?.hashed_token) throw new Error(error?.message ?? "no sign-in token");
    const v = await sb.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
    if (v.error || !v.data.session) throw new Error(v.error?.message ?? "no session");
    return v.data.session;
  }
  const sessions: Record<string, unknown> = {};
  let installerJobIds: string[] = [];
  let ownerJob: string | undefined;
  if (!OFFICE_ONLY) {
    for (const [persona, p] of Object.entries(PERSONAS)) {
      if (!personaAllowed(persona)) { add({ area: "setup", route_or_action: `TEST sign-in ${persona}`, persona, status: "not_run", detail: "persona excluded by --personas; no lookup or sign-in", steps: "", environment: ENV_DB }); continue; }
      const { data: prof } = await admin.from("profiles").select("id").eq("email", p.email).maybeSingle();
      const { data: role } = prof ? await admin.from("user_roles").select("id").eq("user_id", prof.id).eq("role", p.role as never).maybeSingle() : { data: null };
      if (!prof || !role) { add({ area: "setup", route_or_action: `TEST sign-in ${persona}`, persona, status: "blocked", detail: `${p.email} missing or lacks ${p.role} role — ask root to provision this TEST account`, steps: "preflight read-only", environment: ENV_DB }); continue; }
      try {
        const session = await sessionFor(p.email);
        if (session.user.id !== prof.id) throw new Error('TEST session identity mismatch');
        if (READ_ONLY && persona === 'installer') {
          const { createClient } = await import('@supabase/supabase-js');
          const scoped = createClient(process.env['SUPABASE_URL']!, process.env['SUPABASE_PUBLISHABLE_KEY']!, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${session.access_token}` } } });
          const { data: jobs, error: scopeError } = await scoped.from('jobs').select('id,source,qa_archived_at,deleted_at').limit(1000);
          if (scopeError || !jobs || jobs.length === 1000 || jobs.some(j => j.source !== 'qa_test')) throw new Error('TEST installer scope could not be verified or reaches non-TEST jobs');
          installerJobIds = jobs.filter(j => !j.qa_archived_at && !j.deleted_at).map(j => j.id);
          add({ area: 'setup', route_or_action: 'installer reachable-job scope', persona, status: 'passed', detail: `${jobs.length} accessible jobs; all qa_test; zero non-test`, steps: 'user-scoped SELECT, no writes', environment: ENV_DB });
        }
        sessions[persona] = session;
        add({ area: "setup", route_or_action: `TEST sign-in ${persona}`, persona, status: "passed", detail: p.email, steps: REVIEW_GAPS ? 'existing approved TEST session reused and verified; no new login issued' : "magic-link session for TEST account", environment: ENV_DB }); }
      catch (e) { add({ area: "setup", route_or_action: `TEST sign-in ${persona}`, persona, status: "blocked", detail: (e as Error).message, steps: "magic-link session", environment: ENV_DB }); }
    }
    if (personaAllowed("owner") && !READ_ONLY) {
      const { data: owners } = await admin.from("owners").select("id,user_id,email").ilike("email", "%@hivic-test.example").not("user_id", "is", null).limit(50);
      for (const o of owners ?? []) {
        const { data: j } = await admin.from("jobs").select("id").eq("owner_id", o.id).eq("source", "qa_test").is("qa_archived_at" as never, null).limit(1).maybeSingle();
        if (j && o.email && TEST_EMAIL.test(o.email)) { try { sessions["owner"] = await sessionFor(o.email); ownerJob = j.id; break; } catch { /* next */ } }
      }
      if (ownerJob) add({ area: "setup", route_or_action: "TEST sign-in owner", persona: "owner", status: "passed", detail: `owner of qa_test job ${ownerJob}`, steps: "first TEST owner with an open qa_test job", environment: ENV_DB });
      else add({ area: "setup", route_or_action: "TEST sign-in owner", persona: "owner", status: "blocked", detail: "no TEST owner login linked to an open qa_test job — run `bun run journey` to create one", steps: "preflight read-only", environment: ENV_DB });
    } else add({ area: "setup", route_or_action: "TEST sign-in owner", persona: "owner", status: "not_run", detail: "persona excluded or read-only mode has no vetted owner fixture; no lookup or sign-in", steps: "", environment: ENV_DB });

    // ---- authenticated screens (read-only visits) ----
    const RETIRED = ["HI VIC", "undefined", "NaN", "[object", "50% deposit", "Lorem ipsum", "TODO"];
    type Screen = { step: string; persona: string; path: string; expectedPath?: string; expectedSearch?: Record<string, string>; mustSee?: string[]; mustNotSeeExact?: string[]; mustNotSeeExactOutside?: { text: string; ignoreSelector: string }[]; noPrices?: boolean; safeButtons?: string[]; safeTabs?: boolean; readinessSelector?: string; verifyContent?: boolean; discoverTestJob?: boolean; widths?: number[] };
    let screens: Screen[] = [
      { step: "office-operations", persona: "office", path: "/admin/operations", expectedPath: "/admin/enquiries", mustSee: ["Enquiries", "Owner", "Address", "Estimate"] },
      { step: "office-needs-me", persona: "office", path: "/admin", expectedPath: "/admin/needs-me", mustSee: ["Needs me", "Today", "This week", "Watch"] },
      { step: "office-jobs", persona: "office", path: "/admin/board", expectedPath: "/admin/jobs/active", mustSee: ["Jobs", "Active", "Closed", "Choose installer", "Ready Check", "Final check"] },
      { step: "office-enquiry-groups", persona: "office", path: "/admin/enquiry-groups" },
      { step: "office-campaign-emails", persona: "office", path: "/admin/campaign-emails", expectedPath: "/admin/templates", expectedSearch: { cat: "email" }, mustSee: ["Templates", "Viewing here never sends, saves or connects anything."] },
      { step: "office-partners", persona: "office", path: "/admin/partners?tab=approved", expectedPath: "/admin/partners" }, // O5: Partners overview removed (office audit); Approved shows stored names
      { step: "office-templates", persona: "office", path: "/admin/templates" },
      { step: "rec-home", persona: "rec", path: "/field", noPrices: false },
      { step: "rec-business", persona: "rec", path: "/field/business" },
      { step: "rec-money", persona: "rec", path: "/field/money" },
      { step: "installer-home", persona: "installer", path: "/partner" },
      { step: "installer-add-job", persona: "installer", path: "/partner/add", mustSee: ["Add"] },
      { step: "installer-team", persona: "installer", path: "/partner/workers" },
      ...(ownerJob ? [{ step: "owner-job", persona: "owner", path: `/owner/${ownerJob}` }] : []),
      { step: "public-calculator", persona: "public", path: "/" },
    ].map((s) => ({ ...s,
      // Partner legal/record names are shown verbatim. Check retired branding everywhere else,
      // while preserving every other forbidden-text and page-error check over the whole page.
      mustNotSeeExact: s.step === "office-partners" ? RETIRED.filter(t => t !== "HI VIC") : RETIRED,
      ...(s.step === "office-partners" ? { mustNotSeeExactOutside: [{ text: "HI VIC", ignoreSelector: "[data-partner-record-name]" }] } : {}),
    }));
    if (READ_ONLY) {
      // Explicit audited read-only route allowlist, no form submissions or provider actions.
      const existing = new Map(screens.map(s => [s.path, s]));
      screens = [...new Set(READ_ONLY_PATHS)].map((path, i) => ({ ...(existing.get(path) ?? { step: `read-only-${i}`, path }), persona: path.startsWith('/admin') || path.endsWith('email-preview') ? 'office' : path.startsWith('/field') || path.startsWith('/partner') || ['/portal', '/home'].includes(path) ? 'installer' : 'public' }));
      screens = screens.map(s => ({ ...s, safeTabs: ['/admin/communications', '/admin/templates'].includes(s.path) }));
      for (const status of ['all', 'new', 'offered_spot', 'insulation_requested', 'needs_attention', 'photos']) screens.push({ step: `enquiry-view-${status}`, path: `/admin/enquiries?status=${status}`, persona: 'office', readinessSelector: '[role="tablist"][aria-label="Enquiry piles"]' });
      for (const path of ['/admin/jobs/active?stage=quote', '/admin/jobs/closed', '/admin/money?tab=payouts']) screens.push({ step: `additional-${screens.length}`, path, persona: 'office' });
      const fixtureId = '518271f4-90b5-4d16-8ccc-2d2a5a0a12c1'; // existing Office QA fixture, never changed in read-only mode
      const { data: fixture, error: fixtureError } = await admin.from('jobs').select('id,source').eq('id', fixtureId).single();
      if (!fixtureError && fixture?.source === 'qa_test') screens.push({ step: 'office-test-history', path: `/admin/jobs/${fixtureId}`, persona: 'office', mustSee: ['Next', 'Enquiry', 'Ready Check', 'Quote', 'PIESA', 'Install', 'Final check', 'Money', 'Contact history'] });
      else notRun('screens', '/admin/jobs/$jobId', 'existing isolated TEST Office fixture unavailable');
      if (REVIEW_GAPS) {
        screens = [
          { step: 'gap-communications', path: '/admin/communications', persona: 'office', expectedPath: '/admin/communications', mustSee: ['Communications', 'Held & queued'], safeTabs: true },
          { step: 'gap-list', path: '/admin/list?test=true', persona: 'office', expectedPath: '/admin/list', readinessSelector: 'table', mustSee: ['Jobs'] },
          { step: 'gap-ready-check', path: '/admin/ready-check', persona: 'office', expectedPath: '/admin/enquiries', mustSee: ['Enquiries'] },
          { step: 'gap-pricing', path: '/admin/money?tab=prices', persona: 'office', expectedPath: '/admin/money', mustSee: ['Money', 'Owner price list', 'Fixed rule'] },
          { step: 'gap-job-queue', path: '/admin/job-queue', persona: 'office', expectedPath: '/admin/job-queue', mustSee: ['Job queue'] },
          { step: 'gap-installer-home', path: '/field', persona: 'installer', expectedPath: '/field', readinessSelector: '[data-my-work]', discoverTestJob: true },
          { step: 'gap-installer-money', path: '/field/money', persona: 'installer', expectedPath: '/field/money', mustSee: ['Money'] },
          { step: 'gap-installer-business', path: '/field/business', persona: 'installer', expectedPath: '/field/business', mustSee: ['My business', 'Approved partner', 'TEST'] },
          ...(!fixtureError && fixture?.source === 'qa_test' ? [{ step: 'gap-job-disclosures', path: `/admin/jobs/${fixtureId}`, persona: 'office', expectedPath: `/admin/jobs/${fixtureId}`, mustSee: ['HV-2111', 'Last heard from us', 'File · '] }] : []),
        ].map(s => ({ ...s, verifyContent: true }));
        if (REVIEW_RETRY) screens = screens.filter(s => ['gap-communications'].includes(s.step));
        if (REVIEW_RETRY && installerJobIds[0]) screens.push({ step: 'gap-installer-job', path: `/field/${installerJobIds[0]}`, persona: 'installer', expectedPath: `/field/${installerJobIds[0]}`, verifyContent: true, readinessSelector: 'main h1' }, { step: 'gap-installer-day', path: `/field/day/${installerJobIds[0]}`, persona: 'installer', expectedPath: `/field/day/${installerJobIds[0]}`, verifyContent: true, readinessSelector: 'main h1' });
      }
    }
    const inventory = uiRouteInventory(readFileSync('src/routeTree.gen.ts', 'utf8'));
    writeFileSync(`${OUT}/route-inventory.json`, JSON.stringify(inventory, null, 2));
    const runnable = screens.filter((s) => s.persona === "public" || sessions[s.persona]);
    for (const s of screens.filter((x) => !runnable.includes(x))) add({ area: "screens", route_or_action: s.path, persona: s.persona, status: personaAllowed(s.persona) ? "blocked" : "not_run", detail: personaAllowed(s.persona) ? "no TEST session for this role" : "persona excluded by --personas", steps: "see setup rows" });
    const storageKey = `sb-${process.env["SUPABASE_PROJECT_ID"] ?? new URL(process.env["SUPABASE_URL"]!).hostname.split(".")[0]}-auth-token`;
    if (!fits(60_000)) notRun("screens", "authenticated screen visits", "overall budget exhausted");
    else {
      writeFileSync(`${OUT}/.manifest.json`, JSON.stringify({ outDir: OUT, base: BASE, storageKey, sessions, screens: runnable }), { mode: 0o600 });
      const br = sh(["python3", "e2e/journey/shoot.py", `${OUT}/.manifest.json`], READ_ONLY ? 600_000 : 300_000);
      writeFileSync(`${OUT}/.manifest.json`, "{}");
      if (br.status !== 0 || !existsSync(`${OUT}/.browser.json`)) add({ area: "screens", route_or_action: "browser harness", persona: "-", status: "failed", detail: (br.error ? `timeout/error: ${br.error.message} ` : "") + (br.stderr || "harness did not finish").slice(-400), steps: "python3 e2e/journey/shoot.py" });
      let completed: { step: string; persona?: string; ok: boolean; content_verified?: boolean; detail: string; shots: string[]; requested_path?: string; landed_path?: string | null; viewport?: { width: number }; controls?: { name: string; status: string; reason: string }[] }[] = [];
      try { if (existsSync(`${OUT}/.browser.json`)) completed = JSON.parse(readFileSync(`${OUT}/.browser.json`, 'utf8')); }
      catch { add({ area: 'screens', route_or_action: 'partial browser results', persona: '-', status: 'failed', detail: 'browser results unreadable; no coverage inferred', steps: '' }); }
      for (const r of completed) {
        const s = runnable.find((x) => x.step === r.step);
        if (!s) { notRun('screens', r.step, 'unknown browser screen; no coverage inferred'); continue; }
        add({ area: "screens", route_or_action: `${s.path} (${r.detail.includes("390px") ? "phone" : "desktop"})`, persona: s.persona, status: r.ok ? "passed" : "failed", detail: r.detail, steps: `sign in as TEST ${s.persona}, open ${s.path}, check labels`, screenshots: r.shots });
        for (const c of r.controls ?? []) if (c.status !== 'NOT_RUN') add({ area: 'read-only controls', route_or_action: `${s.path}: ${c.name} (${r.viewport?.width}px)`, persona: s.persona, status: c.status === 'PASS' ? 'passed' : 'failed', detail: c.reason, steps: 'click, intended panel/data readback, errors/overflow recheck', screenshots: r.shots });
      }
      const actualCoverage = completedRouteCoverage(inventory, completed);
      writeFileSync(`${OUT}/actual-route-coverage.json`, JSON.stringify(actualCoverage, null, 2));
      writeFileSync(`${OUT}/control-runbook.json`, JSON.stringify(completed.map(r => ({ requestedURL: r.requested_path, finalURL: r.landed_path, role: r.persona, viewport: r.viewport, controls: r.controls })), null, 2));
      for (const route of actualCoverage) if (route.status === 'NOT_RUN') add({ area: 'actual route checklist', route_or_action: `${route.path} (${route.viewport.width}px)`, persona: route.persona, status: 'not_run', detail: route.reason, steps: 'actual completed destination evidence only; planned routes do not count' });
      const destinations = completed.filter(r => r.ok && r.landed_path).map(r => ({ requested_path: r.requested_path, landed_path: r.landed_path, width: r.viewport?.width }));
      writeFileSync(`${OUT}/landed-route-coverage.json`, JSON.stringify({ requested_screens: completed.length, distinct_landed_paths: [...new Set(destinations.map(r => r.landed_path))], destinations, note: 'Redirect aliases are not distinct-page coverage. Older rows without landed_path establish no destination coverage.' }, null, 2));
      for (const route of inventory.filter(route => screens.some(s => s.path === route.path))) for (const width of [390, 1280]) {
        if (!completed.some(r => r.ok && r.landed_path === route.path && r.viewport?.width === width)) notRun('destination coverage', `${route.path} (${width}px)`, 'requested alias redirected, unavailable or missing successful landed-path evidence; no distinct-page PASS');
      }
      for (const s of runnable) for (const width of s.widths ?? [390, 1280]) if (!completed.some(r => r.step === s.step && r.viewport?.width === width)) add({ area: 'screens', route_or_action: `${s.path} (${width}px)`, persona: s.persona, status: 'not_run', detail: 'browser budget ended before this viewport completed', steps: '' });
    }
  }

  // ---- office delete / restore / classification + parity + denied roles (one qa_test job, snapshot restore) ----
  if (READ_ONLY) notRun('office writes', 'qa-office-writes', 'read-only mode: no writes or snapshots started');
  else if (!fits(150_000)) notRun("office writes", "qa-office-writes", "overall budget exhausted");
  else {
    const budget = Math.floor(Math.min(420_000, left() - 30_000) / 1000);
    const ow = sh(["bun", "scripts/qa-office-writes.ts", "--base", BASE, "--out", `${OUT}/office-writes`, "--budget", String(budget), "--personas", PERSONA_LIST], (budget + 20) * 1000);
    writeFileSync(`${OUT}/office-writes.log`, `${ow.stdout}\n${ow.stderr}`);
    const f = `${OUT}/office-writes/office-writes.json`;
    if (ow.error) add({ area: "office writes", route_or_action: "qa-office-writes", persona: "office", status: "failed", detail: `killed: ${ow.error.message}; its snapshot (if any) is recovered on next run`, steps: "bun scripts/qa-office-writes.ts" });
    if (!existsSync(f)) add({ area: "office writes", route_or_action: "qa-office-writes", persona: "office", status: "failed", detail: `harness produced no results (exit ${ow.status})`, steps: "bun scripts/qa-office-writes.ts" });
    else for (const r of JSON.parse(readFileSync(f, "utf8")) as Result[]) add(r);
  }

  if (!OFFICE_ONLY) {
    // ---- installer app click-through (existing harness; ALWAYS local, never the deployed site) ----
    if (READ_ONLY) notRun('installer journey', 'installer-test --installer-app-only', 'read-only mode: legacy mutation harness not started', ENV_LOCAL);
    else if (!personaAllowed("installer")) notRun("installer journey", "installer-test --installer-app-only", "persona excluded by --personas; harness not started", ENV_LOCAL);
    else if (process.argv.includes("--skip-installer")) notRun("installer journey", "installer-test --installer-app-only", "skipped by flag", ENV_LOCAL);
    else if (!fits(240_000)) notRun("installer journey", "installer-test --installer-app-only", "overall budget too low (needs ~4+ min)", ENV_LOCAL);
    else {
      const it = sh(["bun", "scripts/installer-test.ts", "--runs", "1", "--installer-app-only"], left() - 120_000);
      const out = `${it.stdout}\n${it.stderr}`; writeFileSync(`${OUT}/installer-test.log`, out);
      const lines = out.split("\n").filter((l) => /^(PASS|FAIL|NOT_RUN)\s/.test(l));
      if (it.error) add({ area: "installer journey", route_or_action: "installer-test", persona: "installer", status: "failed", detail: `stopped at budget: ${it.error.message}`, steps: "see installer-test.log", environment: ENV_LOCAL });
      if (!lines.length) add({ area: "installer journey", route_or_action: "installer-test", persona: "installer", status: "failed", detail: `harness produced no results (exit ${it.status})`, steps: "bun scripts/installer-test.ts --runs 1 --installer-app-only", environment: ENV_LOCAL });
      for (const l of lines) add({ area: "installer journey", route_or_action: l.replace(/^(PASS|FAIL|NOT_RUN)\s+/, "").split("  —  ")[0]!, persona: "installer", status: l.startsWith("PASS") ? "passed" : l.startsWith('NOT_RUN') ? 'not_run' : "failed", detail: l.split("  —  ")[1] ?? "ok", steps: "see installer-test.log", environment: ENV_LOCAL });
    }

    // ---- isolated email rule tests ----
    const EMAIL_TESTS = ["tests/step3-email-parity.test.ts", "tests/save-spot.test.ts", "tests/save-spot-only-approved.test.ts", "tests/group-b-media.test.ts", "tests/group-b-declaration-routing.test.ts", "tests/existing-insulation-followup.test.ts", "tests/existing-insulation-send.test.ts", "tests/email-safety.test.ts", "tests/estimate-email.test.ts", "tests/portal-qa-safety.test.ts", "tests/test-send-reserved-boundary.test.ts", "tests/ready-check-window-readback-isolated.test.ts"];
    if (REVIEW_GAPS) notRun('emails (isolated)', 'email rule tests', 'prior completed evidence reused; unaffected suites not rerun', ENV_ISOLATED);
    else if (!fits(60_000)) notRun("emails (isolated)", "email rule tests", "overall budget exhausted", ENV_ISOLATED);
    else {
      const summary = isolatedEmailFiles(EMAIL_TESTS, {
        now: Date.now, leftMs: () => left() - 15_000, exists: existsSync,
        run: (file, cap) => sh(["bun", "test", `./${file}`], cap),
        log: text => writeFileSync(`${OUT}/email-tests.log`, text),
        record: row => add({ area: "emails (isolated)", route_or_action: row.file, persona: "-", status: row.status, detail: row.detail, steps: `bun test ./${row.file}`, environment: ENV_ISOLATED }),
      });
      add({ area: "emails (isolated)", route_or_action: "audience/price/routing/removal/idempotency/opt-out rules", persona: "-", status: summary.status, detail: `${summary.pass} pass, ${summary.fail} fail; ${summary.passedFiles} files passed, ${summary.failedFiles} failed, ${summary.notRunFiles} NOT_RUN`, steps: "one fresh bun test process per file; see individual rows and email-tests.log", environment: ENV_ISOLATED });
    }

    // ---- read-only email record log (last 24h): recorded state only, not provider delivery proof ----
    {
      const since = new Date(Date.now() - 864e5).toISOString();
      const { data, error } = READ_ONLY ? { data: null, error: null } : await admin.from("customer_email_sends").select("status,purpose,error,provider_message_id").gte("created_at", since);
      if (READ_ONLY) notRun('emails (live log)', 'customer_email_sends last 24h', 'root-owned audit excluded from read-only performance pass', ENV_DB);
      else if (error) add({ area: "emails (live log)", route_or_action: "customer_email_sends last 24h", persona: "-", status: "blocked", detail: error.message, steps: "read-only select", environment: ENV_DB });
      else {
        const rows = data ?? [];
        const bad = rows.filter((r) => /fail|error|unrecorded/i.test(r.status) || r.error);
        const by: Record<string, number> = {}; for (const r of rows) { const k = `${r.purpose}/${r.status}/${r.provider_message_id ? "provider id" : "no provider id"}`; by[k] = (by[k] ?? 0) + 1; }
        add({ area: "emails (live log)", route_or_action: "customer_email_sends last 24h", persona: "-", status: bad.length ? "failed" : "passed", detail: `${rows.length} records ${JSON.stringify(by)}; ${bad.length} failed/uncertain. Recorded status only — provider delivery is not confirmed by this read`, steps: "read-only select", environment: ENV_DB });
      }
    }

    // ---- retired wording scan ----
    if (!REVIEW_GAPS) {
      const sc = sh(["bun", "scripts/scan-retired-terms.ts"], 60_000);
      add({ area: "wording", route_or_action: "retired-term scan", persona: "-", status: sc.status === 0 ? "passed" : "failed", detail: sc.status === 0 ? "no customer-visible retired terms in source" : (sc.stdout + sc.stderr).slice(-400), steps: "bun scripts/scan-retired-terms.ts", environment: "local source files" });
    }

    // ---- honest coverage gaps (never PASS) ----
    for (const [a, why] of [
      ["electrician/REC onboarding click-through (sign, rates, insurance)", "no TEST-scoped writable REC onboarding journey harness yet"],
      ["office write actions (approve, send back, Save my spot send button)", "needs dedicated TEST office scope (delete/restore/classification covered by office writes rows)"],
      ["owner signing / booking / payment choice", "no TEST owner signing harness with restore"],
      ["installer onboarding signing + approval", "excluded in --installer-app-only; run `bun run installer-test --runs 3` deliberately"],
    ]) notRun("coverage", a, why);
  } else notRun("runner", "screens, installer, email, wording and coverage rows", "--office-only mode");
} catch (e) {
  add({ area: "runner", route_or_action: "runner error", persona: "-", status: "failed", detail: (e as Error).message.slice(0, 300), steps: "" });
} finally {
  exitCode = finalize() === "passed" ? 0 : 1;
}
process.exit(exitCode);
