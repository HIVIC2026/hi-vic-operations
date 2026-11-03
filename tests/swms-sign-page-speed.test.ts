// Part 7 Task 3: the SWMS signing page must load fast on a weak phone signal (Jo 2 Nov 2026: "must load fast on a weak
// phone signal (tested in the build); full PDF only loads if tapped"). Playwright against a RUNNING portal (`bun run dev`)
// and a TEST job's own /sp/<token> link, given as SWMS_SPEED_URL. Without that (or without Chromium) the checks are
// reported NOT_RUN with the reason — never PASS.
import { describe, expect, test } from "bun:test";

const URL_UNDER_TEST = process.env["SWMS_SPEED_URL"];
const PLAYWRIGHT_CANDIDATES = [process.env["PLAYWRIGHT_MODULE"], "playwright", "/opt/npm-tools/node_modules/playwright"].filter((x): x is string => !!x);
/** 400 kbps down / up, 400 ms round trip — a weak 3G signal. */
const WEAK_SIGNAL = { offline: false, downloadThroughput: 400_000 / 8, uploadThroughput: 400_000 / 8, latency: 400 };
const TICK_WITHIN_MS = 4000;

async function chromium(): Promise<any | null> {
  for (const spec of PLAYWRIGHT_CANDIDATES) {
    try { const pw = await import(spec); const b = await pw.chromium.launch(); await b.close(); return pw.chromium; } catch { /* next */ }
  }
  return null;
}
/** Dev server function ids are base64url JSON naming the export; the built ids are hashes (then the URL alone can't name it). */
function serverFnName(url: string): string {
  const m = /\/_serverFn\/([^/?]+)/.exec(url);
  if (!m) return "";
  try { return String((JSON.parse(Buffer.from(m[1]!, "base64url").toString()) as { export?: string }).export ?? m[1]); } catch { return m[1]!; }
}

describe("SWMS signing page on a weak signal (needs SWMS_SPEED_URL = a TEST job's /sp/<token> on a running portal)", () => {
  test("tick box visible within 4 s at 400 kbps / 400 ms; one server call before interaction; no PDF until tapped", async () => {
    if (!URL_UNDER_TEST) { console.warn("NOT_RUN: SWMS_SPEED_URL is not set (no running portal with a TEST job's safety plan link in this container) — the weak-signal check did not run."); return; }
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(URL_UNDER_TEST) || !/\/sp\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(URL_UNDER_TEST)) throw new Error("SWMS_SPEED_URL must be a local portal /sp/<token> link (TEST job only).");
    const cr = await chromium();
    if (!cr) { console.warn("NOT_RUN: Playwright Chromium is not available — the weak-signal check did not run."); return; }
    const b = await cr.launch();
    try {
      const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", WEAK_SIGNAL);
      const requests: { url: string; type: string }[] = [];
      const responses: { url: string; contentType: string }[] = [];
      page.on("request", (r: any) => requests.push({ url: r.url(), type: r.resourceType() }));
      page.on("response", async (r: any) => { responses.push({ url: r.url(), contentType: String(r.headers()["content-type"] ?? "") }); });
      const t0 = Date.now();
      await page.goto(URL_UNDER_TEST, { waitUntil: "commit" });
      await page.locator("[data-swms-tick]").waitFor({ state: "visible", timeout: TICK_WITHIN_MS + 500 });
      const elapsed = Date.now() - t0;
      console.log(`SWMS sign page: tick box visible after ${elapsed} ms on a 400 kbps / 400 ms link`);
      expect(elapsed).toBeLessThanOrEqual(TICK_WITHIN_MS);
      // Exactly one server-function call before any interaction (the view), and nothing PDF-shaped.
      const fnCalls = requests.filter((r) => r.url.includes("/_serverFn/"));
      expect(fnCalls.map((r) => serverFnName(r.url))).toHaveLength(1);
      expect(fnCalls.some((r) => /getSwmsLinkPdf/.test(serverFnName(r.url)))).toBe(false);
      expect(requests.some((r) => /\.pdf(\?|$)/i.test(r.url))).toBe(false);
      expect(responses.some((r) => /application\/pdf/i.test(r.contentType))).toBe(false);
      // Tap "Read the full safety plan (PDF)": only now is the PDF asked for.
      const before = requests.length;
      await page.getByRole("button", { name: "Read the full safety plan (PDF)" }).tap();
      await page.waitForTimeout(3000);
      const after = requests.slice(before).filter((r) => r.url.includes("/_serverFn/"));
      expect(after.length).toBeGreaterThanOrEqual(1);
      // In dev the id names the export; in a build the hash can't be read back, so only the count is asserted there.
      if (after.some((r) => serverFnName(r.url).includes("_createServerFn_handler"))) expect(after.some((r) => /getSwmsLinkPdf/.test(serverFnName(r.url)))).toBe(true);
    } finally { await b.close(); }
  }, 60_000);
});
