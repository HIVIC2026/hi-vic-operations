import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { INSTALLER_PAY_WAITING_AP, INSTALLER_PAY_WAITING_OWNER, accountEnding, installerPayHeldReasons, payState } from "../src/lib/trade-view.core";
import { moneyJobDetail, moneyWords } from "../src/lib/installer-screens.core";
const src = (p: string) => readFileSync(p, "utf8");

describe("E2 bank digits", () => {
  test("last 4 digits everywhere, never fewer", () => {
    expect(accountEnding("123 456 789")).toBe("6789");
    expect(accountEnding("12-34")).toBe("1234");
    expect(accountEnding("123")).toBeNull();
    expect(accountEnding(null)).toBeNull();
    const srv = src("src/lib/trade-view.server.ts");
    expect(srv).not.toMatch(/digits\.slice\(-3\)/);
    expect(srv.match(/accountEnding\(bank\?\.account_number\)/g)?.length).toBe(3);
  });
});

describe("E1 electrician words", () => {
  test("electricians never see install words; installer words unchanged", () => {
    const e = moneyWords("electrician");
    expect(`${e.emptyTitle} ${e.emptyBody} ${e.count(0)} ${e.count(1)} ${e.count(3)}`).not.toMatch(/install/i);
    expect(e.count(1)).toBe("1 visit");
    expect(e.count(3)).toBe("3 visits");
    expect(e.emptyTitle).toBe("No completed visits yet."); // Jo answer 1, exact
    expect(e.emptyBody).toBe("Your pay for each safety check and fixes visit shows here once the visit is done.");
    const i = moneyWords("installer");
    expect([i.emptyTitle, i.emptyBody, i.count(1), i.count(2)]).toEqual(["No completed jobs yet.", "Your pay for each install appears here once the install is done.", "1 install", "2 installs"]);
    const page = src("src/routes/_authenticated/field.money.tsx");
    expect(page).toContain("moneyWords(data.kind)");
    expect(page).not.toContain("once the install is done");
    expect(page).not.toMatch(/install\$\{t\.(this|last)Month/);
  });
});

const facts = { jobNumber: "HV-1", suburb: "Kew", channel: "hivic_sourced", doneAt: null, amount: 1200, state: { kind: "checking" as const }, accountEnding: "6789", product: null, areaM2: null, removalM2: null, crew: [], installerSignedAt: null, ownerSignedAt: null, apApprovedAt: null, ownerPaidInFullAt: null, held: [] as string[] };
describe("E3 why pay is held", () => {
  test("every reason passes through; paid shows none", () => {
    const held = ["Install form not Complete in Mitti", INSTALLER_PAY_WAITING_AP];
    expect(moneyJobDetail({ ...facts, held }).held).toEqual(held);
    expect(moneyJobDetail({ ...facts, held, state: { kind: "paid", on: "2026-10-20T00:00:00Z" } }).held).toEqual([]);
    const page = src("src/routes/_authenticated/field.money_.$jobId.tsx");
    expect(page).toContain("heldPayPill(v.held)");
    expect(page).toContain("data-money-job-held");
    expect(src("src/lib/trade-view.server.ts")).toContain("held: row?.held ?? []");
  });
  test("stays the same: own-customer pay waits for the owner's payment in full", () => {
    const f = { installerSupplied: true, apApprovedAt: "2026-10-01T00:00:00Z", ownerPaidInFullAt: null };
    expect(payState({ paidAt: null, ...f }).kind).toBe("checking");
    expect(installerPayHeldReasons(f)).toEqual([INSTALLER_PAY_WAITING_OWNER]);
  });
});
