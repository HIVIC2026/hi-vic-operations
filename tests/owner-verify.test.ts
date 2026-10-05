import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { codeBlocker, isCode, maskContact, newCode, requestBlocker, sessionUsable } from "../src/lib/owner-verify.core";

const SQL = readFileSync(new URL("../docs/pending-migrations/0120_owner_link_codes.sql", import.meta.url), "utf8");
const ROLLBACK = readFileSync(new URL("../docs/pending-migrations/0120_owner_link_codes.rollback.sql", import.meta.url), "utf8");

describe("owner verification rules", () => {
  test("codes are 6 digits", () => { expect(newCode(() => 0.000001)).toBe("000001"); expect(isCode(newCode())).toBe(true); expect(isCode("12345")).toBe(false); });
  test("masking hides contact details", () => { expect(maskContact("sms", "0412 345 678")).toBe("•••• ••• 678"); expect(maskContact("email", "jane@example.com")).toBe("j•••@example.com"); expect(maskContact("email", null)).toBeNull(); });
  test("expired, used and over-tried codes are blocked", () => {
    const now = Date.parse("2026-10-05T00:00:00Z");
    expect(codeBlocker({ attempts: 0, expires_at: "2026-10-05T00:05:00Z", verified_at: null }, now)).toBeNull();
    expect(codeBlocker({ attempts: 0, expires_at: "2026-10-04T23:59:00Z", verified_at: null }, now)).toContain("expired");
    expect(codeBlocker({ attempts: 5, expires_at: "2026-10-05T00:05:00Z", verified_at: null }, now)).toContain("Too many");
    expect(codeBlocker({ attempts: 0, expires_at: "2026-10-05T00:05:00Z", verified_at: "x" }, now)).toContain("already");
    expect(requestBlocker(5)).not.toBeNull(); expect(requestBlocker(4)).toBeNull();
    expect(sessionUsable({ session_expires_at: "2026-10-05T00:01:00Z" }, now)).toBe(true);
    expect(sessionUsable({ session_expires_at: null }, now)).toBe(false);
  });
});

describe("practice database: owner_link_codes", () => {
  test("applies, is server-only, and rolls back", async () => {
    const db = new PGlite();
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE TABLE public.jobs (id uuid primary key default gen_random_uuid()); GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;`);
    await db.exec(SQL);
    const job = (await db.query<{ id: string }>("INSERT INTO public.jobs DEFAULT VALUES RETURNING id")).rows[0]!.id;
    await db.query("INSERT INTO public.owner_link_codes(job_id, channel, destination_masked, code_hash, expires_at) VALUES ($1,'sms','x','h', now())", [job]);
    await expect(db.query("INSERT INTO public.owner_link_codes(job_id, channel, destination_masked, code_hash, expires_at) VALUES ($1,'fax','x','h', now())", [job])).rejects.toThrow();
    await db.exec("SET ROLE authenticated");
    await expect(db.query("SELECT * FROM public.owner_link_codes")).rejects.toThrow();
    await db.exec("RESET ROLE; SET ROLE anon");
    await expect(db.query("SELECT * FROM public.owner_link_codes")).rejects.toThrow();
    await db.exec("RESET ROLE");
    await db.exec(ROLLBACK);
    expect((await db.query("SELECT to_regclass('public.owner_link_codes') r")).rows[0]).toEqual({ r: null });
  });
});
