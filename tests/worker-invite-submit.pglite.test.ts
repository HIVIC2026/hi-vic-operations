// submitWorkerInvite against a practice Postgres (PGlite) that carries the REAL signed-invite guard from applied
// migration 0072 (`guard_signed_worker_invite` + `signed_worker_invite_immutable`): once used_at is set, any update or
// delete on that invite row raises "Signed worker invitation is immutable". The bug (5 Nov 2026): the function claimed
// the invite first and wrote the signature afterwards, so every signature write and every "reset used_at" failed.
// Jo 5 Nov 2026: the worker declarations are dropped. Registration saves details only (no ticks, no signature) and the
// completion link takes the certificate only, when one is needed. `declarations_due` is never read or written any more.
// Real server code; storage, the upload byte check and the request middleware are stubbed. Never touches the live DB.
import { afterAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { embedShim } from "./helpers/pglite-embed-shim";
import { hashToken, newToken } from "../src/lib/worker-links.core";

const db = new PGlite();
await db.exec(`
CREATE TABLE businesses (id uuid primary key default gen_random_uuid(), name text not null, trading_name text);
CREATE TABLE partner_workers (id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id), full_legal_name text, email text, mobile text,
  trade_role text, worker_role text CHECK (worker_role IS NULL OR worker_role IN ('lead','crew')), licence_number text, qualification text, added_by uuid, approval_status text not null default 'pending', certification_status text, certification jsonb,
  removed_at timestamptz, declarations_due boolean not null default false, UNIQUE (business_id, email));
CREATE TABLE partner_worker_identity (worker_id uuid primary key references partner_workers(id) on delete cascade, date_of_birth date not null, updated_by uuid);
CREATE TABLE partner_worker_invites (id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id), created_by uuid, invitee_name text not null,
  invitee_contact text, trade_role text not null, token_hash text not null unique, expires_at timestamptz not null, used_at timestamptz, revoked_at timestamptz,
  worker_id uuid references partner_workers(id) on delete set null, signed_name text, signed_ip text, signed_user_agent text, declarations jsonb, created_at timestamptz not null default now());
CREATE TABLE admin_config_events (id uuid primary key default gen_random_uuid(), actor_id uuid, event_type text not null, summary text not null, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
`);
// The guard exactly as applied (0072): only the function and its trigger.
const m0072 = readFileSync("drizzle/migrations/0072_worker_invite_atomic.sql", "utf8");
const guardFn = /CREATE FUNCTION public\.guard_signed_worker_invite\(\)[\s\S]*?END \$\$;/.exec(m0072)![0];
const guardTrigger = /CREATE TRIGGER signed_worker_invite_immutable[^;]*;/.exec(m0072)![0];
await db.exec(guardFn.replace(/public\./g, ""));
await db.exec(guardTrigger.replace(/public\./g, ""));

// Fault injection and "another request got there first", by table + write kind, one-shot.
type Op = "update" | "insert" | "delete";
const faults: { table: string; op: Op }[] = [];
const before: { table: string; op: Op; fn: () => Promise<unknown> }[] = [];
const base = embedShim(db, { partner_worker_invites: { businesses: { table: "businesses", fk: "business_id", on: "base" } } });
const storage = { from: () => ({ list: async () => ({ data: [{ name: "eec.pdf" }], error: null }) }) };
const admin = {
  storage,
  from(table: string) {
    const target = base.from(table) as Record<string | symbol, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    let op: Op | "select" = "select";
    const wrap: any = new Proxy(target, { // eslint-disable-line @typescript-eslint/no-explicit-any
      get(t, prop) {
        if (prop === "then") return (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
          const f = faults.findIndex((x) => x.table === table && x.op === op);
          if (f >= 0) { faults.splice(f, 1); return Promise.resolve({ data: null, error: { message: "injected fault" } }).then(res, rej); }
          const h = before.findIndex((x) => x.table === table && x.op === op);
          const pre = h >= 0 ? before.splice(h, 1)[0]!.fn() : Promise.resolve();
          return pre.then(() => t.run()).then(res, rej);
        };
        const v = t[prop];
        if (typeof v !== "function") return v;
        return (...a: unknown[]) => { if (prop === "update" || prop === "insert" || prop === "delete") op = prop; const r = v.apply(t, a); return r === t ? wrap : r; };
      },
    });
    return wrap;
  },
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("../src/lib/upload-safety.server", () => ({ verifyStoredUpload: async () => undefined }));
mock.module("../src/lib/request-meta", () => ({ withRequestMeta: {} }));
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
mock.module("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: (d: unknown) => unknown = (d) => d;
    const b = { middleware: () => b, inputValidator: (fn: typeof validate) => { validate = fn; return b; },
      handler: (h: (a: { data: unknown; context: unknown }) => Promise<unknown>) => async (a: { data: unknown }) =>
        h({ data: validate(a.data), context: { ip: "203.0.113.9", userAgent: "TestPhone/1" } }) };
    return b;
  },
  createMiddleware: () => ({ server: () => ({}) }),
}));
const { submitWorkerInvite, getWorkerInvite } = (await import("../src/lib/worker-invite.functions")) as unknown as { submitWorkerInvite: (a: { data: unknown }) => Promise<{ ok: boolean; errors?: string[] }>; getWorkerInvite: (a: { data: unknown }) => Promise<Record<string, unknown>> };

