// Whole-portal recurring QA — ONE bounded command (no AI, no sends, no publishing):
//   bun scripts/portal-qa.ts [--label morning|midday|afternoon|release] [--base http://localhost:8080] [--skip-installer]
// Writes machine-readable results to /mnt/documents/portal-qa/<stamp>/results.json (+ report.md, screenshots)
// and /mnt/documents/portal-qa/latest.json. Exit 0 only when every check PASSED; any FAIL/BLOCKED/NOT_RUN exits 1.
// Safety: TEST accounts only (@hivic.test / @hivic-test.example), read-only screen visits, writes only through the
// existing installer-test (snapshot + restore, qa_test jobs). Never toggles switches, never emails/texts anyone.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";

type Status = "passed" | "failed" | "blocked" | "not_run";
type Result = { area: string; route_or_action: string; persona: string; status: Status; detail: string; steps: string; screenshots: string[] };
const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1]! : d; };
const LABEL = arg("--label", "manual");
const BASE = arg("--base", "http://localhost:8080");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const ROOT = "/mnt/documents/portal-qa";
const OUT = `${ROOT}/${stamp}`;
mkdirSync(OUT, { recursive: true });
const TEST_EMAIL = /@(hivic-test\.example|hivic\.test)$/i;
const results: Result[] = [];
const add = (r: Omit<Result, "screenshots"> & { screenshots?: string[] }) => { results.push({ screenshots: [], ...r }); console.log(`${r.status.toUpperCase().padEnd(8)} ${r.area} — ${r.route_or_action}${r.status === "passed" ? "" : `: ${r.detail}`}`); };
const sh = (cmd: string[], timeout = 540_000) => spawnSync(cmd[0]!, cmd.slice(1), { encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024 });

// ---- version / environment ----
const git = sh(["git", "log", "-1", "--format=%h %cI"]).stdout.trim();
const env = { label: LABEL, base: BASE, target: BASE.includes("localhost") ? "preview-sandbox (unpublished working copy)" : "deployed", source_revision: git || "unknown", started_at: new Date().toISOString() };

