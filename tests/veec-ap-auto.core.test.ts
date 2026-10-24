// Decision 271 (Jo, 25 Oct 2026): AP Part A of the VEEC assignment form signs itself — pure decision rules.
import { describe, expect, test } from "bun:test";
import { AP_AUTO_HELD_ALERT_MS, AP_AUTO_SIGNER, VEEC_AP_AUTO_EVENT, apAutoHoldAlert, decideApAutoSignature, holdReasonsChanged, type ApAutoFacts } from "../src/lib/veec-ap-auto.core";
import { apPrerequisiteBlockers, AP_DETAILS } from "../src/lib/veec-assignment-form.core";
import { consentValidityBlockers } from "../src/lib/consent.core";
import { signingOrderBlocker } from "../src/lib/assignment.core";

const ready: ApAutoFacts = { status: "awaiting_ap_signature", installerSignedAt: "2026-10-25T01:00:00Z", apSignedAt: null, prerequisiteBlockers: [], ownerConsentBlockers: [], openVariation: false, signerName: "Chris Lowe" };

describe("decision 271: automatic AP signature", () => {
  test("signs as the configured AP representative when the installer has signed and nothing blocks", () => {
    expect(decideApAutoSignature(ready)).toEqual({ action: "sign", signerName: "Chris Lowe" });
    expect(AP_AUTO_SIGNER.name).toBe(AP_DETAILS.fullName);
    expect(VEEC_AP_AUTO_EVENT).toBe("veec_ap_signed_auto");
  });

  test("never signs before the installer's Part B, twice, or out of the signing order", () => {
    expect(decideApAutoSignature({ ...ready, installerSignedAt: null, status: "awaiting_installer_signature" }).action).toBe("skip");
    expect(decideApAutoSignature({ ...ready, apSignedAt: "2026-10-25T02:00:00Z", status: "awaiting_consumer_signature" }).action).toBe("skip");
    expect(decideApAutoSignature({ ...ready, status: null }).action).toBe("skip");
    expect(decideApAutoSignature({ ...ready, status: "variation_required" }).action).toBe("skip");
    // Same order the manual path enforces: installer → ap → consumer.
    expect(signingOrderBlocker({ status: "awaiting_ap_signature", installerSigned: true, apSigned: false, consumerSigned: false, openVariation: false, consumerFinalRequired: false, consumerFinalSigned: false }, "ap")).toBeNull();
  });

  test("holds with every reason: real prerequisite blockers, owner consent, open variation, no configured signer", () => {
    const start = "2026-10-24T22:00:00Z";
    const pre = apPrerequisiteBlockers({ installStart: start, piesaCopyToInstallerAt: "2026-10-23T20:00:00Z", piesaCopyToOwnerAt: "2026-10-24T21:00:00Z", escNotificationSentAt: "2026-10-23T20:00:00Z", warrantyCopyProvidedAt: null, collectionNotices: [{ installer: "TEST Installer", providedAt: "2026-10-20T00:00:00Z" }] });
    const consent = consentValidityBlockers({ status: "awaiting_ap", scheduled_start: start, owner_signed_at: "2026-10-23T00:00:00Z", ap_signed_at: null }, start);
    const d = decideApAutoSignature({ ...ready, prerequisiteBlockers: pre, ownerConsentBlockers: consent, openVariation: true, signerName: null });
    expect(d.action).toBe("hold");
    if (d.action !== "hold") throw new Error("expected hold");
    expect(d.reasons).toEqual([
      "PIESA copy to the owner is not recorded at least 24 hours before the installation started.",
      "Product warranty copy (minimum 5 years) given to the consumer is not recorded.",
      `Owner ESC consent: ${consent[0]}`,
      "A variation is open and must be reconfirmed first.",
      "No AP representative is configured to sign Part A.",
    ]);
  });

  test("a single missing prerequisite is enough to hold; clearing it signs", () => {
    const held = decideApAutoSignature({ ...ready, prerequisiteBlockers: ["ESC scheme participant collection notice to TEST Installer is not recorded."] });
    expect(held).toEqual({ action: "hold", reasons: ["ESC scheme participant collection notice to TEST Installer is not recorded."] });
    expect(decideApAutoSignature({ ...ready, prerequisiteBlockers: [] }).action).toBe("sign");
  });

  test("Needs me alerts only after the signature has been held for more than 24 hours", () => {
    const signedAt = "2026-10-25T01:00:00Z";
    const t0 = Date.parse(signedAt);
    expect(apAutoHoldAlert({ installerSignedAt: signedAt, now: t0 + AP_AUTO_HELD_ALERT_MS - 60_000, reasons: ["x"] }).alert).toBe(false);
    expect(apAutoHoldAlert({ installerSignedAt: signedAt, now: t0 + AP_AUTO_HELD_ALERT_MS + 60_000, reasons: ["x"] }).alert).toBe(true);
    expect(apAutoHoldAlert({ installerSignedAt: signedAt, now: t0 + 3 * AP_AUTO_HELD_ALERT_MS, reasons: [] }).alert).toBe(false);
    expect(apAutoHoldAlert({ installerSignedAt: null, now: t0, reasons: ["x"] }).alert).toBe(false);
  });

  test("held events are recorded once per distinct set of reasons (no 15-minute spam)", () => {
    expect(holdReasonsChanged(null, ["a"])).toBe(true);
    expect(holdReasonsChanged(["a"], ["a"])).toBe(false);
    expect(holdReasonsChanged(["a"], ["a", "b"])).toBe(true);
    expect(holdReasonsChanged(["a", "b"], ["b", "a"])).toBe(true);
  });
});
