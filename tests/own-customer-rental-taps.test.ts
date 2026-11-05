// Task 19 (Jo 2 Nov 2026, answer 24): an installer's own customer (no "It's your turn" text) gets the rental quick taps by
// text straight after the installer adds the job. DRAFT wording, so the text stays behind OWN_CUSTOMER_RENTAL_TAPS_APPROVED
// (false) and the new SMS switch is off. Not on the Add a job form.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  OWN_CUSTOMER_RENTAL_SMS_TYPE, OWN_CUSTOMER_RENTAL_TAPS_APPROVED, ownCustomerRentalTapsKey, ownCustomerRentalTapsText, rentalOnlyLink,
} from "../src/lib/rental-answers.core";
import { SMS_MESSAGE_TYPES, SMS_FRESHNESS } from "../src/lib/sms.core";
import { textOwnRentalTaps, type OwnRentalTapsDeps } from "../src/lib/own-customer-rental-taps.server";
import { quickTapsLink } from "../src/lib/area-batch.core";

type Job = { id: string; channel: string | null; source: string | null; stage: string; deleted_at: string | null; originating_installer_business_id: string | null; owners: { full_name: string | null; phone: string | null } | null };
const JOB: Job = { id: "j1", channel: "installer_sourced", source: "installer_onsite", stage: "ready_check_ready_to_schedule", deleted_at: null, originating_installer_business_id: "biz-1", owners: { full_name: "Helen Owner", phone: "0400 000 000" } };

function deps(over: Partial<OwnRentalTapsDeps> & { job?: Job | null } = {}) {
  const sent: { type: string; key: string; to: string | null | undefined; body: string }[] = [];
  const testSent: { to: string; body: string }[] = [];
  const claimed = new Set<string>();
  const d: OwnRentalTapsDeps = {
    approved: true,
    readJob: async () => (over.job === undefined ? JOB : over.job),
    installerName: async () => "Sample Insulation",
    answered: async () => false,
    doNotContact: async () => false,
    allowed: async () => undefined,
    ownerLink: async () => "https://estimate.example/my-job/TOKEN",
    sendSms: async (i) => { if (claimed.has(i.idempotencyKey)) return { status: "already", detail: "Already handled", sid: null }; claimed.add(i.idempotencyKey); sent.push({ type: i.type, key: i.idempotencyKey, to: i.to, body: i.body }); return { status: "sent", detail: "ok", sid: "s" }; },
    sendTestSms: async (to, body) => { testSent.push({ to, body }); return { status: "sent", detail: "ok" }; },
    ...over,
  };
  return { d, sent, testSent };
}

describe("own customer rental taps text", () => {
  test("ON since 5 Nov 2026 (Jo: all designed templates on); link shows only the rental questions", () => {
    expect(OWN_CUSTOMER_RENTAL_TAPS_APPROVED).toBe(true);
    expect(ownCustomerRentalTapsText({ firstName: "Helen", installer: "Sample Insulation", link: "https://x/y" }))
      .toBe("Home Insulation Victoria: Hi Helen, Sample Insulation has added your ceiling insulation job. A few quick questions about your home: https://x/y");
    expect(rentalOnlyLink(quickTapsLink("https://x/my-job/T"))).toBe("https://x/my-job/T?screen=taps&only=rental");
    expect(ownCustomerRentalTapsKey("j1")).toBe("own-rental-taps:v1:j1");
  });
  test("a new owner SMS type: owner audience, quiet hours, wording approved 5 Nov 2026, its own cadence", () => {
    const t = SMS_MESSAGE_TYPES[OWN_CUSTOMER_RENTAL_SMS_TYPE];
    expect(t.audience).toBe("owner");
    expect(t.wordingApproved).toBe(true);
    expect(t.quietHours).toBe(true);
    expect(SMS_FRESHNESS[OWN_CUSTOMER_RENTAL_SMS_TYPE]).toEqual({ kind: "window" });
  });
  test("flag on: one text to the owner's mobile with the rental-only link, once per job", async () => {
    const { d, sent } = deps();
    expect(await textOwnRentalTaps("j1", d)).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "own_customer_rental_taps", key: "own-rental-taps:v1:j1", to: "0400 000 000" });
    expect(sent[0]!.body).toBe("Home Insulation Victoria: Hi Helen, Sample Insulation has added your ceiling insulation job. A few quick questions about your home: https://estimate.example/my-job/TOKEN?screen=taps&only=rental");
    expect(await textOwnRentalTaps("j1", d)).toMatch(/already/);
    expect(sent).toHaveLength(1);
  });
  test("flag off: \"awaiting approval\", nothing read or sent", async () => {
    let read = false;
    const { d, sent } = deps({ approved: false, readJob: async () => { read = true; return JOB; } });
    expect(await textOwnRentalTaps("j1", d)).toBe("awaiting approval");
    expect(sent).toHaveLength(0); expect(read).toBe(false);
  });
  test("a Home Insulation Victoria lead (not the installer's own) gets no such text", async () => {
    const { d, sent } = deps({ job: { ...JOB, channel: "hivic_sourced" } });
    expect(await textOwnRentalTaps("j1", d)).toBe("not applicable");
    expect(sent).toHaveLength(0);
  });
  test("closed, deleted, missing job or no mobile → nothing sent", async () => {
    for (const job of [{ ...JOB, stage: "cancelled" }, { ...JOB, deleted_at: "2026-11-01" }, null, { ...JOB, owners: { full_name: "H", phone: null } }]) {
      const { d, sent } = deps({ job });
      expect(await textOwnRentalTaps("j1", d)).toMatch(/not applicable|no mobile/);
      expect(sent).toHaveLength(0);
    }
  });
  test("Do not contact blocks it; messages held blocks it; already answered skips it", async () => {
    let s = deps({ doNotContact: async () => true });
    expect(await textOwnRentalTaps("j1", s.d)).toBe("do not contact"); expect(s.sent).toHaveLength(0);
    s = deps({ allowed: async () => { throw new Error("held"); } });
    expect(await textOwnRentalTaps("j1", s.d)).toBe("messages held"); expect(s.sent).toHaveLength(0);
    s = deps({ answered: async () => true });
    expect(await textOwnRentalTaps("j1", s.d)).toBe("already answered"); expect(s.sent).toHaveLength(0);
  });
  test("no owner link → nothing sent; a held send (quiet hours, switch off) is reported, not thrown", async () => {
    let s = deps({ ownerLink: async () => null });
    expect(await textOwnRentalTaps("j1", s.d)).toBe("no owner link"); expect(s.sent).toHaveLength(0);
    s = deps({ sendSms: async () => ({ status: "blocked", detail: "Quiet hours", sid: null }) });
    expect(await textOwnRentalTaps("j1", s.d)).toBe("held: Quiet hours");
  });
  test("TEST jobs go to test-send, never the real sender", async () => {
    const s = deps({ job: { ...JOB, source: "qa_test" } });
    expect(await textOwnRentalTaps("j1", s.d)).toBe("sent");
    expect(s.sent).toHaveLength(0);
    expect(s.testSent).toHaveLength(1);
  });
  test("a send failure is thrown by the sender but Add a job catches it (source check)", () => {
    const src = readFileSync("src/lib/onsite-ready-check.server.ts", "utf8");
    expect(src).toContain("textOwnRentalTaps");
    expect(src).toMatch(/try \{[^}]*textOwnRentalTaps[^}]*\}\s*catch/s);
    expect(readFileSync("src/components/trade/add-job-flow.tsx", "utf8").toLowerCase()).not.toContain("rented");
  });
});
