import { describe, expect, test } from "bun:test";
import { addElectricianProblems, approveChecklist, myElectricianStatus, type AddElectricianInput, type ChecklistFacts } from "../src/lib/my-electricians.core";
import * as core from "../src/lib/my-electricians.core";

const today = "2026-11-03";
const good: AddElectricianInput = {
  name: "Sam Sparks", email: "sam@x.test", mobile: "0400000000", recNumber: "REC1234", licenceNumber: "L12345", licenceExpiry: "2027-01-01",
  licenceFilePath: "a/b.jpg", plFilePath: "a/c.pdf", plAmount: 5_000_000, plExpiry: "2027-01-01",
};
// Jo 4 Nov 2026 21:08 (G8): workers comp / WorkCover is NOT collected — no question, no certificate, no sole-trader tick.
const problems = (o: Partial<AddElectricianInput>) => addElectricianProblems({ ...good, ...o }, today);

describe("addElectricianProblems", () => {
  test("a complete electrician has no problems", () => expect(problems({})).toEqual([]));
  test("WorkCover answers (old drafts) change nothing", () => expect(problems({ employsAnyone: true, soleTraderTick: false, workcoverFilePath: null, workcoverExpiry: "2020-02-01" })).toEqual([]));
  const cases: [string, Partial<AddElectricianInput>][] = [
    ["Add their name", { name: "  " }], ["Add their email", { email: "" }], ["Add their mobile", { mobile: "" }], ["Add their REC number", { recNumber: "" }],
    ["Add their licence number", { licenceNumber: "" }], ["Licence expiry must be in the future", { licenceExpiry: "2026-11-03" }],
    ["Licence expiry must be in the future", { licenceExpiry: "" }], ["Add a photo of their licence", { licenceFilePath: "" }],
    ["Add the public liability certificate", { plFilePath: "" }], ["Public liability must be at least $5 million", { plAmount: 4_999_999 }],
    ["Public liability expiry must be in the future", { plExpiry: "2026-01-01" }],
  ];
  for (const [msg, o] of cases) test(msg + " " + JSON.stringify(o), () => expect(problems(o)).toEqual([msg]));
  test("one message per problem", () => expect(problems({ name: "", email: "" })).toEqual(["Add their name", "Add their email"]));
});

describe("myElectricianStatus", () => {
  const base = { onboardingStatus: "approved", workerApproval: "approved", rejectedReason: null, licenceExpiry: "2027-01-01", plExpiry: "2027-01-01", installerAdded: true, today };
  const table: [string, Partial<typeof base>, string][] = [
    ["approved", {}, "approved"],
    ["submitted business", { onboardingStatus: "submitted" }, "waiting"],
    ["pending worker", { workerApproval: "pending" }, "waiting"],
    ["rejected", { rejectedReason: "Blurry licence", onboardingStatus: "submitted" }, "not_approved"],
    ["licence lapsed", { licenceExpiry: "2026-11-02" }, "expired"],
    ["licence missing", { licenceExpiry: null as unknown as string }, "expired"],
    ["PL lapsed", { plExpiry: "2026-10-01" }, "expired"],
    ["expires today still ok", { licenceExpiry: today }, "approved"],
    // A normally onboarded REC (not installer-added): the office's own checklist already passed, so no date on file is not
    // a block and WorkCover is not checked here. A date that HAS lapsed still shows "expired".
    ["REC: no licence expiry on file = approved", { installerAdded: false, licenceExpiry: null as unknown as string }, "approved"],
    ["REC: no PL expiry on file = approved", { installerAdded: false, plExpiry: null as unknown as string }, "approved"],
    ["REC: licence actually lapsed = expired", { installerAdded: false, licenceExpiry: "2026-11-02" }, "expired"],
    ["REC: PL actually lapsed = expired", { installerAdded: false, plExpiry: "2026-10-01" }, "expired"],
  ];
  for (const [name, o, want] of table) test(name, () => expect(myElectricianStatus({ ...base, ...o })).toBe(want as never));
});

