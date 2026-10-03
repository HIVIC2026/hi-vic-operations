import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import {
  assessEligibility,
  recordErrors,
  rBelowLimit,
  verificationStale,
  verifiedEligibleNow,
  type ReadyCheckEvidence,
} from "../src/lib/verified-eligibility.core";
import { piesaRequestBlockers } from "../src/lib/payment-gate.core";

const read = (f: string) =>
  readFileSync(new URL(`../docs/pending-migrations/${f}`, import.meta.url), "utf8");
const SQL = read("0081_eligibility_verifications.sql");
const ROLLBACK = read("0081_eligibility_verifications.rollback.sql");

const ev = (o: Partial<ReadyCheckEvidence> = {}): ReadyCheckEvidence => ({
  readyCheck: { ref: "rc1", version: 1, final: true, submissionRef: "MITTI-TEST-1" },
  currentVersion: 1,
  attendance: { installer: true, attendedAt: true, geotagPhoto: true, ceilingMedia: true },
  measure: { areaM2: 120, method: "laser" },
  insulation: { existing: "none", type: null, depthMm: null, rValue: null, photos: false },
  removal: "no",
  access: { level: "standard", evidence: true },
  previousUpgrade: "no",
  electrical: { downlightCount: 6, downlightType: "led" },
  conflicts: [],
  ...o,
});
const present = (o: Partial<ReadyCheckEvidence["insulation"]> = {}) => ({
  existing: "present" as const,
  type: "batts",
  depthMm: 50,
  rValue: 1.99,
  photos: true,
  ...o,
});

