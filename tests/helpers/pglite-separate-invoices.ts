// Practice database for the separate-invoices change: the real invoices table (0001 + later columns/constraints), the
// invoice_status view (0079) with a simple stand-in for its helper, and the pending SQL. No network.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const migration = (n: string) => readFileSync(new URL(`../../drizzle/migrations/${n}`, import.meta.url), "utf8");
export const pending = (n: string) => readFileSync(new URL(`../../docs/pending-migrations/${n}`, import.meta.url), "utf8");

export async function makeInvoicesDb(): Promise<PGlite> {
  const db = new PGlite();
  const m0 = migration("0000_hivic_core_schema.sql");
  const m1 = migration("0001_payments_xero.sql");
  const kindEnum = m0.match(/create type public\.quote_kind as enum \([^)]*\);/i)?.[0];
  const statusEnum = m1.match(/create type public\.payment_status as enum \([^)]*\);/i)?.[0];
  const table = m1.match(/create table public\.invoices \([\s\S]*?\n\);/i)?.[0];
  if (!kindEnum || !statusEnum || !table) throw new Error("could not find the real invoices DDL");
  await db.exec(`CREATE SCHEMA IF NOT EXISTS public;
    ${kindEnum} ${statusEnum}
    CREATE TABLE public.jobs (id uuid primary key default gen_random_uuid());
    CREATE TABLE public.quotes (id uuid primary key default gen_random_uuid());
    CREATE FUNCTION public.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
    ${table}
    -- 0002 / 0006 / 0007 / 0008 / 0079 / 0144 net effect on invoices
    ALTER TABLE public.invoices ADD COLUMN balance_paid_at timestamptz, ADD COLUMN xero_invoice_status text,
      ADD COLUMN sync_lock_at timestamptz, ADD COLUMN xero_tracking_option_id text, ADD COLUMN payment_option text,
      ADD COLUMN amount_inc_gst numeric, ADD COLUMN due_date date, ADD COLUMN amount_paid numeric NOT NULL DEFAULT 0,
      ADD COLUMN paid_at timestamptz, ADD COLUMN xero_update_pending boolean NOT NULL DEFAULT false,
      ADD COLUMN part text NOT NULL DEFAULT 'deposit';
    CREATE INDEX invoices_job_created_idx ON public.invoices (job_id, created_at DESC);
    CREATE FUNCTION public.invoice_deposit_cleared(_inv uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT coalesce((SELECT total_paid >= total_inc_gst FROM public.invoices WHERE id = _inv), false) $$;`);
  const view = migration("0079_payment_option_gate.sql").match(/CREATE OR REPLACE VIEW public\.invoice_status[\s\S]*?FROM public\.invoices i;/)?.[0];
  if (!view) throw new Error("could not find the real invoice_status view");
  await db.exec(view);
  return db;
}

export async function applySeparateInvoices(db: PGlite) {
  await db.exec(pending("separate-invoices.sql"));
}
export async function rollbackSeparateInvoices(db: PGlite) {
  await db.exec(pending("separate-invoices.rollback.sql"));
}
