// Office write-action QA on ONE dedicated qa_test job (default HV-2111), with a persistent snapshot + guaranteed restore.
//   bun scripts/qa-office-writes.ts --base <url> --out <dir> [--budget 420] [--inject-failure]
// 1. Denied: TEST installer / REC / owner call deleteJob, restoreJob, setEligibility directly -> refused, DB unchanged.
// 2. Count/list parity on the deployed office reads with includeTest=true (getPipeline + listByStatus):
//    job counted + listed before, absent while deleted, back after restore; every phase pipeline count == list total.
// 3. Browser (office, 1280 + 390): Delete job -> Deleted jobs page -> Restore -> reload; eligibility changes persist.
// 4. DB readback: audit events with office actor + reason; owner answers unchanged; 3 protected real jobs untouched.
// Safety: snapshot is written to disk BEFORE any change; restore runs in finally, on SIGINT/SIGTERM and on the
// internal deadline; a leftover snapshot is only recovered when the job still carries this harness's "QA " marks.
// --inject-failure: deletes the TEST job through the live endpoint, then throws on purpose, to prove restoration.
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { toJSONAsync, fromJSON } from "seroval";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1]! : d; };
const BASE = arg("--base", "http://localhost:8080"), OUT = arg("--out", "/tmp/qa-office-writes"), JOB = arg("--job", "HV-2111");
const BUDGET_MS = Number(arg("--budget", "420")) * 1000, INJECT = process.argv.includes("--inject-failure");
const DEADLINE = Date.now() + BUDGET_MS;
const SNAP_FILE = "/mnt/documents/portal-qa/.office-writes-snapshot.json";
mkdirSync(`${OUT}/screens`, { recursive: true }); mkdirSync("/mnt/documents/portal-qa", { recursive: true });
const TEST_EMAIL = /@(hivic-test\.example|hivic\.test)$/i;
const FORBIDDEN = new Set(["HV-1981", "HV-2010", "HV-2015"]);
const ENV = BASE.includes("localhost") ? "local preview sandbox" : `deployed ${BASE}`;
type Row = { area: string; route_or_action: string; persona: string; status: "passed" | "failed" | "blocked" | "not_run"; detail: string; steps: string; screenshots: string[]; environment: string };
const rows: Row[] = [];
const add = (r: Omit<Row, "screenshots" | "environment"> & { screenshots?: string[]; environment?: string }) => { rows.push({ screenshots: [], environment: ENV, ...r }); writeFileSync(`${OUT}/office-writes.json`, JSON.stringify(rows, null, 2)); console.log(`${r.status.toUpperCase().padEnd(8)} ${r.route_or_action} [${r.persona}] ${r.detail}`); };
const left = () => DEADLINE - Date.now();

if (FORBIDDEN.has(JOB)) throw new Error("SAFETY STOP: protected real job");
const JOB_COLS = "id,job_number,source,stage,prior_stage,hold_reason,next_action,deleted_at,deleted_by,deleted_reason,eligibility_outcome,eligibility_reason,eligibility_set_by,eligibility_set_at,eligibility_decision_source,eligibility_review_required,property_id";
type JobRow = Record<string, unknown> & { id: string; job_number: string; source: string; stage: string; property_id: string | null; deleted_at: string | null; deleted_reason: string | null; eligibility_reason: string | null; eligibility_outcome: string | null; eligibility_decision_source: string | null };
const readJob = async (by: "id" | "job_number", v: string) => (await admin.from("jobs").select(JOB_COLS).eq(by, v).maybeSingle()).data as JobRow | null;
const RESTORABLE = (j: JobRow) => { const { id: _a, job_number: _b, source: _c, property_id: _d, ...r } = j; return r; };

