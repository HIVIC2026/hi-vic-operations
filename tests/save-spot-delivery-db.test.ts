// STEP 56: Save my spot send states against the REAL customer_email_sends DDL (drizzle 0036 + the 0039 status CHECK) on
// isolated PGlite, through the PostgREST-style shim. Proves no migration is needed (delivered_unrecorded is already an
// allowed status), the once-per-home key is enforced by Postgres, and the Office resolution / failed-row re-reservation
// are conditional updates that a concurrent change can't overwrite. Never touches a live database or any provider.
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const JOB = "00000000-0000-4000-8000-0000000005d1";
const db = new PGlite();
const ddl0036 = readFileSync("drizzle/migrations/0036_customer_engagement_followups.sql", "utf8").match(/CREATE TABLE public\.customer_email_sends \([\s\S]*?\n\);/)![0];
const check0039 = readFileSync("drizzle/migrations/0039_customer_email_safety.sql", "utf8").split("\n").filter((l) => l.includes("customer_email_sends_status_check")).join("\n");
await db.exec(`
  CREATE ROLE service_role;
  CREATE TABLE public.jobs (id uuid primary key);
  CREATE TABLE public.customer_estimate_links (id uuid primary key);
  CREATE TABLE public.job_communications (id uuid primary key);
  INSERT INTO public.jobs(id) VALUES ('${JOB}');
`);
await db.exec(ddl0036.replace(/^GRANT.*$/gm, ""));
await db.exec(check0039);
const admin = postgrestShim(db);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
const events: Record<string, unknown>[] = [];
mock.module("../src/lib/workflow.server", () => ({ logEvent: async (_j: string, _a: unknown, type: string, _s: string, d: Record<string, unknown>) => { events.push({ type, ...d }); } }));
const { resolveUncertainSaveSpot } = await import("../src/lib/save-spot-delivery.server");
const { LAUNCH_CAMPAIGN } = await import("../src/lib/launch-campaign.core");

let n = 0;
async function row(status: string, minutesAgo = 0) {
  const key = `${LAUNCH_CAMPAIGN}:save_my_spot:${JOB}:t${++n}`;
  await db.query(`DELETE FROM public.customer_email_sends WHERE job_id = $1`, [JOB]);
  await db.query(`INSERT INTO public.customer_email_sends (job_id, purpose, idempotency_key, status, provider, error, created_at) VALUES ($1, $2, $3, $4, 'resend', 'sent_unknown: timed out', now() - ($5 || ' minutes')::interval)`, [JOB, LAUNCH_CAMPAIGN, key, status, String(minutesAgo)]);
  return key;
}
const view = async () => { const r = (await db.query<{ id: string; created_at: Date }>(`SELECT id, created_at FROM public.customer_email_sends WHERE job_id = $1`, [JOB])).rows[0]!; return { sendId: r.id, attemptAt: r.created_at.toISOString() }; };
const resolve = async (resolution: "delivered" | "not_delivered", note: string, actor: string | null = null) => resolveUncertainSaveSpot(JOB, actor, { ...(await view()), resolution, note });
const status = async () => (await db.query<{ status: string; error: string }>(`SELECT status, error FROM public.customer_email_sends WHERE job_id = $1`, [JOB])).rows[0]!;

describe("real table constraints (no migration)", () => {
  test("the four send states are allowed; anything else is refused", async () => {
    for (const s of ["sending", "sent", "failed", "delivered_unrecorded"]) await row(s);
    await expect(row("unknown")).rejects.toThrow("customer_email_sends_status_check");
  });
  test("the once-per-home idempotency key is UNIQUE in Postgres", async () => {
    const key = await row("failed");
    await expect(db.query(`INSERT INTO public.customer_email_sends (job_id, purpose, idempotency_key) VALUES ($1, $2, $3)`, [JOB, LAUNCH_CAMPAIGN, key])).rejects.toThrow("duplicate key");
  });
});