const BIZ = "00000000-0000-4000-8000-000000000001", OWNER = "00000000-0000-4000-8000-0000000000b1";
await db.query("insert into businesses (id, name, trading_name) values ($1, 'Sparks Pty Ltd', 'Sparks')", [BIZ]);
afterAll(async () => { await db.close(); });
beforeEach(() => { faults.length = 0; before.length = 0; });

async function invite(o: { trade: "electrician" | "installer"; workerId?: string }) {
  const token = newToken();
  const { rows } = await db.query<{ id: string }>(
    "insert into partner_worker_invites (business_id, created_by, invitee_name, trade_role, token_hash, expires_at, worker_id) values ($1,$2,'Ed Spark',$3,$4, now() + interval '7 days', $5) returning id",
    [BIZ, OWNER, o.trade, await hashToken(token), o.workerId ?? null]);
  return { token, id: rows[0]!.id };
}
/** `due` is the OLD flag: a stale `true` left on a row must change nothing. */
async function worker(o: { trade: "electrician" | "installer"; due?: boolean; email: string; certification?: unknown; certStatus?: string }) {
  const { rows } = await db.query<{ id: string }>(
    "insert into partner_workers (business_id, full_legal_name, email, mobile, trade_role, approval_status, declarations_due, certification, certification_status) values ($1,'Ed Spark',$2,'0412345678',$3,'pending',$4,$5,$6) returning id",
    [BIZ, o.email, o.trade, o.due ?? false, o.certification ? JSON.stringify(o.certification) : null, o.certStatus ?? null]);
  return rows[0]!.id;
}
const inviteRow = async (id: string) => (await db.query<Record<string, any>>("select * from partner_worker_invites where id = $1", [id])).rows[0]!; // eslint-disable-line @typescript-eslint/no-explicit-any
const workerRow = async (id: string) => (await db.query<Record<string, any>>("select * from partner_workers where id = $1", [id])).rows[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
const workersByEmail = async (email: string) => (await db.query<{ id: string }>("select id from partner_workers where email = $1", [email])).rows;
const sign = (token: string, extra: Record<string, unknown> = {}) => ({ data: { token, full_legal_name: "Ed Spark", mobile: "0412345678", email: "ed@sparks.test", ...extra } });
const register = (token: string, email: string, extra: Record<string, unknown> = {}) => sign(token, { email, licence_number: "A12345", date_of_birth: "1990-05-01", ...extra });

describe("the practice database really carries the 0072 guard", () => {
  test("an update on a used invite raises 'Signed worker invitation is immutable'", async () => {
    const { id } = await invite({ trade: "electrician" });
    await db.query("update partner_worker_invites set used_at = now() where id = $1", [id]);
    await expect(db.query("update partner_worker_invites set signed_name = 'x' where id = $1", [id])).rejects.toThrow("Signed worker invitation is immutable");
    await expect(db.query("update partner_worker_invites set used_at = null where id = $1", [id])).rejects.toThrow("Signed worker invitation is immutable");
  });
});

describe("completion link (existing installer uploads the certificate; nothing to sign)", () => {
  const cert = (id: string) => ({ certificate_path: `worker-invites/${id}/eec-abc.pdf` });
  test("certificate saved, link used, no declarations or signature written", async () => {
    const w = await worker({ trade: "installer", email: "c2@sparks.test" });
    const { token, id } = await invite({ trade: "installer", workerId: w });
    expect(await submitWorkerInvite(sign(token, cert(id)))).toEqual({ ok: true });
    const inv = await inviteRow(id);
    expect(inv.used_at).not.toBeNull();
    expect(inv.declarations).toBeNull();
    expect(inv.signed_name).toBeNull();
    expect(inv.signed_ip).toBe("203.0.113.9");
    expect(inv.signed_user_agent).toBe("TestPhone/1");
    expect((await workerRow(w))!.certification.eec_upload.path).toBe(`worker-invites/${id}/eec-abc.pdf`);
  });

  test("a stale declarations_due flag changes nothing: the link still takes only the certificate and leaves the flag alone", async () => {
    const w = await worker({ trade: "installer", due: true, email: "c1@sparks.test" });
    const { token, id } = await invite({ trade: "installer", workerId: w });
    expect(await submitWorkerInvite(sign(token))).toEqual({ ok: false, errors: ["Upload the EEC / Certified Insulation Installer certificate."] });
    expect(await submitWorkerInvite(sign(token, cert(id)))).toEqual({ ok: true });
    expect((await workerRow(w))!.declarations_due).toBe(true);
    expect((await inviteRow(id)).declarations).toBeNull();
  });

  test("the certificate is asked for only when needed: already uploaded = nothing to do, nothing burned", async () => {
    const w = await worker({ trade: "installer", email: "c8@sparks.test", certStatus: "unverified", certification: { eec_upload: { path: "worker-invites/old/eec-1.pdf", uploaded_at: "2026-11-01", number: null } } });
    const { token, id } = await invite({ trade: "installer", workerId: w });
    expect(await getWorkerInvite({ data: { token } })).toMatchObject({ ok: true, mode: "completion", needsCert: false });
    expect(await submitWorkerInvite(sign(token))).toEqual({ ok: false, errors: ["Your certificate is already with us. There's nothing more to do on this link."] });
    expect((await inviteRow(id)).used_at).toBeNull();
  });

  test("a rejected certificate can be uploaded again", async () => {
    const w = await worker({ trade: "installer", email: "c9@sparks.test", certStatus: "rejected", certification: { eec_upload: { path: "worker-invites/old/eec-1.pdf", uploaded_at: "2026-11-01", number: null } } });
    const { token, id } = await invite({ trade: "installer", workerId: w });
    expect(await getWorkerInvite({ data: { token } })).toMatchObject({ ok: true, needsCert: true });
    expect(await submitWorkerInvite(sign(token, cert(id)))).toEqual({ ok: true });
    expect((await workerRow(w))!.certification.eec_upload.path).toBe(`worker-invites/${id}/eec-abc.pdf`);
  });

  test("an old electrician signing link is closed politely and nothing is written", async () => {
    const w = await worker({ trade: "electrician", due: true, email: "c10@sparks.test" });
    const { token, id } = await invite({ trade: "electrician", workerId: w });
    expect(await submitWorkerInvite(sign(token))).toEqual({ ok: false, errors: ["This completion link is no longer available. Ask the business owner for a new one."] });
    expect((await inviteRow(id)).used_at).toBeNull();
  });

  test("the page gets the server's refusal words for electrician and verified links", async () => {
    const e = await worker({ trade: "electrician", email: "c12@sparks.test" });
    const ei = await invite({ trade: "electrician", workerId: e });
    expect(await getWorkerInvite({ data: { token: ei.token } })).toEqual({ ok: false, message: "This completion link is no longer available. Ask the business owner for a new one." });
    const v = await worker({ trade: "installer", email: "c13@sparks.test", certStatus: "verified" });
    const vi = await invite({ trade: "installer", workerId: v });
    expect(await getWorkerInvite({ data: { token: vi.token } })).toEqual({ ok: false, message: "This certificate is already verified — nothing more to do." });
  });

  test("a verified certificate is not replaced", async () => {
    const w = await worker({ trade: "installer", email: "c11@sparks.test", certStatus: "verified" });
    const { token, id } = await invite({ trade: "installer", workerId: w });
    expect((await submitWorkerInvite(sign(token, cert(id)))).errors![0]).toContain("already verified");
    expect((await inviteRow(id)).used_at).toBeNull();
  });

  test("a second submit on the same link is refused and changes nothing", async () => {
    const w = await worker({ trade: "installer", email: "c3@sparks.test" });
    const { token, id } = await invite({ trade: "installer", workerId: w });
    expect((await submitWorkerInvite(sign(token, cert(id)))).ok).toBe(true);
    const first = await inviteRow(id);
    const again = await submitWorkerInvite(sign(token, cert(id)));
    expect(again.ok).toBe(false);
    expect(again.errors![0]).toContain("already been used");
    expect(await inviteRow(id)).toEqual(first);
  });

  test("lost race at the single update: 'This link has already been used.'", async () => {
    const w = await worker({ trade: "installer", email: "c4@sparks.test" });
    const { token, id } = await invite({ trade: "installer", workerId: w });
    before.push({ table: "partner_worker_invites", op: "update", fn: () => db.query("update partner_worker_invites set used_at = now(), signed_name = 'Winner' where id = $1", [id]) });
    expect(await submitWorkerInvite(sign(token, cert(id)))).toEqual({ ok: false, errors: ["This link has already been used."] });
    expect((await inviteRow(id)).signed_name).toBe("Winner");
  });

  test("the single update fails: nothing burned, and a retry succeeds", async () => {
    const w = await worker({ trade: "installer", email: "c5@sparks.test" });
    const { token, id } = await invite({ trade: "installer", workerId: w });
    faults.push({ table: "partner_worker_invites", op: "update" });
    expect(await submitWorkerInvite(sign(token, cert(id)))).toEqual({ ok: false, errors: ["We couldn't save your certificate. Please try again."] });
    expect((await inviteRow(id)).used_at).toBeNull();
    expect(await submitWorkerInvite(sign(token, cert(id)))).toEqual({ ok: true });
    expect((await inviteRow(id)).used_at).not.toBeNull();
  });

  test("certificate save fails: nothing burned", async () => {
    const w = await worker({ trade: "installer", email: "c6@sparks.test" });
    const { token, id } = await invite({ trade: "installer", workerId: w });
    faults.push({ table: "partner_workers", op: "update" });
    expect(await submitWorkerInvite(sign(token, cert(id)))).toEqual({ ok: false, errors: ["We couldn't save your certificate. Please try again."] });
    expect((await inviteRow(id)).used_at).toBeNull();
  });

});

describe("registration link (new worker)", () => {
  test("details only: no ticks and no signature needed; the worker is created and held back from nothing", async () => {
    const { token, id } = await invite({ trade: "electrician" });
    expect((await getWorkerInvite({ data: { token } }))["declarations"]).toBeUndefined();
    expect(await submitWorkerInvite(register(token, "r1@sparks.test"))).toEqual({ ok: true });
    const inv = await inviteRow(id);
    const [w] = await workersByEmail("r1@sparks.test");
    expect(w).toBeDefined();
    expect(inv.used_at).not.toBeNull();
    expect(inv.worker_id).toBe(w!.id);
    expect(inv.signed_name).toBeNull();
    expect(inv.declarations).toBeNull();
    expect(inv.signed_ip).toBe("203.0.113.9");
    expect(inv.signed_user_agent).toBe("TestPhone/1");
    expect((await workerRow(w!.id))!.declarations_due).toBe(false);
    expect((await workerRow(w!.id))!.approval_status).toBe("pending");
    expect((await db.query("select 1 from partner_worker_identity where worker_id = $1", [w!.id])).rows).toHaveLength(1);
  });

  test("installer registration stores the certificate on the new worker", async () => {
    const { token, id } = await invite({ trade: "installer" });
    expect(await submitWorkerInvite(register(token, "r2@sparks.test", { licence_number: undefined, qualification: "Cert III", certificate_path: `worker-invites/${id}/eec-x.pdf` }))).toEqual({ ok: true });
    const [w] = await workersByEmail("r2@sparks.test");
    expect((await inviteRow(id)).worker_id).toBe(w!.id);
    expect((await workerRow(w!.id))!.certification_status).toBe("unverified");
    expect((await workerRow(w!.id))!.worker_role).toBe("crew"); // no role = Crew (Jo 5 Nov 2026): stored, never left null
  });

  test("a second submit is refused and changes nothing", async () => {
    const { token, id } = await invite({ trade: "electrician" });
    expect((await submitWorkerInvite(register(token, "r3@sparks.test"))).ok).toBe(true);
    const first = await inviteRow(id);
    const again = await submitWorkerInvite(register(token, "r3b@sparks.test"));
    expect(again.ok).toBe(false);
    expect(again.errors![0]).toContain("already been used");
    expect(await inviteRow(id)).toEqual(first);
    expect(await workersByEmail("r3b@sparks.test")).toHaveLength(0);
  });

  test("claim lost to another request: the just-inserted worker is deleted", async () => {
    const { token, id } = await invite({ trade: "electrician" });
    before.push({ table: "partner_worker_invites", op: "update", fn: () => db.query("update partner_worker_invites set used_at = now() where id = $1", [id]) });
    expect(await submitWorkerInvite(register(token, "r4@sparks.test"))).toEqual({ ok: false, errors: ["This invite link has already been used."] });
    expect(await workersByEmail("r4@sparks.test")).toHaveLength(0);
    expect((await inviteRow(id)).worker_id).toBeNull();
  });

  test("the single update fails: worker deleted, nothing burned, and a retry succeeds", async () => {
    const { token, id } = await invite({ trade: "electrician" });
    faults.push({ table: "partner_worker_invites", op: "update" });
    expect(await submitWorkerInvite(register(token, "r5@sparks.test"))).toEqual({ ok: false, errors: ["We couldn't save your details. Please try again."] });
    expect(await workersByEmail("r5@sparks.test")).toHaveLength(0);
    expect((await inviteRow(id)).used_at).toBeNull();
    expect(await submitWorkerInvite(register(token, "r5@sparks.test"))).toEqual({ ok: true });
    expect(await workersByEmail("r5@sparks.test")).toHaveLength(1);
  });

  test("date of birth save fails: worker deleted, invite not burned", async () => {
    const { token, id } = await invite({ trade: "electrician" });
    faults.push({ table: "partner_worker_identity", op: "insert" });
    expect(await submitWorkerInvite(register(token, "r6@sparks.test"))).toEqual({ ok: false, errors: ["We couldn't save your details. Please try again."] });
    expect(await workersByEmail("r6@sparks.test")).toHaveLength(0);
    expect((await inviteRow(id)).used_at).toBeNull();
  });

  test("email already registered under the business: same message, invite not burned", async () => {
    await worker({ trade: "electrician", due: false, email: "r7@sparks.test" });
    const { token, id } = await invite({ trade: "electrician" });
    expect(await submitWorkerInvite(register(token, "r7@sparks.test"))).toEqual({ ok: false, errors: ["Someone with that email is already registered under this business."] });
    expect((await inviteRow(id)).used_at).toBeNull();
  });
});
