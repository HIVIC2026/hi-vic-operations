// Mitti auto-invite on partner-person approval (decision 188): switch, TEST probe, eligibility, one invite per person.
import { describe, expect, test } from "bun:test";
import {
  MITTI_AUTO_INVITE_ENABLED, MITTI_DEFAULT_SEAT, MITTI_INVITE_EVENTS, MITTI_INVITE_MISSING_ENDPOINTS, inviteEligibility, inviteKey, mittiInviteStep,
  openInvites, priorInviteFor, type InvitePerson, type InviteRecord,
} from "../src/lib/mitti-invite.core";

const ON = { enabled: true, probeDone: true };
const installer: InvitePerson = { workerId: "w1", tradeRole: "installer", approvalStatus: "approved", removedAt: null, email: "lee@warmroofs.com.au", ciiCleared: true, mittiAccess: "not_found", isTest: false };
const electrician: InvitePerson = { ...installer, workerId: "w2", tradeRole: "electrician", ciiCleared: false, email: "sam@sparks.com.au" };

describe("switches", () => {
  test("off by default and a no-op when off", () => {
    expect(MITTI_AUTO_INVITE_ENABLED).toBe(false);
    expect(mittiInviteStep(installer, null, { enabled: false, probeDone: true })).toEqual({ action: "skip", reason: "Mitti auto-invite is switched off." });
  });
  test("TEST probe first: only TEST people until the probe is confirmed", () => {
    expect(mittiInviteStep(installer, null, { enabled: true, probeDone: false }).action).toBe("skip");
    expect(mittiInviteStep({ ...installer, isTest: true }, null, { enabled: true, probeDone: false }).action).toBe("lookup");
  });
});

describe("who is invited", () => {
  test("installers only once their CII is verified and current; electricians once approved", () => {
    expect(inviteEligibility(installer)).toBeNull();
    expect(inviteEligibility({ ...installer, ciiCleared: false })).toMatch(/CII/);
    expect(inviteEligibility(electrician)).toBeNull();
    expect(inviteEligibility({ ...electrician, approvalStatus: "pending" })).toMatch(/Not approved/);
    expect(inviteEligibility({ ...installer, removedAt: "2026-10-24T00:00:00Z" })).toMatch(/Removed/);
    expect(inviteEligibility({ ...installer, email: " " })).toMatch(/No email/);
    expect(inviteEligibility({ ...installer, tradeRole: "assessor" })).toMatch(/No Mitti group/);
  });
  test("right group by trade, lite seat by default", () => {
    const i = mittiInviteStep(installer, null, ON);
    expect(i).toEqual({ action: "lookup", group: "Installers", seat: MITTI_DEFAULT_SEAT, key: inviteKey("w1") });
    expect(MITTI_DEFAULT_SEAT).toBe("lite");
    expect(mittiInviteStep(electrician, null, ON)).toMatchObject({ action: "lookup", group: "Electricians" });
  });
});

describe("lookup → link or record 'invite needed'", () => {
  test("found in Mitti → link that user; not found → invite needed (no create endpoint)", () => {
    expect(mittiInviteStep(installer, null, ON, { mittiUserId: "user_9" })).toMatchObject({ action: "record_linked", mittiUserId: "user_9", group: "Installers" });
    expect(mittiInviteStep(installer, null, ON, { mittiUserId: null })).toMatchObject({ action: "record_needed", seat: "lite" });
    expect(MITTI_INVITE_MISSING_ENDPOINTS.join(" ")).toMatch(/Create a Mitti user.*group/s);
  });
  test("idempotent: never twice per person (seats are billed); already a member → nothing", () => {
    for (const type of Object.values(MITTI_INVITE_EVENTS)) expect(mittiInviteStep(installer, { type, at: "2026-10-24T00:00:00Z" }, ON, { mittiUserId: null }).action).toBe("skip");
    expect(mittiInviteStep({ ...installer, mittiAccess: "member" }, null, ON).action).toBe("skip");
  });
});

describe("People tab list", () => {
  const rec = (workerId: string, type: InviteRecord["type"], at: string): InviteRecord => ({ workerId, type, at, email: `${workerId}@x.com.au`, name: workerId, business: "B", group: "Installers", mittiUserId: null });
  const records = [rec("a", "mitti_invite_needed", "2026-10-24T01:00:00Z"), rec("b", "mitti_invite_linked", "2026-10-24T02:00:00Z"), rec("c", "mitti_invite_needed", "2026-10-24T00:00:00Z"), rec("c", "mitti_invite_office_done", "2026-10-24T03:00:00Z")];
  test("open = latest record per person not yet confirmed done, newest first, with the Mitti to-do", () => {
    const open = openInvites(records);
    expect(open.map((r) => r.workerId)).toEqual(["b", "a"]);
    expect(open[1]!.todo[0]).toMatch(/Invite a@x.com.au to Mitti with that exact email \(lite seat\)/);
    expect(open[0]!.todo[0]).toMatch(/Add them to the Installers group/);
    expect(open[0]!.todo.at(-1)).toMatch(/Template access stays manual/);
  });
  test("prior record per person feeds the idempotency check", () => {
    expect(priorInviteFor("c", records)).toEqual({ type: "mitti_invite_office_done", at: "2026-10-24T03:00:00Z" });
    expect(priorInviteFor("z", records)).toBeNull();
  });
});