describe("Office resolution on real rows", () => {
  test("not delivered: delivered_unrecorded -> failed, with the Office note and the previous detail kept", async () => {
    await row("delivered_unrecorded");
    expect(await resolve("not_delivered", "Resend shows no email")).toEqual({ ok: true, status: "failed", auditLogged: true });
    expect(await status()).toEqual({ status: "failed", error: "office_confirmed_not_delivered: Resend shows no email (was delivered_unrecorded: sent_unknown: timed out)" });
  });
  test("delivered: delivered_unrecorded -> sent", async () => {
    await row("delivered_unrecorded");
    const attempt = (await view()).attemptAt;
    expect((await resolve("delivered", "Resend shows delivered")).status).toBe("sent");
    expect((await status()).status).toBe("sent");
    const sentAt = (await db.query<{ sent_at: Date }>(`SELECT sent_at FROM public.customer_email_sends WHERE job_id = $1`, [JOB])).rows[0]!.sent_at;
    expect(sentAt.toISOString()).toBe(attempt); // the attempt-time condition matched in Postgres (the shim passes ms precision)
  });
  test("a fresh 'sending' is refused; a stale one (process stopped) can be resolved", async () => {
    await row("sending", 1);
    await expect(resolve("not_delivered", "checked Resend")).rejects.toThrow("still being sent");
    expect((await status()).status).toBe("sending");
    await row("sending", 20);
    expect((await resolve("not_delivered", "Resend shows nothing")).status).toBe("failed");
  });
  test("sent and failed rows are never changed", async () => {
    for (const s of ["sent", "failed"]) {
      await row(s);
      await expect(resolve("not_delivered", "checked Resend")).rejects.toThrow("no unresolved");
      expect((await status()).status).toBe(s);
    }
  });
  test("two Office users resolving at once: exactly one wins; the other is told it changed", async () => {
    await row("delivered_unrecorded");
    events.length = 0;
    const v = await view();
    const rs = await Promise.allSettled([
      resolveUncertainSaveSpot(JOB, "00000000-0000-4000-8000-0000000000a1", { ...v, resolution: "delivered", note: "Resend shows delivered" }),
      resolveUncertainSaveSpot(JOB, "00000000-0000-4000-8000-0000000000a2", { ...v, resolution: "not_delivered", note: "Resend shows nothing" }),
    ]);
    expect(rs.filter((r) => r.status === "fulfilled").length).toBe(1);
    const lost = rs.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(lost.reason.message)).toContain("changed while you were checking");
    expect(events.length).toBe(1);
  });
});

describe("attempt identity in Postgres", () => {
  test("a re-reserved row (new created_at) can't be resolved with the earlier attempt's view", async () => {
    await row("delivered_unrecorded");
    const earlier = await view();
    await db.query(`UPDATE public.customer_email_sends SET status = 'delivered_unrecorded', created_at = now() + interval '1 second' WHERE job_id = $1`, [JOB]);
    await expect(resolveUncertainSaveSpot(JOB, null, { ...earlier, resolution: "not_delivered", note: "Resend shows nothing" })).rejects.toThrow("changed while you were checking");
    expect((await status()).status).toBe("delivered_unrecorded");
  });
});

describe("failed-row re-reservation (the sender's exact conditional update)", () => {
  test("two triggers on the same failed row: only the first gets it", async () => {
    await row("failed");
    const id = (await db.query<{ id: string }>(`SELECT id FROM public.customer_email_sends WHERE job_id = $1`, [JOB])).rows[0]!.id;
    const claim = () => admin.from("customer_email_sends").update({ status: "sending", error: null, created_at: new Date().toISOString() }).eq("id", id).eq("status", "failed").select("id");
    const [a, b] = await Promise.all([claim(), claim()]) as { data: { id: string }[] | null }[];
    expect([a!.data!.length, b!.data!.length].sort()).toEqual([0, 1]);
    expect((await status()).status).toBe("sending");
  });
});