/** Restore the TEST job to the snapshot; only ever a qa_test row matching the snapshot id. Returns proof text or throws. */
async function restoreSnapshot(snap: JobRow, why: string) {
  if (snap.source !== "qa_test" || FORBIDDEN.has(snap.job_number)) throw new Error("SAFETY STOP: snapshot is not a qa_test job");
  const { error } = await admin.from("jobs").update(RESTORABLE(snap) as never).eq("id", snap.id).eq("source", "qa_test");
  if (error) throw new Error(`restore failed: ${error.message}`);
  const cur = await readJob("id", snap.id);
  if (!cur || JSON.stringify(RESTORABLE(cur)) !== JSON.stringify(RESTORABLE(snap))) throw new Error("restore readback differs from snapshot");
  rmSync(SNAP_FILE, { force: true });
  return `${snap.job_number} back to ${snap.stage} / ${snap.eligibility_outcome} (${snap.eligibility_decision_source}), not deleted=${!snap.deleted_at}; audit events kept (${why})`;
}

// ---- leftover snapshot from an interrupted run: recover only if the job still carries this harness's marks ----
if (existsSync(SNAP_FILE)) {
  const old = JSON.parse(readFileSync(SNAP_FILE, "utf8")) as { saved_at: string; job: JobRow };
  const cur = await readJob("id", old.job.id);
  const ours = !!cur && cur.source === "qa_test" && ((cur.deleted_reason ?? "").startsWith("QA ") || (cur.eligibility_reason ?? "").startsWith("QA "));
  const unchanged = !!cur && JSON.stringify(RESTORABLE(cur)) === JSON.stringify(RESTORABLE(old.job));
  if (unchanged) { rmSync(SNAP_FILE, { force: true }); add({ area: "office writes", route_or_action: "leftover snapshot", persona: "-", status: "passed", detail: `snapshot from ${old.saved_at} already matched the job; discarded`, steps: "recovery" }); }
  else if (ours) { try { add({ area: "office writes", route_or_action: "leftover snapshot recovered", persona: "-", status: "passed", detail: await restoreSnapshot(old.job, `interrupted run ${old.saved_at}`), steps: "recovery" }); } catch (e) { add({ area: "office writes", route_or_action: "leftover snapshot", persona: "-", status: "blocked", detail: (e as Error).message, steps: "recovery" }); process.exit(1); } }
  else { add({ area: "office writes", route_or_action: "leftover snapshot", persona: "-", status: "blocked", detail: `snapshot from ${old.saved_at} exists but the job changed without QA marks — not restoring blindly; review ${SNAP_FILE}`, steps: "recovery" }); process.exit(1); }
}

const job = await readJob("job_number", JOB);
if (!job || job.source !== "qa_test") { add({ area: "office writes", route_or_action: "fixture", persona: "-", status: "blocked", detail: `${JOB} missing or not qa_test — refusing`, steps: "preflight" }); process.exit(1); }
if (job.deleted_at) { add({ area: "office writes", route_or_action: "fixture", persona: "-", status: "blocked", detail: `${JOB} already deleted — not starting`, steps: "preflight" }); process.exit(1); }
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
const roles = async (email: string) => { const { data: p } = await admin.from("profiles").select("id").eq("email", email).maybeSingle(); if (!p) return null; const { data: r } = await admin.from("user_roles").select("role").eq("user_id", p.id); return (r ?? []).map((x) => x.role as string); };
const sessions: Record<string, Awaited<ReturnType<typeof sessionFor>>> = {};
for (const [persona, email, role] of [["office", "admin@hivic.test", "admin"], ["installer", "deep-test@hivic.test", "installer"], ["rec", "qa.rec.delta@hivic-test.example", "electrician"]] as const) {
  const r = await roles(email);
  const ok = r && r.includes(role) && (role === "admin" || !r.includes("admin"));
  if (!ok) { add({ area: "office writes", route_or_action: "TEST sign-in", persona, status: "blocked", detail: `${email} missing, lacks ${role}, or non-office persona is also admin`, steps: "read-only role preflight" }); continue; }
  try { sessions[persona] = await sessionFor(email); } catch (e) { add({ area: "office writes", route_or_action: "TEST sign-in", persona, status: "blocked", detail: (e as Error).message, steps: "magic link" }); }
}
{
  const { data: owners } = await admin.from("owners").select("email").ilike("email", "%@hivic-test.example").not("user_id", "is", null).limit(30);
  for (const o of owners ?? []) { const r = o.email ? await roles(o.email) : null; if (!r || !r.includes("owner") || r.includes("admin")) continue; try { sessions["owner"] = await sessionFor(o.email!); break; } catch { /* next */ } }
  if (!sessions["owner"]) add({ area: "office writes", route_or_action: "TEST sign-in", persona: "owner", status: "blocked", detail: "no non-admin TEST owner login", steps: "read-only preflight" });
}

