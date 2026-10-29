// Decision 385: the robot API's server operations keep every existing guard. With the robot server module mocked:
// robotSettings never returns the Registry login, the asked mode is capped by the switch + selector map, "submitted"
// records and live attempts are refused unless the portal is live and the job is not a TEST job, and guard errors
// become 409 refusals.
import { beforeEach, describe, expect, mock, test } from "bun:test";

class WorkflowError extends Error {}
mock.module("../src/lib/workflow.server", () => ({ WorkflowError }));
mock.module("../src/lib/esc-registry-selectors", () => ({ SELECTORS_VERIFIED: { install_notification: true, veec_creation: false } }));

const JOB = "11111111-1111-4111-8111-111111111111";
const TEST_JOB = "44444444-4444-4444-8444-444444444444";
const NOTICE = "22222222-2222-4222-8222-222222222222";
const state = { switchOn: true as boolean | null, settingsEnv: null as NodeJS.ProcessEnv | null, calls: [] as { op: string; args: unknown[] }[], throwOn: null as string | null };
const rec = (op: string, ret: unknown = undefined) => async (...args: unknown[]) => {
  state.calls.push({ op, args });
  if (state.throwOn === op) throw new WorkflowError(`${op} refused by guard`);
  return ret;
};
mock.module("../src/lib/esc-registry-robot.server", () => ({
  robotSwitch: async () => state.switchOn,
  robotSettings: async (env: NodeJS.ProcessEnv) => {
    state.settingsEnv = env;
    const { robotMode } = await import("../src/lib/esc-registry-robot.core");
    const m = robotMode({ switchOn: state.switchOn, envOn: env["ESC_REGISTRY_ROBOT_ENABLED"] === "true", modeEnv: env["ESC_REGISTRY_ROBOT_MODE"], credentials: !!(env["VEU_REGISTRY_USERNAME"] && env["VEU_REGISTRY_PASSWORD"]) });
    return { ...m, switchOn: state.switchOn, credentials: m.mode === "off" ? null : { username: env["VEU_REGISTRY_USERNAME"], password: env["VEU_REGISTRY_PASSWORD"] } };
  },
  noticeWork: rec("noticeWork", []),
  veecWork: rec("veecWork", []),
  recordRobotAttempt: rec("recordRobotAttempt"),
  recordRobotDryRun: rec("recordRobotDryRun"),
  recordRobotFailure: rec("recordRobotFailure"),
  recordRobotNotificationSubmitted: rec("recordRobotNotificationSubmitted"),
  recordRobotNotificationUpdated: rec("recordRobotNotificationUpdated"),
  recordRobotVeecSubmitted: rec("recordRobotVeecSubmitted"),
  storeRobotScreenshot: rec("storeRobotScreenshot", "path.png"),
}));
const rows: Record<string, Record<string, { source?: string; job_id?: string }>> = {
  jobs: { [JOB]: { source: "website" }, [TEST_JOB]: { source: "qa_test" } },
  esc_notifications: { [NOTICE]: { job_id: JOB } },
};
mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => ({ select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: rows[table]?.[id] ?? null, error: null }) }) }) }),
  },
}));

const { robotApiOps, serverModeCap } = await import("../src/lib/esc-robot-api.server");
const { RobotApiRefused } = await import("../src/lib/esc-robot-api.core");

beforeEach(() => { state.switchOn = true; state.calls = []; state.throwOn = null; rows.esc_notifications![NOTICE] = { job_id: JOB }; });
const { melbourneToday } = await import("../src/lib/melbourne-time.core");
const submitted = { notificationId: NOTICE, reference: "ESC-123", sentAt: new Date().toISOString(), screenshotPath: null, registryUrl: null };
const veec = { jobId: JOB, reference: "VEEC-1", quantity: 3, submittedDate: melbourneToday(), screenshotPath: null, registryUrl: null };

describe("robotSettings", () => {
  test("uses the robot's flags, never returns credentials, fails closed while the switch is missing", async () => {
    const s = await robotApiOps.robotSettings({ envOn: true, modeEnv: "live", hasCredentials: true });
    expect(s).toEqual({ mode: "live", reason: expect.any(String), switchOn: true });
    expect(JSON.stringify(s)).not.toContain("robot-local");
    expect(state.settingsEnv!["ESC_REGISTRY_ROBOT_MODE"]).toBe("live");
    expect((await robotApiOps.robotSettings({ envOn: false, modeEnv: "live", hasCredentials: true })) as { mode: string }).toMatchObject({ mode: "off" });
    expect((await robotApiOps.robotSettings({ envOn: true, modeEnv: null, hasCredentials: false })) as { mode: string }).toMatchObject({ mode: "off" });
    state.switchOn = null;
    expect((await robotApiOps.robotSettings({ envOn: true, modeEnv: "live", hasCredentials: true })) as { mode: string }).toMatchObject({ mode: "off" });
  });
});

describe("mode cap", () => {
  test("switch off / missing → off; on → the asked mode", async () => {
    expect(await serverModeCap("install_notification")).toBe("live");
    expect(await serverModeCap("veec_creation")).toBe("dry_run");
    await robotApiOps.noticeWork({ mode: "live" });
    await robotApiOps.veecWork({ mode: "live" });
    state.switchOn = false;
    expect(await serverModeCap("install_notification")).toBe("off");
    expect(await serverModeCap("veec_creation")).toBe("off");
    await robotApiOps.noticeWork({ mode: "live" });
    await robotApiOps.veecWork({ mode: "dry_run" });
    state.switchOn = null;
    await robotApiOps.veecWork({ mode: "live" });
    expect(state.calls.map((c) => [c.op, c.args[0]])).toEqual([["noticeWork", "live"], ["veecWork", "dry_run"], ["noticeWork", "off"], ["veecWork", "off"], ["veecWork", "off"]]);
  });
});

