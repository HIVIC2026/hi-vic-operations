// Mitti access for partner people (decisions 188/331): switch, TEST skip, eligibility, one invite per person, create only
// with a verified API, deactivate on removal, office items.
import { describe, expect, test } from "bun:test";
import {
  MITTI_AUTO_INVITE_ENABLED, MITTI_INVITE_EVENTS, MITTI_INVITE_MESSAGE, MITTI_SEAT_FOR_ROLE, MITTI_SEATS_PAID_BY, MITTI_TRADES_GROUP, MITTI_USER_API, MITTI_USER_API_VERIFIED,
  autoInviteEnabled, createUserBody, createdUserId, groupPath, inviteEligibility, inviteKey, mittiInviteStep, mittiRemovalStep, openInvites, priorInviteFor,
  splitName, userPath, userStatusBody, type InvitePerson, type InviteRecord, type RemovalPerson,
} from "../src/lib/mitti-invite.core";
import { SMS_FRESHNESS, SMS_MESSAGE_TYPES } from "../src/lib/sms.core";
import { readFileSync } from "node:fs";

const ON = { enabled: true, apiVerified: false, groupId: null };
const LIVE = { enabled: true, apiVerified: true, groupId: "group_trades" };
const installer: InvitePerson = { workerId: "w1", tradeRole: "installer", approvalStatus: "approved", removedAt: null, email: "lee@warmroofs.com.au", ciiCleared: true, mittiAccess: "not_found", isTest: false };
const electrician: InvitePerson = { ...installer, workerId: "w2", tradeRole: "electrician", ciiCleared: false, email: "sam@sparks.com.au" };

describe("switches", () => {
  test("off by default: env must say exactly true; off = no-op", () => {
    expect(MITTI_AUTO_INVITE_ENABLED).toBe(false);
    expect(MITTI_USER_API_VERIFIED).toBe(false);
    expect([undefined, "", "1", "yes", "TRUE "].map(autoInviteEnabled)).toEqual([false, false, false, false, true]);
    expect(mittiInviteStep(installer, null, { enabled: false })).toEqual({ action: "skip", reason: "Mitti auto-invite is switched off." });
  });
  test("TEST people are skipped (Mitti rejects synthetic emails; TEST forms use the test assignee)", () => {
    expect(mittiInviteStep({ ...installer, isTest: true }, null, LIVE)).toMatchObject({ action: "skip", reason: expect.stringMatching(/TEST/) });
    expect(mittiRemovalStep({ workerId: "w1", email: "a@hivic.test", isTest: true, removedAt: "x", approvalStatus: "approved", stillActiveElsewhere: false }, { type: "mitti_user_invited", at: "t", mittiUserId: "u" }, LIVE).action).toBe("skip");
  });
});

describe("who gets Mitti", () => {
  test("installers only once their CII is verified and current; electricians once approved", () => {
    expect(inviteEligibility(installer)).toBeNull();
    expect(inviteEligibility({ ...installer, ciiCleared: false })).toMatch(/CII/);
    expect(inviteEligibility(electrician)).toBeNull();
    expect(inviteEligibility({ ...electrician, approvalStatus: "pending" })).toMatch(/Not approved/);
    expect(inviteEligibility({ ...installer, removedAt: "2026-10-24T00:00:00Z" })).toMatch(/Removed/);
    expect(inviteEligibility({ ...installer, email: " " })).toMatch(/No email/);
    expect(inviteEligibility({ ...installer, tradeRole: "assessor" })).toMatch(/No Mitti access/);
  });
  test("one HIV trades group, configured seat per trade (lite)", () => {
    expect(mittiInviteStep(installer, null, ON)).toEqual({ action: "lookup", group: MITTI_TRADES_GROUP, seat: "lite", key: inviteKey("w1") });
    expect(MITTI_SEAT_FOR_ROLE).toEqual({ installer: "lite", electrician: "lite" });
    expect(MITTI_TRADES_GROUP).toBe("HIV trades");
  });
  test("decision 340: Lite seats for installers and electricians, Home Insulation Victoria pays, no charge-back", () => {
    expect(mittiInviteStep(electrician, null, ON)).toMatchObject({ seat: "lite" });
    expect(MITTI_SEATS_PAID_BY).toBe("Home Insulation Victoria");
    const doc = readFileSync("docs/MITTI_ACCESS.md", "utf8");
    expect(doc).toContain("Decision 340");
    expect(doc).toMatch(/Home Insulation Victoria pays/);
    expect(doc).toMatch(/not charged\s+back/);
  });
});

