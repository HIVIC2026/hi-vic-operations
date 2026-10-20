// Whole-portal recurring QA — ONE bounded command (no AI, no sends, no publishing):
//   bun scripts/portal-qa.ts [--label morning|midday|afternoon|release] [--base http://localhost:8080] [--skip-installer]
//                            [--office-only] [--budget 540]
// Single run at a time (lock file). One overall budget: every step gets min(its cap, time left); steps that no longer
// fit are reported NOT_RUN. results.json/report.md are rewritten after every row and again in finally, so a killed
// run still leaves its partial results. Each row carries its real environment.
// Safety: TEST accounts only (@hivic.test / @hivic-test.example), read-only screen visits; writes only through the
// installer-test harness and qa-office-writes (both snapshot + restore, qa_test jobs). Never toggles switches or sends.
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";

type Status = "passed" | "failed" | "blocked" | "not_run";
type Result = { area: string; route_or_action: string; persona: string; status: Status; detail: string; steps: string; screenshots: string[]; environment: string };
const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1]! : d; };
const LABEL = arg("--label", "manual");
const BASE = arg("--base", "http://localhost:8080");
const OFFICE_ONLY = process.argv.includes("--office-only");
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
const env = { label: LABEL, base: BASE, target: ENV_BASE, editor_revision: git || "unknown", production_fingerprint, budget_s: BUDGET_MS / 1000, office_only: OFFICE_ONLY, started_at: new Date().toISOString() };

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
    installer: { email: "deep-test@hivic.test", role: "installer" },
  };
  async function sessionFor(email: string) {
    if (!TEST_EMAIL.test(email)) throw new Error("SAFETY STOP: TEST accounts only");
    const { createClient } = await import("@supabase/supabase-js");
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
    const sb = createClient(process.env["SUPABASE_URL"]!, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (i, init) => { const h = new Headers(init?.headers); if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization"); h.set("apikey", key); return fetch(i, { ...init, headers: h }); } } });
    const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (error || !link.properties?.hashed_token) throw new Error(error?.message ?? "no sign-in token");
    const v = await sb.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
    if (v.error || !v.data.session) throw new Error(v.error?.message ?? "no session");
    return v.data.session;
  }
  const sessions: Record<string, unknown> = {};
  let ownerJob: string | undefined;
  if (!OFFICE_ONLY) {
    for (const [persona, p] of Object.entries(PERSONAS)) {
      const { data: prof } = await admin.from("profiles").select("id").eq("email", p.email).maybeSingle();
      const { data: role } = prof ? await admin.from("user_roles").select("id").eq("user_id", prof.id).eq("role", p.role as never).maybeSingle() : { data: null };
      if (!prof || !role) { add({ area: "setup", route_or_action: `TEST sign-in ${persona}`, persona, status: "blocked", detail: `${p.email} missing or lacks ${p.role} role — ask root to provision this TEST account`, steps: "preflight read-only", environment: ENV_DB }); continue; }
      try { sessions[persona] = await sessionFor(p.email); add({ area: "setup", route_or_action: `TEST sign-in ${persona}`, persona, status: "passed", detail: p.email, steps: "magic-link session for TEST account", environment: ENV_DB }); }
      catch (e) { add({ area: "setup", route_or_action: `TEST sign-in ${persona}`, persona, status: "blocked", detail: (e as Error).message, steps: "magic-link session", environment: ENV_DB }); }
    }
    const { data: owners } = await admin.from("owners").select("id,user_id,email").ilike("email", "%@hivic-test.example").not("user_id", "is", null).limit(50);
    for (const o of owners ?? []) {
      const { data: j } = await admin.from("jobs").select("id").eq("owner_id", o.id).eq("source", "qa_test").is("qa_archived_at" as never, null).limit(1).maybeSingle();
      if (j && o.email && TEST_EMAIL.test(o.email)) { try { sessions["owner"] = await sessionFor(o.email); ownerJob = j.id; break; } catch { /* next */ } }
    }
    if (ownerJob) add({ area: "setup", route_or_action: "TEST sign-in owner", persona: "owner", status: "passed", detail: `owner of qa_test job ${ownerJob}`, steps: "first TEST owner with an open qa_test job", environment: ENV_DB });
    else add({ area: "setup", route_or_action: "TEST sign-in owner", persona: "owner", status: "blocked", detail: "no TEST owner login linked to an open qa_test job — run `bun run journey` to create one", steps: "preflight read-only", environment: ENV_DB });

    // ---- authenticated screens (read-only visits) ----
    const RETIRED = ["HI VIC", "undefined", "NaN", "[object", "50% deposit", "Lorem ipsum", "TODO"];
    type Screen = { step: string; persona: string; path: string; expectedPath?: string; expectedSearch?: Record<string, string>; mustSee?: string[]; mustNotSeeExact?: string[]; mustNotSeeExactOutside?: { text: string; ignoreSelector: string }[]; noPrices?: boolean };
    const screens: Screen[] = [
      { step: "office-operations", persona: "office", path: "/admin/operations", expectedPath: "/admin/enquiries", mustSee: ["Enquiries", "Active", "Closed"] },
      { step: "office-enquiry-groups", persona: "office", path: "/admin/enquiry-groups" },
      { step: "office-campaign-emails", persona: "office", path: "/admin/campaign-emails", expectedPath: "/admin/templates", expectedSearch: { cat: "email" }, mustSee: ["Templates", "Viewing here never sends, saves or connects anything."] },
      { step: "office-partners", persona: "office", path: "/admin/partners-overview" },
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
    const runnable = screens.filter((s) => s.persona === "public" || sessions[s.persona]);
    for (const s of screens.filter((x) => !runnable.includes(x))) add({ area: "screens", route_or_action: s.path, persona: s.persona, status: "blocked", detail: "no TEST session for this role", steps: "see setup rows" });
    const storageKey = `sb-${process.env["SUPABASE_PROJECT_ID"] ?? new URL(process.env["SUPABASE_URL"]!).hostname.split(".")[0]}-auth-token`;
    if (!fits(60_000)) notRun("screens", "authenticated screen visits", "overall budget exhausted");
    else {
      writeFileSync(`${OUT}/.manifest.json`, JSON.stringify({ outDir: OUT, base: BASE, storageKey, sessions, screens: runnable }));
      const br = sh(["python3", "e2e/journey/shoot.py", `${OUT}/.manifest.json`], 300_000);
      writeFileSync(`${OUT}/.manifest.json`, "{}");
      if (br.status !== 0 || !existsSync(`${OUT}/.browser.json`)) add({ area: "screens", route_or_action: "browser harness", persona: "-", status: "failed", detail: (br.error ? `timeout/error: ${br.error.message} ` : "") + (br.stderr || "harness did not finish").slice(-400), steps: "python3 e2e/journey/shoot.py" });
      else for (const r of JSON.parse(readFileSync(`${OUT}/.browser.json`, "utf8")) as { step: string; ok: boolean; detail: string; shots: string[] }[]) {
        const s = runnable.find((x) => x.step === r.step)!;
        add({ area: "screens", route_or_action: `${s.path} (${r.detail.includes("390px") ? "phone" : "desktop"})`, persona: s.persona, status: r.ok ? "passed" : "failed", detail: r.detail, steps: `sign in as TEST ${s.persona}, open ${s.path}, check labels`, screenshots: r.shots });
      }
    }
  }

  // ---- office delete / restore / classification + parity + denied roles (one qa_test job, snapshot restore) ----
  if (!fits(150_000)) notRun("office writes", "qa-office-writes", "overall budget exhausted");
  else {
    const budget = Math.floor(Math.min(420_000, left() - 30_000) / 1000);
    const ow = sh(["bun", "scripts/qa-office-writes.ts", "--base", BASE, "--out", `${OUT}/office-writes`, "--budget", String(budget)], (budget + 20) * 1000);
    writeFileSync(`${OUT}/office-writes.log`, `${ow.stdout}\n${ow.stderr}`);
    const f = `${OUT}/office-writes/office-writes.json`;
    if (ow.error) add({ area: "office writes", route_or_action: "qa-office-writes", persona: "office", status: "failed", detail: `killed: ${ow.error.message}; its snapshot (if any) is recovered on next run`, steps: "bun scripts/qa-office-writes.ts" });
    if (!existsSync(f)) add({ area: "office writes", route_or_action: "qa-office-writes", persona: "office", status: "failed", detail: `harness produced no results (exit ${ow.status})`, steps: "bun scripts/qa-office-writes.ts" });
    else for (const r of JSON.parse(readFileSync(f, "utf8")) as Result[]) add(r);
  }

  if (!OFFICE_ONLY) {
    // ---- installer app click-through (existing harness; ALWAYS local, never the deployed site) ----
    if (process.argv.includes("--skip-installer")) notRun("installer journey", "installer-test --installer-app-only", "skipped by flag", ENV_LOCAL);
    else if (!fits(240_000)) notRun("installer journey", "installer-test --installer-app-only", "overall budget too low (needs ~4+ min)", ENV_LOCAL);
    else {
      const it = sh(["bun", "scripts/installer-test.ts", "--runs", "1", "--installer-app-only"], left() - 120_000);
      const out = `${it.stdout}\n${it.stderr}`; writeFileSync(`${OUT}/installer-test.log`, out);
      const lines = out.split("\n").filter((l) => /^(PASS|FAIL)\s/.test(l));
      if (it.error) add({ area: "installer journey", route_or_action: "installer-test", persona: "installer", status: "failed", detail: `stopped at budget: ${it.error.message}`, steps: "see installer-test.log", environment: ENV_LOCAL });
      if (!lines.length) add({ area: "installer journey", route_or_action: "installer-test", persona: "installer", status: "failed", detail: `harness produced no results (exit ${it.status})`, steps: "bun scripts/installer-test.ts --runs 1 --installer-app-only", environment: ENV_LOCAL });
      for (const l of lines) add({ area: "installer journey", route_or_action: l.replace(/^(PASS|FAIL)\s+/, "").split("  —  ")[0]!, persona: "installer", status: l.startsWith("PASS") ? "passed" : "failed", detail: l.split("  —  ")[1] ?? "ok", steps: "see installer-test.log", environment: ENV_LOCAL });
    }

    // ---- isolated email rule tests ----
    const EMAIL_TESTS = ["tests/step3-email-parity.test.ts", "tests/save-spot.test.ts", "tests/save-spot-only-approved.test.ts", "tests/group-b-media.test.ts", "tests/group-b-declaration-routing.test.ts", "tests/existing-insulation-followup.test.ts", "tests/existing-insulation-send.test.ts", "tests/email-safety.test.ts", "tests/estimate-email.test.ts"];
    if (!fits(60_000)) notRun("emails (isolated)", "email rule tests", "overall budget exhausted", ENV_ISOLATED);
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
      const { data, error } = await admin.from("customer_email_sends").select("status,purpose,error,provider_message_id").gte("created_at", since);
      if (error) add({ area: "emails (live log)", route_or_action: "customer_email_sends last 24h", persona: "-", status: "blocked", detail: error.message, steps: "read-only select", environment: ENV_DB });
      else {
        const rows = data ?? [];
        const bad = rows.filter((r) => /fail|error|unrecorded/i.test(r.status) || r.error);
        const by: Record<string, number> = {}; for (const r of rows) { const k = `${r.purpose}/${r.status}/${r.provider_message_id ? "provider id" : "no provider id"}`; by[k] = (by[k] ?? 0) + 1; }
        add({ area: "emails (live log)", route_or_action: "customer_email_sends last 24h", persona: "-", status: bad.length ? "failed" : "passed", detail: `${rows.length} records ${JSON.stringify(by)}; ${bad.length} failed/uncertain. Recorded status only — provider delivery is not confirmed by this read`, steps: "read-only select", environment: ENV_DB });
      }
    }

    // ---- retired wording scan ----
    const sc = sh(["bun", "scripts/scan-retired-terms.ts"], 60_000);
    add({ area: "wording", route_or_action: "retired-term scan", persona: "-", status: sc.status === 0 ? "passed" : "failed", detail: sc.status === 0 ? "no customer-visible retired terms in source" : (sc.stdout + sc.stderr).slice(-400), steps: "bun scripts/scan-retired-terms.ts", environment: "local source files" });

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
