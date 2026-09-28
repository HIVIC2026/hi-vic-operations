import { describe, expect, test } from "bun:test";
import { agreementSignBlockers, finalConsumerSignatureRequired, evaluateAssignment, materialChanges, signingOrderBlocker, templateBlockers, type Template } from "../src/lib/assignment.core";

const T = (k: string, o: Partial<Template> = {}): Template => ({ template_key: k, version: "v1", body: "x".repeat(30), approved: true, is_active: true, required: true, ...o });
const all = [T("consumer_declaration"), T("consumer_rights"), T("esc_consent"), T("installer_declaration")];
const sign = { signatoryName: "Jo", authorityType: "owner" as const, over18: true, readConsumerInfo: true, acceptAgreement: true, acceptAssignment: true, signatureName: "Jo Citizen" };
const base = { status: "awaiting_installer_signature" as const, prepared: true, installerSigned: true, apSigned: true, consumerSigned: true, installedProduct: "R5 batts", installedArea: 120, openVariation: false, templates: all };

describe("customer agreement (quote acceptance)", () => {
  test("needs consumer rights + approved official assignment form (signed conditionally) – NOT ESC consent", () => {
    expect(agreementSignBlockers(sign, [T("consumer_rights"), T("consumer_declaration")])).toEqual([]);
    expect(agreementSignBlockers(sign, [T("consumer_rights")]).join()).toMatch(/official Activity 48/);
    expect(agreementSignBlockers(sign, [T("consumer_rights", { approved: false }), T("consumer_declaration")]).length).toBe(1);
  });
  test("18+, acceptance and conditional assignment confirmation required", () => {
    expect(agreementSignBlockers({ ...sign, over18: false, acceptAgreement: false, acceptAssignment: false }, all).length).toBe(3);
  });
});

describe("final VEEC assignment", () => {
  test("not prepared => draft", () => expect(evaluateAssignment({ ...base, prepared: false, consumerSigned: false }).status).toBe("draft"));
  test("quote-stage signature is conditional, never effective before the activity", () => {
    const q = { ...base, status: "consumer_signed_pending_install" as const, prepared: false, installerSigned: false, apSigned: false, consumerSigned: true, installedProduct: null, installedArea: null };
    expect(evaluateAssignment(q).status).toBe("consumer_signed_pending_install");
    expect(signingOrderBlocker(q, "installer")).toMatch(/after installation/);
  });
  test("post-activity: quote-stage consumer signature preserved – installer + AP complete it", () => {
    const p = { ...base, installerSigned: false, apSigned: false, consumerSigned: true };
    expect(evaluateAssignment(p).status).toBe("awaiting_installer_signature");
    expect(evaluateAssignment({ ...p, installerSigned: true }).status).toBe("awaiting_ap_signature");
    expect(evaluateAssignment({ ...p, installerSigned: true, apSigned: true }).status).toBe("effective_complete");
    expect(signingOrderBlocker({ ...p, status: "awaiting_ap_signature", installerSigned: true, apSigned: true }, "consumer")).toBe("Already signed.");
  });
  test("official form requiring final consumer signature forces re-sign", () => {
    const p = { ...base, consumerFinalRequired: true, consumerFinalSigned: false };
    expect(evaluateAssignment(p).status).toBe("awaiting_consumer_signature");
    expect(signingOrderBlocker({ ...p, status: "awaiting_consumer_signature" }, "consumer")).toBeNull();
    expect(evaluateAssignment({ ...p, consumerFinalSigned: true }).status).toBe("effective_complete");
    expect(finalConsumerSignatureRequired([T("consumer_declaration", { requires_final_consumer_signature: true })])).toBe(true);
    expect(finalConsumerSignatureRequired(all)).toBe(false);
  });
  test("signing sequence installer -> AP -> consumer", () => {
    expect(evaluateAssignment({ ...base, installerSigned: false, apSigned: false, consumerSigned: false }).status).toBe("awaiting_installer_signature");
    expect(evaluateAssignment({ ...base, apSigned: false, consumerSigned: false }).status).toBe("awaiting_ap_signature");
    expect(evaluateAssignment({ ...base, consumerSigned: false }).status).toBe("awaiting_consumer_signature");
    expect(evaluateAssignment(base).status).toBe("effective_complete");
    const s = { status: "awaiting_installer_signature", installerSigned: false, apSigned: false, consumerSigned: false, openVariation: false };
    expect(signingOrderBlocker(s, "consumer")).toMatch(/lead installer/);
    expect(signingOrderBlocker(s, "ap")).toMatch(/lead installer/);
    expect(signingOrderBlocker(s, "installer")).toBeNull();
    expect(signingOrderBlocker({ ...s, installerSigned: true }, "consumer")).toMatch(/AP/);
  });
  test("missing official template or final facts blocks effectiveness", () => {
    expect(evaluateAssignment({ ...base, templates: all.filter((t) => t.template_key !== "consumer_declaration") }).status).toBe("final_details_pending");
    expect(evaluateAssignment({ ...base, installedArea: 0 }).status).toBe("final_details_pending");
  });
  test("open variation blocks and blocks signing", () => {
    expect(evaluateAssignment({ ...base, openVariation: true }).status).toBe("variation_required");
    expect(signingOrderBlocker({ status: "variation_required", installerSigned: true, apSigned: true, consumerSigned: false, openVariation: true }, "consumer")).toMatch(/variation/);
  });
  test("material changes detected, minor ones ignored", () => {
    const s = { installer_user_id: "a", installer_business_id: "b", product: "R5 batts", area_m2: 100, price_before_benefit_inc_gst: 3000, veu_benefit_inc_gst: 1000, final_customer_price_inc_gst: 2000 };
    expect(materialChanges(s, { area_m2: 103, final_customer_price_inc_gst: 2000.5 })).toEqual([]);
    expect(materialChanges(s, { area_m2: 130, installer_user_id: "z", product: "R4 batts", final_customer_price_inc_gst: 2500 })).toEqual(["Installer changed", "Installed product changed", "Installed area changed materially", "Customer price changed"]);
  });
  test("phase blockers are separate", () => {
    expect(templateBlockers([], "agreement").length).toBe(2);
    expect(templateBlockers([], "consent")[0]).toMatch(/ESC owner consent/);
    expect(templateBlockers([], "final")[0]).toMatch(/official Activity 48/);
  });
});
