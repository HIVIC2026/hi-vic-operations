// Part 4 Task 2 (Jo 2 Nov 2026, answers 21 + touchpoints 40/42): one owner message per PIESA result.
import { describe, expect, test } from "bun:test";
import { piesaResultRoute, depositOpenAfterPiesa, CLEAR_TO_INSTALL_EMAIL_APPROVED, UPGRADES_NEEDED_EMAIL_APPROVED } from "../src/lib/piesa-result-route.core";
import { piesaDeliveryPlan, type PiesaDeliveryFacts } from "../src/lib/piesa-delivery.core";
import { depositRequestEligible } from "../src/lib/deposit-request.core";
import { installDepositDueNow } from "../src/lib/payments.core";

const ON = { clearToInstall: true, upgradesNeeded: true };
const r = (o: Partial<Parameters<typeof piesaResultRoute>[0]>, approvals = ON) =>
  piesaResultRoute({ outcome: "all_clear", upgradesDoneSameDay: false, doNotContact: false, newFlow: true, ...o }, approvals);

describe("piesaResultRoute", () => {
  test("new flow: all clear -> the 'clear to install' email", () => { expect(r({})).toEqual(["clear_to_install"]); });
  test("new flow: upgrades needed -> the 'upgrades needed' email", () => { expect(r({ outcome: "upgrades_needed" })).toEqual(["upgrades_needed"]); });
  test("upgrades done on the day -> clear to install (certificate follows)", () => {
    expect(r({ outcome: "upgrades_needed", upgradesDoneSameDay: true })).toEqual(["clear_to_install"]);
  });
  test("Do not contact: only the standalone legal copy", () => {
    expect(r({ doNotContact: true })).toEqual(["standalone_copy"]);
    expect(r({ outcome: "upgrades_needed", doNotContact: true })).toEqual(["standalone_copy"]);
  });
  test("old-flow job keeps the standalone copy", () => { expect(r({ newFlow: false })).toEqual(["standalone_copy"]); });
  test("always exactly one message", () => {
    for (const outcome of ["all_clear", "upgrades_needed"] as const) for (const d of [true, false]) for (const n of [true, false]) for (const s of [true, false])
      expect(r({ outcome, doNotContact: d, newFlow: n, upgradesDoneSameDay: s })).toHaveLength(1);
  });
});

describe("email approval flags (owners must never lose the legal PIESA copy)", () => {
  const OFF = { clearToInstall: false, upgradesNeeded: false };
  test("both flags ship off", () => { expect(CLEAR_TO_INSTALL_EMAIL_APPROVED).toBe(false); expect(UPGRADES_NEEDED_EMAIL_APPROVED).toBe(false); });
  test("default (constants, off): every new-flow result keeps the standalone copy", () => {
    for (const outcome of ["all_clear", "upgrades_needed"] as const) for (const s of [true, false])
      expect(piesaResultRoute({ outcome, upgradesDoneSameDay: s, doNotContact: false, newFlow: true })).toEqual(["standalone_copy"]);
  });
  test("flags off: standalone copy for every new-flow result", () => {
    for (const outcome of ["all_clear", "upgrades_needed"] as const) for (const s of [true, false])
      expect(r({ outcome, upgradesDoneSameDay: s }, OFF)).toEqual(["standalone_copy"]);
  });
  test("clear-to-install flag on: its route (all clear, or upgrades done on the day); upgrades-needed still standalone", () => {
    const a = { clearToInstall: true, upgradesNeeded: false };
    expect(r({}, a)).toEqual(["clear_to_install"]);
    expect(r({ outcome: "upgrades_needed", upgradesDoneSameDay: true }, a)).toEqual(["clear_to_install"]);
    expect(r({ outcome: "upgrades_needed" }, a)).toEqual(["standalone_copy"]);
  });
  test("upgrades-needed flag on: its route; all clear still standalone", () => {
    const a = { clearToInstall: false, upgradesNeeded: true };
    expect(r({ outcome: "upgrades_needed" }, a)).toEqual(["upgrades_needed"]);
    expect(r({}, a)).toEqual(["standalone_copy"]);
  });
  test("Do not contact / old flow: standalone copy whatever the flags", () => {
    expect(r({ doNotContact: true }, ON)).toEqual(["standalone_copy"]);
    expect(r({ newFlow: false }, ON)).toEqual(["standalone_copy"]);
  });
});

