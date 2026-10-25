// Decision 370 (Jo, 25 Oct 2026): the AP part of the ESC owner consent signs itself — pure decision rules.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CONSENT_AP_AUTO_EVENT, CONSENT_AP_HELD_ALERT_MS, consentApHoldAlert, consentAutoApRep, consentHoldReasonsChanged, decideConsentApAutoSignature, type ConsentApAutoFacts,
} from "../src/lib/consent-ap-auto.core";
import { AP_DETAILS } from "../src/lib/veec-assignment-form.core";
import { ESC_CONSENT_TEMPLATE_VERSION, apConsentBlockers, apRepFullName } from "../src/lib/consent.core";
import { buildNeedsRows, type NeedsFacts } from "../src/lib/office-needs.core";

const start = "2026-11-03T22:00:00Z";
const ticks = { owner_or_authorised: true, details_accurate: true, consent_ap_sends: true, consent_commission_shares: true };
const rep = consentAutoApRep()!;
const ready: ConsentApAutoFacts = {
  status: "awaiting_ap", ownerSignedAt: "2026-10-30T01:00:00Z", apSignedAt: null, scheduledStart: start, bookingStart: start,
  templateVersion: ESC_CONSENT_TEMPLATE_VERSION, ownerDeclarations: ticks, nowIso: "2026-10-30T01:05:00Z", rep,
};

describe("decision 370: automatic AP part of the owner consent", () => {
  test("the signer is the AP representative named on the forms (same as decision 271), with complete Part A details", () => {
    expect(apRepFullName(rep)).toBe(AP_DETAILS.fullName!);
    expect(rep.role).toBe("AP representative");
    expect(rep.phone).toBe(AP_DETAILS.phone);
    expect(rep.email).toContain("@");
    expect(consentAutoApRep({ fullName: null, phone: null })).toBeNull();
    expect(consentAutoApRep({ fullName: "Chris", phone: null })).toBeNull(); // Part A needs first AND last name
    expect(CONSENT_AP_AUTO_EVENT).toBe("consent_ap_signed_auto");
  });

  test("signs when the owner has signed, the booking is unchanged and every existing check passes", () => {
    expect(decideConsentApAutoSignature(ready)).toEqual({ action: "sign", rep });
    // The very same manual rule set passes with these details (nothing is bypassed).
    expect(apConsentBlockers({ status: "awaiting_ap", scheduledStart: start, nowIso: ready.nowIso, apRepName: apRepFullName(rep), purposeExplained: true, templateVersion: ESC_CONSENT_TEMPLATE_VERSION, apRep: rep })).toEqual([]);
  });

  test("never signs before the owner, twice, or on a consent that isn't waiting for the AP", () => {
    expect(decideConsentApAutoSignature({ ...ready, ownerSignedAt: null, status: "awaiting_owner" }).action).toBe("skip");
    expect(decideConsentApAutoSignature({ ...ready, apSignedAt: "2026-10-30T02:00:00Z", status: "valid" }).action).toBe("skip");
    expect(decideConsentApAutoSignature({ ...ready, status: null }).action).toBe("skip");
    expect(decideConsentApAutoSignature({ ...ready, status: "stale" }).action).toBe("skip");
  });

  test("timing rules unchanged: inside 24 hours of the start it holds (reschedule), never signs late", () => {
    const late = decideConsentApAutoSignature({ ...ready, nowIso: "2026-11-03T00:00:00Z" });
    expect(late).toEqual({ action: "hold", reasons: ["Consent must be complete at least 24 hours before the installation starts."] });
  });

  test("holds with every reason: booking moved, missing Section 2 ticks, no configured representative", () => {
    const d = decideConsentApAutoSignature({ ...ready, bookingStart: "2026-11-05T22:00:00Z", ownerDeclarations: { ...ticks, consent_commission_shares: false }, rep: null });
    expect(d.action).toBe("hold");
    if (d.action !== "hold") throw new Error("expected hold");
    expect(d.reasons[0]).toBe("The installation booking changed after the owner signed — a new consent is needed.");
    expect(d.reasons).toContain("The owner's four Section 2 declarations are not all recorded.");
    expect(d.reasons).toContain("No AP representative is configured to sign Section 3.");
    expect(decideConsentApAutoSignature({ ...ready, bookingStart: null }).action).toBe("hold");
  });

  test("Needs me: only after 24 hours held, or when the 24h-before-start deadline is less than a day away", () => {
    const t0 = Date.parse(ready.ownerSignedAt!);
    expect(consentApHoldAlert({ ownerSignedAt: ready.ownerSignedAt, scheduledStart: start, now: t0 + CONSENT_AP_HELD_ALERT_MS - 60_000, reasons: ["x"] }).alert).toBe(false);
    expect(consentApHoldAlert({ ownerSignedAt: ready.ownerSignedAt, scheduledStart: start, now: t0 + CONSENT_AP_HELD_ALERT_MS + 60_000, reasons: ["x"] }).alert).toBe(true);
    // Owner signed 40h before the start: deadline (24h before) is 16h away -> alert straight away.
    const close = "2026-11-02T06:00:00Z";
    expect(consentApHoldAlert({ ownerSignedAt: close, scheduledStart: start, now: Date.parse(close) + 60_000, reasons: ["x"] }).alert).toBe(true);
    expect(consentApHoldAlert({ ownerSignedAt: close, scheduledStart: start, now: Date.parse(close), reasons: [] }).alert).toBe(false);
  });

  test("held events are recorded once per distinct set of reasons", () => {
    expect(consentHoldReasonsChanged(null, ["a"])).toBe(true);
    expect(consentHoldReasonsChanged(["a"], ["a"])).toBe(false);
    expect(consentHoldReasonsChanged(["a"], ["b"])).toBe(true);
  });

  test("the Needs me row shows the hold reason and keeps Sign as the fallback", () => {
    const f: NeedsFacts = { jobId: "j", jobNumber: "HV-1", surname: "Smith", suburb: "Melton", consentToSign: { at: "2026-10-30T01:00:00Z", dueAt: "2026-11-02T22:00:00Z", reasons: ["The owner's four Section 2 declarations are not all recorded."] } };
    const rows = buildNeedsRows({ now: Date.parse("2026-10-31T02:00:00Z"), jobs: [f] });
    const row = [...rows.today, ...rows.week][0]!;
    expect(row.kind).toBe("sign_consent");
    expect(row.line).toContain("AP part held");
    expect(row.line).toContain("Section 2 declarations");
    expect(row.button.label).toBe("Sign");
  });

  test("wiring: signs through the one existing path, right after the owner and on the tick; claim is conditional", () => {
    const server = readFileSync(new URL("../src/lib/consent-ap-auto.server.ts", import.meta.url), "utf8");
    expect(server).toContain("confirmApConsent({ jobId, actorId: null");
    expect(server).toContain('method: "automatic"');
    const consent = readFileSync(new URL("../src/lib/consent.server.ts", import.meta.url), "utf8");
    expect(consent).toContain("tryAutoConsentApSignature(p.jobId)");
    expect(consent).toMatch(/\.eq\("status", "awaiting_ap"\)\.is\("ap_signed_at", null\)\.select\("id"\)/);
    // The copy is filed and emailed only after the claim succeeded.
    expect(consent.indexOf("claimed?.length")).toBeLessThan(consent.indexOf("emailOwnerConsentCopy"));
    const tick = readFileSync(new URL("../src/routes/api/public/hooks/allocation-tick.ts", import.meta.url), "utf8");
    expect(tick).toContain("sweepAutoConsentApSignatures");
  });
});