// ---- deployed server function calls (same wire format as the app's own client) ----
const fnId = (file: string, name: string) => createHash("sha256").update(`${file}--${name}_createServerFn_handler`).digest("hex");
async function callFn(id: string, token: string, data: unknown, method: "GET" | "POST" = "POST") {
  const payload = JSON.stringify(await toJSONAsync({ data }));
  const headers: Record<string, string> = { "x-tsr-serverFn": "true", accept: "application/json", authorization: `Bearer ${token}`, origin: BASE };
  const ctl = AbortSignal.timeout(Math.max(5_000, Math.min(45_000, left())));
  const res = method === "GET"
    ? await fetch(`${BASE}/_serverFn/${id}?${new URLSearchParams({ payload })}`, { headers, signal: ctl })
    : await fetch(`${BASE}/_serverFn/${id}`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: payload, signal: ctl });
  const text = await res.text();
  let value: { result?: unknown; error?: unknown } | null = null;
  try { value = fromJSON(JSON.parse(text)) as typeof value; } catch { /* error payloads use custom tags */ }
  return { status: res.status, text: text.slice(0, 600), value };
}
const OFFICE_FN = "src/lib/office.functions.ts";
const ACTIONS = [
  { name: "deleteJob", id: fnId(OFFICE_FN, "deleteJob"), data: { jobId: job.id, reason: "QA denial probe" } },
  { name: "restoreJob", id: fnId(OFFICE_FN, "restoreJob"), data: { jobId: job.id, reason: "QA denial probe" } },
  { name: "setEligibility", id: fnId("src/lib/portal.functions.ts", "setEligibility"), data: { jobId: job.id, outcome: "does_not_appear_eligible", reason: "QA denial probe", nextAction: "none" } },
];
const dbSig = async () => JSON.stringify(await readJob("id", job.id));

type Parity = { ok: boolean; detail: string; listed: boolean };
/** Pipeline count for the job's status == drilldown total, and whether the job is in that drilldown and the all-live list. */
async function parity(token: string, statusKey: string | null): Promise<Parity & { key: string | null }> {
  const pipe = await callFn(fnId(OFFICE_FN, "getPipeline"), token, { includeTest: true }, "GET");
  const all = await callFn(fnId(OFFICE_FN, "listByStatus"), token, { includeTest: true }, "GET");
  const p = pipe.value?.result as { stages: { rows: { key: string; label: string; total: number }[] }[]; ended: { key: string; label: string; total: number }[]; waitingList: { key: string; label: string; total: number }[] } | undefined;
  const a = all.value?.result as { rows: { jobNumber: string; status: string }[]; total: number } | undefined;
  if (!p || !a) return { ok: false, listed: false, key: statusKey, detail: `office reads unreadable (pipeline HTTP ${pipe.status}, list HTTP ${all.status})` };
  const flat = [...p.stages.flatMap((s) => s.rows), ...p.ended, ...p.waitingList];
  const mine = a.rows.find((r) => r.jobNumber === JOB);
  const key = statusKey ?? flat.find((r) => r.label === mine?.status)?.key ?? null;
  if (!key) return { ok: false, listed: !!mine, key, detail: `${JOB} status not found in pipeline (listed=${!!mine})` };
  const drill = await callFn(fnId(OFFICE_FN, "listByStatus"), token, { includeTest: true, status: key }, "GET");
  const d = drill.value?.result as { rows: { jobNumber: string }[]; total: number } | undefined;
  const count = flat.find((r) => r.key === key)?.total ?? -1;
  const inDrill = !!d?.rows.some((r) => r.jobNumber === JOB);
  const sum = flat.reduce((s, r) => s + r.total, 0);
  return { ok: !!d && d.total === count && (!!mine === inDrill), listed: inDrill, key, detail: `status ${key}: pipeline count ${count}, drilldown total ${d?.total ?? "?"}, ${JOB} in drilldown=${inDrill}, in all-live list=${!!mine}; all-statuses sum ${sum} vs all-live total ${a.total}` };
}

