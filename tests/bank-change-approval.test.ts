// Launch blocker Task 7 (QA 7 Nov 2026): installer bank changes need the office's OK before pay goes there.
// Real server code on PGlite (the pending migration is applied to a copy of the production table shape); the sign-in
// check is stubbed per test. Nothing touches the live database.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const MIGRATION = readFileSync(new URL("../docs/pending-migrations/2026-11-07-bank-change-pending-columns.sql", import.meta.url), "utf8");
const ROLLBACK = readFileSync(new URL("../docs/pending-migrations/2026-11-07-bank-change-pending-columns.rollback.sql", import.meta.url), "utf8");

const db = new PGlite();
// Production shape (drizzle 0023 + 0051; mirrored in tests/helpers/pglite-installer.ts).
await db.exec(`
CREATE TABLE profiles (id uuid primary key, business_id uuid, full_name text, email text);
CREATE TABLE businesses (id uuid primary key, name text, onboarding_status text, onboarding_notes text);
CREATE TABLE business_members (id uuid primary key default gen_random_uuid(), business_id uuid not null, user_id uuid not null, member_role text not null, active boolean not null default true);
CREATE TABLE business_bank_details (business_id uuid primary key references businesses(id), account_name text NOT NULL, bsb text NOT NULL, account_number text NOT NULL,
  updated_by uuid references profiles(id), updated_at timestamptz NOT NULL default now(), supplied_by uuid references profiles(id), supplied_at timestamptz,
  reviewed_by uuid references profiles(id), reviewed_at timestamptz, review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','reviewed')));
CREATE TABLE business_bank_detail_events (id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id), actor_id uuid not null references profiles(id),
  event_type text not null CHECK (event_type IN ('supplied','changed','reviewed')), details jsonb not null default '{}', created_at timestamptz not null default now());
CREATE TABLE admin_config_events (id uuid primary key default gen_random_uuid(), actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default now());
`);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const BIZ = id(1), BOSS = id(11), OFFICE = id(50);
await db.query("insert into profiles (id, business_id) values ($1,$2), ($3,null)", [BOSS, BIZ, OFFICE]);
await db.query("insert into businesses (id, name, onboarding_status) values ($1,'Insul One','approved')", [BIZ]);
await db.query("insert into business_members (business_id, user_id, member_role) values ($1,$2,'business_admin')", [BIZ, BOSS]);

const WorkflowErr = class extends Error {};
const realWf = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({ ...realWf, WorkflowError: WorkflowErr }));
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db) }));
let caller = { userId: BOSS, admin: false };
mock.module("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: (d: unknown) => unknown = (d) => d;
    const b = { middleware: () => b, inputValidator: (fn: typeof validate) => { validate = fn; return b; },
      handler: (h: (a: { data: unknown; context: unknown }) => Promise<unknown>) => async (a: { data?: unknown }) =>
        h({ data: validate(a?.data), context: { userId: caller.userId, supabase: { rpc: async () => ({ data: caller.admin, error: null }) } } }) };
    return b;
  },
  createMiddleware: () => ({ server: () => ({}) }),
}));

const pilot = await import("../src/lib/pilot.functions");
const bank = await import("../src/lib/bank-approval.server");
const partners = await import("../src/lib/office-partners.server");
const { approvedBankAccount, BANK_CHANGE_WAITING, BANK_CHANGE_WAITING_INSTALLER } = await import("../src/lib/bank-approval.core");
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

const asBoss = () => { caller = { userId: BOSS, admin: false }; };
const asOffice = () => { caller = { userId: OFFICE, admin: true }; };
const save = (account_number: string, bsb = "063-000", account_name = "Insul One Pty Ltd") => pilot.setBankDetails({ data: { businessId: BIZ, account_name, bsb, account_number } });
const approve = () => pilot.approveBankDetails({ data: { businessId: BIZ } });
const row = async () => (await db.query<Record<string, unknown>>("select * from business_bank_details where business_id=$1", [BIZ])).rows[0] ?? null;
const events = async () => (await db.query<{ event_type: string; actor_id: string; details: Record<string, unknown> }>("select event_type, actor_id, details from business_bank_detail_events where business_id=$1 order by created_at, id", [BIZ])).rows;

