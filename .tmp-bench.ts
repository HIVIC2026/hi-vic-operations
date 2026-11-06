const orig = globalThis.fetch;
let log: { ms: number; url: string; t0: number }[] = [];
let base = 0;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const t0 = performance.now(); const r = await orig(input as RequestInfo, init);
  const url = String(typeof input === "string" ? input : (input as Request).url ?? input);
  log.push({ ms: performance.now() - t0, url: decodeURIComponent(url.replace(/^https:\/\/[^/]+/, "")).slice(0, 150), t0: t0 - base }); return r;
}) as typeof fetch;
async function time(name: string, f: () => Promise<unknown>) {
  log = []; base = performance.now(); const t = performance.now();
  try { await f(); } catch (e) { console.log(name, "ERR", (e as Error).message.slice(0, 120)); }
  const total = performance.now() - t;
  // critical path estimate: number of sequential "waves"
  const sorted = [...log].sort((a, b) => b.ms - a.ms);
  console.log(`\n## ${name}: ${total.toFixed(0)} ms, ${log.length} DB requests, sum ${log.reduce((s, x) => s + x.ms, 0).toFixed(0)} ms`);
  for (const x of sorted.slice(0, 6)) console.log(`  ${x.ms.toFixed(0)}ms @${x.t0.toFixed(0)} ${x.url}`);
}
const which = process.argv[2] ?? "all";
const L = await import("@/lib/office-lists.server");
if (which === "all" || which === "enq") await time("Enquiries list (default page)", () => L.loadEnquiriesList({ search: "", sort: "", dir: "asc", page: 1, filters: {} } as never));
if (which === "all" || which === "jobs") await time("Our jobs list", () => L.loadActiveJobsList({ lane: "ours", needsUs: false, search: "", sort: "", dir: "desc", page: 1, filters: {}, includeTest: false } as never));
if (which === "all" || which === "lanes") await time("Jobs lane counts", () => L.loadJobsLaneCounts());
if (which === "all" || which === "needs") await time("Needs me (live compute)", async () => (await import("@/lib/office-needs.server")).loadNeedsMePage(false));
if (which === "all" || which === "wait") await time("Choose installer list", async () => (await import("@/lib/installer-waiting.server")).loadInstallerWaitingList({ includeTest: false } as never));
if (which === "all" || which === "emails") await time("Emails tab badge", async () => (await import("@/lib/emails-tab.server")).loadEmailsTab());
process.exit(0);
