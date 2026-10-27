import { describe, expect, test } from "bun:test";
import { qaOfficeGlobalBlocker, qaOfficeIdentityBlocker, qaOfficeJobBlocker, type QaOfficeIdentity, type QaOfficeJob } from "../src/lib/qa-office.core";
const identity: QaOfficeIdentity = { roles: ["qa_office"], email: "qa.office@hivic-test.example", emailVerified: true };
const job: QaOfficeJob = { source: "qa_test", deletedAt: null, archivedAt: null, ownerEmail: "qa.owner@hivic-test.example", peopleEmails: ["qa.installer@hivic-test.example"], businesses: [{ id: "test-business", email: "qa.business@hivic-test.example", onboarding_notes: "[TEST PARTNER]" }] };
describe("TEST office capability foundation (not activated)", () => {
  test("real jobs are refused even with TEST contacts", () => { expect(qaOfficeJobBlocker(identity, { ...job, source: "base44" })).not.toBeNull(); });
  test("only an active TEST job with TEST people and businesses qualifies", () => { expect(qaOfficeJobBlocker(identity, job)).toBeNull(); expect(qaOfficeJobBlocker(identity, null)).not.toBeNull(); expect(qaOfficeJobBlocker(identity, { ...job, archivedAt: "2026-10-27" })).not.toBeNull(); });
  test("real owner on a TEST job is refused", () => { expect(qaOfficeJobBlocker(identity, { ...job, ownerEmail: "owner@example.com" })).not.toBeNull(); });
  test("real or unknown assigned person is refused", () => { for (const email of ["worker@example.com", null]) expect(qaOfficeJobBlocker(identity, { ...job, peopleEmails: [email] })).not.toBeNull(); });
  test("marked business with real email is refused", () => { expect(qaOfficeJobBlocker(identity, { ...job, businesses: [{ ...job.businesses[0], id: "business", email: "partner@example.com", onboarding_notes: "[TEST PARTNER]" }] })).not.toBeNull(); });
  test("TEST domain without a business mark is refused", () => { expect(qaOfficeJobBlocker(identity, { ...job, businesses: [{ id: "business", email: "qa.partner@hivic-test.example", onboarding_notes: null }] })).not.toBeNull(); });
  test("user metadata is not authorization and an unverified identity is refused", () => { expect(qaOfficeIdentityBlocker({ ...identity, emailVerified: false })).not.toBeNull(); expect(qaOfficeIdentityBlocker({ ...identity, roles: [] })).not.toBeNull(); });
  test("mixed admin and qa_office roles do not grant a TEST capability", () => { expect(qaOfficeIdentityBlocker({ ...identity, roles: ["admin", "qa_office"] })).not.toBeNull(); });
  test("settings and switches never receive a TEST office capability", () => { expect(qaOfficeGlobalBlocker()).toBeTruthy(); });
});