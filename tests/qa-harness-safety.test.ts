import { describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fixture, id, email } from "./helpers/qa-fixture.mjs";

// Exercise the real server functions and shared guards in the existing disposable QA fixture.
// No live Auth, database, messages, password resets or account preparation is used by this suite.
async function withQaFixture(run: (io: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
  const cleanups: (() => unknown | Promise<unknown>)[] = [];
  try {
    await run(await fixture({ after: (cleanup: () => unknown | Promise<unknown>) => cleanups.push(cleanup) }));
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup();
  }
}

describe("TEST browser harness safety", () => {
  const accounts = readFileSync("src/lib/test-accounts.functions.ts", "utf8");
  const access = readFileSync("src/lib/qa-access.server.ts", "utf8");
  const xero = readFileSync("src/lib/xero.server.ts", "utf8");
  const followups = readFileSync("src/lib/followups.server.ts", "utf8");
  const coverage = readFileSync("src/lib/coverage.functions.ts", "utf8");
  const workflow = readFileSync("src/lib/workflow.server.ts", "utf8");

  test("every privileged journey action rejects missing admin access and inactive or non-TEST jobs before writes", async () => {
    await withQaFixture(async (io) => {
      const data = { jobId: id(1) };
      const actions = [
        () => io.handlers.prepareQaJourneyAccess({ data }),
        () => io.handlers.issueQaPersonaLink({ data: { ...data, persona: "owner" } }),
        () => io.handlers.issueQaWorkerLink({ data }),
        () => io.handlers.simulateQaJourneyTime({ data: { ...data, simulation: "response_24h" } }),
        () => io.handlers.archiveQaJourney({ data }),
        () => io.handlers.simulateQaPayment({ data: { ...data, reason: "TEST safety fixture" } }),
      ];
      const before = await io.snapshot();
      io.isAdmin = false;
      for (const action of [...actions, () => io.handlers.createTestTradeAccounts({ data: {} })]) await assert.rejects(action, /Admin only/);
      io.isAdmin = true;
      io.fail.set("admin:has_role", "Administrator check unavailable");
      for (const action of actions) await assert.rejects(action, /Administrator check unavailable/);
      io.fail.clear();
      expect(await io.snapshot()).toEqual(before);
      for (const sql of ["UPDATE jobs SET source='base44'", "UPDATE jobs SET qa_archived_at=now()", "UPDATE jobs SET deleted_at=now()"]) {
        await io.db.exec("BEGIN");
        try {
          await io.db.exec(sql);
          const restricted = await io.snapshot();
          for (const action of actions) await assert.rejects(action, /active TEST journey/);
          expect(await io.snapshot()).toEqual(restricted);
        } finally { await io.db.exec("ROLLBACK"); }
      }
      expect(io.issued).toEqual([]);
    });
  });

  test("one-time role links reject lookalike domains and require the existing TEST Auth identity", async () => {
    await withQaFixture(async (io) => {
      const user = io.users.get(id(11))!;
      const original = structuredClone(user);
      for (const unsafe of ["qa@hivic-test.example.evil.test", "qa@evil.test@hivic-test.example", "qa@example.test"]) {
        user.email = unsafe;
        await io.db.query("UPDATE profiles SET email=$1 WHERE id=$2", [unsafe, id(11)]);
        const before = await io.snapshot();
        await assert.rejects(() => io.handlers.issueQaPersonaLink({ data: { jobId: id(1), persona: "installer_boss" } }), /safely isolated/);
        expect(await io.snapshot()).toEqual(before);
      }
      Object.assign(user, original);
      await io.db.query("UPDATE profiles SET email=$1 WHERE id=$2", [email.installer, id(11)]);
      user.user_metadata.qa_test = false;
      const before = await io.snapshot();
      await assert.rejects(() => io.handlers.issueQaPersonaLink({ data: { jobId: id(1), persona: "installer_boss" } }), /TEST identity/);
      expect(await io.snapshot()).toEqual(before);
      expect(io.issued).toEqual([]);
    });
  });

  test("existing TEST passwords, roles and approvals are preserved during preparation and sign-in", async () => {
    expect(accounts + access).not.toContain('Hivic-Test-Only-2026!'); // no shared password in application code
    await withQaFixture(async (io) => {
      const before = await io.snapshot();
      await io.handlers.prepareQaJourneyAccess({ data: { jobId: id(1) } });
      for (const persona of ["owner", "installer_boss", "electrician"]) {
        const link = await io.handlers.issueQaPersonaLink({ data: { jobId: id(1), persona } });
        expect(link.type).toBe("magiclink");
      }
      expect(await io.snapshot()).toEqual(before);
      expect(io.issued.map((entry: { email: string }) => entry.email)).toEqual([email.owner, email.installer, email.electrician]);
      expect(io.calls.some((call: string) => call.endsWith(":insert") || call.endsWith(":update") || call === "auth:createUser")).toBe(false);
    });
  });

  test("email and Xero boundaries reject qa_test jobs", () => {
    expect(xero).toContain('source === "qa_test"');
    expect(followups).toContain('job.source === "qa_test"');
    expect(coverage).toContain('job.source === "qa_test"');
  });

  test("TEST identities cannot act on live or archived jobs", () => {
    expect(workflow).toContain('user_metadata?.["qa_test"] === true');
    expect(workflow).toContain('job.source !== "qa_test" || job.qa_archived_at');
  });

  test("cleanup revokes access and archives instead of deleting audit history", () => {
    expect(accounts).toContain('from("worker_job_links").update({ revoked_at: now');
    expect(accounts).toContain('qa_archived_at: now');
    expect(accounts).not.toContain('from("jobs").delete()');
  });
});