let snapshotSaved = false;
async function finalRestore(why: string) {
  if (!snapshotSaved) return;
  snapshotSaved = false;
  try { add({ area: "office writes", route_or_action: "TEST snapshot restored", persona: "-", status: "passed", detail: await restoreSnapshot(job, why), steps: "restore snapshot (qa_test only) in finally" }); }
  catch (e) { add({ area: "office writes", route_or_action: "TEST snapshot restored", persona: "-", status: "failed", detail: `${(e as Error).message}; snapshot kept at ${SNAP_FILE} for next-run recovery`, steps: "finally" }); }
}
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { void finalRestore(`signal ${sig}`).finally(() => process.exit(1)); });
const deadlineTimer = setTimeout(() => { add({ area: "office writes", route_or_action: "deadline", persona: "-", status: "failed", detail: `internal budget ${BUDGET_MS / 1000}s exhausted`, steps: "" }); void finalRestore("deadline").finally(() => process.exit(1)); }, BUDGET_MS);

try {
  // Persistent snapshot BEFORE any possible mutation (denial probes included).
  writeFileSync(SNAP_FILE, JSON.stringify({ saved_at: startedAt, job }, null, 2)); snapshotSaved = true;

  if (INJECT) {
    const s = sessions["office"]; if (!s) throw new Error("no TEST office session");
    const r = await callFn(fnId(OFFICE_FN, "deleteJob"), s.access_token, { jobId: job.id, reason: "QA injected-failure check" });
    const del = await readJob("id", job.id);
    add({ area: "office writes", route_or_action: "injected failure: TEST job deleted first", persona: "office", status: del?.deleted_at ? "passed" : "failed", detail: `HTTP ${r.status}; deleted_at set=${!!del?.deleted_at}`, steps: "live deleteJob, then throw" });
    throw new Error("INJECTED_FAILURE after TEST deletion");
  }

  for (const persona of ["installer", "rec", "owner"]) {
    const s = sessions[persona]; if (!s) continue;
    for (const a of ACTIONS) {
      const before = await dbSig(); const r = await callFn(a.id, s.access_token, a.data); const after = await dbSig();
      const refused = r.status !== 404 && /Admin only/i.test(r.text);
      add({ area: "office writes (denied)", route_or_action: `${a.name} direct call`, persona, status: refused && before === after ? "passed" : "failed", detail: `HTTP ${r.status}; ${refused ? "refused: Admin only." : "NOT refused"}; DB ${before === after ? "unchanged" : "CHANGED"}`, steps: `POST ${BASE}/_serverFn/<${a.name}> as TEST ${persona}` });
    }
  }
  if (!sessions["rec"]) add({ area: "office writes (denied)", route_or_action: "REC direct calls", persona: "rec", status: "blocked", detail: "no TEST REC session", steps: "" });
  if (!sessions["office"]) throw new Error("no TEST office session");
  const tok = sessions["office"].access_token;

  // Parity: before -> deleted (via the deployed endpoint) -> restored
  const p0 = await parity(tok, null);
  add({ area: "office writes (parity)", route_or_action: "before delete: counted + listed", persona: "office", status: p0.ok && p0.listed ? "passed" : "failed", detail: p0.detail, steps: "getPipeline/listByStatus includeTest=true" });
  const d1 = await callFn(fnId(OFFICE_FN, "deleteJob"), tok, { jobId: job.id, reason: "QA parity check: delete" });
  const p1 = await parity(tok, p0.key);
  add({ area: "office writes (parity)", route_or_action: "while deleted: not counted, not listed", persona: "office", status: d1.status === 200 && p1.ok && !p1.listed ? "passed" : "failed", detail: p1.detail, steps: "deleteJob, then same reads" });
  const r1 = await callFn(fnId(OFFICE_FN, "restoreJob"), tok, { jobId: job.id, reason: "QA parity check: restore" });
  const p2 = await parity(tok, p0.key);
  add({ area: "office writes (parity)", route_or_action: "after restore: counted + listed again", persona: "office", status: r1.status === 200 && p2.ok && p2.listed ? "passed" : "failed", detail: p2.detail, steps: "restoreJob, then same reads" });

  // Browser journey (bounded by remaining budget)
  if (left() < 120_000) add({ area: "office writes", route_or_action: "browser journey", persona: "office", status: "not_run", detail: "budget too low for browser journey", steps: "" });
  else {
    const storageKey = `sb-${new URL(process.env["SUPABASE_URL"]!).hostname.split(".")[0]}-auth-token`;
    const manifest = `${OUT}/.manifest.json`;
    writeFileSync(manifest, JSON.stringify({ base: BASE, outDir: OUT, storageKey, session: sessions["office"], jobId: job.id, jobNumber: JOB }));
    rmSync(`${OUT}/.browser.json`, { force: true });
    const py = spawnSync("python3", ["e2e/office-writes.py", manifest], { encoding: "utf8", timeout: Math.max(60_000, left() - 30_000) });
    writeFileSync(manifest, "{}");
    writeFileSync(`${OUT}/browser.log`, `${py.stdout}\n${py.stderr}`);
    const br: { step: string; ok: boolean; detail: string; shots: string[] }[] = existsSync(`${OUT}/.browser.json`) ? JSON.parse(readFileSync(`${OUT}/.browser.json`, "utf8")) : [];
    if (!br.length) add({ area: "office writes", route_or_action: "browser journey", persona: "office", status: "failed", detail: `${py.error ? `timeout/error: ${py.error.message}` : `exit ${py.status}`}: ${(py.stderr || "no results").slice(-300)}`, steps: "python3 e2e/office-writes.py" });
    for (const b of br) add({ area: "office writes", route_or_action: b.step, persona: "office", status: b.ok ? "passed" : "failed", detail: b.detail, steps: `TEST office on ${BASE}`, screenshots: b.shots });
  }

  // DB readback
  const officeId = sessions["office"].user.id;
  const { data: ev } = await admin.from("workflow_events").select("event_type,actor_id,details,created_at").eq("job_id", job.id).gte("created_at", startedAt).order("created_at");
  const evs = (ev ?? []) as { event_type: string; actor_id: string | null; details: Record<string, unknown> | null }[];
  for (const t of ["job_deleted", "job_restored"]) { const m = evs.filter((e) => e.event_type === t); add({ area: "office writes (DB)", route_or_action: `${t} audit`, persona: "office", status: m.length >= 1 && m.every((e) => e.actor_id === officeId && String(e.details?.["reason"] ?? "").length >= 3) ? "passed" : "failed", detail: `${m.length} event(s), all office actor + reason`, steps: "read workflow_events" }); }
  const el = evs.filter((e) => e.event_type === "eligibility_override" || e.event_type === "eligibility_set");
  add({ area: "office writes (DB)", route_or_action: "classification audit", persona: "office", status: el.length >= 2 && el.every((e) => e.actor_id === officeId && !!e.details?.["reason"]) ? "passed" : "failed", detail: `${el.length} classification event(s): ${el.map((e) => e.event_type).join(", ")}`, steps: "read workflow_events" });
} catch (e) {
  add({ area: "office writes", route_or_action: "run error", persona: "-", status: INJECT && /INJECTED_FAILURE/.test((e as Error).message) ? "passed" : "failed", detail: (e as Error).message.slice(0, 300), steps: "caught; restoring in finally" });
} finally {
  clearTimeout(deadlineTimer);
  await finalRestore(INJECT ? "after injected failure" : "end of run");
  add({ area: "office writes (DB)", route_or_action: "owner answers unchanged", persona: "-", status: (await propHash()) === answersBefore ? "passed" : "failed", detail: "properties.enrichment hash before = after", steps: "sha256 compare" });
  const { data: prot } = await admin.from("jobs").select("job_number,deleted_at").in("job_number", [...FORBIDDEN]);
  add({ area: "office writes (DB)", route_or_action: "3 real deleted jobs untouched", persona: "-", status: (prot ?? []).length === 3 && (prot ?? []).every((p) => !!p.deleted_at) ? "passed" : "failed", detail: (prot ?? []).map((p) => `${p.job_number} deleted`).join(", "), steps: "read-only" });
}
process.exit(rows.every((r) => r.status === "passed") ? 0 : 1);
