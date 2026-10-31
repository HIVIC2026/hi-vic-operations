import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { automaticLeadEmail } from "../src/lib/enquiry-groups.core";

// Jo 31 Oct: journeys created in the Test Centre (createTestEnquiry) get the automatic eligibility check like real leads.
// Every other TEST path keeps skipping it: the daily journey runner, Mitti pick-ups, calculator TEST addresses and
// repeat enquiries on existing TEST jobs. TEST enquiries still never auto-email.
const enquiry = readFileSync("src/lib/enquiry.server.ts", "utf8");
const portal = readFileSync("src/lib/portal.functions.ts", "utf8");
const newJobBranch = enquiry.slice(enquiry.indexOf('await logEvent(job.id, actorId, "enquiry_received"'));
const existingBranch = enquiry.slice(enquiry.indexOf("if (existingJob) {"), enquiry.indexOf('await logEvent(job.id, actorId, "enquiry_received"'));

test("new TEST job skips the automatic first work unless the Test Centre asked for it", () => {
  expect(newJobBranch).toContain('if (source === "qa_test" && !testCentreAutoChecks) return { job_id: job.id, job_number: job.job_number, created: true, post_intake: "none" as const };');
});

test("existing TEST jobs are never re-processed (old TEST jobs untouched)", () => {
  expect(existingBranch).toContain('if (source === "qa_test") return { job_id: existingJob.id, job_number: existingJob.job_number, created: false, post_intake: "none" as const };');
});

test("only the Test Centre's createTestEnquiry asks for the automatic checks", () => {
  const create = portal.slice(portal.indexOf("export const createTestEnquiry ="), portal.indexOf("export const setEligibility"));
  expect(create).toContain("{ testCentreAutoChecks: true }");
  const callers = [...(portal + readFileSync("src/lib/journey.server.ts", "utf8") + readFileSync("src/lib/mitti-pickup-auto.server.ts", "utf8") + readFileSync("src/lib/calculator-intake.server.ts", "utf8")).matchAll(/testCentreAutoChecks: true/g)];
  expect(callers.length).toBe(1);
});

test("TEST enquiries still never auto-email", () => {
  const base = { source: "qa_test", channel: "hivic_sourced", decisionSource: "automatic", reviewRequired: false, outcome: "likely_eligible", intakeWorkActive: false, declaredInsulation: "none" as const, ownerEnteredArea: true };
  expect(automaticLeadEmail(base as never).email).toBe("none");
});