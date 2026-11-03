// Part 7 Task 5 (decision #47, Jo 2 Nov 2026): the "Install tomorrow" text goes to the picked Lead Installer's OWN mobile
// with the approved wording — straight to the safety plan (the Lead's own sign link) and the Mitti install form (the real
// audit's URL), never the portal, never the boss's number, never other people's links. Held with a plain reason when it
// can't go (no Lead, no mobile, no install form). In-memory PostgREST; the real sender is faked and watched.
import { beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import { readFileSync } from "node:fs";
import { brandSmsBody } from "../src/lib/sms.core";
import { INSTALLER_TEXT_EVENT, INSTALL_TOMORROW_FROM_HM, installTomorrowKey, installTomorrowText } from "../src/lib/installer-texts.core";

setSystemTime(new Date("2026-11-12T06:00:00Z")); // 5pm Melbourne on 12 Nov: the afternoon before a 13 Nov install

describe("installTomorrowText — decision #47, verbatim", () => {
  test("the approved sentence with both links; the sender adds the brand prefix", () => {
    const body = brandSmsBody(installTomorrowText({ startIso: "2026-11-12T20:30:00Z", address: "12 Example St, Box Hill", jobNumber: "HV-1234", safetyPlanLink: "https://p/sp/abc", mittiLink: "https://app.au.safetyculture.com/inspection/A5" }));
    expect(body).toBe("Home Insulation Victoria: Install tomorrow 7:30am, 12 Example St, Box Hill (HV-1234). Safety plan: https://p/sp/abc Mitti form: https://app.au.safetyculture.com/inspection/A5");
    const decided = readFileSync("docs/hiv-touchpoint-decisions-2026-11-02.md", "utf8");
    expect(decided).toContain('"Home Insulation Victoria: Install tomorrow {time}, {address} ({HV}). Safety plan: {link} Mitti form: {link}"');
    expect(INSTALL_TOMORROW_FROM_HM).toBe("16:00");
  });
});

// ── the sender ────────────────────────────────────────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
function from(t: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "insert" = "select";
  let inserted: Row | null = null;
  const res = () => (op === "insert" ? { data: inserted ? { id: inserted["id"] } : null, error: null } : { data: (tables[t] ?? []).filter((x) => filters.every((f) => f(x))), error: null });
  const one = async () => { const r = res(); return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; };
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => q,
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
    neq: (k: string, v: unknown) => { filters.push((r) => r[k] !== v); return q; },
    is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return q; },
    in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return q; },
    contains: (k: string, v: Row) => { filters.push((r) => Object.entries(v).every(([kk, vv]) => (r[k] as Row | undefined)?.[kk] === vv)); return q; },
    not: () => q, gt: () => q, gte: () => q, lt: () => q, lte: () => q, or: () => q, order: () => q, limit: () => q,
    insert: (r: Row) => { op = "insert"; inserted = { id: crypto.randomUUID(), ...r }; (tables[t] ??= []).push(inserted); return q; },
    maybeSingle: one, single: one,
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(res()).then(ok, bad),
  });
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class WorkflowError extends Error {},
  logEvent: async (job_id: string, _a: unknown, event_type: string, summary: string, details: Row = {}) => { (tables["workflow_events"] ??= []).push({ id: crypto.randomUUID(), job_id, event_type, summary, details, created_at: new Date().toISOString() }); },
}));
mock.module("../src/lib/in-house-suppression.server", () => ({ inHouseDispatchSkip: async () => null }));
let lead: { workerId: string; name: string; mobile: string | null } | null = { workerId: "w1", name: "John Smith", mobile: "0412 345 678" };
mock.module("../src/lib/visit-allocation.server", () => ({ allocatedPersonFor: async (_j: string, kind: string) => (kind === "install" ? lead : null) }));
let auditId: string | null = "A5AUD";
mock.module("../src/lib/daily-mitti-text.server", () => ({ bookingFormAuditId: async (_j: string, kind: string) => (kind === "installation" ? auditId : null) }));
const minted: { jobId: string; key: string; via: unknown }[] = [];
mock.module("../src/lib/swms-link.server", () => ({
  swmsSignLink: async (jobId: string, key: string, _now: number, via?: "lead") => { minted.push({ jobId, key, via }); return `https://p/sp/${key}`; },
  unsignedSwmsSignerLinks: async () => { throw new Error("must not be used by the install-tomorrow text any more"); },
}));
const sent: { type: string; key: string; to: string | null; body: string; jobId: string | undefined; businessId: string | undefined }[] = [];
mock.module("../src/lib/sms.server", () => ({ sendRealSms: async (p: { type: string; idempotencyKey: string; to: string | null; body: string; jobId?: string; businessId?: string }) => { sent.push({ type: p.type, key: p.idempotencyKey, to: p.to, body: p.body, jobId: p.jobId, businessId: p.businessId }); return { status: "sent", detail: "faked" }; } }));
const testSent: { to: string; body: string }[] = [];
mock.module("../src/lib/test-send.server", () => ({ sendTestSms: async (_m: unknown, to: string, body: string) => { testSent.push({ to, body }); return { status: "sent", detail: "test" }; } }));
mock.module("../src/lib/set-password-link.core", () => ({ SET_PASSWORD_BASE: "https://p" }));

