// ESC Registry robot API (decision 385, Jo 25 Oct 2026) – pure request handling for /api/public/hooks/esc-robot.
// The robot (scripts/esc-registry-robot.ts on a separate machine / Claude cloud session) talks to the portal through
// this narrow API protected by its OWN secret ESC_ROBOT_TOKEN, never the database key. Exactly the operations the
// runner uses from esc-registry-robot.server.ts are exposed; every input is checked here with zod and every existing
// guard stays on the server (esc-robot-api.server.ts). Registry login secrets never cross this API: the robot only
// says whether it HAS them. No database import here: the operations are injected so the tests can mock them.
import { z } from "zod";

export const ESC_ROBOT_TOKEN_ENV = "ESC_ROBOT_TOKEN";
export const ESC_ROBOT_API_PATH = "/api/public/hooks/esc-robot";
export const ESC_ROBOT_DEFAULT_PORTAL_URL = "https://estimate.homeinsulationvictoria.com.au";
/** Decoded PNG cap (a full-page Registry screenshot is well under this). */
export const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
const MAX_SCREENSHOT_BASE64 = Math.ceil(MAX_SCREENSHOT_BYTES / 3) * 4;
/** Whole request cap: the screenshot plus a little JSON around it. */
export const MAX_BODY_CHARS = MAX_SCREENSHOT_BASE64 + 64 * 1024;

const uuid = z.string().uuid();
const mode = z.enum(["off", "dry_run", "live"]);
const task = z.enum(["install_notification", "veec_creation"]);
const outcome = z.enum(["dry_run", "submitted", "failed"]);
const iso = z.string().datetime({ offset: true });
const text = (max: number) => z.string().max(max);
const url = text(2000).nullable();
/** Only paths storeRobotScreenshot makes: <job uuid>/esc-registry/<name>.png. */
const SHOT_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/esc-registry\/[A-Za-z0-9_-]{1,200}\.png$/;
const shotPath = text(300).regex(SHOT_PATH, "not a robot screenshot path").nullable();
const keys = z.array(text(100)).max(300);
const reference = text(100);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export const ROBOT_API_INPUTS = {
  robotSettings: z.object({ envOn: z.boolean(), modeEnv: text(20).nullable(), hasCredentials: z.boolean() }).strict(),
  noticeWork: z.object({ mode, now: iso.optional() }).strict(),
  veecWork: z.object({ mode }).strict(),
  recordRobotAttempt: z.object({ jobId: uuid, task, notificationId: uuid.nullable(), mode, plan: text(2000) }).strict(),
  recordRobotDryRun: z.object({ jobId: uuid, task, notificationId: uuid.nullable(), screenshotPath: shotPath, filled: keys, blank: keys, unmapped: keys, registryUrl: url }).strict(),
  recordRobotFailure: z.object({ jobId: uuid, task, notificationId: uuid.nullable(), mode, step: text(200), error: text(4000), screenshotPath: shotPath, registryUrl: url }).strict(),
  recordRobotNotificationSubmitted: z.object({ notificationId: uuid, reference, sentAt: iso, screenshotPath: shotPath, registryUrl: url }).strict(),
  recordRobotNotificationUpdated: z.object({ notificationId: uuid, previousNotificationId: uuid, reference, updatedAt: iso, screenshotPath: shotPath, registryUrl: url }).strict(),
  recordRobotVeecSubmitted: z.object({ jobId: uuid, reference, quantity: z.number().int().positive().max(100_000), submittedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), screenshotPath: shotPath, registryUrl: url }).strict(),
  storeRobotScreenshot: z.object({ jobId: uuid, jobNumber: text(40), task, ref: uuid.nullable(), outcome, pngBase64: z.string().min(12).max(MAX_SCREENSHOT_BASE64).regex(/^[A-Za-z0-9+/]+={0,2}$/, "not base64"), reference: reference.nullable().optional(), at: iso.optional() }).strict(),
} as const;

export type RobotApiOp = keyof typeof ROBOT_API_INPUTS;
export const ROBOT_API_OPS = Object.keys(ROBOT_API_INPUTS) as RobotApiOp[];
export type RobotApiInput<K extends RobotApiOp> = z.infer<(typeof ROBOT_API_INPUTS)[K]>;
type ScreenshotIn = Omit<RobotApiInput<"storeRobotScreenshot">, "pngBase64" | "at"> & { png: Uint8Array; at?: Date };

