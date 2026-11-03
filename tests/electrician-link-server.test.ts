// New job flow, Part 6, Task 2: the electrician's no-login job link — minted on allocation, texted behind approval, and
// the token-only view behind /e/$token. The REAL server module runs against an in-memory database; nothing is sent.
// Own file: it mocks modules for the whole process.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const J = "00000000-0000-4000-8000-0000000000a1", INST = "00000000-0000-4000-8000-0000000000b1", ELEC = "00000000-0000-4000-8000-0000000000b2";
const W = "00000000-0000-4000-8000-0000000000c1", W2 = "00000000-0000-4000-8000-0000000000c2", USER = "00000000-0000-4000-8000-0000000000d1";
const DAY = 86_400_000;
const NOW = Date.parse("2026-11-03T02:00:00.000Z");

const tables: Tables = {};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => memoryPostgrest(tables).from(t), rpc: async () => ({ data: false, error: null }) } }));

const core = await import("../src/lib/electrician-link.core");
const server = await import("../src/lib/electrician-link.server");
const { hashToken } = await import("../src/lib/worker-links.core");

function seed(over: { source?: string; piesaBookedBy?: string | null } = {}) {
  for (const k of Object.keys(tables)) delete tables[k];
  tables["properties"] = [{ id: "p1", address_line: "12 Smith St, Kew", suburb: "Kew" }];
  tables["jobs"] = [{ id: J, job_number: "HV-5001", source: over.source ?? "website", stage: "piesa_scheduled", property_id: "p1", deleted_at: null }];
  tables["businesses"] = [
    { id: INST, name: "Smith Insulation", trading_name: "Smith Insulation Pty Ltd", phone: "03 9000 0001", email: "office@smith.test", onboarding_notes: null, piesa_booked_by: "piesaBookedBy" in over ? over.piesaBookedBy : "electrician" },
    { id: ELEC, name: "Spark Co", trading_name: null, phone: "03 9000 0002", email: "office@spark.test", onboarding_notes: null },
  ];
  tables["job_assignments"] = [
    { id: "a1", job_id: J, business_id: INST, role: "installer", active: true, user_id: null },
    { id: "a2", job_id: J, business_id: ELEC, role: "electrician", active: true, user_id: USER },
  ];
  tables["partner_workers"] = [
    { id: W, business_id: ELEC, full_legal_name: "Sam Spark", mobile: "0422 222 222", trade_role: "electrician", approval_status: "approved", removed_at: null, profile_id: USER },
    { id: W2, business_id: ELEC, full_legal_name: "Other Person", mobile: "0433 333 333", trade_role: "electrician", approval_status: "approved", removed_at: null, profile_id: "u2" },
  ];
  tables["worker_job_links"] = [];
  tables["contact_releases"] = [{ id: "r1", job_id: J, assignment_id: "a2", visit_kind: "piesa", revoked_at: null }];
  tables["job_overview"] = [{ id: J, owner_name: "Helen Owner", owner_phone: "0411 111 111", property_address: "12 Smith St, Kew VIC 3101" }];
  tables["bookings"] = [];
  tables["assessments"] = [{ id: "as1", job_id: J, external_mitti_id: "audit-a3", completed_at: null, piesa_outcome: "pending", mitti_raw_snapshot: null }];
  tables["workflow_events"] = [];
  tables["documents"] = [];
}
beforeEach(() => seed());

const linkRow = () => tables["worker_job_links"]![0]!;
async function mint() { return server.mintElectricianLink(J, W, "actor-1", NOW); }

describe("mintElectricianLink", () => {
  test("stores only the token hash and returns {SET_PASSWORD_BASE}/e/{token}", async () => {
    const { token, url } = await mint();
    expect(url).toBe(`https://estimate.homeinsulationvictoria.com.au/e/${token}`);
    const row = linkRow();
    expect(row["token_hash"]).toBe(await hashToken(token));
    expect(JSON.stringify(tables["worker_job_links"])).not.toContain(token);
    expect(row).toMatchObject({ worker_id: W, business_id: ELEC, job_id: J, created_by: "actor-1" });
  });
  test("a second mint revokes the first", async () => {
    const a = await mint();
    const b = await mint();
    expect(a.token).not.toBe(b.token);
    const [first, second] = tables["worker_job_links"]!;
    expect(first!["revoked_at"]).toBeTruthy();
    expect(second!["revoked_at"] ?? null).toBeNull();
  });
  test("refuses a worker whose business is not the job's electrician", async () => {
    tables["job_assignments"]![1]!["active"] = false;
    await expect(mint()).rejects.toThrow();
    expect(tables["worker_job_links"]).toHaveLength(0);
  });
});

