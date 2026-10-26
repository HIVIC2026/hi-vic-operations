// Decisions 320–322 (Jo 25 Oct 2026): VEU consumer factsheet with O22, warranty copy with O44 (recorded once, at install
// complete), CoES file with the completion pack O47.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { VEU_FACTSHEET_PATH, factsheetDecision, shouldRecordFactsheet } from "../src/lib/veu-factsheet.core";
import { VEU_FACTSHEET_PDF } from "../src/lib/veu-factsheet.data";
import { renderYoureInEmail } from "../src/lib/acceptance-email.core";
import { attachedWarrantyLine, renderCompletionPackEmail, renderInstallCompleteEmail } from "../src/lib/completion-emails.core";
import { coesAttachmentPlan, ownerEmailSent, shouldRecordWarrantyProvided } from "../src/lib/completion-pack.core";
import { FIXES_COES_DOC_TITLE } from "../src/lib/fixes-day.core";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

describe("decision 320: VEU consumer factsheet", () => {
  test("the PDF lives at docs/esc-forms/veu-consumer-factsheet.pdf and is never invented", () => {
    expect(VEU_FACTSHEET_PATH).toBe("docs/esc-forms/veu-consumer-factsheet.pdf");
    // Not in the repo yet: the bundled value stays null until Jo saves the ESC copy and runs the embed script.
    let onDisk = false;
    try { readFileSync(VEU_FACTSHEET_PATH); onDisk = true; } catch { onDisk = false; }
    if (!onDisk) expect(VEU_FACTSHEET_PDF).toBeNull();
  });
  test("attach only a real PDF", () => {
    expect(factsheetDecision(null)).toMatchObject({ attach: false });
    expect(factsheetDecision(new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e]))).toMatchObject({ attach: false });
    expect(factsheetDecision(PDF)).toEqual({ attach: true });
  });
  test("recorded once, only after a send that carried it", () => {
    expect(shouldRecordFactsheet({ sent: true, attached: true, alreadyRecorded: false })).toBe(true);
    expect(shouldRecordFactsheet({ sent: true, attached: false, alreadyRecorded: false })).toBe(false);
    expect(shouldRecordFactsheet({ sent: false, attached: true, alreadyRecorded: false })).toBe(false);
    expect(shouldRecordFactsheet({ sent: true, attached: true, alreadyRecorded: true })).toBe(false);
  });
  test("O22 names the factsheet only when it is attached (approved wording unchanged otherwise)", () => {
    const base = { firstName: "Sam", rebate: 500, totalIncGst: 2000, payment: null, installerName: "Ace", myJobUrl: "https://estimate.homeinsulationvictoria.com.au/my-job/x" };
    expect(renderYoureInEmail(base).text).toContain("Your signed acceptance and receipt are attached, and always on your job page.");
    expect(renderYoureInEmail(base).text).not.toContain("factsheet");
    expect(renderYoureInEmail({ ...base, factsheetAttached: true }).text).toContain("Victorian Energy Upgrades consumer factsheet");
  });
});

describe("decision 321: warranty with the All done email", () => {
  test("sent detection matches guarded and test sends", () => {
    expect(ownerEmailSent("sent")).toBe(true);
    expect(ownerEmailSent("sent: Resend accepted")).toBe(true);
    expect(ownerEmailSent("already attempted — not resent")).toBe(false);
    expect(ownerEmailSent("not sent — owner link missing")).toBe(false);
    expect(ownerEmailSent("blocked: not on allowlist")).toBe(false);
  });
  test("recorded at the first send that carried every warranty; the completion pack never records twice; missing PDF records nothing", () => {
    expect(shouldRecordWarrantyProvided({ sent: true, recordProvided: true, alreadyRecorded: false })).toBe(true);
    expect(shouldRecordWarrantyProvided({ sent: true, recordProvided: true, alreadyRecorded: true })).toBe(false);
    expect(shouldRecordWarrantyProvided({ sent: true, recordProvided: false, alreadyRecorded: false })).toBe(false);
    expect(shouldRecordWarrantyProvided({ sent: false, recordProvided: true, alreadyRecorded: false })).toBe(false);
  });
  test("O44 says the warranty is attached only when it is", () => {
    const i = { firstName: "Sam", installer: { name: "Ace", phone: null }, product: "Bradford Gold R5", areaM2: 80, rebate: 500, balancePaid: false, signRebateFormUrl: null };
    expect(renderInstallCompleteEmail(i).text).not.toContain("manufacturer's warranty (PDF)");
    const r = renderInstallCompleteEmail({ ...i, attachedWarranties: ["Bradford Gold"] });
    expect(r.text).toContain("Attached: your Bradford Gold manufacturer's warranty (PDF).");
    expect(r.html).toContain("Attached: your Bradford Gold manufacturer");
    expect(attachedWarrantyLine([" ", ""])).toBeNull();
  });
});

describe("decision 322: CoES with the completion pack", () => {
  test("the completion pack finds the CoES by the title the fixes form files it under", () => {
    expect(FIXES_COES_DOC_TITLE).toBe("PIESA evidence – Certificate of Electrical Safety (photo or PDF)");
  });
  test("PDF/photo only, oldest first, within the size budget", () => {
    const p = coesAttachmentPlan([
      { storage_path: "j/b.jpg", mime_type: "image/jpeg", size_bytes: 1000, created_at: "2026-10-25T02:00:00Z" },
      { storage_path: "j/a.pdf", mime_type: "application/pdf", size_bytes: 2000, created_at: "2026-10-25T01:00:00Z" },
      { storage_path: "j/c.bin", mime_type: "application/octet-stream", size_bytes: 10, created_at: "2026-10-25T03:00:00Z" },
      { storage_path: "j/d.png", mime_type: "image/png", size_bytes: 9000, created_at: "2026-10-25T04:00:00Z" },
    ], 5000);
    expect(p.attach.map((a) => [a.path, a.filename, a.contentType])).toEqual([
      ["j/a.pdf", "Certificate-of-Electrical-Safety-1.pdf", "application/pdf"],
      ["j/b.jpg", "Certificate-of-Electrical-Safety-2.jpg", "image/jpeg"],
    ]);
    expect(p.skipped.map((s) => s.path)).toEqual(["j/c.bin", "j/d.png"]);
    expect(coesAttachmentPlan([])).toEqual({ attach: [], skipped: [] });
    expect(coesAttachmentPlan([{ storage_path: "j/x.pdf", mime_type: "application/pdf", size_bytes: 10, created_at: "2026-10-25T01:00:00Z" }]).attach[0]!.filename).toBe("Certificate-of-Electrical-Safety.pdf");
  });
  test("O47 lists the CoES only when attached", () => {
    const i = { firstName: "Sam", installer: { name: "Ace", phone: null }, downloads: { certificateUrl: null, invoiceUrl: null, warrantiesUrl: null, signedFormsUrl: null } };
    expect(renderCompletionPackEmail(i).text).not.toContain("Certificate of Electrical Safety");
    expect(renderCompletionPackEmail({ ...i, attachedCoes: true }).text).toContain("Certificate of Electrical Safety (From your electrician's fixes visit, attached to this email)");
  });
});
