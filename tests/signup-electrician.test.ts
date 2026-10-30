import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { signupMainElectrician, signupInviteDue, pickSendable, signupMainNominationIds } from "../src/lib/signup-electrician.core";

const viking = { name: "Will Casdorff", email: "jesse@vikingelec.com.au", mobile: "0 4 6 6 6 5 1 9 0 8", is_primary: true, rec_number: "38603", business_name: "Viking Electrical Services Aus PTY LTD", licence_number: "A81638" };
test("main electrician from sign-up", () => {
  expect(signupMainElectrician({ electrician_choice: "have", preferred_electricians: [viking] }))
    .toEqual({ name: "Viking Electrical Services Aus PTY LTD", licence: "38603", email: "jesse@vikingelec.com.au", phone: "0466651908" });
});
test("first one when none marked main; nothing when not 'have' or empty", () => {
  const a = { ...viking, is_primary: false, business_name: "A" }, b = { ...viking, is_primary: false, business_name: "B" };
  expect(signupMainElectrician({ electrician_choice: "have", preferred_electricians: [a, b] })?.name).toBe("A");
  expect(signupMainElectrician({ electrician_choice: "hivic", preferred_electricians: [viking] })).toBeNull();
  expect(signupMainElectrician({ electrician_choice: "have", preferred_electricians: [] })).toBeNull();
  expect(signupMainElectrician({ electrician_choice: "have", preferred_electricians: [{ name: "", business_name: "" }] })).toBeNull();
});
test("approval calls it, never fails approval (status change and the Approve button)", () => {
  const src = readFileSync("src/lib/pilot.functions.ts", "utf8");
  expect(src).toMatch(/carrySignupElectrician\(data\.businessId, context\.userId\)\)?\.catch/);
  const act = readFileSync("src/lib/partner-activation.functions.ts", "utf8");
  expect(act).toMatch(/carrySignupElectrician\(r\.business_id, context\.userId\)\)?\.catch/);
  // after the decision-402 auto-approval step, before the test / welcome branches
  expect(act.indexOf("carrySignupElectrician(r.business_id")).toBeGreaterThan(act.indexOf("autoApproveVerifiedPeople(r.business_id"));
  expect(act.indexOf("carrySignupElectrician(r.business_id")).toBeLessThan(act.indexOf("sendTestWelcome({"));
});
test("sign-up link lookups only use the installer activation, newest first", () => {
  const server = readFileSync("src/lib/signup-electrician.server.ts", "utf8");
  expect(server.match(/from\("partner_activations"\)[^;]*\.eq\("partner_type", "installer"\)/g)?.length).toBe(2);
  expect(server).toContain('.order("activated_at", { ascending: false })');
  const script = readFileSync("scripts/carry-signup-electricians.ts", "utf8");
  expect(script).toContain('.eq("partner_type", "installer")');
  expect(script).toContain('.order("activated_at", { ascending: false })');
});

const due = { status: "invite_pending_comms", invite_sent_at: null, invite_link_issued_at: null, business_id: null, email: "a@b.co", installerApproved: true, commsEnabled: true, electricianAlreadyApproved: false,
  isMain: true, installerSignupSaved: true, earlierSweepRecord: false, sameEmailAlreadySent: false };
test("signup invite: send when everything is in place", () => expect(signupInviteDue(due)).toBe("send"));
test("signup invite: wait while comms are off", () => expect(signupInviteDue({ ...due, commsEnabled: false })).toBe("wait"));
test("signup invite: skip cases", () => {
  expect(signupInviteDue({ ...due, invite_sent_at: "2026-10-29T00:00:00Z" })).toBe("skip");
  expect(signupInviteDue({ ...due, business_id: "b1" })).toBe("skip");
  expect(signupInviteDue({ ...due, email: null })).toBe("skip");
  expect(signupInviteDue({ ...due, installerApproved: false })).toBe("skip");
  expect(signupInviteDue({ ...due, electricianAlreadyApproved: true })).toBe("skip");
  expect(signupInviteDue({ ...due, status: "invited" })).toBe("skip");
});
test("signup invite: never twice, only the main one, only once the installer's sign-up electrician is saved", () => {
  expect(signupInviteDue({ ...due, invite_link_issued_at: "2026-10-29T00:00:00Z" })).toBe("skip"); // office issued a link: handled
  expect(signupInviteDue({ ...due, earlierSweepRecord: true })).toBe("skip"); // any earlier record (sent, failed, blocked, skipped) is final
  expect(signupInviteDue({ ...due, isMain: false })).toBe("skip");
  expect(signupInviteDue({ ...due, installerSignupSaved: false })).toBe("skip"); // approval / the one-off fix is the gate
  expect(signupInviteDue({ ...due, sameEmailAlreadySent: true })).toBe("skip"); // another nomination by this installer already invited them
  expect(signupInviteDue({ ...due, installerSignupSaved: false, commsEnabled: false })).toBe("skip");
});
test("main nomination per application: the one marked main, else the oldest", () => {
  const rows = [
    { id: "a1", installer_application_id: "A", is_primary: false, created_at: "2026-10-01T00:00:00Z" },
    { id: "a2", installer_application_id: "A", is_primary: true, created_at: "2026-10-02T00:00:00Z" },
    { id: "b2", installer_application_id: "B", is_primary: false, created_at: "2026-10-05T00:00:00Z" },
    { id: "b1", installer_application_id: "B", is_primary: false, created_at: "2026-10-03T00:00:00Z" },
    { id: "x", installer_application_id: null, is_primary: true, created_at: "2026-10-01T00:00:00Z" },
  ];
  expect([...signupMainNominationIds(rows)].sort()).toEqual(["a2", "b1"]);
});
test("tick runs the sign-up invite sweep, before the decision-303 sweep", () => {
  const tick = readFileSync("src/routes/api/public/hooks/allocation-tick.ts", "utf8");
  expect(tick).toContain("sweepSignupNominationInvites");
  expect(tick.indexOf("sweepSignupNominationInvites()")).toBeLessThan(tick.indexOf("sweepRecOnboardingInvites()"));
});
test("pickSendable: skipped rows do not use up the cap", () => {
  const rows = Array.from({ length: 300 }, (_, i) => i);
  const got = pickSendable(rows, 25, (n) => n >= 100);
  expect(got.length).toBe(25);
  expect(got[0]).toBe(100);
  expect(pickSendable([1, 2, 3], 25, () => false)).toEqual([]);
});
test("sweep claims the row before sending and checks comms first", () => {
  const src = readFileSync("src/lib/signup-electrician.server.ts", "utf8");
  expect(src).toContain('.select("id")');
  // claim only rows with no link issued yet; an office-issued link is never taken over
  expect(src).toMatch(/\.update\(\{\s*invite_token_hash[\s\S]*?\.is\("invite_link_issued_at", null\)[\s\S]*?\.select\("id"\)/);
  expect(src).not.toContain("invite_link_issued_at.lt");
  expect(src.indexOf("if (!commsEnabled) return out")).toBeLessThan(src.indexOf("loadApprovedRecCandidates(now)"));
});