describe("electricianLinkView", () => {
  test("shows the business, installer, job, owner contact and the step", async () => {
    const { token } = await mint();
    const v = await server.electricianLinkView(token, NOW);
    expect(v).toMatchObject({ business: "Spark Co", firstName: "Sam", installer: "Smith Insulation Pty Ltd", jobNumber: "HV-5001", address: "12 Smith St, Kew VIC 3101", owner: { name: "Helen Owner", phone: "0411 111 111" } });
    expect(v.view.step).toBe("book_piesa");
    expect(v.view.canBook).toBe(true);
  });
  test("owner name, phone and address are null when there is no current release", async () => {
    tables["contact_releases"]![0]!["revoked_at"] = "2026-11-01T00:00:00Z";
    const { token } = await mint();
    const v = await server.electricianLinkView(token, NOW);
    expect(v.owner).toBeNull();
    expect(v.address).toBeNull();
    expect(JSON.stringify(v)).not.toContain("Helen");
    expect(JSON.stringify(v)).not.toContain("0411");
  });
  test("a release for another business's assignment does not count", async () => {
    tables["contact_releases"]![0]!["assignment_id"] = "a1";
    const { token } = await mint();
    expect((await server.electricianLinkView(token, NOW)).owner).toBeNull();
  });
  test("an unknown or badly shaped token is not valid", async () => {
    await expect(server.electricianLinkView("short", NOW)).rejects.toThrow("This link isn't valid.");
    await expect(server.electricianLinkView("a".repeat(43), NOW)).rejects.toThrow("This link isn't valid.");
  });
  test("a revoked link says it was switched off", async () => {
    const { token } = await mint();
    linkRow()["revoked_at"] = "2026-11-02T00:00:00Z";
    await expect(server.electricianLinkView(token, NOW)).rejects.toThrow("This link has been switched off. Ask Smith Insulation Pty Ltd for a new one.");
  });
  test("an expired link says it expired", async () => {
    const { token } = await mint();
    linkRow()["expires_at"] = new Date(NOW - 1000).toISOString();
    await expect(server.electricianLinkView(token, NOW)).rejects.toThrow("This link has expired. Ask Smith Insulation Pty Ltd for a new one.");
  });
  test("a job no longer assigned to that electrician is switched off", async () => {
    const { token } = await mint();
    tables["job_assignments"]![1]!["active"] = false;
    await expect(server.electricianLinkView(token, NOW)).rejects.toThrow("This link has been switched off.");
  });
  test("a removed or unapproved worker is switched off", async () => {
    const { token } = await mint();
    tables["partner_workers"]![0]!["removed_at"] = "2026-11-02T00:00:00Z";
    await expect(server.electricianLinkView(token, NOW)).rejects.toThrow("This link has been switched off.");
  });
  test("the job moved to a different electrician (same business, other person) is switched off", async () => {
    const { token } = await mint();
    tables["job_assignments"]![1]!["user_id"] = "u2";
    await expect(server.electricianLinkView(token, NOW)).rejects.toThrow("This link has been switched off.");
  });

  test("before All done every open pushes the expiry to now + 60 days and counts the open", async () => {
    const { token } = await mint();
    linkRow()["expires_at"] = new Date(NOW + DAY).toISOString();
    await server.electricianLinkView(token, NOW);
    expect(linkRow()["expires_at"]).toBe(new Date(NOW + 60 * DAY).toISOString());
    expect(linkRow()["open_count"]).toBe(1);
    expect(linkRow()["last_opened_at"]).toBeTruthy();
  });
  test("after All done the expiry is All done + 14 days and is not pushed again", async () => {
    const { token } = await mint();
    const doneAt = new Date(NOW - 2 * DAY).toISOString();
    tables["assessments"]![0] = { ...tables["assessments"]![0]!, completed_at: doneAt, piesa_outcome: "pass" };
    const v = await server.electricianLinkView(token, NOW);
    expect(v.view.step).toBe("all_done");
    const want = new Date(NOW - 2 * DAY + 14 * DAY).toISOString();
    expect(linkRow()["expires_at"]).toBe(want);
    await server.electricianLinkView(token, NOW + 3 * DAY);
    expect(linkRow()["expires_at"]).toBe(want);
  });
  test("more than 14 days after All done the link has expired", async () => {
    const { token } = await mint();
    tables["assessments"]![0] = { ...tables["assessments"]![0]!, completed_at: new Date(NOW - 15 * DAY).toISOString(), piesa_outcome: "pass" };
    await expect(server.electricianLinkView(token, NOW)).rejects.toThrow("This link has expired.");
  });

  test("who books comes from the installer's setting, read fresh: office means no booking step", async () => {
    seed({ piesaBookedBy: "office" });
    const { token } = await mint();
    const v = await server.electricianLinkView(token, NOW);
    expect(v.view).toMatchObject({ step: "waiting_office_book", canBook: false });
  });
  test("a setting that is missing or unknown fails closed to office", async () => {
    seed({ piesaBookedBy: null });
    const { token } = await mint();
    expect((await server.electricianLinkView(token, NOW)).view.canBook).toBe(false);
  });
  test("the booked safety check day shows with its Mitti form button", async () => {
    tables["bookings"]!.push({ id: "b1", job_id: J, kind: "assessment", status: "confirmed", scheduled_start: "2026-11-06T23:00:00Z" });
    const { token } = await mint();
    const v = await server.electricianLinkView(token, NOW);
    expect(v.view.step).toBe("piesa_day");
    expect(v.buttonUrl).toBe("https://app.au.safetyculture.com/inspection/audit-a3");
  });
  test("A3 failed with upgrades booked: upgrades day shows with the A4 form; the day is returned", async () => {
    tables["assessments"]![0] = { ...tables["assessments"]![0]!, completed_at: "2026-11-05T01:00:00Z", piesa_outcome: "fail" };
    tables["bookings"]!.push({ id: "b2", job_id: J, kind: "rectification", status: "confirmed", scheduled_start: "2026-11-09T23:00:00Z" });
    tables["workflow_events"]!.push({ id: "e1", job_id: J, event_type: "fixes_form_created", created_at: "2026-11-05T02:00:00Z", details: { audit_id: "audit-a4" } });
    const { token } = await mint();
    const v = await server.electricianLinkView(token, NOW);
    expect(v.view.step).toBe("upgrades_day");
    expect(v.upgradesDay).toBe("2026-11-09T23:00:00Z");
    expect(v.buttonUrl).toBe("https://app.au.safetyculture.com/inspection/audit-a4");
  });
  test("the Certificate of Electrical Safety in means All done", async () => {
    tables["assessments"]![0] = { ...tables["assessments"]![0]!, completed_at: "2026-11-05T01:00:00Z", piesa_outcome: "fail" };
    tables["workflow_events"]!.push({ id: "e1", job_id: J, event_type: "fixes_form_created", created_at: "2026-11-05T02:00:00Z", details: { audit_id: "audit-a4" } }, { id: "e2", job_id: J, event_type: "fixes_form_completed", created_at: "2026-11-06T02:00:00Z", details: { audit_id: "audit-a4" } });
    const { token } = await mint();
    expect((await server.electricianLinkView(token, NOW)).view.step).toBe("upload_certificate");
    tables["documents"]!.push({ id: "d1", job_id: J, kind: "piesa_evidence", title: "PIESA evidence – Certificate of Electrical Safety (photo or PDF)", created_at: "2026-11-07T01:00:00Z" });
    expect((await server.electricianLinkView(token, NOW)).view.step).toBe("all_done");
  });
  test("a cancelled job shows the handed-back card", async () => {
    tables["jobs"]![0]!["stage"] = "cancelled";
    const { token } = await mint();
    expect((await server.electricianLinkView(token, NOW)).view.step).toBe("closed");
  });
  test("a cancelled job's link ends 14 days after the close and is not renewed on open", async () => {
    tables["jobs"]![0]!["stage"] = "cancelled";
    tables["jobs"]![0]!["updated_at"] = new Date(NOW - 2 * DAY).toISOString();
    const { token } = await mint();
    await server.electricianLinkView(token, NOW);
    const want = new Date(NOW - 2 * DAY + 14 * DAY).toISOString();
    expect(linkRow()["expires_at"]).toBe(want);
    await server.electricianLinkView(token, NOW + 3 * DAY);
    expect(linkRow()["expires_at"]).toBe(want);
    await expect(server.electricianLinkView(token, NOW + 13 * DAY)).rejects.toThrow("This link has expired.");
  });
  test("a database error never reaches the page: the generic message comes back", async () => {
    const { token } = await mint();
    const real = tables["job_overview"];
    // Make the owner read fail by swapping in a table the memory db errors on.
    const mod = await import("@/integrations/supabase/client.server");
    const orig = mod.supabaseAdmin.from;
    (mod.supabaseAdmin as any).from = (t: string) => t === "job_overview" ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'relation "secret_table" does not exist' } }) }) }) } : orig(t);
    try {
      await expect(server.electricianLinkView(token, NOW)).rejects.toThrow("This link isn't valid.");
      await server.electricianLinkView(token, NOW).catch((e: Error) => expect(e.message).not.toContain("secret_table"));
    } finally { (mod.supabaseAdmin as any).from = orig; tables["job_overview"] = real; }
  });
  test("never returns prices or other businesses' contact details", async () => {
    const { token } = await mint();
    const s = JSON.stringify(await server.electricianLinkView(token, NOW));
    expect(s).not.toContain("office@smith.test");
    expect(s).not.toContain("03 9000");
    expect(s).not.toMatch(/price|\$/i);
  });
});

