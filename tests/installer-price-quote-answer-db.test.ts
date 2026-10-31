// A typed installer price answers "Have you prepared a quote?" = Yes (PGlite; Mitti/quote preparation mocked away).
import { describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const db = new PGlite();
await db.exec(`
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default clock_timestamp());
CREATE TABLE jobs (id uuid primary key, channel text, originating_installer_business_id uuid, stage text, deleted_at timestamptz, installer_quoted text);
CREATE TABLE ceiling_measurements (job_id uuid, is_current boolean, raw_snapshot jsonb, removal_required boolean, measured_area_m2 numeric, external_source text, external_id text, status text);
CREATE TABLE quotes (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text, sent_at timestamptz);`);
const BIZ = "00000000-0000-0000-0000-0000000000b1", USER = "00000000-0000-0000-0000-0000000000u1".replace("u", "a");
const J1 = "00000000-0000-0000-0000-000000000001", J2 = "00000000-0000-0000-0000-000000000002";
await db.query("insert into jobs values ($1,'installer_sourced',$3,'enquiry',null,'no'),($2,'installer_sourced',$3,'enquiry',null,'no')", [J1, J2, BIZ]);
await db.query("insert into workflow_events (job_id, event_type, summary, details, created_at) values ($1,'installer_quote_answer','x','{\"answer\":\"not_quoted\"}','2026-10-20T00:00:00Z')", [J1]);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db) }));
const realWorkflow = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({
  ...realWorkflow,
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { await db.query("insert into workflow_events (job_id, actor_id, event_type, summary, details) values ($1,$2,$3,$4,$5)", [job, actor, type, summary, JSON.stringify(details ?? {})]); },
}));
const realPilot = await import("../src/lib/pilot.server");
mock.module("../src/lib/pilot.server", () => ({ ...realPilot, requireMember: async () => ({}) }));
const storedPrice = { record: { price_inc_gst: 4000 }, setAt: "2026-11-01T00:00:00.000Z", setBy: null };
mock.module("../src/lib/installer-price.server", () => ({ readInstallerPrice: async () => storedPrice, readInstallerPriceState: async () => ({ stored: storedPrice, askedAgain: false, newQuoteRequestedAt: null }) }));
mock.module("../src/lib/mitti.server", () => ({ syncMittiAssessment: async () => {} }));
const { setInstallerPrice } = await import("../src/lib/installer-price-set.server");
const { intakeQuoteAnswers } = await import("../src/lib/installer-intake.server");

const good = { priceIncGst: 4000, included: ["Ceiling insulation - supply & install"] };
const answers = async (job: string) => (await db.query<{ details: Record<string, unknown>; summary: string }>("select details, summary from workflow_events where event_type='installer_quote_answer' and job_id=$1 order by created_at", [job])).rows;
const quoted = async (job: string) => (await db.query<{ q: string }>("select installer_quoted q from jobs where id=$1", [job])).rows[0]!.q;

describe("typed installer price → quote prepared", () => {
  test("not_quoted job becomes have_quote with ONE answer event", async () => {
    const before = (await answers(J1)).length;
    await setInstallerPrice(J1, USER, good);
    expect(await quoted(J1)).toBe("yes");
    expect((await intakeQuoteAnswers([J1])).get(J1)).toBe("have_quote");
    const rows = await answers(J1);
    expect(rows.length).toBe(before + 1);
    expect(rows.at(-1)!.details).toEqual({ answer: "have_quote", previous: "not_quoted", source: "installer_price" });
    expect(rows.at(-1)!.summary).toBe("Installer answered: quote prepared");
  });
  test("a second price adds no further answer event", async () => {
    const n = (await answers(J1)).length;
    await setInstallerPrice(J1, USER, { ...good, priceIncGst: 4200 });
    expect((await answers(J1)).length).toBe(n);
  });
  test("an invalid price writes nothing", async () => {
    await expect(setInstallerPrice(J2, USER, { priceIncGst: 0, included: [] })).rejects.toThrow();
    expect(await quoted(J2)).toBe("no");
    expect((await answers(J2)).length).toBe(0);
  });
});
