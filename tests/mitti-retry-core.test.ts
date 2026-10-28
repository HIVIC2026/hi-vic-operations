import { describe, expect, test } from "bun:test";
import {
  ALERT_SENT_EVENT, MAX_RETRIES, MITTI_RETRY_FROM, RETRY_DELAY_MS, RETRY_LINKED_EVENT, RETRY_STARTED_EVENT,
  alertEmail, collectFailureCases, matchAudits, nextAction, retriesFor, type FailureCase, type WorkflowEventRow,
} from "../src/lib/mitti-retry.core";

const T0 = Date.parse(MITTI_RETRY_FROM) + 3_600_000;
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const ev = (job_id: string, event_type: string, min: number, details: Record<string, unknown> | null = null, summary: string | null = null): WorkflowEventRow => ({ job_id, event_type, created_at: at(min), summary, details });
const uncertain = (job: string, kind: string, min: number, claim = "c1") => ev(job, "mitti_audit_create_uncertain", min, { kind, claim_id: claim, detail: "lost reply" });
const NOW = new Date(T0 + 60 * 60_000);

const base: FailureCase = { jobId: "j1", kind: "ready_check", claimId: "c1", failedAt: at(0), reason: "uncertain", detail: "" };
const minsAfter = (min: number) => new Date(T0 + min * 60_000);

describe("constants", () => {
  test("values", () => {
    expect(RETRY_DELAY_MS).toBe(120_000);
    expect(MAX_RETRIES).toBe(2);
    expect(RETRY_STARTED_EVENT).toBe("mitti_create_retry_started");
    expect(RETRY_LINKED_EVENT).toBe("mitti_create_retry_linked");
    expect(ALERT_SENT_EVENT).toBe("mitti_create_alert_sent");
    expect(MITTI_RETRY_FROM).toBe("2026-10-29T00:00:00.000Z");
  });
});

describe("nextAction", () => {
  test("waits under 2 minutes", () => expect(nextAction(base, [], minsAfter(1.9))).toBe("wait"));
  test("search_then_retry at 2 minutes with 0 retries", () => expect(nextAction(base, [], minsAfter(2))).toBe("search_then_retry"));
  test("waits 2 minutes after retry 1", () => {
    expect(nextAction(base, [{ at: at(3) }], minsAfter(4.9))).toBe("wait");
  });
  test("search_then_retry for retry 2", () => expect(nextAction(base, [{ at: at(3) }], minsAfter(5))).toBe("search_then_retry"));
  test("a fresh failure after the retry also restarts the wait", () => {
    expect(nextAction({ ...base, failedAt: at(4) }, [{ at: at(3) }], minsAfter(5))).toBe("wait");
  });
  test("alert after 2 retries", () => expect(nextAction(base, [{ at: at(3) }, { at: at(6) }], minsAfter(6))).toBe("alert"));
  test("alert at once for not_created", () => expect(nextAction({ ...base, reason: "not_created", claimId: null }, [], minsAfter(0))).toBe("alert"));
});

