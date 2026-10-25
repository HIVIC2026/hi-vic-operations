// Decision 385: the ESC Registry robot talks to the portal through /api/public/hooks/esc-robot with its own
// ESC_ROBOT_TOKEN, never the database key. Route handling (method, token, size, zod), every operation mapping
// end-to-end through the runner's client, and the pin that API mode never loads a Supabase client.
import { describe, expect, mock, spyOn, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

let supabaseLoaded = false;
mock.module("@/integrations/supabase/client.server", () => { supabaseLoaded = true; return { supabaseAdmin: {} }; });

const { handleRobotApi, robotTokenMatches, decodePng, RobotApiRefused, ROBOT_API_OPS, ESC_ROBOT_API_PATH, MAX_SCREENSHOT_BYTES } = await import("../src/lib/esc-robot-api.core");
const { robotApiClient } = await import("../scripts/esc-registry-robot.client");

const TOKEN = "robot-token-0123456789abcdef";
const ENV = { ESC_ROBOT_TOKEN: TOKEN };
const JOB = "11111111-1111-4111-8111-111111111111";
const NOTICE = "22222222-2222-4222-8222-222222222222";
const PREV = "33333333-3333-4333-8333-333333333333";
const SHOT = `${JOB}/esc-registry/install_notification-22222222-2026-10-25T00-00-00-000Z-dry_run.png`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6]);