describe("textElectricianLink", () => {
  const URL = "https://estimate.homeinsulationvictoria.com.au/e/abc";
  function deps(over: Record<string, unknown> = {}) {
    const sent: { type: string; key: string; to: string | null | undefined; body: string }[] = [];
    const tested: { to: string; body: string }[] = [];
    const recorded: { type: string; key: string }[] = [];
    return {
      sent, tested, recorded,
      d: {
        approved: true,
        sendSms: async (i: { type: string; idempotencyKey: string; to: string | null | undefined; body: string }) => { sent.push({ type: i.type, key: i.idempotencyKey, to: i.to, body: i.body }); return { status: "sent" as const, detail: "ok", sid: "SM1" }; },
        sendTestSms: async (to: string, body: string) => { tested.push({ to, body }); return { status: "sent", detail: "ok" }; },
        record: async (_jobId: string, type: string, _summary: string, details: Record<string, unknown>) => { recorded.push({ type, key: String(details["key"]) }); tables["workflow_events"]!.push({ id: `ev${recorded.length}`, job_id: J, event_type: type, details }); },
        ...over,
      },
    };
  }
  test("the flag is off by default and nothing is sent", async () => {
    expect(core.ELECTRICIAN_LINK_TEXT_APPROVED).toBe(false);
    const x = deps({ approved: core.ELECTRICIAN_LINK_TEXT_APPROVED });
    expect(await server.textElectricianLink(J, W, URL, x.d)).toBe("held");
    expect(x.sent).toHaveLength(0);
    expect(x.tested).toHaveLength(0);
    expect(x.recorded).toHaveLength(0);
  });
  test("a real job sends the DRAFT text once through the real sender, to the electrician's mobile", async () => {
    const x = deps();
    expect(await server.textElectricianLink(J, W, URL, x.d)).toBe("sent");
    expect(x.sent).toEqual([{ type: "electrician_job_link", key: `electrician-link:v1:${J}:${W}`, to: "0422 222 222", body: `Home Insulation Victoria: New PIESA job HV-5001, Kew, for Smith Insulation Pty Ltd. Your job link: ${URL}` }]);
    expect(x.tested).toHaveLength(0);
  });
  test("a TEST job goes to the test sender once, never the real one", async () => {
    seed({ source: "qa_test" });
    const x = deps();
    expect(await server.textElectricianLink(J, W, URL, x.d)).toBe("test_sent");
    expect(x.tested).toHaveLength(1);
    expect(x.sent).toHaveLength(0);
  });
  test("the same key twice sends once", async () => {
    const x = deps();
    expect(await server.textElectricianLink(J, W, URL, x.d)).toBe("sent");
    expect(await server.textElectricianLink(J, W, URL, x.d)).toBe("held");
    expect(x.sent).toHaveLength(1);
    expect(x.recorded).toHaveLength(1);
  });
  test("no mobile on file means nothing is sent", async () => {
    tables["partner_workers"]![0]!["mobile"] = " ";
    const x = deps();
    expect(await server.textElectricianLink(J, W, URL, x.d)).toBe("no_mobile");
    expect(x.sent).toHaveLength(0);
  });
  test("a send the sender holds (quiet hours, comms off) is reported held", async () => {
    const x = deps({ sendSms: async () => ({ status: "blocked", detail: "Messages are switched off", sid: null }) });
    expect(await server.textElectricianLink(J, W, URL, x.d)).toBe("held");
  });
  test("the SMS type is a worker/electrician (partner) text, wording not approved, quiet hours on", async () => {
    const { SMS_MESSAGE_TYPES } = await import("../src/lib/sms.core");
    expect(SMS_MESSAGE_TYPES["electrician_job_link"]).toMatchObject({ audience: "partner", wordingApproved: false, quietHours: true });
  });
});

