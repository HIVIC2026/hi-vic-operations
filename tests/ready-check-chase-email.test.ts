// Decision #27 (Jo 2 Nov 2026): the "Nearly there" Ready Check chase goes by EMAIL to the installer's business office, not a text.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { READY_CHECK_CHASE_EMAIL_APPROVED, chaseEmailPlan, chaseEmailKey, readyCheckNearlyThereEmail } from "../src/lib/ready-check-chase.core";

const i = { jobNumber: "HV-1234", address: "12 Example St, Box Hill", missing: ["finish and submit the form", "whether the homeowner agrees to be contacted"], mittiFormUrl: "https://app.mitti.example/inspection/abc123" };

describe("#27 Nearly there email", () => {
  test("subject, body lines and button are the approved wording", () => {
    const m = readyCheckNearlyThereEmail(i);
    expect(m.subject).toBe("HV-1234 Ready Check: nearly there");
    expect(m.text).toContain("12 Example St, Box Hill still needs:");
    expect(m.text).toContain("• finish and submit the form");
    expect(m.text).toContain("• whether the homeowner agrees to be contacted");
    expect(m.text).toContain("Add them in Mitti and we'll prepare the owner's quote.");
    expect(m.text).toContain(`Finish the Ready Check form: ${i.mittiFormUrl}`); // Jo 5 Nov 2026: the button names the action
    expect(m.html).toContain("Finish the Ready Check form");
    expect(m.html).toContain(i.mittiFormUrl);
    expect(m.html).toContain("Add them in Mitti and we&#39;ll prepare the owner&#39;s quote.".replace(/&#39;/g, "'")) ;
    expect(`${m.subject}${m.text}${m.html}`).not.toMatch(/\bHIV\b|lawyer/);
  });
  test("no address: falls back to the job number", () => {
    expect(readyCheckNearlyThereEmail({ ...i, address: "" }).text).toContain("HV-1234 still needs:");
  });
  test("flag is off until Jo OKs the pictures", () => { expect(READY_CHECK_CHASE_EMAIL_APPROVED).toBe(false); });
});

describe("one version per chase", () => {
  const base = { approved: true, test: false, officeEmail: "office@example.com", textAlreadySent: false };
  test("flag off: no email (the old text keeps going, so a chase has one version)", () => { expect(chaseEmailPlan({ ...base, approved: false })).toEqual({ action: "off" }); });
  test("flag on: email to the business office", () => { expect(chaseEmailPlan(base)).toEqual({ action: "send", to: "office@example.com" }); });
  test("a chase already texted is not emailed for the same revision", () => { expect(chaseEmailPlan({ ...base, textAlreadySent: true })).toEqual({ action: "already_texted" }); });
  test("no office email on file: held with an office note, never a worker's address", () => {
    expect(chaseEmailPlan({ ...base, officeEmail: null })).toMatchObject({ action: "held" });
    expect(chaseEmailPlan({ ...base, officeEmail: "  " })).toMatchObject({ action: "held" });
  });
  test("TEST jobs go to test-send", () => { expect(chaseEmailPlan({ ...base, test: true })).toEqual({ action: "test_send", to: "office@example.com" }); });
  test("email key is per job + Mitti audit + gap list", () => {
    expect(chaseEmailKey("j", "a", "x|y")).toBe("ready-check-incomplete-email:v1:j:a:x|y");
  });
});

describe("sender wiring", () => {
  const s = readFileSync("src/lib/ready-check-chase.server.ts", "utf8");
  test("flag on sends the office email and no text; flag off keeps the old text", () => {
    expect(s).toContain("sendOfficeEmail");
    expect(s).toContain("businesses");
    expect(s).toMatch(/READY_CHECK_CHASE_EMAIL_APPROVED[\s\S]*emailInstallerOffice[\s\S]*textInstaller/);
    expect(s).not.toMatch(/signer_mobile[^;]*email|email[^;]*signer_mobile/);
  });
  test("templates register lists the email", () => {
    const h = readFileSync("src/lib/template-hub.core.ts", "utf8");
    expect(h).toContain("readyCheckNearlyThereEmail");
  });
});