describe("depositOpenAfterPiesa (answer 21)", () => {
  test("opens as soon as a result is recorded, whatever it is", () => {
    expect(depositOpenAfterPiesa({ outcome: "upgrades_needed" })).toBe(true);
    expect(depositOpenAfterPiesa({ outcome: "all_clear" })).toBe(true);
    expect(depositOpenAfterPiesa({ outcome: null })).toBe(false);
  });
  test("depositRequestEligible follows the result, not the upgrades", () => {
    const base = { paid: false, booked: false, deadline: "2026-11-30", now: new Date("2026-11-01T00:00:00Z") };
    expect(depositRequestEligible({ ...base, piesaOutcome: "upgrades_needed" })).toBe(true);
    expect(depositRequestEligible({ ...base, piesaOutcome: "all_clear" })).toBe(true);
    expect(depositRequestEligible({ ...base, piesaOutcome: null })).toBe(false);
    expect(depositRequestEligible({ ...base, piesaOutcome: "all_clear", paid: true })).toBe(false);
    expect(depositRequestEligible({ ...base, piesaOutcome: "all_clear", booked: true })).toBe(false);
    expect(depositRequestEligible({ ...base, piesaOutcome: "all_clear", deadline: "2026-10-31" })).toBe(false);
  });
  test("installDepositDueNow: due after a result even when upgrades are still to come", () => {
    expect(installDepositDueNow("piesa_complete", { outcome: "fail", section_c_signed_at: null })).toBe(true);
    expect(installDepositDueNow("piesa_complete", { outcome: "pass", section_c_signed_at: null })).toBe(true);
    expect(installDepositDueNow("piesa_complete", null)).toBe(true);
    expect(installDepositDueNow("piesa_scheduled", null)).toBe(false);
  });
});

describe("owner copy is standalone only when the route says so", () => {
  const base: PiesaDeliveryFacts = {
    signedCopyId: "c", piesaRecordId: "r", installStart: null, delivered: { owner: false, installer: false },
    email: { owner: "o@example.com", installer: "i@example.com" }, closed: false,
  };
  const now = new Date("2026-11-02T03:00:00Z");
  test("default (no flag) keeps the owner copy", () => { expect(piesaDeliveryPlan(base, now).send).toEqual(["owner"]); });
  test("ownerStandalone=false drops the owner copy (the result email carries the PIESA); installer copy still sends", () => {
    const f = { ...base, ownerStandalone: false, installStart: "2026-11-05T22:00:00Z" };
    expect(piesaDeliveryPlan(f, now).send).toEqual(["installer"]);
  });
  test("ownerStandalone=false and no install day yet: nothing for the standalone owner copy", () => {
    expect(piesaDeliveryPlan({ ...base, ownerStandalone: false }, now).send).toEqual([]);
  });
});

describe("sender wiring", () => {
  const { readFileSync } = require("node:fs");
  const src = readFileSync("src/lib/piesa-delivery.server.ts", "utf8") as string;
  test("the owner copy follows the route through an injectable dependency; the installer copy is not gated by it", () => {
    expect(src).toContain("deps: PiesaDeliveryDeps");
    expect(src).toContain('(await deps.route(jobId)).includes("standalone_copy")');
    expect(src).toContain("ownerStandalone");
  });
  test("a route read failure falls back to the standalone legal copy", () => {
    expect(src).toMatch(/catch \(e\) \{[\s\S]*return \["standalone_copy"\]/);
  });
});
