// VEU Registry install notification: prepare + remind + record (Jo 24 Oct 2026, decisions 118/119/121/195/197; checklist B5). Pure rules only.
import { describe, expect, test } from "bun:test";
import { DEFAULT_REGISTRY_FIELDS, PIESA_REGISTRY_STATUS, REGISTRY_FIELDS_VERSION, REGISTRY_UPDATABLE_KEYS, buildEscPayload, escSentLine, isWithdrawn, piesaRegistryStatus, readyToInstall, registryBlock, registryChange, registryConditions, registryFacts, registryUpdatePatch, registryUpdateTimingReasons, splitOwnerName, withdrawalPatch } from "../src/lib/esc.core";
import { ESC_REMINDER_TITLES, escReminder, escTask } from "../src/lib/prestart.core";

const START = "2026-11-04T22:00:00Z"; // Thu 5 Nov 9:00am Melbourne (AEDT)
const END = "2026-11-05T04:00:00Z"; // Thu 5 Nov 3:00pm Melbourne
const H = 3600_000, D = 24 * H;
const at = (ms: number) => new Date(Date.parse(START) - ms);
const owner = { name: "Pat Owner", email: "pat@example.com", phone: null };
const sent = (sentAt: string, start = START) => ({ status: "sent", sent_at: sentAt, submission_reference: "VEU-123", scheduled_start: start });

const facts = registryFacts(baseIn());