describe("approveChecklist", () => {
  const ok: ChecklistFacts = { recNumber: "REC1", licenceNumber: "L1", licenceExpiry: "2027-01-01", licenceFilePresent: true, plAmount: 5_000_000, plExpiry: "2027-01-01", plFilePresent: true, today };
  test("all good", () => expect(approveChecklist(ok)).toEqual([]));
  test("expired PL", () => expect(approveChecklist({ ...ok, plExpiry: "2026-10-01" })).toEqual(["Public liability has expired"]));
  test("expired licence", () => expect(approveChecklist({ ...ok, licenceExpiry: "2026-10-01" })).toEqual(["Licence has expired"]));
  test("small PL", () => expect(approveChecklist({ ...ok, plAmount: 2_000_000 })).toEqual(["Public liability is under $5 million"]));
  test("no REC", () => expect(approveChecklist({ ...ok, recNumber: " " })).toEqual(["REC number is missing"]));
  test("WorkCover is never asked for (Jo 4 Nov 2026 21:08)", () => expect(approveChecklist(ok).join(" ")).not.toMatch(/workcover/i));
  test("missing files", () => expect(approveChecklist({ ...ok, licenceFilePresent: false, plFilePresent: false })).toEqual(["Licence photo is missing", "Public liability certificate is missing"]));
});

describe("My electricians screen rules (Task 3)", () => {
  const { statusChip, draftProblems, draftToInput, PROBLEM_FIELD } = core;
  const draft = (o: Partial<core.ElectricianDraft> = {}): core.ElectricianDraft => ({
    name: "Sam", email: "s@x.test", mobile: "0400111222", recNumber: "REC1", licenceNumber: "L1", licenceExpiry: "2099-01-01", licenceFile: { name: "l.jpg" },
    plFile: { name: "pl.pdf" }, plAmount: "5,000,000", plExpiry: "2099-01-01", ...o,
  });
  test("chip wording", () => {
    expect(statusChip("waiting", null)).toEqual({ text: "Waiting for approval", tone: "blue" });
    expect(statusChip("approved", null)).toEqual({ text: "Approved", tone: "green" });
    expect(statusChip("expired", null)).toEqual({ text: "Expired — update their documents", tone: "pink" });
    expect(statusChip("not_approved", "Blurry licence photo")).toEqual({ text: "Not approved: Blurry licence photo", tone: "pink" });
    expect(statusChip("not_approved", null).text).toBe("Not approved: ask Home Insulation Victoria");
  });
  test("a complete draft has no problems; $ and commas in the cover amount are fine", () => {
    expect(draftProblems(draft(), "2026-11-03")).toEqual([]);
    expect(draftToInput(draft({ plAmount: "$5,000,000" }), { licence: "a", pl: "b" }).plAmount).toBe(5_000_000);
  });
  test("no WorkCover question (Jo 4 Nov 2026 21:08); no picked files", () => {
    expect("employs" in draft()).toBe(false);
    expect(draftProblems(draft({ licenceFile: null, plFile: null }), "2026-11-03")).toEqual(["Add a photo of their licence", "Add the public liability certificate"]);
  });
  test("every problem message has a field to sit under", () => {
    const all = core.addElectricianProblems({ name: "", email: "", mobile: "", recNumber: "", licenceNumber: "", licenceExpiry: "", licenceFilePath: "", plFilePath: "", plAmount: 0, plExpiry: "" }, "2026-11-03");
    for (const p of all) expect(PROBLEM_FIELD[p], p).toBeDefined();
  });
});

describe("Fix and resend (Task 5 carried item): the form is prefilled from what is on file", () => {
  const onFile: core.MyElectricianDetails = { name: "Sam Sparks", email: "sam@sparks.test", mobile: "+61400111222", recNumber: "REC5555", licenceNumber: "L-5555", licenceExpiry: "2099-01-01", plAmount: 5_000_000, plExpiry: "2099-01-01", reason: "Blurry licence photo" };
  test("details come back; every document must be uploaded again", () => {
    const d = core.prefillDraft(onFile);
    expect(d).toMatchObject({ name: "Sam Sparks", email: "sam@sparks.test", mobile: "+61400111222", recNumber: "REC5555", licenceNumber: "L-5555", licenceExpiry: "2099-01-01", plAmount: "5000000", plExpiry: "2099-01-01" });
    expect(d.licenceFile).toBeNull(); expect(d.plFile).toBeNull();
    expect(core.draftProblems(d, "2026-11-03")).toEqual(["Add a photo of their licence", "Add the public liability certificate"]);
  });
  test("a missing amount/expiry stays blank", () => {
    expect(core.prefillDraft({ ...onFile, plAmount: null, plExpiry: null })).toMatchObject({ plAmount: "", plExpiry: "" });
  });
  test("the resend button and heading wording", () => {
    expect(core.RESUBMIT_FORM).toEqual({ title: "Fix and resend", button: "Send again", note: "Upload every document again, even the ones that were fine." });
  });
});