describe("linkAfterAllocation", () => {
  const mk = () => {
    const sent: string[] = [];
    const events: string[] = [];
    return { sent, events, over: {
      approved: true,
      sendSms: async (i: { body: string }) => { sent.push(i.body); return { status: "sent" as const, detail: "ok", sid: "SM1" }; },
      sendTestSms: async () => ({ status: "sent", detail: "ok" }),
      record: async (_j: string, type: string, _s: string, details: Record<string, unknown>) => { events.push(type); tables["workflow_events"]!.push({ id: `e${events.length}`, job_id: J, event_type: type, details }); },
    } };
  };
  test("mints one link and texts its url", async () => {
    const x = mk();
    const r = await server.linkAfterAllocation(J, W, "actor-1", x.over);
    expect(r).toBe("sent");
    expect(tables["worker_job_links"]).toHaveLength(1);
    expect(x.sent[0]).toContain("/e/");
  });
  test("a retry for the same person keeps the link they already have", async () => {
    const x = mk();
    await server.linkAfterAllocation(J, W, "actor-1", x.over);
    const before = linkRow()["token_hash"];
    expect(await server.linkAfterAllocation(J, W, "actor-1", x.over)).toBe("already_has_link");
    expect(tables["worker_job_links"]).toHaveLength(1);
    expect(linkRow()["token_hash"]).toBe(before);
    expect(linkRow()["revoked_at"] ?? null).toBeNull();
  });
  test("a failing text never fails the allocation and is logged on the job", async () => {
    const x = mk();
    const r = await server.linkAfterAllocation(J, W, "actor-1", { ...x.over, sendSms: async () => { throw new Error("gateway down"); } });
    expect(r).toBe("text_failed");
    expect(x.events).toContain("electrician_link_text_failed");
    expect(tables["worker_job_links"]).toHaveLength(1);
  });
  test("a failing mint never throws either", async () => {
    const x = mk();
    tables["job_assignments"]![1]!["active"] = false;
    expect(await server.linkAfterAllocation(J, W, "actor-1", x.over)).toBe("link_failed");
    expect(x.events).toContain("electrician_link_text_failed");
  });
  test("held while the flag is off, a later retry with the flag on texts the link once", async () => {
    const x = mk();
    expect(await server.linkAfterAllocation(J, W, "actor-1", { ...x.over, approved: false })).toBe("held");
    expect(x.sent).toHaveLength(0);
    const sentOver = { ...x.over, record: async (_j: string, type: string, _s: string, details: Record<string, unknown>) => { x.events.push(type); tables["workflow_events"]!.push({ id: `e${x.events.length}`, job_id: J, event_type: type, details }); } };
    expect(await server.linkAfterAllocation(J, W, "actor-1", sentOver)).toBe("sent");
    expect(x.sent).toHaveLength(1);
    const live = tables["worker_job_links"]!.filter((l) => !l["revoked_at"]);
    expect(live).toHaveLength(1);
    expect(x.sent[0]).toContain("/e/");
    expect(await server.linkAfterAllocation(J, W, "actor-1", sentOver)).toBe("already_has_link");
    expect(x.sent).toHaveLength(1);
  });
  test("a link that was already texted is never re-minted", async () => {
    const x = mk();
    const over = { ...x.over, record: async (_j: string, type: string, _s: string, details: Record<string, unknown>) => { tables["workflow_events"]!.push({ id: `e${tables["workflow_events"]!.length}`, job_id: J, event_type: type, details }); } };
    expect(await server.linkAfterAllocation(J, W, "actor-1", over)).toBe("sent");
    const hash = linkRow()["token_hash"];
    expect(await server.linkAfterAllocation(J, W, "actor-1", over)).toBe("already_has_link");
    expect(tables["worker_job_links"]).toHaveLength(1);
    expect(linkRow()["token_hash"]).toBe(hash);
  });
  test("the stored copy of the text hides the link, the provider gets the real one", async () => {
    const seen: { body: string; storedBody?: string }[] = [];
    const x = mk();
    await server.linkAfterAllocation(J, W, "actor-1", { ...x.over, sendSms: async (i: any) => { seen.push({ body: i.body, storedBody: i.storedBody }); return { status: "sent" as const, detail: "ok", sid: "S" }; } });
    expect(seen[0]!.body).toMatch(/\/e\/[A-Za-z0-9_-]{20,}/);
    expect(seen[0]!.storedBody).toContain("/e/••••");
    expect(seen[0]!.storedBody).not.toMatch(/\/e\/[A-Za-z0-9_-]{8,}/);
  });
  test("allocateElectrician calls it after the atomic assignment succeeds", () => {
    const src = readFileSync("src/lib/in-house-electrician.server.ts", "utf8");
    const rpc = src.indexOf('db.rpc("allocate_team_electrician"');
    const call = src.indexOf("linkAfterAllocation");
    expect(rpc).toBeGreaterThan(0);
    expect(call).toBeGreaterThan(rpc);
    expect(src.slice(rpc, call)).toContain("if (r.error) throw");
  });
});

