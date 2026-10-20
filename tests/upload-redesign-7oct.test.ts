import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { attachedFilesNote, cleanLead, fieldProblems, jobsFound, outsideVictoria, rowStatusLine, splitContacts, OUTSIDE_VIC_MESSAGE } from "../src/lib/bulk-import.core";

const couple = { full_name: "Megan Tomlins & Gray Charlton", phone: "0403 595 088 M 0423 528 978 G", email: "megan.tomlins@gmail.com; gray.charlton@act.gov.au", address_line: "12 Example St", suburb: "Deakin", postcode: "2604" };
describe("Upload jobs redesign (Jo, 7 Oct)", () => {
  test("couple split: first person main, second contact kept", () => {
    const s = splitContacts(couple);
    expect(s.full_name).toBe("Megan Tomlins");
    expect(s.phone).toBe("0403 595 088");
    expect(s.email).toBe("megan.tomlins@gmail.com");
    expect(s.second).toEqual({ name: "Gray Charlton", phone: "0423 528 978", email: "gray.charlton@act.gov.au" });
    expect(splitContacts({ full_name: "Megan & Gray Charlton" }).full_name).toBe("Megan Charlton");
  });
  test("valid split numbers and emails are not flagged", () => {
    const { lead, issues } = cleanLead(couple);
    expect(issues.some((i) => /phone|email/i.test(i))).toBe(false);
    const f = fieldProblems(lead);
    expect(f.phone).toBeNull(); expect(f.email).toBeNull(); expect(f.name).toBeNull();
    expect(lead.notes).toContain("Second contact: Gray Charlton");
  });
  test("ACT postcode: plainly can't be added, row excluded", () => {
    expect(outsideVictoria("2604")).toBe(true); expect(outsideVictoria("3000")).toBe(false); expect(outsideVictoria("")).toBe(false);
    const { lead } = cleanLead(couple);
    expect(fieldProblems(lead).address).toBe(OUTSIDE_VIC_MESSAGE);
    const st = rowStatusLine({ lead, consent: true, quoted: null, quotedPrice: null, siteCheck: "no" });
    expect(st).toEqual({ ready: false, excluded: true, text: "We can only take Victorian jobs — this one can't be added." });
  });
  test("one status line: Ready, or Needs: with each missing thing once", () => {
    const ok = { ...couple, postcode: "3000", suburb: "Melbourne" };
    const { lead } = cleanLead(ok);
    expect(rowStatusLine({ lead, consent: true, quoted: null, quotedPrice: null, siteCheck: "yes" }).text).toBe("Ready");
    expect(rowStatusLine({ lead: { ...lead, email: "" }, consent: false, quoted: "yes", quotedPrice: null, siteCheck: null }).text).toBe("Needs: email, owner consent tick, quoted price, site check answer");
    expect(rowStatusLine({ lead, consent: true, quoted: "yes", quotedPrice: 4321.5, siteCheck: "no" }).ready).toBe(true);
  });
  test("grammar and plain file note", () => {
    expect(jobsFound(1)).toBe("1 job found"); expect(jobsFound(3)).toBe("3 jobs found");
    expect(attachedFilesNote([{ name: "uploads/Job Sheet.docx", how: "filename" }])).toBe("We attached Job Sheet.docx to this customer — is that right?");
    expect(attachedFilesNote([{ name: "a.jpg", how: "folder" }])).toBeNull();
  });
  test("page: 3 steps, help collapsed, one Confirm, no Save button, no old tiles", () => {
    const ui = readFileSync("src/routes/_authenticated/partner.bulk-import.tsx", "utf8");
    expect(ui).toContain('["Upload", "Check customers", "Confirm"]');
    expect(ui).not.toContain("<details className=\"mt-3 rounded-[22px] bg-card p-4 text-sm shadow-sm\" data-list-guide open");
    expect(ui).not.toContain("Save customer details");
    expect(ui).not.toContain("Files matched by filename only");
    expect(ui).toContain("Confirm ${toAdd.length} job");
    expect(ui).toContain("Ceiling size: ");
  });
});
