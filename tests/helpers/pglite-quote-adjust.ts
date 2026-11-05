// Throwaway in-process PostgreSQL (PGlite) for apply_quote_adjustment. Fake TEST data only.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(new URL(`../../docs/pending-migrations/${f}`, import.meta.url), "utf8");
export const QUOTE_ADJUST_SQL = read("apply-quote-adjustment.sql");
export const QUOTE_ADJUST_ROLLBACK_SQL = read("apply-quote-adjustment.rollback.sql");

export const QA = {
  quote: "10000000-0000-4000-8000-0000000000f1",
  item1: "20000000-0000-4000-8000-0000000000f1",
  item2: "20000000-0000-4000-8000-0000000000f2",
  actor: "30000000-0000-4000-8000-0000000000f1",
};

const BASE = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TYPE public.quote_status AS ENUM ('draft','issued','accepted','declined','superseded','expired');
CREATE TABLE public.profiles (id uuid primary key);
CREATE TABLE public.quotes (
  id uuid primary key, status public.quote_status not null default 'issued', version int not null default 1,
  subtotal_inc_gst numeric(10,2) not null, gst_amount numeric(10,2) not null, veec_discount_inc_gst numeric(10,2) not null default 0,
  customer_total_inc_gst numeric(10,2) not null, manually_adjusted boolean not null default false,
  veec_count int, veec_unit_value_inc_gst numeric, release_state text, release_hold_reason text, sent_at timestamptz);
CREATE TABLE public.quote_items (
  id uuid primary key, quote_id uuid not null references public.quotes(id) on delete cascade, description text not null default 'x',
  quantity numeric(8,2) not null, unit_price_inc_gst numeric(10,2) not null, line_total_inc_gst numeric(10,2) not null, sort int not null default 0);
CREATE TABLE public.quote_adjustments (
  id uuid primary key default gen_random_uuid(), quote_id uuid not null references public.quotes(id), adjusted_by uuid not null references public.profiles(id),
  reason text not null, before_snapshot jsonb not null, after_snapshot jsonb not null, created_at timestamptz not null default now());
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
`;

export async function quoteAdjustDb(applySql = true) {
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(`INSERT INTO public.profiles VALUES ('${QA.actor}');
    INSERT INTO public.quotes (id, status, subtotal_inc_gst, gst_amount, veec_discount_inc_gst, customer_total_inc_gst, release_state, sent_at)
      VALUES ('${QA.quote}', 'issued', 3000, 272.73, 1470, 1530, 'released', now());
    INSERT INTO public.quote_items (id, quote_id, quantity, unit_price_inc_gst, line_total_inc_gst, sort) VALUES
      ('${QA.item1}', '${QA.quote}', 1, 2000, 2000, 0), ('${QA.item2}', '${QA.quote}', 1, 1000, 1000, 1);`);
  if (applySql) await db.exec(QUOTE_ADJUST_SQL);
  return db;
}

export const callAdjust = (db: PGlite, over: { version?: number; release?: unknown; items?: unknown; quote?: string } = {}) =>
  db.query<{ r: any }>(
    `SELECT public.apply_quote_adjustment($1::uuid,$2::int,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb) AS r`,
    [
      over.quote ?? QA.quote, over.version ?? 1,
      JSON.stringify(over.items ?? [{ id: QA.item1, quantity: 1, unit_price_inc_gst: 2200, line_total_inc_gst: 2200 }]),
      JSON.stringify({ subtotal_inc_gst: 3200, gst_amount: 290.91, veec_discount_inc_gst: 1470, customer_total_inc_gst: 1730, manually_adjusted: true }),
      JSON.stringify(over.release === undefined ? null : over.release),
      JSON.stringify({ adjusted_by: QA.actor, reason: "price up", before_snapshot: { old: true } }),
    ],
  );
