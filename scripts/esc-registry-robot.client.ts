// ESC Registry robot – API client (decision 385, Jo 25 Oct 2026). Same function signatures as
// src/lib/esc-registry-robot.server.ts, but every call goes to the portal's robot API
// (POST {PORTAL_URL}/api/public/hooks/esc-robot, Authorization: Bearer ESC_ROBOT_TOKEN) instead of the database.
// Used by scripts/esc-registry-robot.ts whenever ESC_ROBOT_TOKEN is set, so the robot machine never holds the database
// key. This file must never import a Supabase client or the server module (type-only imports are erased).
// The Registry login (VEU_REGISTRY_USERNAME / VEU_REGISTRY_PASSWORD) stays on this machine: the portal is only told
// whether it is present, and the credentials returned by robotSettings come from the local environment.
import type { NoticeWork, RobotSettings, VeecWork } from "../src/lib/esc-registry-robot.server";
import { ESC_ROBOT_ENV_FLAG, ESC_ROBOT_MODE_ENV, ESC_ROBOT_PASSWORD_ENV, ESC_ROBOT_USERNAME_ENV, type RobotMode, type RobotTask } from "../src/lib/esc-registry-robot.core";
import { ESC_ROBOT_API_PATH, ESC_ROBOT_DEFAULT_PORTAL_URL, ESC_ROBOT_TOKEN_ENV, type RobotApiOp } from "../src/lib/esc-robot-api.core";

type Env = Record<string, string | undefined>;
type Fetch = (input: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<Response>;

/** Build a client bound to an environment (tests pass their own env + fetch). */
export function robotApiClient(env: Env = process.env, fetchFn: Fetch = (u, i) => fetch(u, i)) {
  const token = env[ESC_ROBOT_TOKEN_ENV] ?? "";
  if (!token) throw new Error(`${ESC_ROBOT_TOKEN_ENV} is not set`);
  const base = (env["PORTAL_URL"] || ESC_ROBOT_DEFAULT_PORTAL_URL).replace(/\/+$/, "");
  const endpoint = `${base}${ESC_ROBOT_API_PATH}`;

  async function call<T>(op: RobotApiOp, input: unknown): Promise<T> {
    const res = await fetchFn(endpoint, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ op, input }) });
    let body: { ok?: boolean; result?: T; error?: string } | null = null;
    try { body = (await res.json()) as typeof body; } catch { /* not JSON */ }
    if (!res.ok || !body?.ok) throw new Error(`Portal robot API ${op} failed (HTTP ${res.status}): ${body?.error ?? "no details"}`);
    return body.result as T;
  }

  return {
    async robotSettings(e: Env = env): Promise<RobotSettings> {
      const username = (e[ESC_ROBOT_USERNAME_ENV] ?? "").trim(), password = e[ESC_ROBOT_PASSWORD_ENV] ?? "";
      const credentials = username && password ? { username, password } : null;
      const s = await call<{ mode: RobotMode; reason: string; switchOn: boolean | null }>("robotSettings", { envOn: e[ESC_ROBOT_ENV_FLAG] === "true", modeEnv: e[ESC_ROBOT_MODE_ENV] ?? null, hasCredentials: !!credentials });
      return { mode: s.mode, reason: s.reason, switchOn: s.switchOn, credentials: s.mode === "off" ? null : credentials };
    },
    /** The portal always plans with its own clock (the robot cannot move the 24h–5 day window). */
    noticeWork: (mode: RobotMode) => call<NoticeWork[]>("noticeWork", { mode }),
    veecWork: (mode: RobotMode) => call<VeecWork[]>("veecWork", { mode }),
    recordRobotAttempt: (p: { jobId: string; task: RobotTask; notificationId: string | null; mode: RobotMode; plan: string }) => call<void>("recordRobotAttempt", p),
    recordRobotDryRun: (p: { jobId: string; task: RobotTask; notificationId: string | null; screenshotPath: string | null; filled: string[]; blank: string[]; unmapped: string[]; registryUrl: string | null }) => call<void>("recordRobotDryRun", p),
    recordRobotFailure: (p: { jobId: string; task: RobotTask; notificationId: string | null; mode: RobotMode; step: string; error: string; screenshotPath: string | null; registryUrl: string | null }) =>
      call<void>("recordRobotFailure", { ...p, step: p.step.slice(0, 200), error: p.error.slice(0, 4000) }),
    recordRobotNotificationSubmitted: (p: { notificationId: string; reference: string; sentAt: string; screenshotPath: string | null; registryUrl: string | null }) => call<void>("recordRobotNotificationSubmitted", p),
    recordRobotNotificationUpdated: (p: { notificationId: string; previousNotificationId: string; reference: string; updatedAt: string; screenshotPath: string | null; registryUrl: string | null }) => call<void>("recordRobotNotificationUpdated", p),
    recordRobotVeecSubmitted: (p: { jobId: string; reference: string; quantity: number; submittedDate: string; screenshotPath: string | null; registryUrl: string | null }) => call<void>("recordRobotVeecSubmitted", p),
    /** Like the direct helper, a screenshot that cannot be stored (too big, network) is logged and gives null, so the
     *  failure / dry-run record that follows is still written. */
    async storeRobotScreenshot(p: { jobId: string; jobNumber: string; task: RobotTask; ref: string | null; outcome: "dry_run" | "submitted" | "failed"; png: Uint8Array; reference?: string | null; at?: Date }): Promise<string | null> {
      const { png, at, ...rest } = p;
      try {
        return await call<string | null>("storeRobotScreenshot", { ...rest, pngBase64: Buffer.from(png).toString("base64"), ...(at ? { at: at.toISOString() } : {}) });
      } catch (e) {
        console.error("[esc-registry-robot] screenshot not stored:", (e as Error).message);
        return null;
      }
    },
  };
}

export type RobotApiClient = ReturnType<typeof robotApiClient>;
