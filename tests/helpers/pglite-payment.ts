// Throwaway in-process PostgreSQL (PGlite) for the payment-option gate. No network, URL or password:
// the database exists only in this test process's memory. Every row is fake TEST data.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const read = (f: string) =>
  readFileSync(new URL(`../../docs/pending-migrations/${f}`, import.meta.url), "utf8");
export const PAY_SQL = read("0080_payment_option_gate.sql");
export const PAY_ROLLBACK_SQL = read("0080_payment_option_gate.rollback.sql");

export const PID = {
  office: "00000000-0000-4000-8000-0000000000a1",
  owner: "00000000-0000-4000-8000-0000000000b1",
  stranger: "00000000-0000-4000-8000-0000000000e1",
  hivJob: "10000000-0000-4000-8000-000000000001",
  instJob: "10000000-0000-4000-8000-000000000002",
  hivQuote: "20000000-0000-4000-8000-000000000001",
  instQuote: "20000000-0000-4000-8000-000000000002",
  hivInv: "30000000-0000-4000-8000-000000000001",
  instInv: "30000000-0000-4000-8000-000000000002",
};

const BASE = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin','electrician','installer','owner');
CREATE TYPE public.job_channel AS ENUM ('hivic_sourced','installer_sourced');
CREATE TYPE public.payment_status AS ENUM ('invoice_not_created','invoice_created','deposit_due','deposit_paid','balance_due','fully_paid','overdue','xero_sync_error');
CREATE TABLE public.user_roles (id uuid primary key default gen_random_uuid(), user_id uuid not null, role public.app_role not null);
CREATE TABLE public.owners (id uuid primary key default gen_random_uuid(), user_id uuid, full_name text);
CREATE TABLE public.jobs (id uuid primary key, job_number text, owner_id uuid references public.owners(id), channel public.job_channel not null);
CREATE TABLE public.quotes (id uuid primary key, job_id uuid not null references public.jobs(id), customer_total_inc_gst numeric not null);
CREATE TABLE public.invoices (id uuid primary key, job_id uuid not null references public.jobs(id), quote_id uuid not null references public.quotes(id), kind text not null default 'installation',
  status public.payment_status not null default 'invoice_created', xero_invoice_number text, xero_online_url text, total_inc_gst numeric not null, deposit_pct numeric not null,
  deposit_amount numeric not null, deposit_due_date date not null default current_date, deposit_paid_amount numeric not null default 0, deposit_paid_at timestamptz,
  balance_amount numeric not null, balance_due_date date, balance_paid_at timestamptz, total_paid numeric not null default 0, created_at timestamptz not null default now());
CREATE TABLE public.payment_overrides (id uuid primary key default gen_random_uuid(), invoice_id uuid not null, job_id uuid not null, gate text not null, reason text not null, overridden_by uuid not null);
CREATE TABLE public.workflow_settings (id integer primary key, piesa_install_window_days integer default 30);
CREATE FUNCTION public.has_role(_u uuid, _r public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT exists(SELECT 1 FROM public.user_roles WHERE user_id=_u AND role=_r) $$;
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT public.has_role(auth.uid(), 'admin') $$;
CREATE FUNCTION public.is_job_owner(_job uuid, _user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT exists(SELECT 1 FROM public.jobs j JOIN public.owners o ON o.id=j.owner_id WHERE j.id=_job AND o.user_id=_user) $$;
CREATE FUNCTION public.can_access_job(_job uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT public.is_admin() OR public.is_job_owner(_job, auth.uid()) $$;
-- pre-0080 live definitions
CREATE FUNCTION public.invoice_deposit_cleared(_inv uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  select exists (select 1 from public.invoices i where i.id = _inv and public.can_access_job(i.job_id)
    and (i.deposit_paid_at is not null or exists (select 1 from public.payment_overrides o where o.invoice_id = i.id and o.gate = 'deposit')))
$function$;
CREATE VIEW public.invoice_status WITH (security_invoker = true) AS SELECT id, job_id, quote_id, kind, xero_invoice_number, xero_online_url, total_inc_gst, deposit_pct, deposit_amount, deposit_due_date,
  deposit_paid_amount, deposit_paid_at, balance_amount, balance_due_date, balance_paid_at, total_paid, created_at, invoice_deposit_cleared(id) AS deposit_cleared,
  CASE WHEN status = ANY (ARRAY['invoice_not_created'::payment_status, 'xero_sync_error'::payment_status]) THEN status WHEN total_paid >= total_inc_gst THEN 'fully_paid'::payment_status
    WHEN deposit_paid_at IS NULL AND deposit_due_date < (CURRENT_DATE - 7) THEN 'overdue'::payment_status WHEN deposit_paid_at IS NULL THEN 'deposit_due'::payment_status
    WHEN balance_due_date IS NOT NULL AND balance_due_date < CURRENT_DATE THEN 'overdue'::payment_status WHEN balance_due_date IS NOT NULL AND balance_due_date <= CURRENT_DATE THEN 'balance_due'::payment_status
    ELSE 'deposit_paid'::payment_status END AS effective_status FROM public.invoices i;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
`;

/** total: HIV invoice total inc GST. Seeds a legacy-style 50%-era row so "no data change" can be proven. */
export async function paymentDb(total = 10_000) {
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(`
    INSERT INTO public.workflow_settings (id) VALUES (1);
    INSERT INTO public.user_roles (user_id, role) VALUES ('${PID.office}', 'admin');
    INSERT INTO public.owners (id, user_id, full_name) VALUES ('40000000-0000-4000-8000-000000000001', '${PID.owner}', 'TEST Owner');
    INSERT INTO public.jobs VALUES ('${PID.hivJob}', 'TEST-0001', '40000000-0000-4000-8000-000000000001', 'hivic_sourced'),
                                   ('${PID.instJob}', 'TEST-0002', '40000000-0000-4000-8000-000000000001', 'installer_sourced');
    INSERT INTO public.quotes VALUES ('${PID.hivQuote}', '${PID.hivJob}', ${total}), ('${PID.instQuote}', '${PID.instJob}', ${total});
    INSERT INTO public.invoices (id, job_id, quote_id, total_inc_gst, deposit_pct, deposit_amount, balance_amount) VALUES
      ('${PID.hivInv}', '${PID.hivJob}', '${PID.hivQuote}', ${total}, 0.10, 0, 0),
      ('${PID.instInv}', '${PID.instJob}', '${PID.instQuote}', ${total}, 0.10, 0, 0);
  `);
  return db;
}

export async function asUser<T>(db: PGlite, user: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(
    `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${user}', false);`,
  );
  try {
    return await fn();
  } finally {
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);`);
  }
}

export async function cleared(db: PGlite, inv: string, user = PID.office): Promise<boolean> {
  return asUser(
    db,
    user,
    async () =>
      (await db.query<{ c: boolean }>(`SELECT public.invoice_deposit_cleared('${inv}') AS c`))
        .rows[0].c,
  );
}