type Call = { op: string; input: unknown };
function fakeOps(calls: Call[], results: Record<string, unknown> = {}) {
  const ops: Record<string, (i: unknown) => Promise<unknown>> = {};
  for (const op of ROBOT_API_OPS) ops[op] = async (input) => { calls.push({ op, input }); return results[op] ?? null; };
  return ops as never;
}
const req = (body: unknown, opts: { method?: string; token?: string | null } = {}) => new Request(`https://portal.test${ESC_ROBOT_API_PATH}`, {
  method: opts.method ?? "POST",
  headers: { "content-type": "application/json", ...(opts.token === null ? {} : { authorization: `Bearer ${opts.token ?? TOKEN}` }) },
  ...(opts.method && opts.method !== "POST" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
});

describe("route guard: method, token, size, JSON, zod", () => {
  test("wrong method → 405, nothing loaded", async () => {
    let loaded = 0;
    for (const m of ["GET", "PUT", "DELETE", "PATCH"]) {
      const r = await handleRobotApi(req(null, { method: m }), ENV, async () => { loaded++; return fakeOps([]); });
      expect(r.status).toBe(405);
      expect(r.headers.get("allow")).toBe("POST");
    }
    expect(loaded).toBe(0);
  });

  test("missing / wrong / unconfigured token → 401, token never logged, ops never loaded", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    let loaded = 0;
    const load = async () => { loaded++; return fakeOps([]); };
    const body = { op: "veecWork", input: { mode: "dry_run" } };
    expect((await handleRobotApi(req(body, { token: null }), ENV, load)).status).toBe(401);
    expect((await handleRobotApi(req(body, { token: "wrong" }), ENV, load)).status).toBe(401);
    expect((await handleRobotApi(req(body, { token: TOKEN + "x" }), ENV, load)).status).toBe(401);
    expect((await handleRobotApi(req(body), {}, load)).status).toBe(401);
    expect((await handleRobotApi(req(body), { ESC_ROBOT_TOKEN: "" }, load)).status).toBe(401);
    expect(loaded).toBe(0);
    const logged = errSpy.mock.calls.flat().map(String).join(" ");
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain("wrong");
    errSpy.mockRestore();
  });

  test("constant-time compare helper", async () => {
    expect(await robotTokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(await robotTokenMatches("a", TOKEN)).toBe(false);
    expect(await robotTokenMatches(TOKEN, undefined)).toBe(false);
    expect(await robotTokenMatches(null, TOKEN)).toBe(false);
  });

  test("bad JSON, unknown op, invalid inputs → 400 and the operation is never called", async () => {
    const calls: Call[] = [];
    const run = async (b: unknown) => handleRobotApi(req(b), ENV, async () => fakeOps(calls));
    expect((await run("not json")).status).toBe(400);
    expect((await run({ op: "dropTables", input: {} })).status).toBe(400);
    expect((await run({ op: "openRobotFailureRows", input: {} })).status).toBe(400); // not a runner operation
    expect((await run({ op: "veecWork", input: { mode: "turbo" } })).status).toBe(400);
    expect((await run({ op: "recordRobotAttempt", input: { jobId: "not-a-uuid", task: "install_notification", notificationId: null, mode: "dry_run", plan: "x" } })).status).toBe(400);
    expect((await run({ op: "recordRobotDryRun", input: { jobId: JOB, task: "veec_creation", notificationId: null, screenshotPath: "../../etc/passwd", filled: [], blank: [], unmapped: [], registryUrl: null } })).status).toBe(400);
    expect((await run({ op: "recordRobotVeecSubmitted", input: { jobId: JOB, reference: "VEEC-1", quantity: -1, submittedDate: "2026-10-25", screenshotPath: null, registryUrl: null } })).status).toBe(400);
    // Login secrets are not an accepted field anywhere (strict objects).
    const r = await run({ op: "robotSettings", input: { envOn: true, modeEnv: "live", hasCredentials: true, password: "secret" } });
    expect(r.status).toBe(400);
    expect(await r.text()).not.toContain("secret");
    // Screenshots: not a PNG / not base64 / too big.
    const shot = (pngBase64: string) => run({ op: "storeRobotScreenshot", input: { jobId: JOB, jobNumber: "HV-1", task: "veec_creation", ref: null, outcome: "dry_run", pngBase64 } });
    expect((await shot(Buffer.from("GIF89a-not-a-png").toString("base64"))).status).toBe(400);
    expect((await shot("***")).status).toBe(400);
    expect((await shot("A".repeat(Math.ceil(MAX_SCREENSHOT_BYTES / 3) * 4 + 4))).status).toBe(400);
    expect(calls).toEqual([]);
  });

  test("body over the cap → 413", async () => {
    const huge = JSON.stringify({ op: "veecWork", input: { mode: "dry_run", pad: "x".repeat(Math.ceil(MAX_SCREENSHOT_BYTES / 3) * 4 + 70 * 1024) } });
    expect((await handleRobotApi(req(huge), ENV, async () => fakeOps([]))).status).toBe(413);
  });

  test("decodePng only accepts the PNG signature within the cap", () => {
    expect(decodePng(Buffer.from(PNG).toString("base64"))).toEqual(PNG);
    expect(decodePng(Buffer.from("hello world").toString("base64"))).toBeNull();
  });

  test("guard refusal → 409 with its message; unexpected error → 500", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const body = { op: "recordRobotNotificationSubmitted", input: { notificationId: NOTICE, reference: "ESC-123", sentAt: "2026-10-25T01:00:00.000Z", screenshotPath: null, registryUrl: null } };
    const refuse = { ...fakeOps([]), recordRobotNotificationSubmitted: async () => { throw new RobotApiRefused("Notification is already recorded as sent (ref ESC-1)."); } };
    const r1 = await handleRobotApi(req(body), ENV, async () => refuse as never);
    expect(r1.status).toBe(409);
    expect(await r1.json()).toEqual({ ok: false, error: "Notification is already recorded as sent (ref ESC-1)." });
    const boom = { ...fakeOps([]), recordRobotNotificationSubmitted: async () => { throw new Error("db down"); } };
    expect((await handleRobotApi(req(body), ENV, async () => boom as never)).status).toBe(500);
    errSpy.mockRestore();
  });
});

