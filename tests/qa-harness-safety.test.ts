import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("TEST browser harness safety", () => {
  const accounts = readFileSync("src/lib/test-accounts.functions.ts", "utf8");
  const xero = readFileSync("src/lib/xero.server.ts", "utf8");
  const followups = readFileSync("src/lib/followups.server.ts", "utf8");
  const coverage = readFileSync("src/lib/coverage.functions.ts", "utf8");

  test("every privileged harness action verifies admin and qa_test", () => {
    for (const name of ["prepareQaJourneyAccess", "issueQaPersonaLink", "simulateQaJourneyTime", "archiveQaJourney"]) {
      const start = accounts.indexOf(`export const ${name}`);
      expect(start).toBeGreaterThan(0);
      const body = accounts.slice(start, accounts.indexOf("export const", start + 20) < 0 ? undefined : accounts.indexOf("export const", start + 20));
      expect(body).toContain("requireTestAdmin(context)");
      expect(body).toContain("testJob(admin, data.jobId)");
    }
  });

  test("one-time role links accept only the fixed TEST domain", () => {
    expect(accounts).toContain('email?.endsWith(QA_DOMAIN)');
    expect(accounts).toContain('user_metadata: { full_name: name, qa_test: true }');
    expect(accounts).not.toContain("userId: z.string()");
  });

  test("email and Xero boundaries reject qa_test jobs", () => {
    expect(xero).toContain('source === "qa_test"');
    expect(followups).toContain('job.source === "qa_test"');
    expect(coverage).toContain('job.source === "qa_test"');
  });

  test("cleanup revokes access and archives instead of deleting audit history", () => {
    expect(accounts).toContain('from("worker_job_links").update({ revoked_at: now');
    expect(accounts).toContain('qa_archived_at: now');
    expect(accounts).not.toContain('from("jobs").delete()');
  });
});