// Part 2b Task 3: the installer's "My electricians" list (PGlite). Real server code; only the sign-in lookup is stubbed.
import { describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const db = new PGlite();
await db.exec(`
CREATE TABLE businesses (id uuid primary key default gen_random_uuid(), business_type text, capabilities jsonb default '[]', name text, email text, phone text, rec_number text, onboarding_status text, is_active boolean, public_liability_cover_amount numeric,
  added_by_installer_business_id uuid references businesses(id), workcover_exempt_declared_at timestamptz, installer_added_rejected_reason text, onboarding_notes text);
CREATE TABLE partner_workers (id uuid primary key default gen_random_uuid(), business_id uuid, trade_role text, full_legal_name text, email text, mobile text, rec_number text, licence_number text, licence_expires_on date, approval_status text, added_by uuid, removed_at timestamptz);
CREATE TABLE business_credentials (id uuid primary key default gen_random_uuid(), business_id uuid, kind text, label text, number text, expires_at date, document_path text, verification text, critical boolean, created_by uuid);
CREATE TABLE partner_relationships (id uuid primary key default gen_random_uuid(), installer_business_id uuid not null, electrician_business_id uuid not null, active boolean not null default true, preferred boolean default false, is_primary boolean default false, source text, notes text, created_by uuid, UNIQUE (installer_business_id, electrician_business_id));
CREATE TABLE admin_config_events (id uuid primary key default gen_random_uuid(), actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default now());
`);
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const INST = id(1), INST2 = id(2), U_BOSS = id(11), U_BOSS2 = id(12), U_STAFF = id(13), U_ELEC = id(14);
await db.query(`insert into businesses (id, business_type, name, onboarding_status, is_active, capabilities) values ($1,'eec_installer','Insul One','approved',true,'[]'), ($2,'eec_installer','Insul Two','approved',true,'[]')`, [INST, INST2]);

/** One electrician business + person + PL (+ optional WorkCover) credential, linked to an installer. */
const mk = async (n: number, name: string, o: { status: string; active?: boolean; licExp: string | null; plExp?: string; wcExp?: string | null; exempt?: boolean; rejected?: string; addedBy?: string; linkTo?: string; linkActive?: boolean }) => {
  await db.query(`insert into businesses (id, business_type, name, onboarding_status, is_active, capabilities, installer_added_rejected_reason, added_by_installer_business_id, workcover_exempt_declared_at) values ($1,'rec',$2,$3,$4,'["electrician"]',$5,$6,$7)`,
    [id(n), name, o.status, o.active ?? true, o.rejected ?? null, o.addedBy ?? null, o.exempt === false ? null : new Date().toISOString()]);
  await db.query(`insert into partner_workers (business_id, trade_role, full_legal_name, email, licence_number, licence_expires_on, approval_status) values ($1,'electrician',$2,$3,$4,$5,$6)`, [id(n), name, `e${n}@x.test`, `L${n}`, o.licExp, o.status === "approved" ? "approved" : "pending"]);
  await db.query(`insert into business_credentials (business_id, kind, expires_at, verification) values ($1,'public_liability_insurance',$2,'verified')`, [id(n), o.plExp ?? "2099-01-01"]);
  if (o.wcExp) await db.query(`insert into business_credentials (business_id, kind, expires_at, verification) values ($1,'workers_comp_insurance',$2,'verified')`, [id(n), o.wcExp]);
  if (o.linkTo) await db.query(`insert into partner_relationships (installer_business_id, electrician_business_id, active, source) values ($1,$2,$3,'installer_added')`, [o.linkTo, id(n), o.linkActive ?? false]);
};
// Insul One's list: one waiting, one approved (linked, not added), one not approved, one approved whose licence lapsed, one approved with a lapsed WorkCover row (not collected since Jo 4 Nov 2026 21:08 → still approved).
await mk(20, "Wendy Waiting", { status: "submitted", active: false, licExp: "2099-01-01", addedBy: INST, linkTo: INST });
await mk(21, "Alan Approved", { status: "approved", licExp: "2099-03-04", plExp: "2098-05-06", linkTo: INST, linkActive: true });
await mk(22, "Nina Nope", { status: "submitted", active: false, licExp: "2099-01-01", rejected: "Blurry licence photo", addedBy: INST, linkTo: INST });
await mk(23, "Eddie Expired", { status: "approved", licExp: "2020-01-01", linkTo: INST, linkActive: true });
await mk(24, "Wally WorkCover", { status: "approved", licExp: "2099-01-01", wcExp: "2020-01-01", exempt: false, addedBy: INST, linkTo: INST, linkActive: true });
// A normally onboarded sole-trader REC (not installer-added): no WorkCover row, not "declared exempt", no licence expiry on file. Approved, not "expired".
await mk(25, "Solo Rec", { status: "approved", licExp: null, exempt: false, linkTo: INST, linkActive: true });
// Other installer's electrician, and an electrician with no link at all: never on Insul One's list.
await mk(30, "Other Installer's", { status: "submitted", active: false, licExp: "2099-01-01", addedBy: INST2, linkTo: INST2 });
await mk(31, "Nobody's", { status: "approved", licExp: "2099-01-01" });
// An approved electrician the office switched OFF for Insul One (link inactive, nothing pending): not shown.
await mk(32, "Olive Off", { status: "approved", licExp: "2099-01-01", linkTo: INST, linkActive: false });

const people: Record<string, { biz: string; kind: string; boss: boolean }> = { [U_BOSS]: { biz: INST, kind: "installer", boss: true }, [U_BOSS2]: { biz: INST2, kind: "installer", boss: true }, [U_STAFF]: { biz: INST, kind: "installer", boss: false }, [U_ELEC]: { biz: id(21), kind: "electrician", boss: true } };
const WorkflowErr = class extends Error {};
const realWf = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({ ...realWf, WorkflowError: WorkflowErr }));
mock.module("../src/lib/trade-view.server", () => ({
  bossOrThrow: async (u: string) => { const p = people[u]; if (!p) throw new WorkflowErr("Your sign-in isn't linked to an approved business yet."); if (!p.boss) throw new WorkflowErr("Only the business owner can see this."); return { biz: { id: p.biz, onboarding_notes: null }, kind: p.kind, boss: true }; },
}));
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { ...postgrestShim(db), storage: {} } }));
const els = await import("../src/lib/my-electricians.server");
const reject = async (p: Promise<unknown>) => (await p.then(() => null, (e: Error) => e.message));

