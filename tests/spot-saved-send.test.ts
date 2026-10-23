// Jo 23 Oct 2026: real Spot saved confirmation — one email + one text per owner, every guard kept.
import { describe, expect, test } from "bun:test";
import { planSpotSaved, spotSavedEmailKey, spotSavedSmsKey, type SpotSavedFacts } from "../src/lib/spot-saved-send.core";

const ok: SpotSavedFacts = {
  source: "base44", stage: "ready_check_ready_to_schedule", deletedAt: null, qaArchivedAt: null, spotSavedAt: "2026-10-20T00:00:00Z", campaignOptedOutAt: null,
  consent: true, commsEnabled: true, email: "Owner@Example.org.au", phone: "0412 345 678", emailOptedOut: false, emailSuppressed: false, smsStopped: false,
  emailSwitchOn: true, smsSwitchOn: true, hasLink: true,
};

describe("spot saved confirmation plan", () => {
  test("eligible owner gets one email and one text, keyed per owner (not per job)", () => {
    const p = planSpotSaved(ok);
    expect(p.email).toEqual({ send: true, to: "owner@example.org.au", key: spotSavedEmailKey("owner@example.org.au") });
    expect(p.sms).toEqual({ send: true, to: "+61412345678", key: spotSavedSmsKey("+61412345678") });
    expect(spotSavedEmailKey("OWNER@example.org.au ")).toBe(spotSavedEmailKey("owner@example.org.au"));
  });
  test.each([
    [{ source: "qa_test" }, "TEST job"], [{ stage: "cancelled" }, "Job cancelled"], [{ deletedAt: "x" }, "Job deleted"],
    [{ campaignOptedOutAt: "x" }, "Owner opted out"], [{ consent: false }, "No contact consent"], [{ spotSavedAt: null }, "Spot not saved"],
  ] as [Partial<SpotSavedFacts>, string][])("%o stops both channels", (over, reason) => {
    const p = planSpotSaved({ ...ok, ...over });
    expect(p.email).toEqual({ send: false, reason });
    expect(p.sms).toEqual({ send: false, reason });
  });
  test("email-only and text-only blocks", () => {
    expect(planSpotSaved({ ...ok, emailOptedOut: true }).email.send).toBe(false);
    expect(planSpotSaved({ ...ok, emailOptedOut: true }).sms.send).toBe(true);
    expect(planSpotSaved({ ...ok, smsStopped: true }).sms).toEqual({ send: false, reason: "Replied STOP" });
    expect(planSpotSaved({ ...ok, smsStopped: true }).email.send).toBe(true);
    expect(planSpotSaved({ ...ok, phone: "03 9555 1234" }).sms).toEqual({ send: false, reason: "No valid mobile" });
    expect(planSpotSaved({ ...ok, email: "nope" }).email).toEqual({ send: false, reason: "No valid email" });
  });
  test("test addresses are never real owners", () => {
    for (const e of ["a@example.com", "qa.someone@gmail.com", "jolowexo@hotmail.com"]) expect(planSpotSaved({ ...ok, email: e }).email).toEqual({ send: false, reason: "Test address" });
  });
  test("Jo's removed address is no longer classified as a Spot saved TEST address", () => {
    const email = "sweet_sunshine231@hotmail.com";
    expect(planSpotSaved({ ...ok, email }).email).toEqual({ send: true, to: email, key: spotSavedEmailKey(email) });
    expect(planSpotSaved({ ...ok, source: "qa_test", email }).email).toEqual({ send: false, reason: "TEST job" });
  });
  test("each channel has its own switch", () => {
    expect(planSpotSaved({ ...ok, emailSwitchOn: false }).email).toEqual({ send: false, reason: "Spot saved emails are switched off" });
    expect(planSpotSaved({ ...ok, smsSwitchOn: false }).sms).toEqual({ send: false, reason: "Spot saved texts are switched off" });
  });
});
