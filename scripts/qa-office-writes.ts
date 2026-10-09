// Office write-action QA on ONE dedicated qa_test job (default HV-2111), snapshot + restore.
//   bun scripts/qa-office-writes.ts --base <url> --out <dir>
// 1. Denied: TEST installer / REC / owner call deleteJob, restoreJob, setEligibility directly → must be refused, DB unchanged.
// 2. Browser (office, 1280 + 390): Delete job → Deleted jobs page → not on Pipeline → Restore → reload;
//    eligibility Does Not Appear Eligible → Likely Eligible with reasons; reload persists.
// 3. DB readback: audit events carry office actor + reason; owner answers (properties.enrichment) unchanged.
// 4. Restores the job's original eligibility/stage/delete snapshot. Never touches any other job; nothing is sent.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { toJSONAsync } from "seroval";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1]! : d; };
const BASE = arg("--base", "http://localhost:8080"), OUT = arg("--out", `/tmp/qa-office-writes`), JOB = arg("--job", "HV-2111");
mkdirSync(`${OUT}/screens`, { recursive: true });
const TEST_EMAIL = /@(hivic-test\.example|hivic\.test)$/i;
const FORBIDDEN = new Set(["HV-1981", "HV-2010", "HV-2015"]);
type Row = { area: string; route_or_action: string; persona: string; status: "passed" | "failed" | "blocked" | "not_run"; detail: string; steps: string; screenshots: string[] };
const rows: Row[] = [];
const add = (r: Omit<Row, "screenshots"> & { screenshots?: string[] }) => { rows.push({ screenshots: [], ...r }); console.log(`${r.status.toUpperCase().padEnd(8)} ${r.route_or_action} [${r.persona}] ${r.detail}`); };
const finish = () => { writeFileSync(`${OUT}/office-writes.json`, JSON.stringify(rows, null, 2)); process.exit(rows.every((r) => r.status === "passed") ? 0 : 1); };

if (FORBIDDEN.has(JOB)) throw new Error("SAFETY STOP: protected real job");
const JOB_COLS = "id,job_number,source,stage,prior_stage,hold_reason,next_action,deleted_at,deleted_by,deleted_reason,eligibility_outcome,eligibility_reason,eligibility_set_by,eligibility_set_at,eligibility_decision_source,eligibility_review_required,property_id";
const { data: snap } = await admin.from("jobs").select(JOB_COLS).eq("job_number", JOB).maybeSingle();
if (!snap || snap.source !== "qa_test") { add({ area: "office writes", route_or_action: "fixture", persona: "-", status: "blocked", detail: `${JOB} missing or not qa_test — refusing`, steps: "preflight" }); finish(); }
const job = snap!;
if (job.deleted_at) { add({ area: "office writes", route_or_action: "fixture", persona: "-", status: "blocked", detail: `${JOB} already deleted — restore it before testing`, steps: "preflight" }); finish(); }
const propHash = async () => { const { data } = await admin.from("properties").select("enrichment").eq("id", job.property_id!).maybeSingle(); return createHash("sha256").update(JSON.stringify(data?.enrichment ?? null)).digest("hex"); };
const answersBefore = await propHash();
const startedAt = new Date().toISOString();

