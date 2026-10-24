import { describe, expect, test } from "bun:test";
import { parseDateInput, formatDateAu, stepErrors, agreementText, WORKER_CII, ACTIVATABLE_INSTALLER_VERSIONS } from "../src/lib/installer-onboarding.core";

describe("onboarding no-repeat + short CII (5 Oct)", () => {
  test("friendly dates", () => {
    expect(parseDateInput("05/10/2028")).toBe("2028-10-05");
    expect(parseDateInput("5/10/28")).toBe("2028-10-05");
    expect(parseDateInput("2028-10-05")).toBe("2028-10-05");
    expect(parseDateInput("31/02/2028")).toBeNull();
    expect(parseDateInput("soon")).toBeNull();
    expect(formatDateAu("2028-10-05")).toBe("05/10/2028");
  });
  const one = { full_legal_name: "A B", piisa_done: "no", mobile: "0412345679", email: "a@example.com", cii_holds: "held" as const, cii_certificate_number: "C1", cii_issuer: "Energy Efficiency Council Victoria", cii_level: "full" as const, cii_expiry: "2099-01-01", esc_notice_ticked: true };
  test("issuer required, issue date not asked; one installer has no prefix; expiry must be future", () => {
    expect(stepErrors("installers", { installers: [one] })).toEqual([]);
    expect(stepErrors("installers", { installers: [{ ...one, cii_issuer: "" }] })).toEqual(["Enter who issued the certificate, for example Energy Efficiency Council Victoria."]);
    const past = stepErrors("installers", { installers: [{ ...one, cii_expiry: "2020-01-01" }] });
    expect(past).toEqual(["This certificate has expired — enter a future expiry date."]);
    const two = stepErrors("installers", { installers: [one, { ...one, email: "b@example.com", cii_expiry: "" }] });
    expect(two[0]).toStartWith("Installer 2: ");
  });
  test("status labels and agreement line include issuer, leave out blanks", () => {
    expect(WORKER_CII.map((c) => c.l)).toEqual(["Yes, certified", "Still training", "Not certified"]);
    const t = agreementText({ installers: [one] });
    expect(t).toContain("issued by Energy Efficiency Council Victoria");
    expect(t).not.toContain(" on ,");
    expect(ACTIVATABLE_INSTALLER_VERSIONS).toContain("HI-VIC-A48-INST-1.14-2026-10-03");
  });
  test("asks 'are you one of the installers' only when the list is empty", () => {
    expect(stepErrors("installers", {})).toContain("Tell us if you're one of the installers.");
  });
});