describe("live records", () => {
  test("allowed when live and a real job", async () => {
    await robotApiOps.recordRobotNotificationSubmitted(submitted);
    await robotApiOps.recordRobotNotificationUpdated({ ...submitted, previousNotificationId: NOTICE, updatedAt: submitted.sentAt });
    await robotApiOps.recordRobotAttempt({ jobId: JOB, task: "install_notification", notificationId: NOTICE, mode: "live", plan: "submit" });
    expect(state.calls.map((c) => c.op)).toEqual(["recordRobotNotificationSubmitted", "recordRobotNotificationUpdated", "recordRobotAttempt"]);
    expect(state.calls[2]!.args[0]).toMatchObject({ mode: "live" });
  });

  test("VEEC creation is not verified yet: a submitted record is refused, a live attempt is recorded as a dry run", async () => {
    await expect(robotApiOps.recordRobotVeecSubmitted(veec)).rejects.toThrow("not in live mode");
    expect(state.calls).toEqual([]);
    await robotApiOps.recordRobotAttempt({ jobId: JOB, task: "veec_creation", notificationId: null, mode: "live", plan: "submit" });
    expect(state.calls.map((c) => c.op)).toEqual(["recordRobotAttempt"]);
    expect(state.calls[0]!.args[0]).toMatchObject({ task: "veec_creation", mode: "dry_run" });
  });

  test("refused when the switch is off, for TEST jobs, and for unknown notices — nothing recorded", async () => {
    state.switchOn = false;
    await expect(robotApiOps.recordRobotNotificationSubmitted(submitted)).rejects.toBeInstanceOf(RobotApiRefused);
    await expect(robotApiOps.recordRobotVeecSubmitted(veec)).rejects.toThrow("not in live mode");
    await expect(robotApiOps.recordRobotAttempt({ jobId: JOB, task: "veec_creation", notificationId: null, mode: "live", plan: "submit" })).rejects.toBeInstanceOf(RobotApiRefused);
    state.switchOn = true;
    await expect(robotApiOps.recordRobotAttempt({ jobId: TEST_JOB, task: "install_notification", notificationId: NOTICE, mode: "live", plan: "submit" })).rejects.toThrow("TEST jobs are always dry-run");
    rows.esc_notifications![NOTICE] = { job_id: TEST_JOB };
    await expect(robotApiOps.recordRobotNotificationSubmitted(submitted)).rejects.toThrow("TEST jobs");
    delete rows.esc_notifications![NOTICE];
    await expect(robotApiOps.recordRobotNotificationUpdated({ ...submitted, previousNotificationId: NOTICE, updatedAt: submitted.sentAt })).rejects.toThrow("job not found");
    expect(state.calls).toEqual([]);
    // Dry-run trail is always allowed (TEST jobs included).
    await robotApiOps.recordRobotAttempt({ jobId: TEST_JOB, task: "veec_creation", notificationId: null, mode: "dry_run", plan: "submit" });
    expect(state.calls.map((c) => c.op)).toEqual(["recordRobotAttempt"]);
  });

  test("times come from the portal's clock: a back-dated notice or VEEC date is refused", async () => {
    const old = new Date(Date.now() - 3 * 86_400_000);
    await expect(robotApiOps.recordRobotNotificationSubmitted({ ...submitted, sentAt: old.toISOString() })).rejects.toThrow("not now by the portal's clock");
    await expect(robotApiOps.recordRobotNotificationUpdated({ ...submitted, previousNotificationId: NOTICE, updatedAt: new Date(Date.now() + 3_600_000).toISOString() })).rejects.toBeInstanceOf(RobotApiRefused);
    await expect(robotApiOps.recordRobotVeecSubmitted({ ...veec, submittedDate: melbourneToday(old) })).rejects.toThrow("not today in Melbourne");
    expect(state.calls).toEqual([]);
    // noticeWork never takes a clock from the robot.
    await robotApiOps.noticeWork({ mode: "dry_run" });
    expect(Math.abs((state.calls[0]!.args[1] as Date).getTime() - Date.now())).toBeLessThan(5_000);
  });

  test("a guard WorkflowError from the record helper becomes a 409 refusal", async () => {
    state.throwOn = "recordRobotNotificationSubmitted";
    await expect(robotApiOps.recordRobotNotificationSubmitted(submitted)).rejects.toBeInstanceOf(RobotApiRefused);
  });
});

test("screenshot and trail records pass straight through", async () => {
  const png = new Uint8Array([1, 2, 3]);
  expect(await robotApiOps.storeRobotScreenshot({ jobId: JOB, jobNumber: "HV-1", task: "veec_creation", ref: null, outcome: "dry_run", png })).toBe("path.png");
  await robotApiOps.recordRobotDryRun({ jobId: JOB, task: "veec_creation", notificationId: null, screenshotPath: null, filled: [], blank: [], unmapped: [], registryUrl: null });
  await robotApiOps.recordRobotFailure({ jobId: JOB, task: "veec_creation", notificationId: null, mode: "dry_run", step: "login", error: "x", screenshotPath: null, registryUrl: null });
  expect(state.calls.map((c) => c.op)).toEqual(["storeRobotScreenshot", "recordRobotDryRun", "recordRobotFailure"]);
  expect((state.calls[0]!.args[0] as { png: Uint8Array }).png).toBe(png);
});
