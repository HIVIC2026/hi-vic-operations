import { describe, expect, test } from "bun:test";
import { ACKNOWLEDGEMENTS, ACTIVATABLE_INSTALLER_VERSIONS, INSTALLER_AGREEMENT_VERSION, agreementText } from "../src/lib/installer-onboarding.core";
import { performInstallerSign, signedData, type InstallerSignApp, type InstallerSignInput, type InstallerSignDeps } from "../src/lib/installer-sign.core";

const previousVersion = "HI-VIC-A48-INST-1.16-2026-10-05";
const app: InstallerSignApp = {
  id: "isolated-warranty-test", status: "draft", data: { works_for_business: false, agreement_reviewed: true, wants_hivic_leads: false },
  insurance_certificate_path: null, created_at: "2026-10-09T20:00:00Z", updated_at: "2026-10-09T20:00:00Z", test_mode: true, allow_incomplete_sign: true,
};
const hash = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");
const text = agreementText(signedData(app));
const input: InstallerSignInput = {
  signer_name: "Sample Installer", signer_position: "Director", signer_email: "sample@example.com",
  acknowledgements: Object.fromEntries(ACKNOWLEDGEMENTS.map((ack) => [ack.key, true])),
  agreement_version: INSTALLER_AGREEMENT_VERSION, expected_updated_at: app.updated_at, agreement_sha256: hash(text),
};
async function capturedSignature() {
  let signed: Record<string, unknown> | undefined;
  const deps: InstallerSignDeps = {
    sha256: async (value) => hash(value),
    signAtomic: async (args) => {
      signed = args.signed;
      return { outcome: "signed", partner_enquiry_id: "isolated-enquiry", signed_at: "2026-10-09T20:00:00Z" };
    },
  };
  await performInstallerSign(app, input, { ip: null, userAgent: null }, deps);
  if (!signed) throw new Error("Signature was not committed");
  return signed;
}

describe("installer warranty terms bound to prospective signatures (no hosted calls)", () => {
  test("signed workmanship responsibility lasts at least five years from completion with own-cost rectification and ACL protection", async () => {
    const signed = await capturedSignature();
    expect(signed.agreement_text).toContain("Defects and workmanship warranty. For at least five years after completion of each Job, the Installer must return and correct any defect in its workmanship at its own cost within a reasonable time after notice. This does not limit any guarantee under the Australian Consumer Law.");
  });
  test("signed supplied-product warranty lasts at least five years from job completion separately from workmanship", async () => {
    const signed = await capturedSignature();
    expect(signed.agreement_text).toContain("all insulation products it supplies for each Job have a product warranty of at least five years from completion of that Job");
    expect(signed.agreement_text).toContain("The product warranty is separate from, and does not replace or reduce, the Installer's responsibility to rectify defects in its workmanship at its own cost.");
  });
  test("signed obligation supplies written warranties for the homeowner completion pack without limiting ACL rights", async () => {
    const signed = await capturedSignature();
    expect(signed.agreement_text).toContain("written workmanship and product warranty details for inclusion in the homeowner's completion pack");
    expect(signed.agreement_text).toContain("These warranties do not limit any guarantee or right under the Australian Consumer Law.");
  });
  test("new signature stores the exact reviewed updated text, version and hash", async () => {
    expect(await capturedSignature()).toMatchObject({ agreement_version: "HI-VIC-A48-INST-1.17-2026-10-09", agreement_text: text, agreement_sha256: hash(text) });
    expect(ACTIVATABLE_INSTALLER_VERSIONS).toContain(previousVersion);
    expect(ACTIVATABLE_INSTALLER_VERSIONS).toContain("HI-VIC-A48-INST-1.13-2026-10-03");
  });
  test("previous version or previously reviewed hash cannot sign new terms", async () => {
    let calls = 0;
    const deps: InstallerSignDeps = { sha256: async (value) => hash(value), signAtomic: async () => { calls++; throw new Error("Unexpected commit"); } };
    await expect(performInstallerSign(app, { ...input, agreement_version: previousVersion }, { ip: null, userAgent: null }, deps)).rejects.toThrow("agreement has been updated");
    await expect(performInstallerSign(app, { ...input, agreement_sha256: hash("historic reviewed terms") }, { ip: null, userAgent: null }, deps)).rejects.toThrow("Reload and review");
    expect(calls).toBe(0);
  });
  test("historic same-hash replay preserves original signature and sends no replacement snapshot", async () => {
    const historicHash = hash("historic signed agreement");
    const historicApp = { ...app, status: "submitted", agreement_sha256: historicHash, partner_enquiry_id: "historic-enquiry" };
    let payload: Parameters<InstallerSignDeps["signAtomic"]>[0] | undefined;
    const result = await performInstallerSign(historicApp, { ...input, agreement_version: previousVersion, agreement_sha256: historicHash }, { ip: null, userAgent: null }, {
      sha256: async () => { throw new Error("Must not regenerate historic text"); },
      signAtomic: async (args) => { payload = args; return { outcome: "already_signed_same", partner_enquiry_id: "historic-enquiry", signed_at: "2026-10-05T00:00:00Z" }; },
    });
    expect(payload?.signed).toEqual({});
    expect(payload?.enquiry).toEqual({});
    expect(result).toMatchObject({ outcome: "already_signed_same", signed_at: "2026-10-05T00:00:00Z", agreement_sha256: historicHash });
  });
});