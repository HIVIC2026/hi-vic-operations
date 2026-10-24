// ESC Registry robot (decision 272, Jo 25 Oct 2026): pure decision rules, selector map safety and the browser steps
// against a fake page. No database, no network, no real browser.
import { describe, expect, test } from "bun:test";
import {
  ESC_ROBOT_SWITCH_COLUMN, ROBOT_DOC_KINDS, ROBOT_EVENTS, ROBOT_SUBMISSION_METHOD, failureDetails, failureLine, jobMode, openRobotFailures, planNotification, planVeecCreation,
  referenceLooksValid, robotHistory, robotMode, runSummary, screenshotPath, screenshotTitle, windowState, type NoticeCandidate, type RobotEvent, type VeecCandidate,
} from "../src/lib/esc-registry-robot.core";
import { INSTALL_NOTIFICATION, LOGIN, SELECTOR_MAP_VERIFIED, VEEC_CREATION, extractReference, formatForRegistry, selectorGaps, unmappedNotificationKeys } from "../src/lib/esc-registry-selectors";
import { RobotStepError, fillInstallNotification, login, submitAndReadReference, type RobotPage } from "../src/lib/esc-registry-robot.browser";
import { DEFAULT_REGISTRY_FIELDS, REGISTRY_FIELDS_VERSION, REGISTRY_UPDATABLE_KEYS } from "../src/lib/esc.core";
import { categoriseDocument } from "../src/lib/jobfile.core";
import { OFFICE_SWITCH_COLUMNS, PENDING_SWITCH_COLUMNS, SWITCHES, switchState } from "../src/lib/office-settings.core";
import { buildNeedsRows, needsCandidates } from "../src/lib/office-needs.core";

const H = 3600_000, D = 24 * H;
const START = "2026-11-04T22:00:00Z"; // Thu 5 Nov 9:00am Melbourne
const at = (msBefore: number) => new Date(Date.parse(START) - msBefore);
const ALL_ON = { switchOn: true, envOn: true, modeEnv: "live", credentials: true, selectorsVerified: true };

describe("mode: five locks, all fail closed", () => {
  test("deployment flag off → off, whatever else is set", () => expect(robotMode({ ...ALL_ON, envOn: false }).mode).toBe("off"));
  test("switch column missing (pending migration) → off", () => expect(robotMode({ ...ALL_ON, switchOn: null })).toMatchObject({ mode: "off", reason: expect.stringContaining(ESC_ROBOT_SWITCH_COLUMN) }));
  test("switch off → off", () => expect(robotMode({ ...ALL_ON, switchOn: false }).mode).toBe("off"));
  test("no login → off (never a dry run that would fail at login)", () => expect(robotMode({ ...ALL_ON, credentials: false }).mode).toBe("off"));
  test("mode env not exactly 'live' → dry run", () => {
    for (const m of [undefined, null, "", "LIVE", "true", "dry_run"]) expect(robotMode({ ...ALL_ON, modeEnv: m }).mode).toBe("dry_run");
  });
  test("unverified selector map → dry run even when set live", () => expect(robotMode({ ...ALL_ON, selectorsVerified: false })).toMatchObject({ mode: "dry_run", reason: expect.stringContaining("SELECTOR_MAP_VERIFIED") }));
  test("everything in place → live", () => expect(robotMode(ALL_ON).mode).toBe("live"));
  test("the shipped selector map is unverified, so live is impossible until the first supervised run", () => {
    expect(SELECTOR_MAP_VERIFIED).toBe(false);
    expect(selectorGaps().length).toBeGreaterThan(0);
  });
  test("TEST (qa_test) jobs never go live", () => {
    expect(jobMode("live", "qa_test")).toBe("dry_run");
    expect(jobMode("live", "website")).toBe("live");
    expect(jobMode("dry_run", "website")).toBe("dry_run");
    expect(jobMode("off", "website")).toBe("off");
  });
});