describe("installerMyElectricians", () => {
  test("shows waiting, approved, not-approved and expired rows for this installer only, by name", async () => {
    const rows = await els.installerMyElectricians(U_BOSS);
    expect(rows.map((r) => [r.name, r.status, r.reason])).toEqual([
      ["Alan Approved", "approved", null],
      ["Eddie Expired", "expired", null],
      ["Nina Nope", "not_approved", "Blurry licence photo"],
      ["Solo Rec", "approved", null],
      ["Wally WorkCover", "approved", null], // WorkCover is not collected (Jo 4 Nov 2026)
      ["Wendy Waiting", "waiting", null],
    ]);
    const alan = rows.find((r) => r.name === "Alan Approved")!;
    expect(alan.id).toBe(id(21));
    expect(alan.licenceExpiry).toBe("2099-03-04");
    expect(alan.plExpiry).toBe("2098-05-06");
  });

  test("the other installer sees only their own", async () => {
    const rows = await els.installerMyElectricians(U_BOSS2);
    expect(rows.map((r) => [r.name, r.status])).toEqual([["Other Installer's", "waiting"]]);
  });

  test("staff, electricians and strangers are refused", async () => {
    expect(await reject(els.installerMyElectricians(U_STAFF))).toBe("Only the business owner can see this.");
    expect(await reject(els.installerMyElectricians(U_ELEC))).toBe("Only an installer's business owner can add electricians.");
    expect(await reject(els.installerMyElectricians(id(99)))).toMatch(/isn't linked/);
  });

  test("an installer with nobody on the list gets an empty list, not an error", async () => {
    await db.query(`delete from partner_relationships where installer_business_id=$1`, [INST2]);
    expect(await els.installerMyElectricians(U_BOSS2)).toEqual([]);
  });
});