// ---- TEST personas (verified read-only; never created or changed here) ----
const PERSONAS: Record<string, { email: string; role: string }> = {
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
for (const [persona, p] of Object.entries(PERSONAS)) {
  const { data: prof } = await admin.from("profiles").select("id").eq("email", p.email).maybeSingle();
  const { data: role } = prof ? await admin.from("user_roles").select("id").eq("user_id", prof.id).eq("role", p.role as never).maybeSingle() : { data: null };
  if (!prof || !role) { add({ area: "setup", route_or_action: `TEST sign-in ${persona}`, persona, status: "blocked", detail: `${p.email} missing or lacks ${p.role} role — ask root to provision this TEST account`, steps: "preflight read-only" }); continue; }
  try { sessions[persona] = await sessionFor(p.email); add({ area: "setup", route_or_action: `TEST sign-in ${persona}`, persona, status: "passed", detail: p.email, steps: "magic-link session for TEST account" }); }
  catch (e) { add({ area: "setup", route_or_action: `TEST sign-in ${persona}`, persona, status: "blocked", detail: (e as Error).message, steps: "magic-link session" }); }
}
// Owner: a TEST owner login linked to a live (unarchived) qa_test job.
{
  const { data: owners } = await admin.from("owners").select("id,user_id,email").ilike("email", "%@hivic-test.example").not("user_id", "is", null).limit(50);
  let ownerJob: string | null = null;
  for (const o of owners ?? []) {
    const { data: j } = await admin.from("jobs").select("id").eq("owner_id", o.id).eq("source", "qa_test").is("qa_archived_at" as never, null).limit(1).maybeSingle();
    if (j && o.email && TEST_EMAIL.test(o.email)) { try { sessions["owner"] = await sessionFor(o.email); ownerJob = j.id; break; } catch { /* next */ } }
  }
  if (ownerJob) { add({ area: "setup", route_or_action: "TEST sign-in owner", persona: "owner", status: "passed", detail: `owner of qa_test job ${ownerJob}`, steps: "first TEST owner with an open qa_test job" }); (PERSONAS as Record<string, { email: string; role: string; job?: string }>)["owner"] = { email: "(TEST owner)", role: "owner", job: ownerJob }; }
  else add({ area: "setup", route_or_action: "TEST sign-in owner", persona: "owner", status: "blocked", detail: "no TEST owner login linked to an open qa_test job — run `bun run journey` to create one", steps: "preflight read-only" });
}

// ---- authenticated screens (read-only visits; approved labels asserted) ----
const ownerJob = (PERSONAS as Record<string, { job?: string }>)["owner"]?.job;
// Case-sensitive: invented/broken wording that must never reach a screen.
const RETIRED = ["HI VIC", "undefined", "NaN", "[object", "50% deposit", "Lorem ipsum", "TODO"];
type Screen = { step: string; persona: string; path: string; mustSee?: string[]; mustNotSee?: string[]; mustNotSeeExact?: string[]; noPrices?: boolean };
const screens: Screen[] = [
  { step: "office-operations", persona: "office", path: "/admin/operations", mustSee: ["Leads", "Active", "Closed"] },
  { step: "office-enquiry-groups", persona: "office", path: "/admin/enquiry-groups" },
  { step: "office-campaign-emails", persona: "office", path: "/admin/campaign-emails", mustSee: ["Preview only"] },
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
].map((s) => ({ ...s, mustNotSeeExact: RETIRED }));
const runnable = screens.filter((s) => s.persona === "public" || sessions[s.persona]);
for (const s of screens.filter((x) => !runnable.includes(x))) add({ area: "screens", route_or_action: s.path, persona: s.persona, status: "blocked", detail: "no TEST session for this role", steps: "see setup rows" });
const storageKey = `sb-${process.env["SUPABASE_PROJECT_ID"] ?? new URL(process.env["SUPABASE_URL"]!).hostname.split(".")[0]}-auth-token`;
writeFileSync(`${OUT}/.manifest.json`, JSON.stringify({ outDir: OUT, base: BASE, storageKey, sessions, screens: runnable }));
const br = sh(["python3", "e2e/journey/shoot.py", `${OUT}/.manifest.json`], 540_000);
if (br.status !== 0 || !existsSync(`${OUT}/.browser.json`)) add({ area: "screens", route_or_action: "browser harness", persona: "-", status: "failed", detail: (br.stderr || br.error?.message || "harness did not finish").slice(-400), steps: "python3 e2e/journey/shoot.py" });
else for (const r of JSON.parse(readFileSync(`${OUT}/.browser.json`, "utf8")) as { step: string; ok: boolean; detail: string; shots: string[] }[]) {
  const s = runnable.find((x) => x.step === r.step)!;
  add({ area: "screens", route_or_action: `${s.path} (${r.detail.includes("390px") ? "phone" : "desktop"})`, persona: s.persona, status: r.ok ? "passed" : "failed", detail: r.detail, steps: `sign in as TEST ${s.persona}, open ${s.path}, check labels`, screenshots: r.shots });
}
writeFileSync(`${OUT}/.manifest.json`, "{}"); // drop session tokens from Files

// ---- installer app click-through with persistence readback (existing harness, snapshot/restore) ----
if (process.argv.includes("--skip-installer")) add({ area: "installer journey", route_or_action: "installer-test --installer-app-only", persona: "installer", status: "not_run", detail: "skipped by flag", steps: "" });
else {
  const it = sh(["bun", "scripts/installer-test.ts", "--runs", "1", "--installer-app-only"], 580_000);
  const out = `${it.stdout}\n${it.stderr}`; writeFileSync(`${OUT}/installer-test.log`, out);
  const lines = out.split("\n").filter((l) => /^(PASS|FAIL)\s/.test(l));
  if (!lines.length) add({ area: "installer journey", route_or_action: "installer-test", persona: "installer", status: "failed", detail: `harness produced no results (exit ${it.status}${it.error ? `, ${it.error.message}` : ""})`, steps: "bun scripts/installer-test.ts --runs 1 --installer-app-only" });
  for (const l of lines) add({ area: "installer journey", route_or_action: l.replace(/^(PASS|FAIL)\s+/, "").split("  —  ")[0]!, persona: "installer", status: l.startsWith("PASS") ? "passed" : "failed", detail: l.split("  —  ")[1] ?? "ok", steps: "see installer-test.log" });
}

// ---- isolated email trigger/rule tests (PGlite + renderers; nothing sent) ----
const EMAIL_TESTS = ["tests/step3-email-parity.test.ts", "tests/save-spot.test.ts", "tests/save-spot-only-approved.test.ts", "tests/group-b-media.test.ts", "tests/group-b-declaration-routing.test.ts", "tests/existing-insulation-followup.test.ts", "tests/existing-insulation-send.test.ts", "tests/email-safety.test.ts", "tests/estimate-email.test.ts"].filter(existsSync);
const et = sh(["bun", "test", ...EMAIL_TESTS.map((t) => `./${t}`)]);
const etOut = `${et.stdout}\n${et.stderr}`; writeFileSync(`${OUT}/email-tests.log`, etOut);
const pass = Number(etOut.match(/(\d+) pass/)?.[1] ?? 0), fail = Number(etOut.match(/(\d+) fail/)?.[1] ?? 0);
add({ area: "emails (isolated)", route_or_action: "audience/price/routing/removal/idempotency/opt-out rules", persona: "-", status: et.status === 0 && pass > 0 ? "passed" : "failed", detail: `${pass} pass, ${fail} fail`, steps: `bun test ${EMAIL_TESTS.join(" ")}` });

// ---- read-only real email delivery log (last 24h) ----
{
  const since = new Date(Date.now() - 864e5).toISOString();
  const { data, error } = await admin.from("customer_email_sends").select("status,purpose,error").gte("created_at", since);
  if (error) add({ area: "emails (live log)", route_or_action: "customer_email_sends last 24h", persona: "-", status: "blocked", detail: error.message, steps: "read-only select" });
  else { const bad = (data ?? []).filter((r) => /fail|error|unrecorded/i.test(r.status) || r.error); add({ area: "emails (live log)", route_or_action: "customer_email_sends last 24h", persona: "-", status: bad.length ? "failed" : "passed", detail: `${data?.length ?? 0} records, ${bad.length} failed/uncertain${bad.length ? `: ${[...new Set(bad.map((b) => `${b.purpose}/${b.status}`))].join(", ")}` : ""}`, steps: "read-only select" }); }
}

// ---- retired wording scan ----
const sc = sh(["bun", "scripts/scan-retired-terms.ts"]);
add({ area: "wording", route_or_action: "retired-term scan", persona: "-", status: sc.status === 0 ? "passed" : "failed", detail: sc.status === 0 ? "no customer-visible retired terms" : (sc.stdout + sc.stderr).slice(-400), steps: "bun scripts/scan-retired-terms.ts" });

// ---- honest coverage gaps (never PASS) ----
for (const [a, why] of [
  ["electrician/REC onboarding click-through (sign, rates, insurance)", "no TEST-scoped writable REC onboarding journey harness yet"],
  ["office write actions (approve, send back, Save my spot send button)", "office writes touch shared records; needs dedicated TEST office scope"],
  ["owner signing / booking / payment choice", "no TEST owner signing harness with restore"],
  ["installer onboarding signing + approval", "excluded in --installer-app-only; run `bun run installer-test --runs 3` deliberately"],
]) add({ area: "coverage", route_or_action: a, persona: "-", status: "not_run", detail: why, steps: "" });

// ---- results ----
const counts = results.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {} as Record<string, number>);
const overall: Status = results.some((r) => r.status === "failed") ? "failed" : results.every((r) => r.status === "passed") ? "passed" : "blocked";
const prev = existsSync(`${ROOT}/latest.json`) ? JSON.parse(readFileSync(`${ROOT}/latest.json`, "utf8")) as { last_successful_run?: string | null } : {};
const doc = { ...env, finished_at: new Date().toISOString(), overall, counts, last_successful_run: overall === "passed" ? env.started_at : prev.last_successful_run ?? null, out_dir: OUT, results };
writeFileSync(`${OUT}/results.json`, JSON.stringify(doc, null, 2));
writeFileSync(`${ROOT}/latest.json`, JSON.stringify(doc, null, 2));
writeFileSync(`${OUT}/report.md`, [`# Portal QA ${LABEL} — ${env.started_at}`, `Target: ${env.target} · revision ${env.source_revision} · overall **${overall.toUpperCase()}**`, `Counts: ${JSON.stringify(counts)}`, "", "| Status | Area | Route/action | Who | Detail |", "|---|---|---|---|---|", ...results.map((r) => `| ${r.status} | ${r.area} | ${r.route_or_action} | ${r.persona} | ${r.detail.replace(/\|/g, "/").slice(0, 200)} |`)].join("\n"));
console.log(`\nOVERALL ${overall.toUpperCase()} ${JSON.stringify(counts)}\n${OUT}/results.json`);
process.exit(overall === "passed" ? 0 : 1);