const notice = (o: Partial<NoticeCandidate> = {}): NoticeCandidate => ({
  jobId: "job-1", jobSource: "website", notificationId: "n-1", version: 1, status: "ready", scheduledStart: START, sentAt: null, submissionReference: null, consentId: "c-1",
  missing: [], payloadJson: { fields_version: REGISTRY_FIELDS_VERSION, additional: { installation_start: "x" } }, previousSent: null, robotEvents: [], ...o,
});
const ev = (event_type: string, details: Record<string, unknown>, created_at = "2026-11-01T00:00:00Z"): RobotEvent => ({ event_type, created_at, details });

describe("install notification: which notices are due", () => {
  test("window: early before 5 days, open between, closed inside 24h", () => {
    expect(windowState(START, at(5 * D + H))).toBe("early");
    expect(windowState(START, at(5 * D - H))).toBe("open");
    expect(windowState(START, at(25 * H))).toBe("open");
    expect(windowState(START, at(23 * H))).toBe("closed");
  });
  test("ready + consent + inside the window → submit", () => expect(planNotification(notice(), at(3 * D)).action).toBe("submit"));
  test("too early → skip (not office), window closed → skip for the office", () => {
    expect(planNotification(notice(), at(6 * D))).toMatchObject({ action: "skip", reason: expect.stringContaining("window opens") });
    const closed = planNotification(notice(), at(20 * H));
    expect(closed).toMatchObject({ action: "skip", office: true });
  });
  test("already sent → skip, never twice", () => {
    expect(planNotification(notice({ sentAt: "2026-11-01T00:00:00Z", submissionReference: "VEU-1" }), at(3 * D))).toMatchObject({ action: "skip", reason: expect.stringContaining("already recorded") });
  });
  test("not ready / no consent / missing Table 5 values → skip (nothing blank is ever typed into the Registry)", () => {
    expect(planNotification(notice({ status: "configuration_required", missing: ["Owner last name"] }), at(3 * D)).reason).toContain("Owner last name");
    expect(planNotification(notice({ consentId: null }), at(3 * D)).reason).toContain("consent");
    expect(planNotification(notice({ missing: ["EEC Certification number"] }), at(3 * D)).action).toBe("skip");
  });
  test("an earlier robot failure on the same notice → office owns it; a new notice version starts clean", () => {
    const failed = ev(ROBOT_EVENTS.failed, { task: "install_notification", notification_id: "n-1", needs_office: true });
    expect(planNotification(notice({ robotEvents: [failed] }), at(3 * D))).toMatchObject({ action: "skip", office: true });
    expect(planNotification(notice({ notificationId: "n-2", robotEvents: [failed] }), at(3 * D)).action).toBe("submit");
  });
  test("a live attempt with no outcome (crash mid-submit) is never retried; a dry-run attempt is", () => {
    const liveAttempt = ev(ROBOT_EVENTS.attempt, { task: "install_notification", notification_id: "n-1", mode: "live" });
    expect(planNotification(notice({ robotEvents: [liveAttempt] }), at(3 * D))).toMatchObject({ action: "skip", office: true, reason: expect.stringContaining("did not finish") });
    const dryAttempt = ev(ROBOT_EVENTS.attempt, { task: "install_notification", notification_id: "n-1", mode: "dry_run" });
    const dryDone = ev(ROBOT_EVENTS.dryRun, { task: "install_notification", notification_id: "n-1" }, "2026-11-01T00:01:00Z");
    expect(planNotification(notice({ robotEvents: [dryAttempt, dryDone] }), at(3 * D)).action).toBe("submit");
    expect(planNotification(notice({ robotEvents: [dryAttempt] }), at(3 * D)).action).toBe("submit");
    expect(robotHistory([dryAttempt, dryDone], "install_notification", "n-1").dryRuns).toBe(1);
  });
  test("install moved after a sent notice: updatable change inside the window → update on the same ID; otherwise the office withdraws first", () => {
    const prevPayload = { fields_version: REGISTRY_FIELDS_VERSION, additional: { installation_start: "Wed 4 Nov 2026 9:00 am", premises_address: "1 Test St" } };
    const newStart = new Date(Date.parse(START) + D).toISOString();
    const prev = { id: "n-0", scheduled_start: START, sent_at: "2026-11-01T00:00:00Z", submission_reference: "VEU-77", payload_json: prevPayload };
    const moved = notice({ notificationId: "n-1", scheduledStart: newStart, previousSent: prev, payloadJson: { fields_version: REGISTRY_FIELDS_VERSION, additional: { ...prevPayload.additional, installation_start: "Thu 5 Nov 2026 9:00 am" } } });
    const upd = planNotification(moved, at(3 * D));
    expect(upd).toMatchObject({ action: "update_same_id", reference: "VEU-77" });
    if (upd.action === "update_same_id") expect(upd.change.changed).toEqual(["installation_start"]);
    const addressChanged = notice({ scheduledStart: newStart, previousSent: prev, payloadJson: { fields_version: REGISTRY_FIELDS_VERSION, additional: { ...prevPayload.additional, premises_address: "2 Other St" } } });
    expect(planNotification(addressChanged, at(3 * D))).toMatchObject({ action: "skip", office: true, reason: expect.stringContaining("withdrawn") });
  });
  test("updatable keys are exactly esc.core's Table 5 column 3", () => expect(REGISTRY_UPDATABLE_KEYS).toEqual(["installation_start", "installation_end", "lead_installer", "lead_installer_phone", "lead_installer_cii_number", "installer_company", "installer_abn_acn"]));
});

