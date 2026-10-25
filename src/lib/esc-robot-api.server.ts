// ESC Registry robot API – server operations (decision 385). Each one calls the SAME esc-registry-robot.server.ts
// helper the runner used directly, so every guard stays: switch (+ the robot's env flags), live refused until
// SELECTOR_MAP_VERIFIED, qa_test always dry-run, idempotency in the record helpers. Because the caller is now remote,
// the server also caps the mode it is asked for (never above what the switch + selector map allow) and refuses any
// "submitted" record or live attempt unless live is allowed here and the job is not a TEST job. Login secrets never
// come here: the robot only says whether it has them, and robotSettings' credentials are never returned.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError } from "./workflow.server";
import {
  noticeWork, recordRobotAttempt, recordRobotDryRun, recordRobotFailure, recordRobotNotificationSubmitted, recordRobotNotificationUpdated,
  recordRobotVeecSubmitted, robotSettings, robotSwitch, storeRobotScreenshot, veecWork,
} from "./esc-registry-robot.server";
import { ESC_ROBOT_ENV_FLAG, ESC_ROBOT_MODE_ENV, ESC_ROBOT_PASSWORD_ENV, ESC_ROBOT_USERNAME_ENV, robotMode, type RobotMode } from "./esc-registry-robot.core";
import { SELECTOR_MAP_VERIFIED } from "./esc-registry-selectors";
import { RobotApiRefused, type RobotApiOps } from "./esc-robot-api.core";

const RANK: Record<RobotMode, number> = { off: 0, dry_run: 1, live: 2 };

/** The most the server allows right now, whatever the robot's own flags say: off / dry_run / live. */
export async function serverModeCap(): Promise<RobotMode> {
  return robotMode({ switchOn: await robotSwitch(), envOn: true, modeEnv: "live", credentials: true, selectorsVerified: SELECTOR_MAP_VERIFIED }).mode;
}

const capped = async (asked: RobotMode): Promise<RobotMode> => { const cap = await serverModeCap(); return RANK[asked] <= RANK[cap] ? asked : cap; };

async function jobSource(jobId: string): Promise<string | null> {
  const { data, error } = await admin.from("jobs").select("source").eq("id", jobId).maybeSingle();
  if (error) throw new Error(`Job could not be read: ${error.message}`);
  return data?.source ?? null;
}

async function noticeJobId(notificationId: string): Promise<string | null> {
  const { data, error } = await admin.from("esc_notifications").select("job_id").eq("id", notificationId).maybeSingle();
  if (error) throw new Error(`Notification could not be read: ${error.message}`);
  return data?.job_id ?? null;
}

/** Live records only when the server says live AND the job is a real job. */
async function assertLive(jobId: string | null, what: string) {
  const cap = await serverModeCap();
  if (cap !== "live") throw new WorkflowError(`${what} refused: the portal is not in live mode for the Registry robot (switch off or selector map not verified).`);
  if (!jobId) throw new WorkflowError(`${what} refused: job not found.`);
  if ((await jobSource(jobId)) === "qa_test") throw new WorkflowError(`${what} refused: TEST jobs are always dry-run.`);
}

const refusals = <A, R>(fn: (a: A) => Promise<R>) => async (a: A): Promise<R> => {
  try { return await fn(a); } catch (e) { if (e instanceof WorkflowError) throw new RobotApiRefused(e.message); throw e; }
};

export const robotApiOps: RobotApiOps = {
  robotSettings: refusals(async (i) => {
    // The env flags are the ROBOT machine's (as when it imported the server module directly); the login stays there.
    const env = { [ESC_ROBOT_ENV_FLAG]: i.envOn ? "true" : "", [ESC_ROBOT_MODE_ENV]: i.modeEnv ?? "", ...(i.hasCredentials ? { [ESC_ROBOT_USERNAME_ENV]: "robot-local", [ESC_ROBOT_PASSWORD_ENV]: "robot-local" } : {}) } as NodeJS.ProcessEnv;
    const s = await robotSettings(env);
    return { mode: s.mode, reason: s.reason, switchOn: s.switchOn };
  }),
  noticeWork: refusals(async (i) => noticeWork(await capped(i.mode), i.now ? new Date(i.now) : new Date())),
  veecWork: refusals(async (i) => veecWork(await capped(i.mode))),
  recordRobotAttempt: refusals(async (i) => {
    if (i.mode === "live") await assertLive(i.jobId, "A live Registry attempt");
    return recordRobotAttempt(i);
  }),
  recordRobotDryRun: refusals(async (i) => recordRobotDryRun(i)),
  recordRobotFailure: refusals(async (i) => recordRobotFailure(i)),
  recordRobotNotificationSubmitted: refusals(async (i) => {
    await assertLive(await noticeJobId(i.notificationId), "Recording a robot-submitted notification");
    return recordRobotNotificationSubmitted(i);
  }),
  recordRobotNotificationUpdated: refusals(async (i) => {
    await assertLive(await noticeJobId(i.notificationId), "Recording a robot-updated notification");
    return recordRobotNotificationUpdated(i);
  }),
  recordRobotVeecSubmitted: refusals(async (i) => {
    await assertLive(i.jobId, "Recording robot-created VEECs");
    return recordRobotVeecSubmitted(i);
  }),
  storeRobotScreenshot: refusals(async (i) => storeRobotScreenshot(i)),
};