describe("lookup → link / create / invite needed", () => {
  test("found → link (group add only with a verified API and a group id)", () => {
    expect(mittiInviteStep(installer, null, ON, { mittiUserId: "user_9" })).toMatchObject({ action: "record_linked", mittiUserId: "user_9", addToGroup: null });
    expect(mittiInviteStep(installer, null, LIVE, { mittiUserId: "user_9" })).toMatchObject({ action: "record_linked", addToGroup: "group_trades" });
    expect(mittiInviteStep(installer, null, { ...LIVE, groupId: " " }, { mittiUserId: "user_9" })).toMatchObject({ addToGroup: null });
  });
  test("not found → create when the API is verified, else 'invite needed' for the office", () => {
    expect(mittiInviteStep(installer, null, ON, { mittiUserId: null })).toMatchObject({ action: "record_needed", seat: "lite" });
    expect(mittiInviteStep(installer, null, LIVE, { mittiUserId: null })).toMatchObject({ action: "create", seat: "lite", addToGroup: "group_trades" });
  });
  test("idempotent: never twice per person; a failure may retry (search first); already a member → nothing", () => {
    for (const type of ["mitti_invite_needed", "mitti_invite_linked", "mitti_user_linked", "mitti_user_invited", "mitti_user_reactivated", "mitti_invite_office_done"] as const)
      expect(mittiInviteStep(installer, { type, at: "2026-10-24T00:00:00Z" }, LIVE, { mittiUserId: null }).action).toBe("skip");
    expect(mittiInviteStep(installer, { type: "mitti_access_failed", at: "t" }, LIVE).action).toBe("lookup");
    expect(mittiInviteStep({ ...installer, mittiAccess: "member" }, null, LIVE).action).toBe("skip");
  });
  test("approved again after a deactivation → reactivate the same Mitti user (never a second seat)", () => {
    const prior = { type: "mitti_user_deactivated" as const, at: "t", mittiUserId: "user_5" };
    expect(mittiInviteStep(installer, prior, LIVE)).toMatchObject({ action: "reactivate", mittiUserId: "user_5" });
    expect(mittiInviteStep(installer, prior, ON)).toMatchObject({ action: "fail", reason: expect.stringMatching(/reactivate them in Mitti by hand/) });
    expect(mittiInviteStep(installer, { ...prior, mittiUserId: null }, LIVE).action).toBe("fail");
  });
});

describe("removal → deactivate", () => {
  const gone: RemovalPerson = { workerId: "w1", email: "lee@warmroofs.com.au", isTest: false, removedAt: "2026-10-25T00:00:00Z", approvalStatus: "approved", stillActiveElsewhere: false };
  const invited = { type: "mitti_user_invited" as const, at: "t", mittiUserId: "user_1" };
  test("removed or rejected person with a recorded Mitti user → deactivate", () => {
    expect(mittiRemovalStep(gone, invited, LIVE)).toEqual({ action: "deactivate", mittiUserId: "user_1" });
    expect(mittiRemovalStep({ ...gone, removedAt: null, approvalStatus: "rejected" }, invited, LIVE).action).toBe("deactivate");
  });
  test("skips: switch off, still active, no Mitti user known, already deactivated, active for another business", () => {
    expect(mittiRemovalStep(gone, invited, { enabled: false }).action).toBe("skip");
    expect(mittiRemovalStep({ ...gone, removedAt: null }, invited, LIVE).action).toBe("skip");
    expect(mittiRemovalStep(gone, null, LIVE).action).toBe("skip");
    expect(mittiRemovalStep(gone, { type: "mitti_user_deactivated", at: "t", mittiUserId: "user_1" }, LIVE).action).toBe("skip");
    expect(mittiRemovalStep({ ...gone, stillActiveElsewhere: true }, invited, LIVE)).toMatchObject({ action: "skip", reason: expect.stringMatching(/another business/) });
  });
  test("API not verified → one office item to deactivate by hand", () => {
    expect(mittiRemovalStep(gone, invited, ON)).toMatchObject({ action: "fail", reason: expect.stringMatching(/Deactivate lee@warmroofs.com.au in Mitti by hand/) });
  });
});

