import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { signupMainElectrician, signupInviteDue, pickSendable } from "../src/lib/signup-electrician.core";

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
test("approval calls it, never fails approval", () => {
  const src = readFileSync("src/lib/pilot.functions.ts", "utf8");
  expect(src).toMatch(/carrySignupElectrician\(data\.businessId, context\.userId\)\)?\.catch/);
});

const due = { status: "invite_pending_comms", invite_sent_at: null, business_id: null, email: "a@b.co", installerApproved: true, commsEnabled: true, electricianAlreadyApproved: false };
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
test("tick runs the sign-up invite sweep", () => {
  expect(readFileSync("src/routes/api/public/hooks/allocation-tick.ts", "utf8")).toContain("sweepSignupNominationInvites");
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
  expect(src).toContain("invite_link_issued_at.is.null");
  expect(src.indexOf("if (!commsEnabled) return out")).toBeLessThan(src.indexOf("loadApprovedRecCandidates(now)"));
});