const veec = (o: Partial<VeecCandidate> = {}): VeecCandidate => ({
  jobId: "job-1", jobSource: "website", stage: "ready_for_veec", lodgement: { status: "not_submitted", submission_reference: null },
  assignment: { status: "effective_complete", installerSignedAt: "a", apSignedAt: "b", consumerSignedAt: "c" }, quantity: 12, robotEvents: [], ...o,
});

describe("VEEC creation: only after every office gate", () => {
  test("Ready for VEEC + fully signed assignment + quantity → submit", () => expect(planVeecCreation(veec()).action).toBe("submit"));
  test("already lodged (any status but not_submitted) → skip, never twice", () => {
    for (const s of ["submitted", "query", "approved", "rejected"]) expect(planVeecCreation(veec({ lodgement: { status: s, submission_reference: "R1" } })).action).toBe("skip");
  });
  test("not at Ready for VEEC (AP has not approved) → skip", () => expect(planVeecCreation(veec({ stage: "ap_review" })).action).toBe("skip"));
  test("owner has not signed Section 4 Part B → skip", () => expect(planVeecCreation(veec({ assignment: { status: "effective_complete", installerSignedAt: "a", apSignedAt: "b", consumerSignedAt: null } })).reason).toContain("signed"));
  test("assignment not effective / missing → skip", () => {
    expect(planVeecCreation(veec({ assignment: null })).action).toBe("skip");
    expect(planVeecCreation(veec({ assignment: { status: "variation_required", installerSignedAt: "a", apSignedAt: "b", consumerSignedAt: "c" } })).action).toBe("skip");
  });
  test("quantity unknown → skip for the office (never derived)", () => expect(planVeecCreation(veec({ quantity: null }))).toMatchObject({ action: "skip", office: true }));
  test("earlier failure or unfinished live attempt → office", () => {
    expect(planVeecCreation(veec({ robotEvents: [ev(ROBOT_EVENTS.failed, { task: "veec_creation", needs_office: true })] }))).toMatchObject({ action: "skip", office: true });
    expect(planVeecCreation(veec({ robotEvents: [ev(ROBOT_EVENTS.attempt, { task: "veec_creation", mode: "live" })] }))).toMatchObject({ action: "skip", office: true });
    // A notification failure on the same job does not block the VEEC creation (different task).
    expect(planVeecCreation(veec({ robotEvents: [ev(ROBOT_EVENTS.failed, { task: "install_notification", notification_id: "n-1", needs_office: true })] })).action).toBe("submit");
  });
});