const { textInstallerInstallTomorrow } = await import("../src/lib/installer-texts.server");
const BOOKING = { id: "BK1", scheduled_start: "2026-11-12T20:30:00Z" }; // 7:30am 13 Nov Melbourne
const KEY = installTomorrowKey("J1", "BK1", BOOKING.scheduled_start);
const events = (type: string) => (tables["workflow_events"] ?? []).filter((e) => e["event_type"] === type);

beforeEach(() => {
  sent.length = 0; testSent.length = 0; minted.length = 0;
  lead = { workerId: "w1", name: "John Smith", mobile: "0412 345 678" };
  auditId = "A5AUD";
  tables = {
    jobs: [{ id: "J1", job_number: "HV-1234", source: "website", channel: "hivic_sourced", deleted_at: null, properties: { address_line: "12 Example St", suburb: "Box Hill" } }],
    job_assignments: [{ job_id: "J1", role: "installer", active: true, business_id: "B1" }],
    businesses: [{ id: "B1", name: "Rapid Insulation", signer_mobile: "0499 000 111", phone: "03 9000 0000", onboarding_notes: null }],
    workflow_events: [],
  };
});

describe("textInstallerInstallTomorrow — to the Lead Installer only", () => {
  test("sent to the Lead's own mobile with the approved wording, the Lead's OWN sign link and the real Mitti audit url; key unchanged; prepared event first", async () => {
    expect(await textInstallerInstallTomorrow("J1", BOOKING)).toBe("installer sms sent: faked");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "install_tomorrow", key: KEY, to: "0412 345 678", jobId: "J1", businessId: "B1" });
    expect(KEY).toBe("install-tomorrow:v1:J1:BK1:2026-11-13");
    const { mittiFormUrl } = await import("../src/lib/mitti-link.core");
    // The real sender (sendRealSms, faked here) adds the brand prefix itself (brandSmsBody), as for every installer text.
    expect(brandSmsBody(sent[0]!.body)).toBe(`Home Insulation Victoria: Install tomorrow 7:30am, 12 Example St, Box Hill (HV-1234). Safety plan: https://p/sp/w:w1 Mitti form: ${mittiFormUrl("A5AUD")}`);
    expect(minted).toEqual([{ jobId: "J1", key: "w:w1", via: undefined }]); // the Lead's own token, minted now, not via lead
    expect(sent[0]!.body).not.toContain("/field/"); // never the portal job page
    expect(sent[0]!.body.match(/https?:\/\//g)).toHaveLength(2); // no other crew members' links
    const prepared = events(INSTALLER_TEXT_EVENT);
    expect(prepared).toHaveLength(1);
    expect(prepared[0]!["details"]).toMatchObject({ text: "install_tomorrow", key: KEY, booking_id: "BK1", recipient: "w:w1" });
    expect(events("install_tomorrow_held")).toHaveLength(0);
  });
  test("a second run is 'already handled' (same key) — also for an install that already got the old-wording text under that key", async () => {
    tables["workflow_events"]!.push({ id: "old", job_id: "J1", event_type: INSTALLER_TEXT_EVENT, summary: "old text", details: { text: "install_tomorrow", key: KEY } });
    expect(await textInstallerInstallTomorrow("J1", BOOKING)).toBe("already handled");
    expect(sent).toHaveLength(0);
  });
  test("no Lead picked → 'no lead installer': nothing sent, never the boss's signer_mobile or phone, held once", async () => {
    lead = null;
    expect(await textInstallerInstallTomorrow("J1", BOOKING)).toBe("no lead installer");
    expect(await textInstallerInstallTomorrow("J1", BOOKING)).toBe("no lead installer");
    expect(sent).toHaveLength(0); expect(testSent).toHaveLength(0);
    expect(JSON.stringify(sent)).not.toContain("0499 000 111");
    expect(events(INSTALLER_TEXT_EVENT)).toHaveLength(0);
    const held = events("install_tomorrow_held");
    expect(held).toHaveLength(1);
    expect(held[0]!["details"]).toMatchObject({ reason: "no lead installer", key: KEY, booking_id: "BK1" });
  });
  test("Lead with no mobile → 'lead installer has no mobile': nothing sent (not to the boss either), held once", async () => {
    lead = { workerId: "w1", name: "John Smith", mobile: null };
    expect(await textInstallerInstallTomorrow("J1", BOOKING)).toBe("lead installer has no mobile");
    expect(await textInstallerInstallTomorrow("J1", BOOKING)).toBe("lead installer has no mobile");
    expect(sent).toHaveLength(0);
    expect(events("install_tomorrow_held")).toHaveLength(1);
    expect(events("install_tomorrow_held")[0]!["details"]).toMatchObject({ reason: "lead installer has no mobile" });
    expect(minted).toHaveLength(0);
  });
  test("install form not made yet → 'install form not ready': held, no guessed link; once the form exists the text goes under the same key", async () => {
    auditId = null;
    expect(await textInstallerInstallTomorrow("J1", BOOKING)).toBe("install form not ready");
    expect(sent).toHaveLength(0);
    expect(events("install_tomorrow_held")).toHaveLength(1);
    expect(events(INSTALLER_TEXT_EVENT)).toHaveLength(0); // the key is not claimed by a hold
    auditId = "A5AUD";
    expect(await textInstallerInstallTomorrow("J1", BOOKING)).toBe("installer sms sent: faked");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.key).toBe(KEY);
  });
  test("not due yet (two days before, or the install morning) → nothing, no hold", async () => {
    setSystemTime(new Date("2026-11-11T06:00:00Z"));
    expect(await textInstallerInstallTomorrow("J1", BOOKING)).toBe("not due");
    setSystemTime(new Date("2026-11-12T06:00:00Z"));
    expect(sent).toHaveLength(0); expect(events("install_tomorrow_held")).toHaveLength(0);
  });
  test("TEST job → the test sender, same recipient rule (the Lead's mobile), never the real sender", async () => {
    tables["jobs"]![0]!["source"] = "qa_test";
    expect(await textInstallerInstallTomorrow("J1", BOOKING)).toBe("installer sms (test) sent: test");
    expect(sent).toHaveLength(0);
    expect(testSent).toEqual([{ to: "0412 345 678", body: expect.stringContaining("Safety plan: https://p/sp/w:w1 Mitti form: ") }]);
  });
  test("source: the sender no longer lists other people's links or falls back to the boss; recorded before deliver; keeps the real-sender path", () => {
    const srv = readFileSync("src/lib/installer-texts.server.ts", "utf8");
    const start = srv.indexOf("export async function textInstallerInstallTomorrow");
    const body = srv.slice(start, srv.indexOf("export async function", start + 10));
    for (const gone of ["withSafetyPlanLinks", "dailyTextRecipient", "unsignedSwmsSignerLinks", "jobLink(jobId)", "signer_mobile", "biz?.phone"]) expect(body, gone).not.toContain(gone);
    for (const kept of ['allocatedPersonFor(jobId, "install")', "swmsSignLink(", 'bookingFormAuditId(jobId, "installation")', "mittiFormUrl(", "logEvent(", "return deliver("]) expect(body, kept).toContain(kept);
    expect(body.indexOf("return deliver(")).toBeGreaterThan(body.indexOf("INSTALLER_TEXT_EVENT"));
  });
});
