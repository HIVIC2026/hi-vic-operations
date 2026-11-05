// Deep first-job Part 4(b) (Jo 1–2 Nov, 5 Nov 2026): the owner's "You're booked" goes for EVERY visit a partner books on
// their jobs — Ready Check, PIESA, electrical upgrades day and install. On an installer's own customer there is no Ready
// Check booking any more (Jo 5 Nov), so only PIESA, upgrades day and install send there. Pure rules only.
import { describe, expect, test } from "bun:test";
import { OWN_CUSTOMER_NO_READY_CHECK_NOTICE, bookingNoticeKindFor, ownerBookedGate, type BookingNoticeKind } from "../src/lib/in-house-booking.core";

const KINDS: BookingNoticeKind[] = ["ready_check", "piesa", "upgrades", "install"];
const sends = (f: { channel: string | null; heldInHouse: boolean }) => KINDS.filter((kind) => ownerBookedGate({ kind, ...f }) === null);

describe("bookingNoticeKindFor (booking kind → owner notice kind)", () => {
  test("every bookable visit has an owner notice, the upgrades day included", () => {
    expect(bookingNoticeKindFor("ready_check")).toBe("ready_check");
    expect(bookingNoticeKindFor("assessment")).toBe("piesa");
    expect(bookingNoticeKindFor("rectification")).toBe("upgrades");
    expect(bookingNoticeKindFor("installation")).toBe("install");
  });
  test("anything else (crew save, unknown) has none", () => {
    expect(bookingNoticeKindFor("crew")).toBeNull();
    expect(bookingNoticeKindFor("")).toBeNull();
  });
});

describe("ownerBookedGate (which visit kinds send, per job)", () => {
  test("in-house job: every visit", () => {
    expect(sends({ channel: "hivic_sourced", heldInHouse: true })).toEqual(KINDS);
    expect(sends({ channel: "installer_sourced", heldInHouse: true })).toEqual(KINDS);
  });
  test("installer's own customer (call and book): PIESA, upgrades day and install — never a Ready Check notice", () => {
    expect(sends({ channel: "installer_sourced", heldInHouse: false })).toEqual(["piesa", "upgrades", "install"]);
    expect(ownerBookedGate({ kind: "ready_check", channel: "installer_sourced", heldInHouse: false })).toBe(OWN_CUSTOMER_NO_READY_CHECK_NOTICE);
  });
  test("Home Insulation Victoria lead not in-house: only the upgrades day (entered on the electrician's link on every job)", () => {
    expect(sends({ channel: "hivic_sourced", heldInHouse: false })).toEqual(["upgrades"]);
    expect(sends({ channel: null, heldInHouse: false })).toEqual(["upgrades"]);
    expect(ownerBookedGate({ kind: "piesa", channel: "hivic_sourced", heldInHouse: false })).toMatch(/not an in-house or own job/);
  });
});