describe("records: events, documents, failures", () => {
  test("success events reuse the office path names; the method is the adapter slot", () => {
    expect(ROBOT_EVENTS.notificationSent).toBe("esc_notification_sent");
    expect(ROBOT_EVENTS.notificationUpdated).toBe("esc_notification_updated");
    expect(ROBOT_EVENTS.veecUpdated).toBe("veec_updated");
    expect(ROBOT_SUBMISSION_METHOD).toBe("adapter");
  });
  test("screenshot documents file under ESC / VEEC, not visible to owner or trades", () => {
    for (const k of Object.values(ROBOT_DOC_KINDS)) {
      const c = categoriseDocument(k, screenshotTitle({ task: "install_notification", outcome: "submitted", reference: "VEU-1", jobNumber: "HV-1" }));
      expect(c.category).toBe("ESC / VEEC");
      expect(c.audience).toEqual([]);
    }
    expect(screenshotPath({ jobId: "j", task: "veec_creation", ref: null, outcome: "dry_run", at: new Date("2026-11-01T00:00:00Z") })).toBe("j/esc-registry/veec_creation-veec-2026-11-01T00-00-00-000Z-dry_run.png");
    expect(screenshotTitle({ task: "install_notification", outcome: "dry_run", jobNumber: "HV-9" })).toContain("not submitted");
  });
  test("failure details carry needs_office, a bounded error and never the page or credentials", () => {
    const d = failureDetails({ task: "install_notification", notificationId: "n-1", mode: "live", step: "login", error: "x".repeat(1000), screenshotPath: "p", registryUrl: "u" });
    expect(d.needs_office).toBe(true);
    expect(d.error.length).toBeLessThanOrEqual(400);
    expect(JSON.stringify(d)).not.toMatch(/password|username/i);
    expect(failureLine(d)).toBe(`Registry robot failed · ESC notice · login · ${"x".repeat(90)} · do it by hand`);
  });
  test("reference sanity: short, non-empty, no runs of whitespace", () => {
    expect(referenceLooksValid("VEU-12345")).toBe(true);
    expect(referenceLooksValid("ab")).toBe(false);
    expect(referenceLooksValid("")).toBe(false);
    expect(referenceLooksValid(null)).toBe(false);
    expect(referenceLooksValid("a   b")).toBe(false);
  });
  test("open failures: one per job + task, cleared once the notice is sent or the VEEC lodged, never by time", () => {
    const failures = [
      { id: "e1", job_id: "j1", event_type: ROBOT_EVENTS.failed, created_at: "2026-10-01T00:00:00Z", details: { task: "install_notification", notification_id: "n-1", needs_office: true, step: "login", error: "refused" } },
      { id: "e2", job_id: "j1", event_type: ROBOT_EVENTS.failed, created_at: "2026-10-02T00:00:00Z", details: { task: "install_notification", notification_id: "n-1", needs_office: true, step: "submit", error: "button" } },
      { id: "e3", job_id: "j2", event_type: ROBOT_EVENTS.failed, created_at: "2026-10-02T00:00:00Z", details: { task: "veec_creation", needs_office: true, step: "fill:veec_quantity", error: "no field" } },
      { id: "e4", job_id: "j3", event_type: ROBOT_EVENTS.failed, created_at: "2026-10-02T00:00:00Z", details: { task: "install_notification", notification_id: "n-3", needs_office: true } },
    ];
    const open = openRobotFailures({ failures, sentNotificationIds: new Set(["n-3"]), lodgedJobIds: new Set() });
    expect(open.map((o) => [o.jobId, o.task, o.eventId])).toEqual([["j1", "install_notification", "e2"], ["j2", "veec_creation", "e3"]]);
    expect(openRobotFailures({ failures, sentNotificationIds: new Set(["n-1", "n-3"]), lodgedJobIds: new Set(["j2"]) })).toEqual([]);
  });
  test("run summary is one line", () => expect(runSummary({ mode: "dry_run", reason: "r", notices: { planned: 1, submitted: 0, updated: 0, dryRuns: 1, failed: 0, skipped: 2 }, veecs: { planned: 0, submitted: 0, dryRuns: 0, failed: 0, skipped: 0 } })).toMatch(/^ESC Registry robot · mode dry_run/));
});

