// VEU Registry install notification: prepare + remind + record (Jo 24 Oct 2026, decisions 118/119/121). Pure rules only.
import { describe, expect, test } from "bun:test";
import { AP_ACCREDITATION_NUMBER, DEFAULT_REGISTRY_FIELDS, buildEscPayload, escSentLine, isWithdrawn, readyToInstall, registryBlock, registryFacts, withdrawalPatch } from "../src/lib/esc.core";
import { ESC_REMINDER_TITLES, escReminder, escTask } from "../src/lib/prestart.core";

const START = "2026-11-04T22:00:00Z"; // Thu 5 Nov 9:00am Melbourne (AEDT)
const H = 3600_000, D = 24 * H;
const at = (ms: number) => new Date(Date.parse(START) - ms);
const owner = { name: "Pat Owner", email: "pat@example.com", phone: null };
const sent = (sentAt: string, start = START) => ({ status: "sent", sent_at: sentAt, submission_reference: "VEU-123", scheduled_start: start });

const facts = registryFacts({
  jobNumber: "HV-3200", premisesAddress: "12 Sample St, Reservoir VIC 3073", ownerName: "Pat Owner", scheduledStart: START, scheduledEnd: null,
  installerBusiness: "Warm Roofs Pty Ltd", leadInstaller: "Lee Installer", leadInstallerCii: "CII-5566",
  electricianName: "Sam Sparks", electricianLicence: "REC 12345", piesaCompletedOn: "2026-10-28", piisaSignedOn: null, consentCompletedAt: "2026-10-30T03:00:00Z",
});

describe("Registry field list (default when no approved config)", () => {
  test("the agreed fields, in order", () => {
    expect(DEFAULT_REGISTRY_FIELDS.map((f) => f.key)).toEqual([
      "ap_name", "ap_accreditation_number", "premises_address", "owner_name", "installation_date", "installation_start_time", "expected_completion_date",
      "installer_business", "lead_installer", "lead_installer_cii_number", "electrician_name", "electrician_licence", "piesa_completed_on", "piisa_completed",
      "owner_consent_obtained_on", "job_number",
    ]);
    expect(DEFAULT_REGISTRY_FIELDS.filter((f) => f.optional).map((f) => f.key)).toEqual(["lead_installer_cii_number", "electrician_name", "electrician_licence"]);
  });
  test("facts are Melbourne-local, completion defaults to the same day, PIISA 'Not yet' until signed", () => {
    expect(facts.ap_accreditation_number).toBe(AP_ACCREDITATION_NUMBER);
    expect(facts.installation_date).toBe("Thu 5 Nov 2026");
    expect(facts.installation_start_time).toBe("9:00 am");
    expect(facts.expected_completion_date).toBe("Thu 5 Nov 2026 (same day)");
    expect(facts.piesa_completed_on).toBe("Wed 28 Oct 2026");
    expect(facts.piisa_completed).toBe("Not yet");
    expect(facts.owner_consent_obtained_on).toMatch(/Fri 30 Oct 2026 2:00 pm/);
    expect(registryFacts({ ...baseIn(), scheduledEnd: "2026-11-05T22:00:00Z" }).expected_completion_date).toBe("Fri 6 Nov 2026");
    expect(registryFacts({ ...baseIn(), piisaSignedOn: "2026-11-04" }).piisa_completed).toBe("Yes (Wed 4 Nov 2026)");
    expect(registryFacts({ ...baseIn(), leadInstallerCii: null, electricianName: null }).lead_installer_cii_number).toBeNull();
  });
  test("prepared without admin approval: no config => default list, consent + facts decide readiness", () => {
    const i = { jobNumber: "HV-3200", installationDays: ["2026-11-05"], scheduledStart: START, scheduledEnd: null, premisesAddress: "12 Sample St, Reservoir VIC 3073", owner, extra: {}, facts };
    const ready = buildEscPayload(null, { ...i, consentReference: "c:1" });
    expect(ready.status).toBe("ready");
    expect(ready.missing).toEqual([]);
    expect(ready.payload["fields_version"]).toBe("registry-default-v1");
    expect((ready.payload["additional"] as Record<string, unknown>)["lead_installer_cii_number"]).toBe("CII-5566");
    // Optional blanks never block; required blanks do (listed once, by label).
    expect(buildEscPayload(null, { ...i, consentReference: "c:1", facts: { ...facts, lead_installer_cii_number: null, electrician_licence: null } }).status).toBe("ready");
    const noPiesa = buildEscPayload(null, { ...i, consentReference: "c:1", facts: { ...facts, piesa_completed_on: null } });
    expect(noPiesa.status).toBe("configuration_required");
    expect(noPiesa.missing).toEqual(["PIESA completion date"]);
    // No consent yet => not ready (prepared all the same, so the office can see what is coming).
    const noConsent = buildEscPayload(null, { ...i, consentReference: null, facts: { ...facts, owner_consent_obtained_on: null } });
    expect(noConsent.status).toBe("configuration_required");
    expect(noConsent.missing).toContain("Owner consent obtained");
    expect(noConsent.missing.join()).toMatch(/Valid separate owner ESC consent/);
  });
  test("an existing but unapproved config still reports configuration required; an approved config replaces the default list", () => {
    const i = { jobNumber: "HV-1", installationDays: ["x"], scheduledStart: START, scheduledEnd: null, premisesAddress: "A", owner, extra: {}, consentReference: "c", facts };
    expect(buildEscPayload({ version: "v9", required_fields: [], approved: false, is_active: true }, i).missing[0]).toMatch(/Admin-approved/);
    const approved = buildEscPayload({ version: "v9", required_fields: [{ key: "job_number", label: "Job" }], approved: true, is_active: true }, i);
    expect(approved.status).toBe("ready");
    expect(Object.keys(approved.payload["additional"] as object)).toEqual(["job_number"]);
  });
  test("copy-ready block lists every field, marks blanks, and never invents a value", () => {
    const p = buildEscPayload(null, { jobNumber: "HV-3200", installationDays: ["2026-11-05"], scheduledStart: START, scheduledEnd: null, premisesAddress: "12 Sample St", owner, extra: {}, facts: { ...facts, lead_installer_cii_number: null }, consentReference: "c:1" }).payload;
    const b = registryBlock(p);
    expect(b.rows.length).toBe(DEFAULT_REGISTRY_FIELDS.length);
    expect(b.text.split("\n")[0]).toMatch(/VEU Registry – Install notification/);
    expect(b.text).toContain("AP accreditation number: A003654");
    expect(b.text).toContain("Lead installer EEC CII number: —");
    expect(b.missing).toEqual([]); // CII number is optional
    expect(registryBlock({ ...p, additional: { ...(p["additional"] as object), owner_name: "" } }).missing).toEqual(["Owner name"]);
  });
});