/** What the server side implements (esc-robot-api.server.ts). Results must be JSON-serialisable. */
export type RobotApiOps = {
  [K in Exclude<RobotApiOp, "storeRobotScreenshot">]: (input: RobotApiInput<K>) => Promise<unknown>;
} & { storeRobotScreenshot: (input: ScreenshotIn) => Promise<string | null> };

/** Constant-time token check (SHA-256 both sides, timingSafeEqual). Missing/empty expected token = always false. */
export async function robotTokenMatches(given: string | null | undefined, expected: string | null | undefined): Promise<boolean> {
  if (!expected || !given) return false;
  const { createHash, timingSafeEqual } = await import("node:crypto");
  const digest = (v: string) => createHash("sha256").update(v, "utf8").digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/** Bearer token from the Authorization header (never logged). */
export function bearer(request: Request): string | null {
  return /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? null;
}

/** base64 → PNG bytes; null unless it decodes, is within the cap and starts with the PNG signature. */
export function decodePng(b64: string): Uint8Array | null {
  let bin: string;
  try { bin = atob(b64); } catch { return null; }
  if (bin.length > MAX_SCREENSHOT_BYTES || bin.length < PNG_SIGNATURE.length) return null;
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b) ? bytes : null;
}

/** Thrown by the server operations when an existing guard refuses (WorkflowError there) → 409, not 500. Tagged by a
 *  property, not the class name, so a minified bundle cannot break the check. */
export class RobotApiRefused extends Error { readonly refused = true as const; }

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

/** The whole route: POST only → token → size → JSON → zod → operation. Errors are short messages, never the token. */
export async function handleRobotApi(request: Request, env: Record<string, string | undefined>, loadOps: () => Promise<RobotApiOps>): Promise<Response> {
  if (request.method !== "POST") return json(405, { ok: false, error: "Method not allowed" }, { allow: "POST" });
  const expected = env[ESC_ROBOT_TOKEN_ENV];
  if (!expected) console.error("[esc-robot-api] ESC_ROBOT_TOKEN is not configured; refusing every request");
  if (!(await robotTokenMatches(bearer(request), expected))) return json(401, { ok: false, error: "Unauthorized" });

  const len = Number(request.headers.get("content-length") ?? "0");
  if (len > MAX_BODY_CHARS) return json(413, { ok: false, error: "Request too large" });
  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return json(413, { ok: false, error: "Request too large" });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return json(400, { ok: false, error: "Body is not JSON" }); }
  const envelope = z.object({ op: z.enum(ROBOT_API_OPS as [RobotApiOp, ...RobotApiOp[]]), input: z.unknown() }).strict().safeParse(body);
  if (!envelope.success) return json(400, { ok: false, error: `Unknown or missing operation (one of ${ROBOT_API_OPS.join(", ")})` });
  const { op } = envelope.data;
  const parsed = ROBOT_API_INPUTS[op].safeParse(envelope.data.input);
  // Field paths and messages only – never the values (they can be long or private).
  if (!parsed.success) return json(400, { ok: false, error: `Invalid input for ${op}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}` });

  try {
    const ops = await loadOps();
    let result: unknown;
    if (op === "storeRobotScreenshot") {
      const { pngBase64, at, ...rest } = parsed.data as RobotApiInput<"storeRobotScreenshot">;
      const png = decodePng(pngBase64);
      if (!png) return json(400, { ok: false, error: `Invalid input for ${op}: pngBase64 is not a PNG within ${MAX_SCREENSHOT_BYTES} bytes` });
      result = await ops.storeRobotScreenshot({ ...rest, png, ...(at ? { at: new Date(at) } : {}) });
    } else {
      result = await (ops[op] as (i: unknown) => Promise<unknown>)(parsed.data);
    }
    return json(200, { ok: true, result: result ?? null });
  } catch (e) {
    const err = e as Error;
    // A guard refused (already sent, not ready, live refused…): 409 with its plain message.
    const refused = (e as { refused?: unknown })?.refused === true;
    if (!refused) console.error(`[esc-robot-api] ${op} failed:`, err?.message ?? String(e));
    return json(refused ? 409 : 500, { ok: false, error: String(err?.message ?? e) });
  }
}
