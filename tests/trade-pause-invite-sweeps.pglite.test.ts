// "Pause all trade messages" + per-business exception (Jo 31 Oct): the two electrician-invite sweeps decide the pause per
// invite by the nominating installer's business. Pause ON: the flagged installer's invite sends; the unflagged one is held
// and consumes nothing (no nomination row / claim, no record), so the next tick can still send it.
import { describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const FLAGGED = "11111111-0000-0000-0000-000000000001";
const PLAIN = "11111111-0000-0000-0000-000000000002";
const J1 = "22222222-0000-0000-0000-000000000001", J2 = "22222222-0000-0000-0000-000000000002";
const APP1 = "33333333-0000-0000-0000-000000000001", APP2 = "33333333-0000-0000-0000-000000000002";
const N1 = "44444444-0000-0000-0000-000000000001", N2 = "44444444-0000-0000-0000-000000000002";

const db = new PGlite();
await db.exec(`create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid'; create role anon; create role authenticated; create role service_role;
  create table public.workflow_settings(id int primary key, updated_at timestamptz not null default now()); insert into public.workflow_settings(id) values (1);
  create table public.businesses(id uuid primary key, name text, is_active boolean, onboarding_status text);
  create table public.jobs(id uuid primary key, stage text, deleted_at timestamptz, qa_archived_at timestamptz, originating_installer_business_id uuid);
  create table public.partner_relationships(id uuid primary key default gen_random_uuid(), installer_business_id uuid, electrician_business_id uuid, active boolean not null default true);
  create table public.job_assignments(id uuid primary key default gen_random_uuid(), job_id uuid, business_id uuid, role text, active boolean not null default true);
  create table public.workflow_events(id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, internal boolean, created_at timestamptz default now());
  create table public.admin_config_events(id uuid primary key default gen_random_uuid(), actor_id uuid, event_type text not null, summary text not null, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
  create table public.partner_activations(id uuid primary key default gen_random_uuid(), application_id uuid, business_id uuid, partner_type text, activated_at timestamptz default now());
  create table public.electrician_nominations(id uuid primary key default gen_random_uuid(), installer_application_id uuid, job_id uuid, contact_name text, contact_name_x text, business_name text, email text, phone text, rec_number text, licence_number text, status text, invite_sent_at timestamptz, invite_link_issued_at timestamptz, invite_token_hash text, invite_expires_at timestamptz, business_id uuid, nominating_business_id uuid, nominated_by uuid, nominated_for text, is_primary boolean, ended_at timestamptz, created_at timestamptz not null default now());`);
await db.exec(readFileSync("docs/pending-migrations/trade-messages-paused.sql", "utf8"));
await db.exec(readFileSync("docs/pending-migrations/business-messages-while-paused.sql", "utf8"));
await db.exec(`insert into public.businesses(id, name, is_active, onboarding_status, messages_while_paused) values ('${FLAGGED}', 'Flagged Installer', true, 'approved', true), ('${PLAIN}', 'Plain Installer', true, 'approved', false);
  update public.workflow_settings set trade_messages_paused = true where id = 1;`);

const invites: string[] = [];
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db, { jsonColumns: { workflow_settings: [], admin_config_events: ["details"], workflow_events: ["details"] } }) }));
mock.module("../src/lib/comms.server", () => ({ customerCommsEnabled: async () => true }));
mock.module("../src/lib/job-electrician-invite.server", () => ({ sendElectricianInvite: async (p: { installerBusinessId: string; to: string }) => { invites.push(`${p.installerBusinessId}|${p.to}`); return { status: "sent", to: p.to, test: false, detail: null }; } }));
mock.module("../src/lib/rec-onboarded.server", () => ({ loadApprovedRecCandidates: async () => [] }));

const count = async (sql: string) => Number((await db.query<{ n: string }>(sql)).rows[0]!.n);

describe("rec-onboarding-invite while paused", () => {
  test("only the flagged installer's invite sends; the held one writes no nomination and no record", async () => {
    await db.exec(`insert into public.jobs(id, stage) values ('${J1}', 'ready_check'), ('${J2}', 'ready_check');
      insert into public.workflow_events(job_id, event_type, summary, details) values
        ('${J1}', 'electrician_onboarding_needed', 'x', '{"name":"Ann Sparks","licence":"L1","email":"ann@e.example","installer_business_id":"${FLAGGED}"}'),
        ('${J2}', 'electrician_onboarding_needed', 'x', '{"name":"Bob Volt","licence":"L2","email":"bob@e.example","installer_business_id":"${PLAIN}"}')`);
    const { sweepRecOnboardingInvites } = await import("../src/lib/rec-onboarding-invite.server");
    const out = await sweepRecOnboardingInvites(new Date());
    expect(invites).toEqual([`${FLAGGED}|ann@e.example`]);
    expect(out.sent).toBe(1);
    expect(await count(`select count(*) n from public.electrician_nominations where nominating_business_id = '${PLAIN}'`)).toBe(0);
    expect(await count(`select count(*) n from public.admin_config_events where details->>'key' like '%bob%' or summary like '%Bob%'`)).toBe(0);
  });
});

describe("signup-electrician while paused", () => {
  test("only the flagged installer's sign-up invite is claimed and sent; the held one keeps no claim", async () => {
    invites.length = 0;
    await db.exec(`insert into public.partner_activations(application_id, business_id, partner_type) values ('${APP1}', '${FLAGGED}', 'installer'), ('${APP2}', '${PLAIN}', 'installer');
      insert into public.electrician_nominations(id, installer_application_id, contact_name, email, status, is_primary, created_at) values
        ('${N1}', '${APP1}', 'Cy Amp', 'cy@e.example', 'invite_pending_comms', true, now()),
        ('${N2}', '${APP2}', 'Di Watt', 'di@e.example', 'invite_pending_comms', true, now());
      insert into public.admin_config_events(event_type, summary, details) values
        ('usual_electrician', 's', '{"business_id":"${FLAGGED}","source":"installer_signup"}'), ('usual_electrician', 's', '{"business_id":"${PLAIN}","source":"installer_signup"}')`);
    const { USUAL_ELECTRICIAN_EVENT } = await import("../src/lib/usual-electrician.core");
    await db.query("update public.admin_config_events set event_type = $1 where event_type = 'usual_electrician'", [USUAL_ELECTRICIAN_EVENT]);
    const { sweepSignupNominationInvites } = await import("../src/lib/signup-electrician.server");
    const out = await sweepSignupNominationInvites(new Date());
    expect(invites).toEqual([`${FLAGGED}|cy@e.example`]);
    expect(out.sent).toBe(1);
    const held = (await db.query<{ invite_link_issued_at: string | null; invite_token_hash: string | null }>(`select invite_link_issued_at, invite_token_hash from public.electrician_nominations where id = '${N2}'`)).rows[0]!;
    expect(held.invite_link_issued_at).toBeNull();
    expect(held.invite_token_hash).toBeNull();
    expect(await count(`select count(*) n from public.admin_config_events where details->>'nomination_id' = '${N2}'`)).toBe(0);
  });
});