describe("collectFailureCases", () => {
  test("ignores events before MITTI_RETRY_FROM", () => {
    const old: WorkflowEventRow = { job_id: "j1", event_type: "mitti_audit_create_uncertain", created_at: "2026-10-28T23:59:59.000Z", details: { kind: "ready_check", claim_id: "c0" } };
    expect(collectFailureCases([old], NOW)).toEqual([]);
  });
  test("uncertain case carries kind, claim id, time and detail", () => {
    expect(collectFailureCases([uncertain("j1", "piesa", 5, "cX")], NOW)).toEqual([{ jobId: "j1", kind: "piesa", claimId: "cX", failedAt: at(5), reason: "uncertain", detail: "lost reply" }]);
  });
  test("not-created sources map to kinds, claimId null", () => {
    const events = [
      ev("a", "mitti_access_needed", 1, null, "On-site Ready Check form could not be created: boom"),
      ev("b", "piesa_autoform_failed", 1, { reason: "nope" }),
      ev("c", "fixes_form_held", 1, { key: "booking:b1:not_created", reason: "x" }),
      ev("d", "mitti_piisa_autosend_failed", 1, { message: "bad" }),
    ];
    const got = collectFailureCases(events, NOW);
    expect(got.map((c) => [c.jobId, c.kind, c.reason, c.claimId])).toEqual([["a", "ready_check", "not_created", null], ["b", "piesa", "not_created", null], ["c", "fixes", "not_created", null], ["d", "install_day", "not_created", null]]);
  });
  test("other access_needed and held reasons are not failures", () => {
    expect(collectFailureCases([ev("a", "mitti_access_needed", 1, null, "Needs Mitti access: x"), ev("c", "fixes_form_held", 1, { key: "booking:b1:no_email" })], NOW)).toEqual([]);
  });
  test("released events (including the sweep's own) are not failures", () => {
    expect(collectFailureCases([ev("a", "mitti_audit_create_released", 1, { kind: "ready_check", claim_id: "c1", reason: "retry_after_search_found_nothing" })], NOW)).toEqual([]);
  });
  test("drops cases resolved by a later linked, created, override, retry-linked or alert event", () => {
    const resolvers: [string, Record<string, unknown> | null][] = [
      ["mitti_audit_created", null], ["mitti_audit_linked", null], ["mitti_access_override", null],
      [RETRY_LINKED_EVENT, { kind: "ready_check" }], [ALERT_SENT_EVENT, { kind: "ready_check" }],
    ];
    for (const [type, details] of resolvers) expect(collectFailureCases([uncertain("j1", "ready_check", 1), ev("j1", type, 2, details)], NOW)).toEqual([]);
    expect(collectFailureCases([uncertain("j1", "install_day", 1), ev("j1", "mitti_piisa_audit_created", 2)], NOW)).toEqual([]);
    expect(collectFailureCases([ev("j1", "piesa_autoform_failed", 1), ev("j1", ALERT_SENT_EVENT, 2, { kind: "piesa" })], NOW)).toEqual([]);
  });
  test("a PIESA failure is cleared by a PIESA-kind create event", () => {
    expect(collectFailureCases([ev("j1", "piesa_autoform_failed", 1), ev("j1", "mitti_audit_created", 2, { kind: "piesa" })], NOW)).toEqual([]);
    expect(collectFailureCases([ev("j1", "piesa_autoform_failed", 1), ev("j1", "mitti_audit_reshared", 2, { kind: "piesa" })], NOW)).toEqual([]);
  });
  test("a PIESA create event does not clear a ready_check case", () => {
    expect(collectFailureCases([uncertain("j1", "ready_check", 1), ev("j1", "mitti_audit_created", 2, { kind: "piesa" })], NOW)).toHaveLength(1);
  });
  test("a piesa-kind access override clears piesa only", () => {
    const got = collectFailureCases([uncertain("j1", "piesa", 1), uncertain("j1", "ready_check", 1), ev("j1", "mitti_access_override", 2, { kind: "piesa" })], NOW);
    expect(got.map((c) => c.kind)).toEqual(["ready_check"]);
  });
  test("a kind-less create event (older events) clears both ready_check and piesa", () => {
    expect(collectFailureCases([uncertain("j1", "ready_check", 1), uncertain("j1", "piesa", 1), ev("j1", "mitti_audit_created", 2)], NOW)).toEqual([]);
  });
  test("mitti_audit_linked clears ready_check only", () => {
    const got = collectFailureCases([uncertain("j1", "ready_check", 1), uncertain("j1", "piesa", 1), ev("j1", "mitti_audit_linked", 2)], NOW);
    expect(got.map((c) => c.kind)).toEqual(["piesa"]);
  });
  test("a resolver for a different kind or job does not drop the case", () => {
    expect(collectFailureCases([uncertain("j1", "piesa", 1), ev("j1", ALERT_SENT_EVENT, 2, { kind: "ready_check" }), ev("j2", RETRY_LINKED_EVENT, 2, { kind: "piesa" })], NOW)).toHaveLength(1);
  });
  test("a failure after a resolver is a new case", () => {
    const got = collectFailureCases([uncertain("j1", "ready_check", 1), ev("j1", "mitti_audit_linked", 2), uncertain("j1", "ready_check", 3, "c2")], NOW);
    expect(got).toHaveLength(1);
    expect(got[0]!.claimId).toBe("c2");
  });
  test("one case per job+kind, using the latest failure", () => {
    const got = collectFailureCases([uncertain("j1", "ready_check", 1, "c1"), uncertain("j1", "ready_check", 9, "c2"), uncertain("j1", "piesa", 2, "c3"), uncertain("j2", "ready_check", 3, "c4")], NOW);
    expect(got).toHaveLength(3);
    expect(got.find((c) => c.jobId === "j1" && c.kind === "ready_check")).toMatchObject({ claimId: "c2", failedAt: at(9) });
  });
});

