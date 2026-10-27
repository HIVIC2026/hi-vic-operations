// Full-journey test — ONE command:  bun run journey   (add --keep to leave the TEST job for inspection)
// 1. Runs every step on fresh TEST data through the portal's own server steps (src/lib/journey.server.ts).
// 2. Opens each step's pages in a real browser (Playwright) at 390px and 1280px, signed in as the TEST person,
//    takes screenshots and checks what must / must not be on screen (e2e/journey/shoot.py).
// 3. Writes report.md / report.json + screenshots to /mnt/documents/journey/<time>/, stores the result
//    (office Today shows it), archives the TEST data, and prints OK TO PUBLISH or DON'T PUBLISH.
// TEST only: never touches real jobs; nothing is sent to anyone outside the allowlist.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { summarise, publishVerdict, type StepResult } from "../src/lib/journey-test.core";

// Screens proof must not invoke legacy setup or server-driven actions before its safety preflight.
if (process.argv.includes("--screens")) {
  await import("./journey-screens");
  process.exit(process.exitCode ?? 1);
}
const { runServerJourney, cleanupJourney, storeJourneyRun, personaSession, JOURNEY_ACTOR_EMAIL, TEST_INSTALLER_EMAIL, TEST_ELECTRICIAN_EMAIL, TEST_WORKER_EMAIL } = await import("../src/lib/journey.server");