describe("Registry field list = Activity Guide v1.2 Appendix A Table 5 (default when no approved config)", () => {
  test("the Table 5 fields, in form order, with the Registry's updatable column", () => {
    expect(DEFAULT_REGISTRY_FIELDS.map((f) => f.key)).toEqual([
      "installation_start", "installation_end", "premises_address",
      "owner_first_name", "owner_last_name", "owner_phone", "owner_email", "owner_entity_name",
      "lead_installer", "lead_installer_phone", "lead_installer_cii_number", "installer_company", "installer_abn_acn",
      "piesa_status", "coes_number", "rec_number", "owner_consent_to_share",
    ]);
    expect(DEFAULT_REGISTRY_FIELDS.filter((f) => f.optional).map((f) => f.key)).toEqual(["owner_entity_name", "installer_company"]);
    // Table 5 "Field able to be amended as part of a notification update" = Yes.
    expect(REGISTRY_UPDATABLE_KEYS).toEqual(["installation_start", "installation_end", "lead_installer", "lead_installer_phone", "lead_installer_cii_number", "installer_company", "installer_abn_acn"]);
    expect(DEFAULT_REGISTRY_FIELDS.find((f) => f.key === "coes_number")?.when).toBe("rectification");
    expect(DEFAULT_REGISTRY_FIELDS.find((f) => f.key === "rec_number")?.when).toBe("rec_required");
    // EEC certification number is REQUIRED (the old list had it optional); every field names its job source.
    expect(DEFAULT_REGISTRY_FIELDS.find((f) => f.key === "lead_installer_cii_number")?.optional).toBeFalsy();
    expect(DEFAULT_REGISTRY_FIELDS.every((f) => !!f.source)).toBe(true);
    // Fields the Registry does not ask are gone.
    for (const k of ["ap_name", "ap_accreditation_number", "electrician_name", "electrician_licence", "piesa_completed_on", "piisa_completed", "job_number"]) expect(DEFAULT_REGISTRY_FIELDS.map((f) => f.key)).not.toContain(k);
  });
  test("the four PIESA answers, verbatim, from the signed PIESA", () => {
    expect(Object.values(PIESA_REGISTRY_STATUS)).toEqual([
      "Not completed", "Completed: no electrical issues identified", "Completed: electrical issues identified and all rectified",
      "Completed: electrical issues identified, rectification not possible, electrician will be required at installation.",
    ]);
    expect(piesaRegistryStatus({ signed: false, b1: null, outcome: "pending", coesNumber: null })).toBe("Not completed");
    expect(piesaRegistryStatus({ signed: true, b1: "not_required", outcome: "pass", coesNumber: null })).toBe(PIESA_REGISTRY_STATUS.noIssues);
    expect(piesaRegistryStatus({ signed: true, b1: "required", outcome: "pass", coesNumber: "CES-1" })).toBe(PIESA_REGISTRY_STATUS.allRectified);
    expect(piesaRegistryStatus({ signed: true, b1: "required", outcome: "pass", coesNumber: null })).toBe("Not completed"); // no CoES = not rectified on paper
    expect(piesaRegistryStatus({ signed: true, b1: "required", outcome: "fail", coesNumber: "CES-1" })).toBe("Not completed");
    expect(piesaRegistryStatus({ signed: true, b1: "not_possible", outcome: "fail", coesNumber: null })).toBe(PIESA_REGISTRY_STATUS.electricianAtInstall);
    expect(piesaRegistryStatus({ signed: true, b1: null, outcome: "pass", coesNumber: null })).toBeNull(); // never guessed
  });
  test("facts: Melbourne date-times, owner name split, verified CII, consent Yes only when valid; blanks stay blank", () => {
    expect(facts.installation_start).toBe("Thu 5 Nov 2026 9:00 am");
    expect(facts.installation_end).toBe("Thu 5 Nov 2026 3:00 pm");
    expect(facts.owner_first_name).toBe("Pat Anne");
    expect(facts.owner_last_name).toBe("Owner");
    expect(facts.owner_phone).toBe("0400 000 000");
    expect(facts.lead_installer_phone).toBe("0411 111 111");
    expect(facts.lead_installer_cii_number).toBe("CII-5566");
    expect(facts.installer_abn_acn).toBe("12 345 678 901");
    expect(facts.piesa_status).toBe(PIESA_REGISTRY_STATUS.noIssues);
    expect(facts.coes_number).toBeNull();
    expect(facts.rec_number).toBeNull(); // REC only with a CoES
    expect(facts.owner_consent_to_share).toBe("Yes");
    expect(splitOwnerName("Cher")).toEqual({ first: "Cher", last: null });
    const thin = registryFacts({ ...baseIn(), scheduledEnd: null, ownerPhone: null, consentValid: false, leadInstallerCii: null });
    expect([thin.installation_end, thin.owner_phone, thin.owner_consent_to_share, thin.lead_installer_cii_number]).toEqual([null, null, null, null]);
    const rect = registryFacts({ ...baseIn(), piesa: { signed: true, b1: "required", outcome: "pass" }, coesNumber: "CES-77", recNumber: "REC 12345" });
    expect([rect.piesa_status, rect.coes_number, rect.rec_number]).toEqual([PIESA_REGISTRY_STATUS.allRectified, "CES-77", "REC 12345"]);
    expect(registryConditions(rect)).toEqual({ rectification: true, recRequired: true });
    expect(registryConditions(facts)).toEqual({ rectification: false, recRequired: false });
  });
  test("prepared without admin approval: no config => Table 5 list, consent + facts decide readiness", () => {
    const i = { jobNumber: "HV-3200", installationDays: ["2026-11-05"], scheduledStart: START, scheduledEnd: END, premisesAddress: "12 Sample St, Reservoir VIC 3073", owner, extra: {}, facts };
    const ready = buildEscPayload(null, { ...i, consentReference: "c:1" });
    expect(ready.missing).toEqual([]);
    expect(ready.status).toBe("ready");
    expect(ready.payload["fields_version"]).toBe(REGISTRY_FIELDS_VERSION);
    expect((ready.payload["additional"] as Record<string, unknown>)["lead_installer_cii_number"]).toBe("CII-5566");
    // Optional blanks never block; required blanks do (listed once, by label). EEC number is now required.
    expect(buildEscPayload(null, { ...i, consentReference: "c:1", facts: { ...facts, installer_company: null } }).status).toBe("ready");
    const noCii = buildEscPayload(null, { ...i, consentReference: "c:1", facts: { ...facts, lead_installer_cii_number: null, lead_installer_phone: null } });
    expect(noCii.status).toBe("configuration_required");
    expect(noCii.missing).toEqual(["Lead installer phone number", "EEC Certification number"]);
    // CoES + REC only required when the PIESA says all rectified.
    const rectFacts = { ...facts, piesa_status: PIESA_REGISTRY_STATUS.allRectified, coes_number: "CES-1", rec_number: null };
    expect(buildEscPayload(null, { ...i, consentReference: "c:1", facts: rectFacts }).missing).toEqual(["REC Registration Number"]);
    // No consent yet => the consent field and the consent record are both listed.
    const noConsent = buildEscPayload(null, { ...i, consentReference: null, facts: { ...facts, owner_consent_to_share: null } });
    expect(noConsent.status).toBe("configuration_required");
    expect(noConsent.missing[0]).toMatch(/Written owner consent/);
    expect(noConsent.missing.join()).toMatch(/Valid separate owner ESC consent/);
  });
  test("an existing but unapproved config still reports configuration required; an approved config replaces the default list", () => {
    const i = { jobNumber: "HV-1", installationDays: ["x"], scheduledStart: START, scheduledEnd: null, premisesAddress: "A", owner, extra: {}, consentReference: "c", facts };
    expect(buildEscPayload({ version: "v9", required_fields: [], approved: false, is_active: true }, i).missing[0]).toMatch(/Admin-approved/);
    const approved = buildEscPayload({ version: "v9", required_fields: [{ key: "owner_email", label: "Email" }], approved: true, is_active: true }, i);
    expect(approved.status).toBe("ready");
    expect(Object.keys(approved.payload["additional"] as object)).toEqual(["owner_email"]);
  });
  test("copy-ready block: Table 5 rows (conditional ones only when they apply), blanks marked with where to fix them", () => {
    const p = buildEscPayload(null, { jobNumber: "HV-3200", installationDays: ["2026-11-05"], scheduledStart: START, scheduledEnd: END, premisesAddress: "12 Sample St", owner, extra: {}, facts: { ...facts, installer_company: null }, consentReference: "c:1" }).payload;
    const b = registryBlock(p);
    expect(b.rows.map((r) => r.key)).not.toContain("coes_number");
    expect(b.rows.length).toBe(DEFAULT_REGISTRY_FIELDS.length - 2);
    expect(b.text.split("\n")[0]).toMatch(/Submit a new install notification/);
    expect(b.text).toContain("EEC Certification number: CII-5566");
    expect(b.text).toContain("Installer company name: —");
    expect(b.missing).toEqual([]); // company is optional
    const gap = registryBlock({ ...p, additional: { ...(p["additional"] as object), owner_phone: "" } });
    expect(gap.missing).toEqual(["Owner phone number"]);
    expect(gap.missingFacts[0]!.source).toBe("Owner phone");
    const rp = buildEscPayload(null, { jobNumber: "HV-3200", installationDays: ["x"], scheduledStart: START, scheduledEnd: END, premisesAddress: "12 Sample St", owner, extra: {}, facts: { ...facts, piesa_status: PIESA_REGISTRY_STATUS.allRectified, coes_number: "CES-1", rec_number: "REC 9" }, consentReference: "c:1" }).payload;
    expect(registryBlock(rp).rows.slice(-3).map((r) => r.value)).toEqual(["CES-1", "REC 9", "Yes"]);
  });
});

