// Runs every tests/*.test.ts(x) file in its own Bun process.
// Why: bun's mock.module() is process-wide and cannot be undone, so a file that stubs the
// database or a server module would otherwise leak that stub into every later file.
// Usage: bun scripts/test-isolated.ts [concurrency] [tests/file.test.ts ...]
import { readdirSync } from "node:fs";

const requestedFiles = process.argv.slice(3).map((f) => f.replace(/^\.\//, ""));
const allFiles = readdirSync("tests").filter((f) => /\.test\.tsx?$/.test(f)).sort().map((f) => `tests/${f}`);
if (requestedFiles.some((f) => !allFiles.includes(f))) throw new Error("Only existing tests/*.test.ts(x) files can be selected.");
const files = (requestedFiles.length ? requestedFiles : allFiles).map((f) => `./${f}`);
const concurrency = Number(process.argv[2] ?? 6);
const isolatedEnv = {
  ...process.env,
  SUPABASE_URL: "http://127.0.0.1:54321",
  VITE_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_PROJECT_ID: "local-test-isolated",
  VITE_SUPABASE_PROJECT_ID: "local-test-isolated",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_test_isolated",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_test_isolated",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_local_test_isolated",
  NODE_ENV: "test",
  VITEST: "1",
};
delete isolatedEnv.ALLOW_PROD_SUPABASE;
let pass = 0, fail = 0;
const failed: string[] = [];
const crashes: string[] = [];
let next = 0;

async function worker() {
  while (next < files.length) {
    const f = files[next++]!;
    let p, out = "";
    // Bun 1.3.3 occasionally segfaults inside the PGlite (WASM) engine under load. That is a
    // runtime crash, not a test result, so a crashed file is re-run (max 2 retries) and reported.
    for (let attempt = 0; attempt < 3; attempt++) {
      p = Bun.spawn(["bun", "test", "--timeout", "30000", f], { stdout: "pipe", stderr: "pipe", env: isolatedEnv });
      out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
      await p.exited;
      if (!/Bun has crashed/.test(out)) break;
      crashes.push(f);
    }
    const ps = Number(/^\s*(\d+) pass/m.exec(out)?.[1] ?? 0);
    const fl = Number(/^\s*(\d+) fail/m.exec(out)?.[1] ?? 0);
    pass += ps; fail += fl;
    if (fl || p!.exitCode !== 0) {
      failed.push(f);
      const lines = out.split("\n");
      lines.forEach((line, i) => { if (line.startsWith("(fail)")) console.log(`${f} ${line}`); if (/^error/.test(line)) console.log(lines.slice(i, i + 8).join("\n")); });
      if (process.env.TEST_VERBOSE) console.log(out.slice(-4000));
      if (!fl) console.log(`${f} exited ${p!.exitCode}\n${out.slice(-1500)}`);
    }
  }
}

const t0 = Date.now();
await Promise.all(Array.from({ length: concurrency }, worker));
console.log(`\n${files.length} files · ${pass} pass · ${fail} fail · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
if (crashes.length) console.log("Bun runtime crashes retried: " + crashes.join(", "));
if (failed.length) { console.log("Failed files:\n" + failed.join("\n")); process.exit(1); }
