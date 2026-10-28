import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { INSTALLER_PAY_WAITING_AP, INSTALLER_PAY_WAITING_OWNER, accountEnding, installerPayHeldReasons, payState, statementCsv, statementFileName } from "../src/lib/trade-view.core";
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
describe("E4 statement", () => {
  test("csv escapes, shows Held, iPhone-safe save", () => {
    const csv = statementCsv([{ jobNumber: "HV-1", surname: 'O"Brien, J', suburb: null, what: "Install", amount: 1200, state: { kind: "checking" }, held: ["Form not Complete"] }]);
    expect(csv.split("\r\n")).toEqual(['"Job","Owner","Suburb","What","Amount","Status"', '"HV-1","O""Brien, J","","Install","1200","Held"']);
    expect(statementFileName(new Date("2026-10-27T14:30:00Z"))).toBe("pay-statement-2026-10-28.csv");
    const page = src("src/routes/_authenticated/field.money.tsx");
    expect(page).not.toContain("data:text/csv");
    expect(page.match(/saveFile\(/g)?.length).toBeGreaterThanOrEqual(1);
    const sf = src("src/components/trade/save-file.ts");
    for (const s of ["navigator.canShare", "navigator.share", "createObjectURL", "revokeObjectURL", "AbortError"]) expect(sf).toContain(s);
  });
});
describe("E4 statement formula safety", () => {
  const row = (o: Partial<Parameters<typeof statementCsv>[0][number]>) => ({ jobNumber: "HV-1", surname: "Smith", suburb: "Brunswick", what: "Install", amount: 1200, state: { kind: "checking" } as const, held: [], ...o });
  test("text cells starting with a formula character get a leading quote", () => {
    const line = statementCsv([row({ surname: "=1+1", suburb: "@x", what: "-2", jobNumber: "+3" })]).split("\r\n")[1];
    expect(line).toBe(`"'+3","'=1+1","'@x","'-2","1200","Being checked"`);
  });
  test("normal values are unchanged", () => {
    expect(statementCsv([row({})]).split("\r\n")[1]).toBe('"HV-1","Smith","Brunswick","Install","1200","Being checked"');
  });
});
