import { describe, expect, test } from "bun:test";
import {
  MITTI_ACCESS_LABEL,
  mittiAccessOf,
  mittiAssignBlocker,
  mittiCheckedLabel,
  mittiInviteLine,
  mittiOverrideAccepted,
} from "../src/lib/mitti-membership.core";

const IN = { email: "sparky@example.com.au", mitti_user_id: "u-1", mitti_checked_email: "sparky@example.com.au", mitti_checked_at: "2026-10-02T01:00:00Z" };

describe("Mitti membership", () => {
  test("nobody is a member until Mitti has been checked", () => {
    expect(mittiAccessOf({ email: "a@b.c" })).toBe("unchecked");
  });

  test("a confirmed member is one whose checked email still matches", () => {
    expect(mittiAccessOf(IN)).toBe("member");
    expect(MITTI_ACCESS_LABEL.member).toBe("In Mitti");
  });

  test("a check that found nobody reads Not in Mitti, not 'unchecked'", () => {
    expect(mittiAccessOf({ ...IN, mitti_user_id: null })).toBe("not_found");
  });

  test("changing the email after a check voids the proof", () => {
    expect(mittiAccessOf({ ...IN, email: "sparky@new.com.au" })).toBe("email_changed");
    expect(mittiAccessOf({ ...IN, mitti_checked_email: null })).toBe("email_changed");
  });

  test("matching is case and space insensitive", () => {
    expect(mittiAccessOf({ email: " Sparky@Example.com.au ", mitti_user_id: "u", mitti_checked_email: "sparky@example.com.au", mitti_checked_at: "2026-10-02T01:00:00Z" })).toBe("member");
  });

  test("the blocker always names the person and the one fix: invite with that exact email", () => {
    const b = mittiAssignBlocker("installer", "TEST Alpha", "qa.installer.alpha@hivic-test.example", "not_found");
    expect(b).toContain("TEST Alpha");
    expect(b).toContain("qa.installer.alpha@hivic-test.example");
    expect(b).toContain("Invite qa.installer.alpha@hivic-test.example to Mitti with that exact email");
    expect(b).toContain("cannot receive the installer's Mitti forms");
  });

  test("a missing email is called out instead of a nonsense invite line", () => {
    expect(mittiInviteLine("")).toContain("no email address on file");
    expect(mittiAssignBlocker("electrician", null, null, "unchecked")).toContain("has not been checked");
  });

  test("an override needs a real reason", () => {
    expect(mittiOverrideAccepted("   ")).toBe(false);
    expect(mittiOverrideAccepted("ab")).toBe(false);
    expect(mittiOverrideAccepted("Office will collect evidence by email instead")).toBe(true);
  });

  test("the checked date is shown, never invented", () => {
    expect(mittiCheckedLabel(IN)).toBe("checked 2026-10-02");
    expect(mittiCheckedLabel({ email: "a@b.c" })).toBe("never checked");
    expect(mittiCheckedLabel({ mitti_checked_at: "nonsense" })).toContain("unreadable");
  });
});
