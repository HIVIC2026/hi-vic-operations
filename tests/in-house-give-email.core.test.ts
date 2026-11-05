// Plan 2026-11-02 Task 4: ONE installer email per Give — the pure builder and the notice words.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  IN_HOUSE_GIVE_CALL_LINE, IN_HOUSE_GIVE_EMAIL_APPROVED, IN_HOUSE_GIVE_EMAIL_SUBJECT, giveEmailLine, inHouseGiveEmailKey, installerEmailWords,
  renderInHouseGiveEmail, type GiveEmailJob,
} from "../src/lib/in-house-give-email.core";

const WAYNE: GiveEmailJob = { jobId: "j1", jobNumber: "HV-2730", ownerName: "WAYNE WILSON", ownerMobile: "0412 000 000", address: "1 Example St, Clayton 3168" };
const BLANK: GiveEmailJob = { jobId: "j2", jobNumber: "HV-2731", ownerName: null, ownerMobile: null, address: null };

describe("in-house Give email builder", () => {
  test("exact subject and call line; stays off until Jo approves (exact constant form)", () => {
    expect(IN_HOUSE_GIVE_EMAIL_SUBJECT).toBe("New free Ready Check jobs from Home Insulation Victoria");
    expect(IN_HOUSE_GIVE_CALL_LINE).toBe("Call each owner to book their free Ready Check.");
    expect(IN_HOUSE_GIVE_EMAIL_APPROVED).toBe(true); // Jo 6 Nov 2026: on.
    expect(readFileSync("src/lib/in-house-give-email.core.ts", "utf8")).toContain("export const IN_HOUSE_GIVE_EMAIL_APPROVED: boolean = true;");
  });
  test("one line per job: job number · owner name · owner mobile · address", () => {
    expect(giveEmailLine(WAYNE)).toBe("HV-2730 · Wayne Wilson · 0412 000 000 · 1 Example St, Clayton 3168");
    expect(giveEmailLine(BLANK)).toBe("HV-2731 · Owner · no mobile on file · address not recorded");
    expect(giveEmailLine({ ...BLANK, ownerName: "   ", ownerMobile: " ", address: "  " })).toBe("HV-2731 · Owner · no mobile on file · address not recorded");
  });
  test("renders one full email listing every job, then the call line; never null/undefined", () => {
    const m = renderInHouseGiveEmail({ jobs: [WAYNE, BLANK] });
    expect(m.subject).toBe(IN_HOUSE_GIVE_EMAIL_SUBJECT);
    expect(/^<!doctype html/i.test(m.html.trimStart())).toBe(true);
    // Suite look (5 Nov 2026): one card per job (number, owner, mobile, address), then the call line.
    for (const line of ["Job: HV-2730", "Owner: Wayne Wilson", "Mobile: 0412 000 000", "Address: 1 Example St, Clayton 3168", "Job: HV-2731", "Owner: Owner", "Mobile: no mobile on file", "Address: address not recorded", IN_HOUSE_GIVE_CALL_LINE]) expect(m.text).toContain(line);
    expect(m.text.indexOf("HV-2730")).toBeLessThan(m.text.indexOf(IN_HOUSE_GIVE_CALL_LINE));
    for (const bit of ["HV-2731", ">Owner<", "no mobile on file", "address not recorded"]) expect(m.html).toContain(bit);
    expect(JSON.stringify(m)).not.toMatch(/null|undefined/);
    expect(m.html).not.toContain("TEST — only sent to Jo");
    expect(renderInHouseGiveEmail({ jobs: [WAYNE], test: true }).html).toContain("TEST");
  });
  test("once-only key per Give", () => {
    expect(inHouseGiveEmailKey("B1")).toBe("in-house-give:v1:B1");
  });
  test("notice words for each outcome, installer name in normal case", () => {
    const p = "RAPID INSULATION";
    expect(installerEmailWords({ status: "not_approved" }, p)).toBe("No email sent to Rapid Insulation — the email isn't approved yet. Call Rapid Insulation with the job list.");
    expect(installerEmailWords({ status: "sent" }, p)).toBe("Emailed Rapid Insulation the job list.");
    expect(installerEmailWords({ status: "test_sent" }, p)).toBe("TEST email sent for Rapid Insulation.");
    expect(installerEmailWords({ status: "no_email" }, p)).toBe("No email to Rapid Insulation — no office email on file.");
    expect(installerEmailWords({ status: "held" }, p)).toBe("No email sent to Rapid Insulation — trade messages are paused. Call Rapid Insulation with the job list.");
    expect(installerEmailWords({ status: "not_sent" }, p)).toBe("Email to Rapid Insulation didn't send — call them with the job list.");
    expect(installerEmailWords({ status: "sent" }, "INSolation")).toBe("Emailed INSolation the job list.");
    expect(installerEmailWords({ status: "sent" }, "")).toBe("Emailed the installer the job list.");
  });
});

// Photo-quote installers Task 3 (spec PR #126 row): the From photos version of the Give email.
describe("in-house Give email — From photos version", () => {
  test("photo subject, heading, due line and an Open the job button per job; no Ready Check promise", async () => {
    const { IN_HOUSE_PHOTO_GIVE_EMAIL_APPROVED } = await import("../src/lib/in-house-give-email.core");
    expect(IN_HOUSE_PHOTO_GIVE_EMAIL_APPROVED).toBe(false);
    const m = renderInHouseGiveEmail({ jobs: [WAYNE, BLANK], contactName: "No Gap Insulation", method: "photos" });
    expect(m.subject).toBe("New photo quote jobs from Home Insulation Victoria");
    expect(m.text).toContain("New photo quote jobs");
    expect(m.text).toContain("Quote each one from the owner's photos within 2 business days.");
    expect(m.text).not.toContain(IN_HOUSE_GIVE_CALL_LINE);
    expect(m.text).not.toMatch(/Ready Check|\bHIV\b|\babout\b/);
    expect(m.html.match(/Open the job/g)?.length).toBe(2);
    expect(m.html).toContain("https://estimate.homeinsulationvictoria.com.au/field/j1");
    expect(m.html).toContain("https://estimate.homeinsulationvictoria.com.au/field/j2");
    const t = renderInHouseGiveEmail({ jobs: [WAYNE], method: "photos", appBase: "https://preview.example", test: true });
    expect(t.html).toContain("https://preview.example/field/j1");
  });
  test("Ready Check version is unchanged (same output with or without the method)", () => {
    expect(renderInHouseGiveEmail({ jobs: [WAYNE, BLANK], contactName: "Rapid", method: "ready_check" })).toEqual(renderInHouseGiveEmail({ jobs: [WAYNE, BLANK], contactName: "Rapid" }));
  });
});