beforeEach(async () => {
  await db.exec("DELETE FROM business_bank_detail_events; DELETE FROM business_bank_details;");
  await db.exec(MIGRATION);
  asBoss();
});

describe("bank change approval (Task 7)", () => {
  test("pending migration is idempotent and its rollback removes only the new columns", async () => {
    await db.exec(MIGRATION); // second run: no-op
    const cols = async () => (await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_name='business_bank_details' order by column_name")).rows.map((r) => r.column_name);
    expect(await cols()).toEqual(expect.arrayContaining(["pending_account_name", "pending_bsb", "pending_account_number", "account_number", "review_status"]));
    await db.exec(ROLLBACK);
    expect((await cols()).filter((c) => c.startsWith("pending_"))).toEqual([]);
    await db.exec(ROLLBACK); // idempotent
    await db.exec(MIGRATION);
  });

  test("first bank details need office approve before payout", async () => {
    await save("11112222");
    expect((await row())?.["review_status"]).toBe("pending");
    expect((await bank.payoutBankHolds([BIZ])).get(BIZ)).toBe("Bank change waiting");
    expect((await bank.payoutBankHolds([id(2)])).get(id(2))).toBe("Bank details not given (collected after approval)");
    asOffice(); await approve();
    expect((await bank.payoutBankHolds([BIZ])).get(BIZ)).toBeNull();
  });

  test("change keeps old approved account until approved", async () => {
    await save("11112222"); asOffice(); await approve(); asBoss();
    await save("99998888", "123-456", "Someone Else");
    const r = await row();
    expect(r).toMatchObject({ account_number: "11112222", bsb: "063-000", account_name: "Insul One Pty Ltd", review_status: "reviewed", pending_account_number: "99998888", pending_bsb: "123-456", pending_account_name: "Someone Else" });
    expect((await events()).map((e) => e.event_type)).toEqual(["supplied", "reviewed", "changed"]);
    // Entering the approved account again clears the waiting change.
    await save("11112222");
    expect(await row()).toMatchObject({ account_number: "11112222", review_status: "reviewed", pending_account_number: null });
  });

  test("payout uses last approved account while change pending", async () => {
    await save("11112222"); asOffice(); await approve(); asBoss();
    await save("99998888", "123-456", "Someone Else");
    expect((await bank.payoutBankHolds([BIZ])).get(BIZ)).toBeNull();
    expect(approvedBankAccount((await row()) as never)).toEqual({ accountName: "Insul One Pty Ltd", bsb: "063-000", accountNumber: "11112222" });
    const shown = await partners.revealBank(BIZ, OFFICE);
    expect(shown).toMatchObject({ account: "11112222", bsb: "063-000" });
    expect(shown?.pending).toMatchObject({ account: "99998888", bsb: "123-456", accountName: "Someone Else" });
    const file = await bank.bankChangesWaiting();
    expect(file).toEqual([{ businessId: BIZ, name: "Insul One" }]);
  });

  test("only admin can approve", async () => {
    await save("11112222");
    await expect(approve()).rejects.toThrow(/Admin only/);
    expect((await row())?.["review_status"]).toBe("pending");
    expect((await events()).map((e) => e.event_type)).toEqual(["supplied"]);
  });

  test("approve moves pending to approved and logs event", async () => {
    await save("11112222"); asOffice(); await approve(); asBoss();
    await save("99998888", "123-456", "Someone Else");
    asOffice(); await approve();
    expect(await row()).toMatchObject({ account_number: "99998888", bsb: "123-456", account_name: "Someone Else", review_status: "reviewed", reviewed_by: OFFICE, pending_account_number: null, pending_bsb: null, pending_account_name: null });
    const ev = await events();
    expect(ev.map((e) => e.event_type)).toEqual(["supplied", "reviewed", "changed", "reviewed"]);
    expect(ev[3]).toMatchObject({ actor_id: OFFICE, details: { account_last3: "888", bsb_last3: "456", changed: true } });
    expect(await bank.bankChangesWaiting()).toEqual([]);
    // A second Approve with nothing waiting changes nothing and logs nothing.
    await approve();
    expect((await events()).length).toBe(4);
  });

  test("before the migration runs, a change falls back to the held live write (never paid unapproved)", async () => {
    await save("11112222"); asOffice(); await approve(); asBoss();
    await db.exec(ROLLBACK);
    await save("99998888", "123-456", "Someone Else");
    expect(await row()).toMatchObject({ account_number: "99998888", review_status: "pending" });
    expect((await bank.payoutBankHolds([BIZ])).get(BIZ)).toBe("Bank change waiting");
  });

  test("Mark paid and the Payouts tab both read the bank hold", () => {
    const office = readFileSync(new URL("../src/lib/office.functions.ts", import.meta.url), "utf8");
    const money = readFileSync(new URL("../src/lib/office-money.server.ts", import.meta.url), "utf8");
    const markPaid = office.slice(office.indexOf("export const markPayoutPaid"), office.indexOf("export const getMoneyOverview"));
    expect(markPaid).toMatch(/payoutPayeeBusiness\(/);
    expect(markPaid).toMatch(/payoutBankHolds\(/);
    expect(money.slice(money.indexOf("export async function moneyPayouts"))).toMatch(/payoutBankHolds\(/);
  });
});

describe("bank change approval — fix round 1 (review of PR C)", () => {
  test("approvedBankFor is gone (only a test used it)", () => {
    expect("approvedBankFor" in bank).toBe(false);
  });

  test("Partners > Approved row shows the waiting chip linking to the business file, with no Approve there", () => {
    const page = src("routes/_authenticated/admin.partners.tsx");
    const approved = page.slice(page.indexOf("function Approved("), page.indexOf("\nfunction ", page.indexOf("function Approved(") + 10));
    expect(page).not.toMatch(/approveBankDetails/);
    expect(approved).not.toMatch(/>Approve</);
    // The chip sits inside a Link to that business's file.
    expect(approved).toMatch(/<Link[^>]*to="\/admin\/partners\/business\/\$businessId"[^>]*params=\{\{ businessId: b\.id \}\}[^>]*>\s*<Pill tone="amber">\{BANK_CHANGE_WAITING\}<\/Pill>\s*<\/Link>/);
    // Approve lives on the business file Bank panel, beside the masked waiting and current accounts.
    const file = src("routes/_authenticated/admin.partners_.business.$businessId.tsx");
    const panel = file.slice(file.indexOf("function BankPanel("), file.indexOf("\nfunction ", file.indexOf("function BankPanel(") + 10));
    expect(panel).toMatch(/useAction\(approveBankDetails\)/);
    expect(panel).toMatch(/approve\(\{ businessId \}/);
    expect(panel).toMatch(/m\.accountName/);
    expect(panel).toMatch(/\{p\.accountName\} · \{p\.bsb\} · \{p\.account\}/);
  });

  test("installer sees the approved waiting line while a change is waiting", async () => {
    expect(BANK_CHANGE_WAITING_INSTALLER).toBe("Bank change waiting for Home Insulation Victoria to check");
    const get = () => pilot.getBankDetails({ data: { businessId: BIZ } }) as Promise<Record<string, unknown> | null>;
    await save("11112222");
    expect(await get()).toMatchObject({ change_waiting: true, account_number: "****222" });
    asOffice(); await approve(); asBoss();
    expect(await get()).toMatchObject({ change_waiting: false, account_number: "****222" });
    await save("99998888", "123-456", "Someone Else");
    // Still the approved account on screen (masked), plus the waiting line; the waiting numbers are never sent to the trade.
    const shown = await get();
    expect(shown).toMatchObject({ change_waiting: true, account_number: "****222", account_name: "Insul One Pty Ltd" });
    expect(JSON.stringify(shown)).not.toMatch(/9999|8888|Someone Else/);
    asOffice(); await approve(); asBoss();
    expect(await get()).toMatchObject({ change_waiting: false, account_number: "****888" });
    // The installer bank screen shows the approved words only while change_waiting.
    const screen = src("routes/_authenticated/field.business_.bank.tsx");
    expect(screen).toMatch(/data\?\.change_waiting && [^\n]*\{BANK_CHANGE_WAITING_INSTALLER\}/);
    expect(BANK_CHANGE_WAITING_INSTALLER.startsWith(BANK_CHANGE_WAITING)).toBe(true);
  });

  test("a save that writes the live account clears any stale waiting change", async () => {
    await save("11112222"); asOffice(); await approve(); asBoss();
    await save("99998888", "123-456", "Someone Else");
    // Re-activation (activation SQL 0081–0083) upserts the live account back to 'pending' and leaves pending_* alone.
    await db.query("update business_bank_details set account_number='55554444', review_status='pending' where business_id=$1", [BIZ]);
    await save("77776666");
    expect(await row()).toMatchObject({ account_number: "77776666", review_status: "pending", pending_account_number: null, pending_bsb: null, pending_account_name: null });
    asOffice(); await approve();
    expect(await row()).toMatchObject({ account_number: "77776666", review_status: "reviewed" });
  });

  test("approve after a re-activation approves the live account, never the stale waiting change", async () => {
    await save("11112222"); asOffice(); await approve(); asBoss();
    await save("99998888", "123-456", "Someone Else");
    await db.query("update business_bank_details set account_number='55554444', review_status='pending' where business_id=$1", [BIZ]);
    const shown = await partners.revealBank(BIZ, OFFICE);
    expect(shown).toMatchObject({ account: "55554444", pending: null });
    asOffice(); await approve();
    expect(await row()).toMatchObject({ account_number: "55554444", account_name: "Insul One Pty Ltd", review_status: "reviewed", pending_account_number: null });
    expect((await events()).at(-1)).toMatchObject({ event_type: "reviewed", details: { account_last3: "444", changed: false } });
  });

  test("bankChangesWaiting lists approved businesses only and reads past 200 rows", async () => {
    const PENDING_BIZ = id(3);
    await db.query("insert into businesses (id, name, onboarding_status) values ($1,'Applicant Co','pending') on conflict do nothing", [PENDING_BIZ]);
    await db.query("insert into business_bank_details (business_id, account_name, bsb, account_number) values ($1,'A','063000','12345678')", [PENDING_BIZ]);
    const many = Array.from({ length: 205 }, (_, i) => id(1000 + i));
    await db.query("insert into businesses (id, name, onboarding_status) select x, 'Biz ' || x, 'approved' from unnest($1::uuid[]) x on conflict do nothing", [many]);
    await db.query("insert into business_bank_details (business_id, account_name, bsb, account_number) select x, 'A', '063000', '12345678' from unnest($1::uuid[]) x", [many]);
    await save("11112222");
    const waiting = (await bank.bankChangesWaiting()).map((w) => w.businessId);
    expect(waiting).not.toContain(PENDING_BIZ);
    expect(waiting).toContain(BIZ);
    expect(new Set(waiting).size).toBe(206);
    const fn = src("lib/bank-approval.server.ts");
    const body = fn.slice(fn.indexOf("export async function bankChangesWaiting"), fn.indexOf("export async function payoutPayeeBusiness"));
    expect(body).not.toMatch(/limit\(5000\)/);
    expect(body).toMatch(/\.range\(/);
    expect(body).toMatch(/onboarding_status", "approved"/);
  });
});
