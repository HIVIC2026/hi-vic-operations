// Daily QA (Jo 10 Oct): REC + installer onboarding fields / Back / resume / save persistence and final signing,
//   bun scripts/qa-onboarding.ts [--budget 540]
// TEST only: every application starts from a single-use staff link with purpose qa_test (same path as the office
// "Test link"), so it is test_mode and can never be approved as a real partner. No existing record is changed, so
// there is nothing to restore; the run only creates fresh TEST drafts and, on signing, a TEST-sourced partner enquiry.
// No provider is on these paths (start/save/sign are database writes only); the browser can reach localhost only.
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { spawnSync, execSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";

const budget = Number(process.argv[process.argv.indexOf("--budget") + 1]) || 540;
const LOCK = "/tmp/portal-qa.lock";
if (existsSync(LOCK)) { const pid = Number(readFileSync(LOCK, "utf8")); try { process.kill(pid, 0); console.error(`BLOCKED: another QA run (pid ${pid})`); process.exit(1); } catch { /* stale */ } }
writeFileSync(LOCK, String(process.pid));
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = `/mnt/documents/portal-qa/${stamp}-onboarding`;
mkdirSync(`${outDir}/screens`, { recursive: true });
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const db = admin as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const started = new Date().toISOString();
const rev = execSync("git rev-parse HEAD").toString().trim();

try {
  const { data: actor } = await db.from("profiles").select("id").eq("email", "admin@hivic.test").single();
  if (!actor) throw new Error("BLOCKED: TEST office account admin@hivic.test missing");
  const plan = [
    { trade: "rec", width: 390, mode: "validate" }, { trade: "rec", width: 390, mode: "flow" }, { trade: "rec", width: 1280, mode: "flow", sign: true },
    { trade: "installer", width: 390, mode: "validate" }, { trade: "installer", width: 390, mode: "flow" }, { trade: "installer", width: 1280, mode: "flow", sign: true },
  ];
  const apps = [];
  for (const p of plan) {
    const link = randomBytes(32).toString("base64url"); const tag = `${p.trade}${p.width}${p.mode[0]}${stamp.slice(11, 19).replace(/-/g, "")}`.toLowerCase();
    const { data: a, error } = await db.from("onboarding_authorisations").insert({ token_hash: sha(link), trade: p.trade, purpose: "qa_test", allow_incomplete_sign: p.mode === "flow", max_uses: 1, expires_at: new Date(Date.now() + 1800e3).toISOString(), issued_by: actor.id, note: `daily QA onboarding ${stamp}` }).select("id").single();
    if (error) throw new Error(`could not issue TEST link: ${error.message}`);
    apps.push({ ...p, link, tag, authId: a.id, route: p.trade === "rec" ? "electrician-onboarding" : "installer-onboarding", key: p.trade === "rec" ? "hivic_rec_onboarding_token" : "hivic_installer_onboarding_token" });
  }
  const manifest = `${outDir}/.manifest.json`;
  writeFileSync(manifest, JSON.stringify({ base: "http://localhost:8080", outDir, budget: budget - 30, apps }));
  const py = spawnSync("python3", ["e2e/onboarding-qa.py", manifest], { encoding: "utf8", timeout: budget * 1000 });
  writeFileSync(manifest, "{}"); // links are single-use secrets
  const br = existsSync(`${outDir}/.browser.json`) ? JSON.parse(readFileSync(`${outDir}/.browser.json`, "utf8")) : { rows: [{ trade: "-", width: 0, action: "browser", status: "failed", detail: (py.stderr || "").slice(-400) }], tokens: {} };
  const tokens = br.tokens ?? {}; br.tokens = "(removed)"; writeFileSync(`${outDir}/.browser.json`, JSON.stringify(br));
  // Database readback of every application this run created (by its own authorisation).
  const readback = [];
  for (const a of apps) {
    const { data: rows } = await db.from("rec_onboarding_applications").select("id, partner_type, test_mode, status, step_key, data, signed_at, agreement_version, partner_enquiry_id, authorisation_id").eq("authorisation_id", a.authId);
    const r = rows?.[0];
    let enquiry = null;
    if (r?.partner_enquiry_id) enquiry = (await db.from("partner_enquiries").select("source, email").eq("id", r.partner_enquiry_id).maybeSingle()).data;
    const ok = !r ? false : r.test_mode === true && r.data?.primary_contact_name === `QA Onboarding ${a.tag}` && r.data?.business_email === `qa.onb.${a.tag}@hivic-test.example` && (a.trade !== "rec" || r.data?.licence_expiry === "2028-06-30");
    const tokenMatch = tokens[`${a.trade}-${a.width}`] ? true : null;
    readback.push({ trade: a.trade, width: a.width, mode: a.mode, found: !!r, test_mode: r?.test_mode ?? null, status: r?.status ?? null, step_key: r?.step_key ?? null, answers_persisted: ok, signed_at: r?.signed_at ?? null, agreement_version: r?.agreement_version ?? null, enquiry_source: enquiry?.source ?? null, enquiry_email_test_domain: enquiry ? /@hivic-test\.example$/.test(enquiry.email ?? "") : null, resume_token_seen: tokenMatch });
  }
  const res = { started, finished: new Date().toISOString(), environment: "local preview sandbox (localhost:8080) on the shared production backend", source_revision: rev, budget_s: budget, browser_rows: br.rows, external_requests_blocked: br.external_requests_blocked ?? [], readback };
  writeFileSync(`${outDir}/results.json`, JSON.stringify(res, null, 2));
  for (const r of br.rows) console.log(`${r.status.toUpperCase().padEnd(7)} ${r.trade}@${r.width} ${r.action} — ${r.detail}`);
  for (const r of readback) console.log("READBACK", JSON.stringify(r));
  console.log(`Results: ${outDir}/results.json`);
} finally {
  try { unlinkSync(LOCK); } catch { /* none */ }
}
