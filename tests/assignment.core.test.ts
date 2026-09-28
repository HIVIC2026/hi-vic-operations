import { describe, expect, test } from "bun:test";
import { consumerSignBlockers, evaluateAssignment, materialChanges, templateBlockers, type Template } from "../src/lib/assignment.core";

const T = (k: string, o: Partial<Template> = {}): Template => ({ template_key: k, version: "v1", body: "x".repeat(30), approved: true, is_active: true, required: true, ...o });
const all = [T("consumer_declaration"), T("consumer_rights"), T("installer_declaration")];
const sign = { signatoryName: "Jo", authorityType: "owner" as const, over18: true, readConsumerInfo: true, acceptDeclaration: true, acceptAssignment: true, signatureName: "Jo Citizen" };
const base = { status: "consumer_signed_pending_install" as const, consumerSigned: true, installationCompleted: true, installerSigned: true, installedProduct: "R5 batts", installedArea: 120, openVariation: false, templates: all };

describe("customer acceptance & VEEC assignment", () => {
  test("signing blocked until official wording approved (never invented)", () => {
    expect(templateBlockers([], "consumer").length).toBe(2);
    expect(consumerSignBlockers(sign, [T("consumer_declaration", { approved: false }), T("consumer_rights")]).length).toBe(1);
    expect(consumerSignBlockers(sign, all)).toEqual([]);
  });
  test("all declarations + 18+ required", () => {
    expect(consumerSignBlockers({ ...sign, over18: false, acceptAssignment: false }, all).length).toBe(2);
  });
  test("consumer signature alone is not effective", () => {
    expect(evaluateAssignment({ ...base, installationCompleted: false, installerSigned: false, installedProduct: null, installedArea: null }).status).toBe("consumer_signed_pending_install");
  });
  test("installer signed before install stays pending", () => {
    expect(evaluateAssignment({ ...base, installationCompleted: false }).status).toBe("installer_signed_pending_install");
  });
  test("installed but no final details -> final_details_pending", () => {
    expect(evaluateAssignment({ ...base, installerSigned: false }).status).toBe("final_details_pending");
    expect(evaluateAssignment({ ...base, installedArea: 0 }).status).toBe("final_details_pending");
  });
  test("effective only after install + installer declaration + product + m²", () => {
    expect(evaluateAssignment(base).status).toBe("effective_complete");
  });
  test("missing installer template blocks effectiveness", () => {
    expect(evaluateAssignment({ ...base, templates: all.slice(0, 2) }).status).toBe("final_details_pending");
  });
  test("open variation blocks", () => {
    expect(evaluateAssignment({ ...base, openVariation: true }).status).toBe("variation_required");
  });
  test("material changes detected, minor ones ignored", () => {
    const s = { installer_user_id: "a", installer_business_id: "b", product: "R5 batts", area_m2: 100, price_before_benefit_inc_gst: 3000, veu_benefit_inc_gst: 1000, final_customer_price_inc_gst: 2000 };
    expect(materialChanges(s, { area_m2: 103, final_customer_price_inc_gst: 2000.5 })).toEqual([]);
    expect(materialChanges(s, { area_m2: 130, installer_user_id: "z", product: "R4 batts", final_customer_price_inc_gst: 2500 })).toEqual(["Installer changed", "Installed product changed", "Installed area changed materially", "Customer price changed"]);
  });
  test("draft when unsigned", () => {
    expect(evaluateAssignment({ ...base, consumerSigned: false }).status).toBe("draft");
  });
});