describe("Update on the same notification ID vs withdraw + resubmit (Activity Guide v1.2 §3.3.3)", () => {
  const mk = (f: typeof facts, start = START) => buildEscPayload(null, { jobNumber: "HV-3200", installationDays: ["x"], scheduledStart: start, scheduledEnd: END, premisesAddress: "12 Sample St", owner, extra: {}, facts: f, consentReference: "c:1" }).payload;
  const OLD = "2026-11-03T22:00:00Z";
  const prev = { scheduled_start: OLD, sent_at: "2026-10-31T00:00:00Z", submission_reference: "VEU-123", payload_json: mk(registryFacts({ ...baseIn(), scheduledStart: OLD }), OLD) };
  const now = new Date(Date.parse(OLD) - 2 * D).toISOString(); // 2 days before the original start
  test("date and lead-installer changes inside the window → update (same ID)", () => {
    const next = { scheduled_start: START, payload_json: mk({ ...facts, lead_installer_phone: "0422 222 222" }) };
    const c = registryChange(prev, next, now);
    expect(c.action).toBe("update_same_id");
    expect(c.changed).toEqual(["installation_start", "lead_installer_phone"]);
    const patch = registryUpdatePatch({ prev, change: c, reference: "VEU-123", updatedAt: now, confirmed: true, actorId: "u1" }, now);
    expect(patch.submission_reference).toBe("VEU-123");
    expect(patch.status).toBe("sent");
    expect(patch.response.registry_update.changed).toContain("lead_installer_phone");
    expect(() => registryUpdatePatch({ prev, change: c, reference: "VEU-999", updatedAt: now, confirmed: true, actorId: "u1" }, now)).toThrow(/same notification ID/);
    expect(() => registryUpdatePatch({ prev, change: c, reference: "VEU-123", updatedAt: now, confirmed: false, actorId: "u1" }, now)).toThrow(/Confirm/);
  });
  test("address/owner/PIESA changes, a passed original start, or a start beyond 5 days → withdraw and resubmit", () => {
    const addr = registryChange(prev, { scheduled_start: START, payload_json: mk({ ...facts, premises_address: "14 Other St" }) }, now);
    expect(addr.action).toBe("withdraw_and_resubmit");
    expect(addr.reasons[0]).toMatch(/Installation address/);
    const piesa = registryChange(prev, { scheduled_start: OLD, payload_json: mk({ ...registryFacts({ ...baseIn(), scheduledStart: OLD }), piesa_status: PIESA_REGISTRY_STATUS.electricianAtInstall }, OLD) }, now);
    expect(piesa.action).toBe("withdraw_and_resubmit");
    const passed = registryChange(prev, { scheduled_start: START, payload_json: mk(facts) }, new Date(Date.parse(OLD) + H).toISOString());
    expect(passed.reasons.join()).toMatch(/original installation date and time has passed/);
    const far = "2026-11-12T22:00:00Z";
    expect(registryChange(prev, { scheduled_start: far, payload_json: mk(registryFacts({ ...baseIn(), scheduledStart: far }), far) }, now).reasons.join()).toMatch(/more than 5 days/);
    expect(() => registryUpdatePatch({ prev, change: addr, reference: "VEU-123", updatedAt: now, confirmed: true, actorId: "u1" }, now)).toThrow(/can't be updated/);
  });
  test("nothing changed → none; a notice from the old field list → withdraw and resubmit", () => {
    expect(registryChange(prev, { scheduled_start: OLD, payload_json: prev.payload_json }, now).action).toBe("none");
    expect(registryChange({ ...prev, payload_json: { fields_version: "registry-default-v1", additional: {} } }, { scheduled_start: START, payload_json: mk(facts) }, now).action).toBe("withdraw_and_resubmit");
    expect(registryUpdateTimingReasons(OLD, START, now)).toEqual([]);
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

function baseIn(): Parameters<typeof registryFacts>[0] {
  return {
    premisesAddress: "12 Sample St, Reservoir VIC 3073", ownerName: "Pat Anne Owner", ownerPhone: "0400 000 000", ownerEmail: "pat@example.com",
    scheduledStart: START, scheduledEnd: END,
    leadInstaller: "Lee Installer", leadInstallerPhone: "0411 111 111", leadInstallerCii: "CII-5566", installerCompany: "Warm Roofs Pty Ltd", installerAbnAcn: "12 345 678 901",
    piesa: { signed: true, b1: "not_required", outcome: "pass" }, coesNumber: null, recNumber: "REC 12345", consentValid: true,
  };
}