const keep = process.argv.includes("--keep");
// Opt-in hard cases (Jo 27 Oct 2026): --branch not-eligible | --branch piesa-fixes. Without --branch nothing below changes.
const branchArg = process.argv.includes("--branch") ? process.argv[process.argv.indexOf("--branch") + 1] : null;
if (branchArg && /^m\d+-/.test(branchArg)) {
  // Phase 4 (Jo 27 Oct 17:50): the money and safety blocks, one per run, fresh TEST job, 390px screens.
  const { runPhase4, PHASE4 } = await import("../src/lib/journey-branches.server");
  if (!(branchArg in PHASE4)) { console.error(`--branch must be one of: ${Object.keys(PHASE4).join(", ")}`); process.exit(2); }
  const dir = `/mnt/documents/journey/${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${branchArg}`;
  mkdirSync(dir, { recursive: true });
  const res = await runPhase4(branchArg as never, `${dir}/screens`);
  const verdict = res.blocked ? "BLOCKED" : res.answers.length === 4 && res.answers.every((a) => a.answer !== "no") ? "PASS" : "FAIL";
  const md = [`# Phase 4 ${branchArg}: ${verdict}`, res.blocked ? `\nBlocked: ${res.blocked}` : "", "",
    ...res.jobs.map((j) => `TEST job ${j.jobNumber ?? "-"} (${j.jobId ?? "-"}) — ${j.archived ? "archived" : "NOT archived"}`), "",
    "## Four questions", ...res.answers.map((a) => `- **${a.q}: ${a.answer.toUpperCase()}** — ${a.detail}`), "",
    "## Screens (390px)", ...res.shots.map((s) => `- ${s.moment} · ${s.who} · ${s.path} → ${s.landed ?? "did not load"}${s.overflow ? " · SIDEWAYS SCROLL" : ""}${s.errors.length ? ` · errors: ${s.errors.join("; ")}` : ""} · screens/${s.name}\n  > ${s.text.slice(0, 300)}`), "",
    "## Checks", ...res.checks.map((c) => `- ${c.n} ${c.status.toUpperCase()} — ${c.name}: ${c.detail}`)].join("\n");
  writeFileSync(`${dir}/report.md`, md);
  writeFileSync(`${dir}/report.json`, JSON.stringify({ verdict, ...res }, null, 2));
  console.log(`${verdict} ${branchArg}${res.blocked ? ` — ${res.blocked}` : ""}`);
  for (const a of res.answers) console.log(`  ${a.q}: ${a.answer} — ${a.detail.slice(0, 400)}`);
  for (const c of res.checks) console.log(`  ${c.status} ${c.n} ${c.name} — ${c.detail.slice(0, 200)}`);
  console.log(`Report: ${dir}/report.md`);
  process.exit(0);
}
if (branchArg && branchArg.startsWith("p") && /^p[1-8]-/.test(branchArg)) {
  // Phase 3 (Jo 27 Oct 14:57): one path per run, fresh TEST job, 390px screens of the affected person and the office.
  const { runPhase3, PHASE3 } = await import("../src/lib/journey-branches.server");
  if (!(branchArg in PHASE3)) { console.error(`--branch must be one of: ${Object.keys(PHASE3).join(", ")}`); process.exit(2); }
  const dir = `/mnt/documents/journey/${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${branchArg}`;
  mkdirSync(dir, { recursive: true });
  const res = await runPhase3(branchArg as never, `${dir}/screens`);
  const verdict = res.blocked ? "BLOCKED" : res.answers.length === 4 && res.answers.every((a) => a.answer !== "no") ? "PASS" : "FAIL";
  const md = [`# Phase 3 ${branchArg}: ${verdict}`, res.blocked ? `\nBlocked: ${res.blocked}` : "", "",
    ...res.jobs.map((j) => `TEST job ${j.jobNumber ?? "-"} (${j.jobId ?? "-"}) — ${j.archived ? "archived" : "NOT archived"}`), "",
    "## Four questions", ...res.answers.map((a) => `- **${a.q}: ${a.answer.toUpperCase()}** — ${a.detail}`), "",
    "## Screens (390px)", ...res.shots.map((s) => `- ${s.moment} · ${s.who} · ${s.path} → ${s.landed ?? "did not load"}${s.overflow ? " · SIDEWAYS SCROLL" : ""}${s.errors.length ? ` · errors: ${s.errors.join("; ")}` : ""} · screens/${s.name}\n  > ${s.text.slice(0, 300)}`), "",
    "## Checks", ...res.checks.map((c) => `- ${c.n} ${c.status.toUpperCase()} — ${c.name}: ${c.detail}`)].join("\n");
  writeFileSync(`${dir}/report.md`, md);
  writeFileSync(`${dir}/report.json`, JSON.stringify({ verdict, ...res }, null, 2));
  console.log(`${verdict} ${branchArg}${res.blocked ? ` — ${res.blocked}` : ""}`);
  for (const a of res.answers) console.log(`  ${a.q}: ${a.answer} — ${a.detail.slice(0, 400)}`);
  for (const c of res.checks) console.log(`  ${c.status} ${c.n} ${c.name} — ${c.detail.slice(0, 200)}`);
  console.log(`Report: ${dir}/report.md`);
  process.exit(0);
}
if (branchArg) {
  if (branchArg !== "not-eligible" && branchArg !== "piesa-fixes") { console.error("--branch must be not-eligible or piesa-fixes"); process.exit(2); }
  const { runJourneyBranch } = await import("../src/lib/journey-branches.server");
  const res = await runJourneyBranch(branchArg);
  const dir = `/mnt/documents/journey/${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${branchArg}`;
  mkdirSync(dir, { recursive: true });
  const md = [`# Journey hard case: ${branchArg}`, "", ...res.jobs.map((j) => `TEST job ${j.jobNumber ?? "-"} (${j.jobId ?? "-"}) — ${j.archived ? "archived" : "NOT archived"}`), "",
    "## Setup (default steps, same code)", ...res.setup.map((s) => `- ${s.passed ? "ok" : "FAILED"} — ${s.label}${s.error ? `: ${s.error}` : ""}`), "",
    "## Checks", ...res.checks.map((c) => `- **${c.n} ${c.status.toUpperCase()}** — ${c.name}: ${c.detail}${Object.keys(c.ids).length ? ` · ids ${JSON.stringify(c.ids)}` : ""}`)].join("\n");
  writeFileSync(`${dir}/report.md`, md);
  writeFileSync(`${dir}/report.json`, JSON.stringify(res, null, 2));
  for (const c of res.checks) console.log(`${c.status.toUpperCase().padEnd(7)} ${c.n} ${c.name} — ${c.detail}`);
  console.log(`\nReport: ${dir}/report.md`);
  process.exit(res.checks.length && res.checks.every((c) => c.status === "passed" || c.status === "simulated") ? 0 : 1);
}
const noBrowser = process.argv.includes("--no-browser");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = `/mnt/documents/journey/${stamp}`;
mkdirSync(`${outDir}/screens`, { recursive: true });