describe("eligibility rules (pure)", () => {
  test("complete evidence → eligible allowed", () => {
    const a = assessEligibility(ev());
    expect(a.eligibleAllowed).toBe(true);
    expect(recordErrors("eligible", a, null, null)).toEqual([]);
  });
  test("missing area or method blocks eligible", () => {
    for (const measure of [
      { areaM2: null, method: "laser" },
      { areaM2: 120, method: null },
    ]) {
      const a = assessEligibility(ev({ measure }));
      expect(a.evidenceComplete).toBe(false);
      expect(recordErrors("eligible", a, null, null).length).toBeGreaterThan(0);
    }
  });
  test("Ready Check not final, or newer version → eligible blocked", () => {
    expect(
      assessEligibility(
        ev({ readyCheck: { ref: "rc1", version: 1, final: false, submissionRef: null } }),
      ).eligibleAllowed,
    ).toBe(false);
    const stale = assessEligibility(ev({ currentVersion: 2 }));
    expect(stale.eligibleAllowed).toBe(false);
    expect(stale.suggested).toBe("needs_review");
  });
  test("not_eligible needs a reason; needs_review needs a note", () => {
    const a = assessEligibility(ev());
    expect(recordErrors("not_eligible", a, "", null)).toHaveLength(1);
    expect(recordErrors("not_eligible", a, "Building under 5 years", null)).toEqual([]);
    expect(recordErrors("needs_review", a, null, null)).toHaveLength(1);
    expect(recordErrors("needs_review", a, null, "Check photos")).toEqual([]);
  });
  test("existing insulation: R1.99 can be eligible, R2.0 exactly cannot", () => {
    expect(rBelowLimit(1.99)).toBe(true);
    expect(rBelowLimit(2.0)).toBe(false);
    expect(assessEligibility(ev({ insulation: present({ rValue: 1.99 }) })).eligibleAllowed).toBe(
      true,
    );
    const r2 = assessEligibility(ev({ insulation: present({ rValue: 2.0 }) }));
    expect(r2.eligibleAllowed).toBe(false);
    expect(r2.suggested).toBe("needs_review"); // never an automatic fail
  });
  test("existing insulation present without reliable R-value/depth/photos → needs_review", () => {
    const a = assessEligibility(
      ev({ insulation: present({ rValue: null, depthMm: null, photos: false, type: null }) }),
    );
    expect(a.eligibleAllowed).toBe(false);
    expect(a.suggested).toBe("needs_review");
    expect(assessEligibility(ev({ insulation: present({ rValue: null }) })).suggested).toBe(
      "needs_review",
    );
    expect(
      assessEligibility(
        ev({
          insulation: {
            existing: "unknown",
            type: null,
            depthMm: null,
            rValue: null,
            photos: false,
          },
        }),
      ).suggested,
    ).toBe("needs_review");
  });
  test("previous VEU upgrade = yes → office review, not a fail", () => {
    const a = assessEligibility(ev({ previousUpgrade: "yes" }));
    expect(a.eligibleAllowed).toBe(false);
    expect(a.suggested).toBe("needs_review");
  });
  test("conflicting/amended evidence → needs_review", () => {
    expect(assessEligibility(ev({ conflicts: ["area amended after submission"] })).suggested).toBe(
      "needs_review",
    );
  });
  test("Section D missing/unclear flags safety/planning but does not block eligibility", () => {
    const a = assessEligibility(
      ev({ electrical: { downlightCount: null, downlightType: "unable_to_confirm" } }),
    );
    expect(a.eligibleAllowed).toBe(true);
    expect(a.flags.some((f) => f.startsWith("Safety/planning"))).toBe(true);
  });
  test("newer Ready Check marks stored verification out of date", () => {
    const v = { outcome: "eligible" as const, ready_check_ref: "rc1", ready_check_version: 1 };
    expect(verifiedEligibleNow(v, { ref: "rc1", version: 1 })).toBe(true);
    expect(verificationStale(v, { ref: "rc1", version: 2 })).toBe(true);
    expect(verifiedEligibleNow(v, { ref: "rc1", version: 2 })).toBe(false);
    expect(verifiedEligibleNow(v, { ref: "rc2", version: 1 })).toBe(false);
  });
  test("eligible alone never unblocks PIESA (quote + payment still required)", () => {
    const b = piesaRequestBlockers({
      readyCheckComplete: true,
      verifiedEligible: true,
      currentQuoteApproved: false,
      payment: { cleared: false, blocker: "Payment rule pending activation" },
    } as never);
    expect(b.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------- Practice database (in-process PGlite, fake TEST data, no network) ----------------
const U = {
  office: "00000000-0000-4000-8000-0000000000a1",
  owner: "00000000-0000-4000-8000-0000000000b1",
  installer: "00000000-0000-4000-8000-0000000000c1",
  electrician: "00000000-0000-4000-8000-0000000000d1",
  stranger: "00000000-0000-4000-8000-0000000000e1",
};
const JOB = "10000000-0000-4000-8000-000000000001";
const BASE = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin','electrician','installer','owner');
CREATE TABLE public.user_roles (id uuid primary key default gen_random_uuid(), user_id uuid not null, role public.app_role not null);
CREATE TABLE public.owners (id uuid primary key, user_id uuid);
CREATE TABLE public.jobs (id uuid primary key, owner_id uuid references public.owners(id), stage text not null);
CREATE TABLE public.job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid, user_id uuid, role text, active boolean default true);
CREATE TABLE public.quotes (id uuid primary key default gen_random_uuid(), job_id uuid);
CREATE TABLE public.invoices (id uuid primary key default gen_random_uuid(), job_id uuid);
CREATE TABLE public.bookings (id uuid primary key default gen_random_uuid(), job_id uuid);
CREATE TABLE public.piesa_records (id uuid primary key default gen_random_uuid(), job_id uuid);
CREATE TABLE public.job_communications (id uuid primary key default gen_random_uuid(), job_id uuid);
CREATE TABLE public.workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid not null, actor_id uuid, event_type text not null, from_stage text, to_stage text, summary text not null, details jsonb not null default '{}', internal boolean not null default false, created_at timestamptz not null default now());
CREATE FUNCTION public.has_role(_u uuid, _r public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT exists(SELECT 1 FROM public.user_roles WHERE user_id=_u AND role=_r) $$;
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT public.has_role(auth.uid(), 'admin') $$;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
INSERT INTO public.user_roles(user_id, role) VALUES ('${U.office}','admin'),('${U.owner}','owner'),('${U.installer}','installer'),('${U.electrician}','electrician');
INSERT INTO public.owners VALUES ('40000000-0000-4000-8000-000000000001','${U.owner}');
INSERT INTO public.jobs VALUES ('${JOB}','40000000-0000-4000-8000-000000000001','ready_check_complete');
INSERT INTO public.job_assignments(job_id,user_id,role) VALUES ('${JOB}','${U.installer}','installer'),('${JOB}','${U.electrician}','electrician');
`;
async function db() {
  const d = new PGlite();
  await d.exec(BASE);
  await d.exec(SQL);
  return d;
}
async function as<T>(d: PGlite, u: string, fn: () => Promise<T>) {
  await d.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${u}',false);`);
  try {
    return await fn();
  } finally {
    await d.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);`);
  }
}
const rec = (
  d: PGlite,
  outcome: string,
  o: {
    complete?: boolean;
    reviews?: string;
    reason?: string | null;
    note?: string | null;
    version?: number;
  } = {},
) =>
  d.query<{ id: string }>(
    `SELECT public.record_eligibility_verification($1,'rc1',$2,$3,$4,$5::jsonb,'[]'::jsonb,'{}'::jsonb,'v1',$6,$7) AS id`,
    [
      JOB,
      o.version ?? 1,
      outcome,
      o.complete ?? true,
      o.reviews ?? "[]",
      o.reason ?? null,
      o.note ?? null,
    ],
  );

describe("practice database: 0081", () => {
  test("access: only office can record or read", async () => {
    const d = await db();
    for (const u of [U.owner, U.installer, U.electrician, U.stranger]) {
      await as(d, u, async () => {
        await expect(rec(d, "eligible")).rejects.toThrow(/Only office/);
      });
    }
    await as(d, U.office, () => rec(d, "eligible"));
    for (const u of [U.owner, U.installer, U.electrician, U.stranger]) {
      const n = await as(
        d,
        u,
        async () => (await d.query(`SELECT * FROM public.eligibility_verifications`)).rows.length,
      );
      expect(n).toBe(0);
    }
    expect(
      await as(
        d,
        U.office,
        async () => (await d.query(`SELECT * FROM public.eligibility_verifications`)).rows.length,
      ),
    ).toBe(1);
    // no direct writes, even for office
    await as(d, U.office, async () => {
      await expect(
        d.exec(
          `INSERT INTO public.eligibility_verifications(job_id,outcome,ready_check_ref,ready_check_version,evidence_complete,ruleset,recorded_by) VALUES ('${JOB}','eligible','x',1,true,'v1','${U.office}')`,
        ),
      ).rejects.toThrow();
      await expect(
        d.exec(`UPDATE public.eligibility_verifications SET outcome='not_eligible'`),
      ).rejects.toThrow();
    });
    // signed out
    await d.exec(`SET ROLE anon`);
    await expect(rec(d, "eligible")).rejects.toThrow();
    await d.exec(`RESET ROLE`);
  });

  test("database refuses eligible without evidence, not_eligible without reason, review without note", async () => {
    const d = await db();
    await as(d, U.office, async () => {
      await expect(rec(d, "eligible", { complete: false })).rejects.toThrow();
      await expect(rec(d, "eligible", { reviews: '["previous upgrade"]' })).rejects.toThrow();
      await expect(rec(d, "not_eligible", { reason: "  " })).rejects.toThrow();
      await expect(rec(d, "needs_review")).rejects.toThrow();
      await rec(d, "not_eligible", { reason: "TEST reason" });
      await rec(d, "needs_review", { note: "TEST check photos" });
    });
  });

  test("audit history: every record kept, one current, amendments chained", async () => {
    const d = await db();
    await as(d, U.office, async () => {
      await rec(d, "needs_review", { note: "TEST" });
      await rec(d, "eligible");
      await rec(d, "eligible", { version: 2 });
    });
    const rows = (
      await d.query<{
        outcome: string;
        is_current: boolean;
        supersedes: string | null;
        superseded_at: string | null;
        ready_check_version: number;
      }>(`SELECT * FROM public.eligibility_verifications ORDER BY recorded_at, ready_check_version`)
    ).rows;
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.is_current)).toHaveLength(1);
    expect(rows.filter((r) => r.supersedes)).toHaveLength(2);
    const events = (
      await d.query<{ actor_id: string; to_stage: string | null }>(
        `SELECT * FROM public.workflow_events WHERE event_type='eligibility_verified'`,
      )
    ).rows;
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.actor_id === U.office && e.to_stage === null)).toBe(true);
  });

  test("recording never advances stage or creates quote/PIESA/payment/booking/message", async () => {
    const d = await db();
    await as(d, U.office, () => rec(d, "eligible"));
    expect((await d.query<{ stage: string }>(`SELECT stage FROM public.jobs`)).rows[0].stage).toBe(
      "ready_check_complete",
    );
    for (const t of ["quotes", "invoices", "bookings", "piesa_records", "job_communications"])
      expect((await d.query(`SELECT 1 FROM public.${t}`)).rows).toHaveLength(0);
  });

  test("rollback is clean and re-apply is clean", async () => {
    const d = await db();
    await as(d, U.office, () => rec(d, "eligible"));
    await d.exec(ROLLBACK);
    expect(
      (await d.query(`SELECT to_regclass('public.eligibility_verifications') AS t`)).rows[0],
    ).toEqual({ t: null });
    expect((await d.query(`SELECT count(*)::int AS n FROM public.jobs`)).rows[0]).toEqual({ n: 1 });
    await d.exec(SQL);
    expect(
      (await d.query(`SELECT count(*)::int AS n FROM public.eligibility_verifications`)).rows[0],
    ).toEqual({ n: 0 });
  });
});