describe("retriesFor", () => {
  const retry = (job: string, kind: string, min: number) => ev(job, RETRY_STARTED_EVENT, min, { kind });
  test("returns this job+kind's retries from the first unresolved failure on", () => {
    const events = [uncertain("j1", "ready_check", 0), retry("j1", "ready_check", 3), retry("j1", "piesa", 3), retry("j2", "ready_check", 3), uncertain("j1", "ready_check", 4, "c2"), retry("j1", "ready_check", 7)];
    const c = collectFailureCases(events, NOW).find((x) => x.jobId === "j1" && x.kind === "ready_check")!;
    expect(retriesFor(events, c)).toEqual([{ at: at(3) }, { at: at(7) }]);
  });
  test("ignores retries from before an earlier, resolved run", () => {
    const events = [uncertain("j1", "ready_check", 0), retry("j1", "ready_check", 3), ev("j1", RETRY_LINKED_EVENT, 4, { kind: "ready_check" }), uncertain("j1", "ready_check", 10, "c2")];
    const c = collectFailureCases(events, NOW)[0]!;
    expect(retriesFor(events, c)).toEqual([]);
  });
});

describe("matchAudits", () => {
  const want = { templateId: "t1", mittiOwnerUserId: "u1", jobNumber: "HV-3519", siteAddress: "12 Smith St, Reid ACT", homeownerName: "Jo Citizen" };
  const audit = (o: Record<string, unknown> = {}) => ({ templateId: "t1", mittiOwnerUserId: "u1", jobNumber: "HV-3519", siteAddress: null, homeownerName: null, ...o });
  test("none for no audits", () => expect(matchAudits([], want)).toBe("none"));
  test("one match on job number", () => expect(matchAudits([audit()], want)).toBe("one"));
  test("ignores other jobs' forms, other templates and other owners", () => {
    expect(matchAudits([audit({ jobNumber: "HV-9999" }), audit({ templateId: "t2" }), audit({ mittiOwnerUserId: "u2" })], want)).toBe("none");
  });
  test("A1 form without a job number matches on address and name", () => {
    const a1 = audit({ jobNumber: null, siteAddress: "  12 SMITH st,  Reid ACT. ", homeownerName: "jo   citizen" });
    expect(matchAudits([a1], want)).toBe("one");
    expect(matchAudits([audit({ jobNumber: null, siteAddress: "13 Smith St, Reid ACT", homeownerName: "Jo Citizen" })], want)).toBe("none");
    expect(matchAudits([audit({ jobNumber: null, siteAddress: "12 Smith St, Reid ACT", homeownerName: "Someone Else" })], want)).toBe("none");
  });
  test("blank address and name never match", () => {
    expect(matchAudits([audit({ jobNumber: null })], { ...want, siteAddress: "", homeownerName: "" })).toBe("none");
  });
  test("2 matches gives many", () => expect(matchAudits([audit(), audit()], want)).toBe("many"));
});

describe("alertEmail", () => {
  const input = { jobNumber: "HV-3519", address: "12 Smith St <Reid>", kind: "ready_check" as const, tradeName: "Sam & Co", tradeEmail: "sam@example.com", bookingAt: "2026-11-03T23:00:00.000Z", error: "Mitti said \"no\"", jobUrl: "https://app.example.com/jobs/1" };
  test("exact subject and body facts", () => {
    const m = alertEmail(input);
    expect(m.subject).toBe("Mitti form not made: HV-3519 (Ready Check)");
    for (const s of ["HV-3519", "12 Smith St <Reid>", "sam@example.com", "Mitti said \"no\"", "https://app.example.com/jobs/1"]) expect(m.text).toContain(s);
  });
  test("booking time is Melbourne local", () => expect(alertEmail(input).text).toContain("10:00"));
  test("html escapes user text", () => {
    const h = alertEmail(input).html;
    expect(h).toContain("12 Smith St &lt;Reid&gt;");
    expect(h).toContain("Sam &amp; Co");
    expect(h).not.toContain("<Reid>");
  });
  test("kind labels and missing values", () => {
    expect(alertEmail({ ...input, kind: "piesa" }).subject).toContain("(PIESA)");
    expect(alertEmail({ ...input, kind: "fixes" }).subject).toContain("(Electrical fixes)");
    const m = alertEmail({ ...input, kind: "install_day", tradeName: null, tradeEmail: null, bookingAt: null });
    expect(m.subject).toContain("(Install day)");
    expect(m.text).not.toContain("null");
  });
});