async function sessionFor(email: string) {
  if (!TEST_EMAIL.test(email)) throw new Error("SAFETY STOP: TEST accounts only");
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env["SUPABASE_URL"]!, process.env["SUPABASE_PUBLISHABLE_KEY"]!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !link.properties?.hashed_token) throw new Error(error?.message ?? "no token");
  const v = await sb.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (v.error || !v.data.session) throw new Error(v.error?.message ?? "no session");
  return v.data.session;
}
const roleOk = async (email: string, role: string) => { const { data: p } = await admin.from("profiles").select("id").eq("email", email).maybeSingle(); if (!p) return null; const { data: r } = await admin.from("user_roles").select("role").eq("user_id", p.id); return (r ?? []).map((x) => x.role as string).includes(role) && !(r ?? []).some((x) => x.role === "admin") ? p.id : null; };
const sessions: Record<string, Awaited<ReturnType<typeof sessionFor>>> = {};
for (const [persona, email, role] of [["office", "admin@hivic.test", "admin"], ["installer", "deep-test@hivic.test", "installer"], ["rec", "qa.rec.delta@hivic-test.example", "electrician"]] as const) {
  const ok = role === "admin" ? (await admin.from("profiles").select("id").eq("email", email).maybeSingle()).data?.id : await roleOk(email, role);
  if (!ok) { add({ area: "office writes", route_or_action: "TEST sign-in", persona, status: "blocked", detail: `${email} missing, lacks ${role}, or is also admin`, steps: "read-only role preflight" }); continue; }
  try { sessions[persona] = await sessionFor(email); } catch (e) { add({ area: "office writes", route_or_action: "TEST sign-in", persona, status: "blocked", detail: (e as Error).message, steps: "magic link" }); }
}
{ // TEST owner (non-admin) linked to a qa_test job
  const { data: owners } = await admin.from("owners").select("id,email,user_id").ilike("email", "%@hivic-test.example").not("user_id", "is", null).limit(30);
  for (const o of owners ?? []) { if (!o.email || !(await roleOk(o.email, "owner"))) continue; try { sessions["owner"] = await sessionFor(o.email); break; } catch { /* next */ } }
  if (!sessions["owner"]) add({ area: "office writes", route_or_action: "TEST sign-in", persona: "owner", status: "blocked", detail: "no non-admin TEST owner login", steps: "read-only preflight" });
}

// ---- 1. denied direct endpoint calls ----
const fnId = (file: string, name: string) => createHash("sha256").update(`${file}--${name}_createServerFn_handler`).digest("hex");
async function callFn(id: string, token: string, data: unknown) {
  const body = JSON.stringify(await toJSONAsync({ data }));
  const res = await fetch(`${BASE}/_serverFn/${id}`, { method: "POST", headers: { "x-tsr-serverFn": "true", "content-type": "application/json", accept: "application/json", authorization: `Bearer ${token}`, origin: BASE }, body });
  return { status: res.status, text: (await res.text()).slice(0, 600) };
}
const ACTIONS = [
  { name: "deleteJob", id: fnId("src/lib/office.functions.ts", "deleteJob"), data: { jobId: job.id, reason: "QA denial probe" } },
  { name: "restoreJob", id: fnId("src/lib/office.functions.ts", "restoreJob"), data: { jobId: job.id, reason: "QA denial probe" } },
  { name: "setEligibility", id: fnId("src/lib/portal.functions.ts", "setEligibility"), data: { jobId: job.id, outcome: "does_not_appear_eligible", reason: "QA denial probe", nextAction: "none" } },
];
const dbSig = async () => { const { data } = await admin.from("jobs").select(JOB_COLS).eq("id", job.id).single(); return JSON.stringify(data); };
// Endpoint-exists control: an unauthenticated call must reach the function (auth error), not a 404.
for (const persona of ["installer", "rec", "owner"]) {
  const s = sessions[persona]; if (!s) continue;
  for (const a of ACTIONS) {
    const before = await dbSig();
    const r = await callFn(a.id, s.access_token, a.data);
    const after = await dbSig();
    const refused = r.status !== 404 && !/"ok":true|ok\\?":true/.test(r.text) && /admin|denied|forbidden|not allowed|unauthori|permission|only/i.test(r.text);
    add({ area: "office writes (denied)", route_or_action: `${a.name} direct call`, persona, status: refused && before === after ? "passed" : "failed", detail: `HTTP ${r.status}; DB ${before === after ? "unchanged" : "CHANGED"}; ${r.text.replace(/\s+/g, " ").slice(0, 160)}`, steps: `POST ${BASE}/_serverFn/<${a.name}> as TEST ${persona}` });
  }
}
if (!sessions["rec"]) add({ area: "office writes (denied)", route_or_action: "REC direct calls", persona: "rec", status: "blocked", detail: "no TEST REC session", steps: "" });