describe("runner client → route → operations: every operation maps through", () => {
  const calls: Call[] = [];
  const results = { robotSettings: { mode: "dry_run", reason: "fill only", switchOn: true }, noticeWork: [{ jobNumber: "HV-1" }], veecWork: [{ jobNumber: "HV-2" }], storeRobotScreenshot: SHOT };
  const sent: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fetchFn = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    sent.push({ url, headers: init.headers, body: init.body });
    return handleRobotApi(new Request(url, init), ENV, async () => fakeOps(calls, results));
  };
  const localEnv = { ESC_ROBOT_TOKEN: TOKEN, ESC_REGISTRY_ROBOT_ENABLED: "true", ESC_REGISTRY_ROBOT_MODE: "live", VEU_REGISTRY_USERNAME: "ap@example.com", VEU_REGISTRY_PASSWORD: "local-only-password" };
  const client = robotApiClient(localEnv, fetchFn);

  test("default portal URL, bearer token, JSON envelope", async () => {
    await client.veecWork("dry_run");
    expect(sent.at(-1)!.url).toBe(`https://estimate.homeinsulationvictoria.com.au${ESC_ROBOT_API_PATH}`);
    expect(sent.at(-1)!.headers["authorization"]).toBe(`Bearer ${TOKEN}`);
    expect(robotApiClient({ ...localEnv, PORTAL_URL: "https://portal.example/" }, fetchFn)).toBeTruthy();
    expect(() => robotApiClient({}, fetchFn)).toThrow("ESC_ROBOT_TOKEN");
  });

  test("robotSettings sends only flags; the login stays local and comes back from the local env", async () => {
    const s = await client.robotSettings();
    const last = sent.at(-1)!.body;
    expect(last).not.toContain("local-only-password");
    expect(last).not.toContain("ap@example.com");
    expect(JSON.parse(last)).toEqual({ op: "robotSettings", input: { envOn: true, modeEnv: "live", hasCredentials: true } });
    expect(s).toEqual({ mode: "dry_run", reason: "fill only", switchOn: true, credentials: { username: "ap@example.com", password: "local-only-password" } });
  });

  test("each runner operation reaches the same-named server operation with its input", async () => {
    calls.length = 0;
    const now = new Date("2026-10-25T00:00:00.000Z");
    expect(await client.noticeWork("dry_run")).toEqual([{ jobNumber: "HV-1" }] as never);
    expect(await client.veecWork("live")).toEqual([{ jobNumber: "HV-2" }] as never);
    await client.recordRobotAttempt({ jobId: JOB, task: "install_notification", notificationId: NOTICE, mode: "dry_run", plan: "submit: due" });
    await client.recordRobotDryRun({ jobId: JOB, task: "install_notification", notificationId: NOTICE, screenshotPath: SHOT, filled: ["a"], blank: [], unmapped: ["b"], registryUrl: "https://veu.esc.vic.gov.au/x" });
    await client.recordRobotFailure({ jobId: JOB, task: "veec_creation", notificationId: null, mode: "dry_run", step: "login", error: "x".repeat(5000), screenshotPath: null, registryUrl: null });
    await client.recordRobotNotificationSubmitted({ notificationId: NOTICE, reference: "ESC-123", sentAt: now.toISOString(), screenshotPath: SHOT, registryUrl: null });
    await client.recordRobotNotificationUpdated({ notificationId: NOTICE, previousNotificationId: PREV, reference: "ESC-123", updatedAt: now.toISOString(), screenshotPath: null, registryUrl: null });
    await client.recordRobotVeecSubmitted({ jobId: JOB, reference: "VEEC-9", quantity: 12, submittedDate: "2026-10-25", screenshotPath: null, registryUrl: null });
    expect(await client.storeRobotScreenshot({ jobId: JOB, jobNumber: "HV-1", task: "install_notification", ref: NOTICE, outcome: "dry_run", png: PNG, at: now })).toBe(SHOT);
    expect(calls.map((c) => c.op)).toEqual(["noticeWork", "veecWork", "recordRobotAttempt", "recordRobotDryRun", "recordRobotFailure", "recordRobotNotificationSubmitted", "recordRobotNotificationUpdated", "recordRobotVeecSubmitted", "storeRobotScreenshot"]);
    expect(calls[0]!.input).toEqual({ mode: "dry_run" });
    expect((calls[4]!.input as { error: string }).error.length).toBe(4000);
    expect(calls[7]!.input).toEqual({ jobId: JOB, reference: "VEEC-9", quantity: 12, submittedDate: "2026-10-25", screenshotPath: null, registryUrl: null });
    const shotIn = calls[8]!.input as { png: Uint8Array; at: Date; jobNumber: string };
    expect(Array.from(shotIn.png)).toEqual(Array.from(PNG));
    expect(shotIn.at.toISOString()).toBe(now.toISOString());
    expect(new Set([...calls.map((c) => c.op), "robotSettings"])).toEqual(new Set(ROBOT_API_OPS));
  });

  test("a refused record throws in the runner (so its catch records the failure); a failed screenshot gives null", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const refusing = robotApiClient(localEnv, async (url, init) => handleRobotApi(new Request(url, init), ENV, async () => ({ ...fakeOps([]), recordRobotVeecSubmitted: async () => { throw new RobotApiRefused("VEEC is already submitted."); }, storeRobotScreenshot: async () => { throw new Error("storage down"); } }) as never));
    await expect(refusing.recordRobotVeecSubmitted({ jobId: JOB, reference: "VEEC-9", quantity: 1, submittedDate: "2026-10-25", screenshotPath: null, registryUrl: null })).rejects.toThrow("HTTP 409): VEEC is already submitted.");
    expect(await refusing.storeRobotScreenshot({ jobId: JOB, jobNumber: "HV-1", task: "veec_creation", ref: null, outcome: "failed", png: PNG })).toBeNull();
    const wrongToken = robotApiClient({ ESC_ROBOT_TOKEN: "nope" }, fetchFn);
    await expect(wrongToken.veecWork("dry_run")).rejects.toThrow("HTTP 401");
    errSpy.mockRestore();
  });

  test("API mode never loaded a Supabase client", () => {
    expect(supabaseLoaded).toBe(false);
  });
});

