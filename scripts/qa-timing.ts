// Portal speed step 2 (spec 2026-11-05, rule 6 "Proof"): time-to-usable per screen at 390 px and 1280 px, with the number
// of browser→server calls each screen makes. TEST sessions only: reuses an existing session file written by
// `scripts/qa-session.ts` (never mints one, never signs in), and refuses any session whose email is not a reserved TEST
// address — the same rule as qa-session.ts. Read-only: it only opens pages; it never clicks an action.
//
//   bun scripts/qa-timing.ts --session /tmp/browser/gb/session-installer.json --routes /field,/field/money [--base URL]
//
// Writes /mnt/documents/portal-qa/timing-<stamp>.json. A route that does not settle within the limit is recorded as
// NOT_RUN with the reason, never as a time.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const TEST_EMAIL = /@(hivic-test\.example|hivic\.test)$/i;
const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const sessionFile = arg("session");
const routes = (arg("routes") ?? "/field").split(",").map((r) => r.trim()).filter(Boolean);
const base = (arg("base") ?? process.env["QA_BASE_URL"] ?? "http://localhost:8080").replace(/\/$/, "");
const QUIET_MS = 1500, LIMIT_MS = 60_000;
const VIEWPORTS = [{ width: 390, height: 844 }, { width: 1280, height: 900 }] as const;

if (!sessionFile) throw new Error("SAFETY STOP: --session <file from scripts/qa-session.ts> is required (this script never signs in)");
const session = JSON.parse(readFileSync(sessionFile, "utf8")) as { user?: { email?: string } };
const email = session.user?.email ?? "";
if (!TEST_EMAIL.test(email)) throw new Error("SAFETY STOP: TEST accounts only");
const supabaseUrl = process.env["SUPABASE_URL"];
if (!supabaseUrl) throw new Error("SUPABASE_URL is needed for the session storage key");
const storageKey = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;

const isServerFn = (u: string) => /_serverFn/.test(u);
const isData = (u: string) => isServerFn(u) || /\/rest\/v1|\/rpc\/|\/auth\/v1\/user/.test(u);

type Row = { route: string; viewport: string; status: "PASS" | "NOT_RUN"; usableMs?: number; serverCalls?: number; dataCalls?: number; reason?: string };
const results: Row[] = [];
const browser = await chromium.launch();
try {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: vp });
    await ctx.addInitScript(([k, v]) => window.localStorage.setItem(k as string, v as string), [storageKey, JSON.stringify(session)]);
    const page = await ctx.newPage();
    let inflight = 0, lastEnd = 0, server = 0, data = 0;
    page.on("request", (r) => { if (isData(r.url())) { inflight++; data++; if (isServerFn(r.url())) server++; } });
    const done = (r: { url: () => string }) => { if (isData(r.url())) { inflight--; lastEnd = Date.now(); } };
    page.on("requestfinished", done); page.on("requestfailed", done);
    for (const route of routes) {
      server = 0; data = 0; inflight = 0;
      const t = Date.now(); lastEnd = t;
      try {
        await page.goto(`${base}${route}`, { waitUntil: "domcontentloaded", timeout: LIMIT_MS });
        if (new URL(page.url()).pathname.startsWith("/auth")) throw new Error("session refused (landed on /auth)");
        let settled = false;
        while (Date.now() - t < LIMIT_MS) { await page.waitForTimeout(200); if (inflight <= 0 && Date.now() - lastEnd > QUIET_MS) { settled = true; break; } }
        if (!settled) throw new Error(`did not settle within ${LIMIT_MS} ms`);
        results.push({ route, viewport: `${vp.width}`, status: "PASS", usableMs: lastEnd - t, serverCalls: server, dataCalls: data });
      } catch (e) {
        results.push({ route, viewport: `${vp.width}`, status: "NOT_RUN", reason: (e as Error).message });
      }
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
const dir = "/mnt/documents/portal-qa";
mkdirSync(dir, { recursive: true });
const out = `${dir}/timing-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(out, JSON.stringify({ base, email, at: new Date().toISOString(), results }, null, 2));
for (const r of results) console.log(`${r.viewport.padStart(4)} ${r.route.padEnd(28)} ${r.status === "PASS" ? `${r.usableMs} ms · ${r.serverCalls} server calls · ${r.dataCalls} data calls` : `NOT_RUN (${r.reason})`}`);
console.log("wrote", out);