// ---- 2. browser journey as TEST office ----
if (!sessions["office"]) { add({ area: "office writes", route_or_action: "browser journey", persona: "office", status: "blocked", detail: "no TEST office session", steps: "" }); finish(); }
const storageKey = `sb-${new URL(process.env["SUPABASE_URL"]!).hostname.split(".")[0]}-auth-token`;
const manifest = `${OUT}/.manifest.json`;
writeFileSync(manifest, JSON.stringify({ base: BASE, outDir: OUT, storageKey, session: sessions["office"], jobId: job.id, jobNumber: JOB }));
const py = spawnSync("python3", ["e2e/office-writes.py", manifest], { encoding: "utf8", timeout: 420_000 });
writeFileSync(manifest, "{}");
writeFileSync(`${OUT}/browser.log`, `${py.stdout}\n${py.stderr}`);
const br: { step: string; ok: boolean; detail: string; shots: string[] }[] = existsSync(`${OUT}/.browser.json`) ? JSON.parse(readFileSync(`${OUT}/.browser.json`, "utf8")) : [];
if (!br.length) add({ area: "office writes", route_or_action: "browser journey", persona: "office", status: "failed", detail: (py.stderr || "harness produced no results").slice(-400), steps: "python3 e2e/office-writes.py" });
for (const b of br) add({ area: "office writes", route_or_action: b.step, persona: "office", status: b.ok ? "passed" : "failed", detail: b.detail, steps: `TEST office on ${BASE}`, screenshots: b.shots });

// ---- 3. DB readback ----
const officeId = sessions["office"]!.user.id;
const { data: ev } = await admin.from("workflow_events").select("event_type,actor_id,details,created_at").eq("job_id", job.id).gte("created_at", startedAt).order("created_at");
const evs = (ev ?? []) as { event_type: string; actor_id: string | null; details: Record<string, unknown> | null }[];
for (const t of ["job_deleted", "job_restored"]) { const m = evs.filter((e) => e.event_type === t); add({ area: "office writes (DB)", route_or_action: `${t} audit`, persona: "office", status: m.length >= 1 && m.every((e) => e.actor_id === officeId && typeof e.details?.["reason"] === "string" && (e.details["reason"] as string).length >= 3) ? "passed" : "failed", detail: `${m.length} event(s), office actor + reason`, steps: "read workflow_events" }); }
const el = evs.filter((e) => e.event_type === "eligibility_override" || e.event_type === "eligibility_set");
add({ area: "office writes (DB)", route_or_action: "classification audit", persona: "office", status: el.length >= 2 && el.every((e) => e.actor_id === officeId && !!e.details?.["reason"]) ? "passed" : "failed", detail: `${el.length} classification event(s): ${el.map((e) => e.event_type).join(", ")}`, steps: "read workflow_events" });
add({ area: "office writes (DB)", route_or_action: "owner answers unchanged", persona: "-", status: (await propHash()) === answersBefore ? "passed" : "failed", detail: "properties.enrichment hash before = after", steps: "sha256 compare" });
const { data: prot } = await admin.from("jobs").select("job_number,deleted_at").in("job_number", [...FORBIDDEN]);
add({ area: "office writes (DB)", route_or_action: "3 real deleted jobs untouched", persona: "-", status: (prot ?? []).length === 3 && (prot ?? []).every((p) => !!p.deleted_at) ? "passed" : "failed", detail: (prot ?? []).map((p) => `${p.job_number} deleted`).join(", "), steps: "read-only" });

// ---- 4. restore TEST snapshot ----
const { id: _i, job_number: _n, source: _s, property_id: _p, ...restore } = job;
const { error: rErr } = await admin.from("jobs").update(restore as never).eq("id", job.id).eq("source", "qa_test");
const now = await dbSig();
const { id: _a, job_number: _b, source: _c, property_id: _d, ...cur } = JSON.parse(now) as typeof job;
add({ area: "office writes", route_or_action: "TEST snapshot restored", persona: "-", status: !rErr && JSON.stringify(cur) === JSON.stringify(restore) ? "passed" : "failed", detail: rErr?.message ?? `${JOB} back to ${job.stage} / ${job.eligibility_outcome} (${job.eligibility_decision_source}); audit events kept`, steps: "restore snapshot (qa_test only)" });
finish();