describe("Settings switch row and Needs me row", () => {
  test("the switch is an office column behind the pending migration, shown off and not editable until applied", () => {
    expect(OFFICE_SWITCH_COLUMNS).toContain("esc_registry_robot_enabled");
    expect(PENDING_SWITCH_COLUMNS.esc_registry_robot_enabled).toBe("docs/pending-migrations/esc-registry-robot-switch.sql");
    const def = SWITCHES.find((s) => s.key === "esc_registry_robot")!;
    expect(def.kind).toBe("column");
    expect(switchState(def, { customer_comms_enabled: false })).toMatchObject({ on: false, editable: false, note: expect.stringContaining("esc-registry-robot-switch.sql") });
    expect(switchState(def, { esc_registry_robot_enabled: true })).toMatchObject({ on: true, editable: true });
  });
  test("a robot failure is a Today row with the hand-over button; no row when nothing failed", () => {
    const base = { jobId: "j", jobNumber: "HV-1", surname: "Smith", suburb: "Croydon" };
    const n = needsCandidates({ ...base, robotFailed: { at: "2026-10-24T00:00:00Z", text: "Registry robot failed · ESC notice · login · do it by hand", task: "install_notification" } }, Date.parse("2026-10-24T03:00:00Z"));
    expect(n[0]).toMatchObject({ kind: "robot_failed", group: "today", button: { label: "Open Registry block", section: "install" } });
    const v = needsCandidates({ ...base, robotFailed: { at: "2026-10-24T00:00:00Z", text: "x", task: "veec_creation" } }, Date.parse("2026-10-24T03:00:00Z"));
    expect(v[0]!.button).toMatchObject({ label: "Lodge VEEC", section: "final-check" });
    const g = buildNeedsRows({ now: Date.parse("2026-10-24T03:00:00Z"), jobs: [{ ...base }] });
    expect([...g.today, ...g.week, ...g.watch]).toEqual([]);
  });
});

describe("selector map", () => {
  test("every Table 5 key has a selector; nothing is silently unmapped", () => {
    expect(unmappedNotificationKeys()).toEqual([]);
    expect(Object.keys(INSTALL_NOTIFICATION.fields).sort()).toEqual(DEFAULT_REGISTRY_FIELDS.map((f) => f.key).sort());
  });
  test("reference extraction never guesses", () => {
    expect(extractReference("Your install notification ID: VEU-2026-00123 has been received", INSTALL_NOTIFICATION.confirmation.pattern)).toBe("VEU-2026-00123");
    expect(extractReference("Thank you", INSTALL_NOTIFICATION.confirmation.pattern)).toBeNull();
    expect(extractReference(null, VEEC_CREATION.confirmation.pattern)).toBeNull();
  });
  test("date-times are typed as Melbourne wall-clock", () => {
    expect(formatForRegistry(START, "DD/MM/YYYY HH:mm")).toBe("05/11/2026 09:00");
    expect(formatForRegistry(START, "DD/MM/YYYY")).toBe("05/11/2026");
    expect(formatForRegistry(START, "YYYY-MM-DDTHH:mm")).toBe("2026-11-05T09:00");
  });
  test("the VEEC form keys are Section 2 keys plus the quantity", () => expect(Object.keys(VEEC_CREATION.fields)).toContain("veec_quantity"));
});

