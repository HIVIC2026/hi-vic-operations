import { describe, expect, test } from "bun:test";
import { addElectricianProblems, approveChecklist, myElectricianStatus, type AddElectricianInput, type ChecklistFacts } from "../src/lib/my-electricians.core";

const today = "2026-11-03";
const good: AddElectricianInput = {
  name: "Sam Sparks", email: "sam@x.test", mobile: "0400000000", recNumber: "REC1234", licenceNumber: "L12345", licenceExpiry: "2027-01-01",
  licenceFilePath: "a/b.jpg", plFilePath: "a/c.pdf", plAmount: 5_000_000, plExpiry: "2027-01-01", employsAnyone: false, soleTraderTick: true,
};
const problems = (o: Partial<AddElectricianInput>) => addElectricianProblems({ ...good, ...o }, today);

describe("addElectricianProblems", () => {
  test("a complete sole trader has no problems", () => expect(problems({})).toEqual([]));
  test("a complete employer has no problems", () => expect(problems({ employsAnyone: true, soleTraderTick: false, workcoverFilePath: "w.pdf", workcoverExpiry: "2027-02-01" })).toEqual([]));
  const cases: [string, Partial<AddElectricianInput>][] = [
    ["Add their name", { name: "  " }], ["Add their email", { email: "" }], ["Add their mobile", { mobile: "" }], ["Add their REC number", { recNumber: "" }],
    ["Add their licence number", { licenceNumber: "" }], ["Licence expiry must be in the future", { licenceExpiry: "2026-11-03" }],
    ["Licence expiry must be in the future", { licenceExpiry: "" }], ["Add a photo of their licence", { licenceFilePath: "" }],
    ["Add the public liability certificate", { plFilePath: "" }], ["Public liability must be at least $5 million", { plAmount: 4_999_999 }],
    ["Public liability expiry must be in the future", { plExpiry: "2026-01-01" }],
    ["Tick that they're a sole trader with no staff", { soleTraderTick: false }],
    ["Add the WorkCover certificate", { employsAnyone: true, workcoverFilePath: null, workcoverExpiry: "2027-02-01" }],
    ["WorkCover expiry must be in the future", { employsAnyone: true, workcoverFilePath: "w.pdf", workcoverExpiry: "2026-10-01" }],
  ];
  for (const [msg, o] of cases) test(msg + " " + JSON.stringify(o), () => expect(problems(o)).toEqual([msg]));
  test("employer ignores the sole trader tick", () => expect(problems({ employsAnyone: true, soleTraderTick: true, workcoverFilePath: "w", workcoverExpiry: "2027-02-01" })).toEqual([]));
  test("one message per problem", () => expect(problems({ name: "", email: "" })).toEqual(["Add their name", "Add their email"]));
});

describe("myElectricianStatus", () => {
  const base = { onboardingStatus: "approved", workerApproval: "approved", rejectedReason: null, licenceExpiry: "2027-01-01", plExpiry: "2027-01-01", workcoverExpiry: "2027-01-01", workcoverExempt: false, today };
  const table: [string, Partial<typeof base>, string][] = [
    ["approved", {}, "approved"],
    ["submitted business", { onboardingStatus: "submitted" }, "waiting"],
    ["pending worker", { workerApproval: "pending" }, "waiting"],
    ["rejected", { rejectedReason: "Blurry licence", onboardingStatus: "submitted" }, "not_approved"],
    ["licence lapsed", { licenceExpiry: "2026-11-02" }, "expired"],
    ["licence missing", { licenceExpiry: null as unknown as string }, "expired"],
    ["PL lapsed", { plExpiry: "2026-10-01" }, "expired"],
    ["WorkCover lapsed", { workcoverExpiry: "2026-10-01" }, "expired"],
    ["WorkCover lapsed but exempt", { workcoverExpiry: null as unknown as string, workcoverExempt: true }, "approved"],
    ["expires today still ok", { licenceExpiry: today }, "approved"],
  ];
  for (const [name, o, want] of table) test(name, () => expect(myElectricianStatus({ ...base, ...o })).toBe(want as never));
});

describe("approveChecklist", () => {
  const ok: ChecklistFacts = { recNumber: "REC1", licenceNumber: "L1", licenceExpiry: "2027-01-01", licenceFilePresent: true, plAmount: 5_000_000, plExpiry: "2027-01-01", plFilePresent: true, workcoverExpiry: "2027-01-01", workcoverFilePresent: true, workcoverExempt: false, today };
  test("all good", () => expect(approveChecklist(ok)).toEqual([]));
  test("expired PL", () => expect(approveChecklist({ ...ok, plExpiry: "2026-10-01" })).toEqual(["Public liability has expired"]));
  test("expired licence", () => expect(approveChecklist({ ...ok, licenceExpiry: "2026-10-01" })).toEqual(["Licence has expired"]));
  test("small PL", () => expect(approveChecklist({ ...ok, plAmount: 2_000_000 })).toEqual(["Public liability is under $5 million"]));
  test("no REC", () => expect(approveChecklist({ ...ok, recNumber: " " })).toEqual(["REC number is missing"]));
  test("exempt skips WorkCover", () => expect(approveChecklist({ ...ok, workcoverExempt: true, workcoverFilePresent: false, workcoverExpiry: null })).toEqual([]));
  test("WorkCover needed when not exempt", () => expect(approveChecklist({ ...ok, workcoverFilePresent: false, workcoverExpiry: null })).toEqual(["WorkCover certificate is missing", "WorkCover expiry is missing"]));
  test("missing files", () => expect(approveChecklist({ ...ok, licenceFilePresent: false, plFilePresent: false })).toEqual(["Licence photo is missing", "Public liability certificate is missing"]));
});