describe("electricianBusinessFor", () => {
  test("the assigned electrician's business office phone, never the worker's mobile", async () => {
    const c = await server.electricianBusinessFor(J);
    expect(c).toEqual({ name: "Spark Co", tradingName: null, officePhone: "03 9000 0002", email: "office@spark.test" });
    expect(JSON.stringify(c)).not.toContain("0422");
  });
  test("null when no electrician is assigned", async () => {
    tables["job_assignments"]![1]!["active"] = false;
    expect(await server.electricianBusinessFor(J)).toBeNull();
  });
});

describe("I3: a fresh link that keeps the one already in the phone until a send succeeded", () => {
  test("keepOlder: the first link stays active beside the new one; retireOlderElectricianLinks then revokes every other link for that person + job; revokeElectricianLink drops one", async () => {
    const first = await server.mintElectricianLink(J, W, null, NOW);
    const second = await server.mintElectricianLink(J, W, null, NOW + 1, { keepOlder: true });
    const live = () => tables["worker_job_links"]!.filter((l) => !l["revoked_at"]).map((l) => l["id"]);
    expect(live()).toHaveLength(2);
    expect((await server.electricianLinkView(first.token, NOW + 2)).jobNumber).toBe("HV-5001");
    expect((await server.electricianLinkView(second.token, NOW + 2)).jobNumber).toBe("HV-5001");
    await server.retireOlderElectricianLinks(J, W, second.id, NOW + 3);
    expect(live()).toEqual([second.id]);
    await expect(server.electricianLinkView(first.token, NOW + 4)).rejects.toThrow("switched off");
    const third = await server.mintElectricianLink(J, W, null, NOW + 5, { keepOlder: true });
    await server.revokeElectricianLink(third.id, NOW + 6);
    expect(live()).toEqual([second.id]);
  });
});