// ---- Browser steps against a fake page ------------------------------------------------------------------------
function fakePage(o: { html?: Record<string, string>; failOn?: string[]; visible?: string[] } = {}) {
  const calls: string[] = [];
  const page: RobotPage & { calls: string[] } = {
    calls,
    async goto(url) { calls.push(`goto ${url}`); },
    async fill(sel, v) { if (o.failOn?.includes(sel)) throw new Error("no such element"); calls.push(`fill ${sel} = ${sel === LOGIN.password ? "***" : v}`); },
    async click(sel) { if (o.failOn?.includes(sel)) throw new Error("no such element"); calls.push(`click ${sel}`); },
    async check(sel) { calls.push(`check ${sel}`); },
    async selectOption(sel, v) { calls.push(`select ${sel} = ${typeof v === "string" ? v : v.label}`); },
    async waitForSelector(sel) { if (o.failOn?.includes(sel)) throw new Error("timeout"); calls.push(`wait ${sel}`); },
    async textContent(sel) { return o.html?.[sel] ?? null; },
    async screenshot() { return new Uint8Array([1]); },
    url() { return "https://veu.esc.vic.gov.au/x"; },
    async isVisible(sel) { return o.visible?.includes(sel) ?? false; },
  };
  return page;
}

describe("browser steps (fake page)", () => {
  test("login types the credentials and waits for the signed-in marker; a refused login is a login-step failure", async () => {
    const p = fakePage();
    await login(p, { username: "u@x", password: "secret" });
    expect(p.calls.some((c) => c.includes("secret"))).toBe(false);
    expect(p.calls.at(-1)).toBe(`wait ${LOGIN.loggedIn}`);
    const refused = fakePage({ visible: [LOGIN.failed] });
    await expect(login(refused, { username: "u", password: "p" })).rejects.toMatchObject({ step: "login" });
    await expect(login(fakePage(), { username: "", password: "" })).rejects.toBeInstanceOf(RobotStepError);
  });
  test("fill: blanks are left alone, ISO date-times are formatted, values with no selector are reported, Submit is never pressed", async () => {
    const p = fakePage();
    const r = await fillInstallNotification(p, { installation_start: START, owner_first_name: "Pat", owner_last_name: null, piesa_status: "Not completed", owner_consent_to_share: "Yes", mystery_key: "x" });
    expect(r.filled).toEqual(expect.arrayContaining(["installation_start", "owner_first_name", "piesa_status", "owner_consent_to_share"]));
    expect(r.blank).toContain("owner_last_name");
    expect(r.unmapped).toEqual(["mystery_key"]);
    expect(p.calls).toContain(`fill ${INSTALL_NOTIFICATION.fields["installation_start"]!.selector} = 05/11/2026 09:00`);
    expect(p.calls.some((c) => c.startsWith("click"))).toBe(false);
  });
  test("a field that cannot be filled names the key in the step", async () => {
    const sel = INSTALL_NOTIFICATION.fields["owner_phone"]!.selector;
    await expect(fillInstallNotification(fakePage({ failOn: [sel] }), { owner_phone: "0400" })).rejects.toMatchObject({ step: "fill:owner_phone" });
  });
  test("submit reads the reference; no reference = failure that tells the office to check the Registry", async () => {
    const ok = fakePage({ html: { main: "Install notification ID: VEU-555 received" } });
    expect(await submitAndReadReference(ok, INSTALL_NOTIFICATION)).toEqual({ reference: "VEU-555", url: "https://veu.esc.vic.gov.au/x" });
    expect(ok.calls).toContain(`click ${INSTALL_NOTIFICATION.submit}`);
    await expect(submitAndReadReference(fakePage({ html: { main: "Thanks" } }), INSTALL_NOTIFICATION)).rejects.toMatchObject({ step: "confirmation", message: expect.stringContaining("CHECK THE REGISTRY") });
  });
});
