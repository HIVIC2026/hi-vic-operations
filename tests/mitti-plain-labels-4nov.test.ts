// Jo 4 Nov: plain wording on every field, including portal-filled ones. New labels read per template; old ones still work.
import { describe, expect, it } from "vitest";
import { buildPrefill, contactAnswersFromEntries, validateStoredMittiAudit } from "@/lib/mitti.core";
import { parsePickupAudit, portalJobNumberItem } from "@/lib/mitti-pickup.core";
import { auditIdentity } from "@/lib/mitti-retry.core";
import { readFixesDay } from "@/lib/fixes-day.core";
import { shortAnswersFromEntries } from "@/lib/official-short.core";
import { installDayPrefillItems, labelKey as installKey, INSTALL_DAY_Q } from "@/lib/install-day.core";
import { formHasInstallerAnswers } from "@/lib/ready-check-basics.core";

const t = (id: string, label: string, text?: string) => ({ item_id: id, label, type: "textsingle", ...(text ? { responses: { text } } : {}) });

describe("A1/A2 Ready Check", () => {
  const tpl = { header_items: [t("j", "Job number"), t("a", "Address"), t("n", "Owner's name"), t("m", "Owner's mobile"), t("e", "Owner's email")], items: [t("l", "Life support: what our records say")] };
  it("prefills Job number, Address, owner fields and life support record", () => {
    const p = buildPrefill(tpl, { jobNumber: "HV-1", address: "1 A St", ownerName: "Ann", ownerPhone: "0400", ownerEmail: "a@b.c", lifeSupport: "None", assessorName: "X" } as never);
    const ids = [...p.header_items, ...p.items].map((r: { item_id: string }) => r.item_id).sort();
    expect(ids).toEqual(["a", "e", "j", "l", "m", "n"]);
  });
  it("reads owner contact and new A1 contact question", () => {
    const c = contactAnswersFromEntries([{ label: "Owner's mobile", value: "0400" }, { label: "Owner's email", value: "a@b.c" }, { label: "Did the owner say Home Insulation Victoria can contact them?", value: "Yes" }]);
    expect([c.phone, c.email, c.contactPermission]).toEqual(["0400", "a@b.c", true]);
  });
  it("pickup reads Job number / Address / Owner's name and finds the write-back item", () => {
    const audit = { audit_id: "x", header_items: [t("j", "Job number", "HV-9"), t("a", "Address", "1 A St"), t("n", "Owner's name", "Ann")], items: [] };
    const p = parsePickupAudit(audit)!;
    expect([p.mittiRef, p.siteAddress, p.homeownerName]).toEqual(["HV-9", "1 A St", "Ann"]);
    expect(portalJobNumberItem(audit)?.itemId).toBe("j");
  });
  it("job match still enforced on the renamed Job number (A1/A2/A5)", () => {
    const audit = { audit_id: "x", template_id: "T", header_items: [t("j", "Job number", "HV-2")], items: [] };
    expect(() => validateStoredMittiAudit(audit, { storedAuditId: "x", jobNumber: "HV-1", templateId: "T" })).toThrow();
    expect(() => validateStoredMittiAudit(audit, { storedAuditId: "x", jobNumber: "HV-2", templateId: "T" })).not.toThrow();
  });
  it("Job number / Address are prefilled values, not installer answers", () => {
    expect(formHasInstallerAnswers([{ label: "Job number", value: "HV-1" }, { label: "Address", value: "1 A St" }])).toBe(false);
  });
  it("retry identity reads the new labels for Ready Check, PIESA and Install day", () => {
    const audit = { audit_id: "x", header_items: [t("j", "Job number", "HV-3"), t("a", "Address", "1 A St")], items: [] };
    for (const k of ["ready_check", "piesa", "install_day", "fixes"] as const) expect(auditIdentity(k, audit)?.jobNumber).toBe("HV-3");
  });
});

describe("A3 PIESA (own labels)", () => {
  it("reads new labels into the same official fields; old labels still work", () => {
    const now = shortAnswersFromEntries("piesa", [
      { label: "Job number", value: "HV-1" }, { label: "Address", value: "1 A St" },
      { label: "Your full name", value: "Sam" }, { label: "Your electrician licence number", value: "L1" },
      { label: "Your business name (REC)", value: "Sparks" }, { label: "Your REC number", value: "R1" }, { label: "Your mobile", value: "0411" },
      { label: "Life support: what our records say", value: "None" },
    ]);
    expect([now.jobRef, now.address, now["b3.name"], now["b3.licence"], now["b3.recName"], now["b3.recNo"], now["b3.phone"], now.lifeSupportRecord]).toEqual(["HV-1", "1 A St", "Sam", "L1", "Sparks", "R1", "0411", "None"]);
    const old = shortAnswersFromEntries("piesa", [{ label: "Electrician full name", value: "Sam" }, { label: "Job Reference ID", value: "HV-1" }]);
    expect([old["b3.name"], old.jobRef]).toEqual(["Sam", "HV-1"]);
  });
});

describe("A4 Electrical upgrades (own labels)", () => {
  it("reads new labels; old labels still work", () => {
    const a = (labels: [string, string][]) => ({ items: labels.map(([l, v], i) => t(String(i), l, v)) });
    const now = readFixesDay(a([["Job number", "HV-1"], ["Your full name", "Sam"], ["Your electrician licence number", "L1"], ["Your business name (REC)", "Sparks"], ["Your REC number", "R1"], ["Your mobile", "0411"]]));
    expect([now.jobNumber, now.electricianName, now.licence, now.recName, now.recNo, now.phone]).toEqual(["HV-1", "Sam", "L1", "Sparks", "R1", "0411"]);
    const old = readFixesDay(a([["Electrician name", "Sam"], ["Licence number", "L1"], ["REC name", "Sparks"], ["Phone", "0411"]]));
    expect([old.electricianName, old.licence, old.recName, old.phone]).toEqual(["Sam", "L1", "Sparks", "0411"]);
  });
});

describe("A5 Install day (own labels)", () => {
  const pairs: [string, string][] = [
    [INSTALL_DAY_Q.jobNumber, "Job number"], [INSTALL_DAY_Q.address, "Address"], [INSTALL_DAY_Q.ap, "Accredited Person"],
    [INSTALL_DAY_Q.business, "Installer's business name"], [INSTALL_DAY_Q.lead, "Lead installer's full name"],
    [INSTALL_DAY_Q.leadCii, "Lead installer's CII number (EEC Ceiling Insulation Installer)"],
    [INSTALL_DAY_Q.second, "Second installer's full name"], [INSTALL_DAY_Q.third, "Third installer's full name"],
  ];
  it("each new label reads as the same A5 question", () => { for (const [old, now] of pairs) expect(installKey(now)).toBe(installKey(old)); });
  it("second/third CII labels unchanged and distinct from lead", () => {
    expect(installKey(INSTALL_DAY_Q.secondCii)).not.toBe(installKey(INSTALL_DAY_Q.leadCii));
  });
  it("prefills the renamed A5 fields", () => {
    const tpl = { items: pairs.map(([, l], i) => t(String(i), l)) };
    const out = installDayPrefillItems(tpl, { jobNumber: "HV-1", address: "1 A St", apName: "AP", businessName: "Biz", leadName: "Lee", leadCii: "C1", secondName: "Sue", thirdName: "Tom" } as never, () => null);
    expect(out.map((o) => o.item_id).sort()).toEqual(["0", "1", "2", "3", "4", "5", "6", "7"]);
  });
});
