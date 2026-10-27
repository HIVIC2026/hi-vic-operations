// Jo 27 Oct 13:15: only a TEST-domain owner on a qa_test job, asking by email, gets a TEST code copy.
import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { qaOwnerCodeCopyAllowed } from "../src/lib/owner-verify.core";

test("real owners never get a stored code copy", () => {
  expect(qaOwnerCodeCopyAllowed("website", "email", "pat@gmail.com")).toBe(false);
  expect(qaOwnerCodeCopyAllowed("base44", "email", "qa.owner@hivic-test.example")).toBe(false);
  expect(qaOwnerCodeCopyAllowed(null, "email", "qa.owner@hivic-test.example")).toBe(false);
  expect(qaOwnerCodeCopyAllowed("qa_test", "email", "pat@gmail.com")).toBe(false);
  expect(qaOwnerCodeCopyAllowed("qa_test", "sms", "qa.owner@hivic-test.example")).toBe(false);
  expect(qaOwnerCodeCopyAllowed("qa_test", "email", "qa.owner@hivic-test.example.com")).toBe(false);
});

test("TEST-domain owner on a qa_test job asking by email gets a copy", () => {
  expect(qaOwnerCodeCopyAllowed("qa_test", "email", "QA.Owner@hivic-test.example")).toBe(true);
});

test("the TEST code table is unreadable to signed-in and anonymous users (practice database)", async () => {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;`);
  await db.exec(readFileSync(new URL("../docs/pending-migrations/qa-owner-codes.sql", import.meta.url), "utf8"));
  await db.exec(`INSERT INTO qa_owner_codes (job_id, code_id, code, expires_at) VALUES (gen_random_uuid(), gen_random_uuid(), '123456', now())`);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`SET ROLE ${role}`);
    await expect(db.query(`SELECT code FROM qa_owner_codes`)).rejects.toThrow();
    await db.exec(`RESET ROLE`);
  }
  await db.exec(`SET ROLE service_role`);
  expect((await db.query(`SELECT code FROM qa_owner_codes`)).rows.length).toBe(1);
});