const { ctx, result } = await runServerJourney({ cleanup: false });
let steps: StepResult[] = result.steps;

if (!noBrowser) {
  const personaEmail: Record<string, string | null> = { public: null, owner_token: null, office: JOURNEY_ACTOR_EMAIL, installer: TEST_INSTALLER_EMAIL, electrician: TEST_ELECTRICIAN_EMAIL, worker: TEST_WORKER_EMAIL };
  const needed = [...new Set(ctx.screens.map((s) => s.persona))];
  const sessions: Record<string, unknown> = {};
  for (const p of needed) { const e = personaEmail[p]; if (e) sessions[p] = await personaSession(e); }
  const manifest = `${outDir}/.manifest.json`;
  writeFileSync(manifest, JSON.stringify({ base: "http://localhost:8080", outDir, storageKey: `sb-${process.env["SUPABASE_PROJECT_ID"] ?? "wvuffpykgnqliikhodzl"}-auth-token`, screens: ctx.screens, sessions }));
  const py = spawnSync("python3", [new URL("../e2e/journey/shoot.py", import.meta.url).pathname, manifest], { encoding: "utf8", timeout: 540_000 });
  const resFile = `${outDir}/.browser.json`;
  const browser: { step: string; ok: boolean; detail: string; shots: string[] }[] = existsSync(resFile) ? JSON.parse(readFileSync(resFile, "utf8")) : [{ step: "s1_calculator", ok: false, detail: `browser run failed: ${(py.stderr || py.stdout || "").slice(-400)}`, shots: [] }];
  writeFileSync(manifest, "{}"); // sessions are short-lived secrets; don't leave them on disk
  steps = steps.map((s) => {
    const b = browser.filter((x) => x.step === s.key);
    if (!b.length) return s;
    const checks = [...s.checks, ...b.map((x) => ({ name: `browser: ${x.detail}`, ok: x.ok }))];
    const passed = s.passed && b.every((x) => x.ok);
    return { ...s, checks, passed, screenshots: b.flatMap((x) => x.shots), ...(s.passed && !passed ? { error: b.filter((x) => !x.ok).map((x) => x.detail).join("; ") } : {}) };
  });
}

const final = summarise(steps);
if (!keep) await cleanupJourney(ctx);
await storeJourneyRun(noBrowser ? "server" : "browser", ctx, final);

const verdict = publishVerdict(final);
const md = [`# Full-journey test — ${new Date().toLocaleString("en-AU", { timeZone: "Australia/Melbourne" })}`, "", `**${verdict}**`, "", `TEST job ${ctx.jobNumber ?? "-"} (${keep ? "kept" : "archived"})`, "",
  ...final.steps.flatMap((s) => [`## ${s.passed ? "PASS" : "FAIL"} — ${s.label}`, ...(s.error ? [`- Problem: ${s.error}`] : []), ...s.checks.map((c) => `- ${c.ok ? "ok" : "FAILED"} — ${c.name}${c.detail ? ` (${c.detail})` : ""}`), ...(s.simulated?.length ? [`- Simulated: ${s.simulated.join("; ")}`] : []), ...(s.screenshots ?? []).map((p) => `- Screenshot: ${p}`), ""])].join("\n");
writeFileSync(`${outDir}/report.md`, md);
writeFileSync(`${outDir}/report.json`, JSON.stringify({ verdict, jobNumber: ctx.jobNumber, ...final }, null, 2));
for (const s of final.steps) console.log(`${s.passed ? "PASS" : "FAIL"}  ${s.label}${s.passed ? "" : `  —  ${s.error ?? ""}`}`);
console.log(`\n${verdict}\nReport: ${outDir}/report.md`);
process.exit(final.passed ? 0 : 1);