describe("Mitti request shapes", () => {
  test("endpoints carry their public reference", () => {
    for (const e of Object.values(MITTI_USER_API)) expect(e.source).toMatch(/^https:\/\/developer\.(mitti|safetyculture)\.com\/reference\//);
    expect(groupPath("g 1")).toBe("/groups/g%201/users");
    expect(userPath("user_1")).toBe("/users/user_1");
    expect(userStatusBody("inactive")).toEqual({ status: "inactive" });
  });
  test("create body: split name, lower-case email, seat; new id from user_id or id", () => {
    expect(createUserBody({ fullName: "Lee  Van Dyke", email: "Lee@X.com.au", seat: "lite", password: "pw" })).toEqual({ firstname: "Lee", lastname: "Van Dyke", email: "lee@x.com.au", password: "pw", seat_type: "lite" });
    expect(splitName("Cher", "c@x.au")).toEqual({ first: "Cher", last: "-" });
    expect(splitName(null, "sam@x.au")).toEqual({ first: "sam", last: "-" });
    expect([createdUserId({ user_id: "user_1" }), createdUserId({ id: "user_2" }), createdUserId({ user: { id: "user_3" } }), createdUserId({})]).toEqual(["user_1", "user_2", "user_3", null]);
  });
  test("the one message is Jo's approved wording and has its own approved partner SMS type", () => {
    expect(MITTI_INVITE_MESSAGE).toBe("You've been invited to Mitti, the app you'll use for Home Insulation Victoria job forms. Check your email from Mitti, set your password, and download the Mitti app.");
    expect(SMS_MESSAGE_TYPES.mitti_invite).toMatchObject({ audience: "partner", wordingApproved: true, quietHours: true });
    expect(SMS_FRESHNESS.mitti_invite).toEqual({ kind: "event", maxAgeMinutes: 1440 });
  });
});

describe("Office list", () => {
  const rec = (workerId: string, type: InviteRecord["type"], at: string, extra: Partial<InviteRecord> = {}): InviteRecord => ({ workerId, type, at, email: `${workerId}@x.com.au`, name: workerId, business: "B", group: MITTI_TRADES_GROUP, mittiUserId: null, ...extra });
  const records = [
    rec("a", "mitti_invite_needed", "2026-10-24T01:00:00Z"),
    rec("b", "mitti_user_linked", "2026-10-24T02:00:00Z", { mittiUserId: "u_b", groupAdded: false }),
    rec("c", "mitti_invite_needed", "2026-10-24T00:00:00Z"), rec("c", "mitti_invite_office_done", "2026-10-24T03:00:00Z"),
    rec("d", "mitti_user_invited", "2026-10-24T04:00:00Z", { mittiUserId: "u_d", groupAdded: true }),
    rec("e", "mitti_access_failed", "2026-10-24T05:00:00Z", { reason: "Mitti could not create a user for e@x.com.au — invite them in Mitti by hand" }),
    rec("f", "mitti_user_deactivated", "2026-10-24T06:00:00Z", { mittiUserId: "u_f" }),
  ];
  test("open = latest record per person that still needs the office, newest first, plain reason for failures", () => {
    const open = openInvites(records);
    expect(open.map((r) => r.workerId)).toEqual(["e", "b", "a"]);
    expect(open[0]!.todo).toEqual(["Mitti could not create a user for e@x.com.au — invite them in Mitti by hand"]);
    expect(open[1]!.todo).toEqual(["Add them to the HIV trades group in Mitti."]);
    expect(open[2]!.todo[0]).toMatch(/Invite a@x.com.au to Mitti with that exact email \(lite seat\)/);
  });
  test("prior record per person + latest known Mitti user id feed idempotency and deactivation", () => {
    expect(priorInviteFor("c", records)).toEqual({ type: "mitti_invite_office_done", at: "2026-10-24T03:00:00Z", mittiUserId: null });
    expect(priorInviteFor("d", records)).toEqual({ type: "mitti_user_invited", at: "2026-10-24T04:00:00Z", mittiUserId: "u_d" });
    expect(priorInviteFor("z", records)).toBeNull();
    expect(MITTI_INVITE_EVENTS.failed).toBe("mitti_access_failed");
  });
});