describe("Record: reference + time feed every screen and READY TO INSTALL", () => {
  test("Sent to ESC line only for a real recorded submission", () => {
    expect(escSentLine(null)).toBeNull();
    expect(escSentLine({ status: "ready", sent_at: null, submission_reference: null })).toBeNull();
    expect(escSentLine({ status: "sent", sent_at: "2026-11-01T23:30:00Z", submission_reference: "VEU-123" })).toBe("Sent to ESC on Mon 2 Nov 2026 10:30 am · ref VEU-123");
  });
  test("readyToInstall takes the recorded submission (decision 119 AP prerequisite: notified ≥24h before)", () => {
    const consent = { status: "valid", scheduled_start: START, owner_signed_at: "2026-10-30T03:00:00Z", ap_signed_at: "2026-10-30T03:00:00Z" };
    const base = { scheduledStart: START, consent, deliveries: { owner: "2026-11-01T00:00:00Z", installer: "2026-11-01T00:00:00Z" }, piesa: { date: "2026-10-28", deadline: "2026-11-27", outcome: "pass" } };
    expect(readyToInstall({ ...base, notification: sent(at(2 * D).toISOString()) }).ready).toBe(true);
    expect(readyToInstall({ ...base, notification: { status: "ready", sent_at: null, submission_reference: null, scheduled_start: START } }).blockers[0]).toMatch(/not sent/);
    expect(readyToInstall({ ...base, notification: sent(at(2 * D).toISOString(), "2026-11-03T22:00:00Z") }).blockers[0]).toMatch(/stale/);
  });
});