// ---- Source pins ---------------------------------------------------------------------------------------------
/** Every module statically reachable from `entry` through VALUE imports (type-only imports are erased). */
function valueImportClosure(entry: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)) {
      const spec = m[1]!;
      out.push(spec);
      const base = spec.startsWith("@/") ? resolve("src", spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(file), spec) : null;
      if (!base) continue;
      const f = [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((p) => existsSync(p));
      if (f) walk(f);
    }
  };
  walk(resolve(entry));
  return out;
}

describe("source pins", () => {
  test("the client's static import closure has no Supabase client and no server module", () => {
    const specs = valueImportClosure("scripts/esc-registry-robot.client.ts");
    expect(specs.length).toBeGreaterThan(0);
    for (const s of specs) {
      expect(s).not.toMatch(/supabase|\.server$|workflow\.server/);
    }
  });

  test("the runner loads the server module only when ESC_ROBOT_TOKEN is not set", () => {
    const src = readFileSync("scripts/esc-registry-robot.ts", "utf8");
    expect(src).not.toMatch(/^import [^;]*esc-registry-robot\.server/m);
    expect(src).not.toMatch(/^import [^;]*supabase/m);
    expect(src).toMatch(/const apiMode = !!process\.env\["ESC_ROBOT_TOKEN"\];/);
    expect(src).toMatch(/apiMode\s*\? \(await import\("\.\/esc-registry-robot\.client"\)\)\.robotApiClient\(\)\s*: await import\("\.\.\/src\/lib\/esc-registry-robot\.server"\)/);
    // Static imports of the runner itself: no Supabase / server modules.
    for (const s of valueImportClosure("scripts/esc-registry-robot.ts")) expect(s).not.toMatch(/supabase|\.server$/);
  });

  test("route: POST JSON through handleRobotApi with the server operations; no token logging", () => {
    const src = readFileSync("src/routes/api/public/hooks/esc-robot.ts", "utf8");
    expect(src).toContain('createFileRoute("/api/public/hooks/esc-robot")');
    expect(src).toContain("handleRobotApi(request, process.env");
    expect(src).toContain('import("@/lib/esc-robot-api.server")');
    expect(src).not.toMatch(/console\./);
    expect(readFileSync("src/routeTree.gen.ts", "utf8")).toContain("'/api/public/hooks/esc-robot'");
  });
});
