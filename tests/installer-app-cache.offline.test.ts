// Installer app cache: the browser check (Playwright, Python, e2e/installer-app-cache/offline.py through
// scripts/installer-app-cache-check.ts). It needs a published build with the switch on, the Supabase keys and a
// browser, so here it is NOT_RUN (skipped with the reason) unless INSTALLER_APP_CACHE_BASE is set with the keys.
//   INSTALLER_APP_CACHE_BASE=https://portal.homeinsulationvictoria.com.au bun test tests/installer-app-cache.offline.test.ts
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const base = process.env["INSTALLER_APP_CACHE_BASE"];
const keys = !!process.env["SUPABASE_URL"] && !!process.env["SUPABASE_PUBLISHABLE_KEY"];
const python = spawnSync("python3", ["-c", "import playwright.async_api"], { encoding: "utf8" }).status === 0;
const reason = !base ? "NOT_RUN: INSTALLER_APP_CACHE_BASE is not set (needs a published build with SERVICE_WORKER_ENABLED on)" : !keys ? "NOT_RUN: SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY not set (runs in Lovable)" : !python ? "NOT_RUN: python3 playwright is not installed" : null;

describe("installer app cache: a second load with the network off still renders the shell", () => {
  (reason ? test.skip : test)(reason ?? "the shell is served by the service worker offline and the repeat visit downloads no static files", () => {
    const run = spawnSync("bun", ["scripts/installer-app-cache-check.ts", "--base", base!], { encoding: "utf8", timeout: 12 * 60_000 });
    expect(run.status).toBe(0);
    const date = new Date().toISOString().slice(0, 10);
    const resultPath = `/tmp/installer-app-cache/${date}/result.json`;
    expect(existsSync(resultPath)).toBe(true);
    const r = JSON.parse(readFileSync(resultPath, "utf8")) as { repeat: { assetsFromNetwork: string[] }; offline: { shellFromServiceWorker: boolean } };
    expect(r.offline.shellFromServiceWorker).toBe(true);
    expect(r.repeat.assetsFromNetwork).toEqual([]);
  }, 13 * 60_000);
});