describe("Withdraw / resubmit keeps history", () => {
  const notice = { status: "stale", sent_at: "2026-11-01T00:00:00Z", submission_reference: "VEU-123", response: null };
  test("only a sent notice can be withdrawn; reason and a non-future time are required", () => {
    const p = withdrawalPatch({ notice, reason: "Install moved outside the 5-day window", withdrawnAt: "2026-11-02T00:00:00Z", actorId: "u1" }, "2026-11-02T00:10:00Z");
    expect(p.status).toBe("stale");
    expect(p.response.withdrawal.registry_reference).toBe("VEU-123");
    expect(isWithdrawn({ response: p.response })).toBe(true);
    expect(isWithdrawn(notice)).toBe(false);
    expect(() => withdrawalPatch({ notice: { ...notice, sent_at: null, submission_reference: null }, reason: "x y z", withdrawnAt: "2026-11-02T00:00:00Z", actorId: "u1" }, "2026-11-02T00:10:00Z")).toThrow(/recorded as sent/);
    expect(() => withdrawalPatch({ notice, reason: "", withdrawnAt: "2026-11-02T00:00:00Z", actorId: "u1" }, "2026-11-02T00:10:00Z")).toThrow(/why/);
    expect(() => withdrawalPatch({ notice, reason: "moved", withdrawnAt: "2026-11-03T00:00:00Z", actorId: "u1" }, "2026-11-02T00:10:00Z")).toThrow(/future/);
    expect(() => withdrawalPatch({ notice: { ...notice, response: p.response }, reason: "again", withdrawnAt: "2026-11-02T00:00:00Z", actorId: "u1" }, "2026-11-02T00:10:00Z")).toThrow(/already/);
  });
});

describe("Remind: once per stage from the tick", () => {
  test("nothing before 5 days; window open; urgent at 48h; blocked at 24h", () => {
    expect(escReminder({ start: START, current: null, previousSent: null, now: at(5 * D + H) })).toBeNull();
    expect(escReminder({ start: START, current: null, previousSent: null, now: at(4 * D) })?.code).toBe("esc_window_open");
    expect(escReminder({ start: START, current: null, previousSent: null, now: at(47 * H) })?.code).toBe("esc_urgent_48h");
    const blocked = escReminder({ start: START, current: null, previousSent: null, now: at(23 * H) });
    expect(blocked?.code).toBe("esc_blocked_24h");
    expect(blocked?.key).toBe(`${new Date(START).toISOString()}:esc_blocked_24h`);
    expect(escTask({ start: START, current: null, previousSent: null, now: at(23 * H) })?.detail).toMatch(/locked/);
    expect(ESC_REMINDER_TITLES.esc_window_open).toBe("ESC notification can be sent now");
  });
  test("recorded for this date => no reminder; date moved after a recorded submission => reopened", () => {
    expect(escReminder({ start: START, current: sent(at(3 * D).toISOString()), previousSent: null, now: at(2 * D) })).toBeNull();
    const old = "2026-11-03T22:00:00Z";
    expect(escReminder({ start: START, current: { status: "ready", sent_at: null, submission_reference: null, scheduled_start: START }, previousSent: sent(at(3 * D).toISOString(), old), now: at(2 * D) })?.code).toBe("esc_reopened");
    expect(escReminder({ start: START, current: null, previousSent: sent(at(8 * D).toISOString(), old), now: at(4 * D) })?.code).toBe("esc_reopened");
  });
  test("a withdrawn earlier notice no longer asks for update/withdraw — plain submit again", () => {
    // The server filters withdrawn notices out of previousSent; the pure rule then falls back to the window stage.
    expect(escReminder({ start: START, current: null, previousSent: null, now: at(4 * D) })?.code).toBe("esc_window_open");
  });
});

function baseIn() {
  return {
    jobNumber: "HV-3200", premisesAddress: "12 Sample St, Reservoir VIC 3073", ownerName: "Pat Owner", scheduledStart: START, scheduledEnd: null as string | null,
    installerBusiness: "Warm Roofs Pty Ltd", leadInstaller: "Lee Installer", leadInstallerCii: "CII-5566" as string | null,
    electricianName: "Sam Sparks" as string | null, electricianLicence: "REC 12345", piesaCompletedOn: "2026-10-28", piisaSignedOn: null as string | null, consentCompletedAt: "2026-10-30T03:00:00Z",
  };
}
