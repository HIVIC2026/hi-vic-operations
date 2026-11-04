// Task 11 (job facts): the job page reads whole rows (`select *`) once and answers sections' queries from them. A live
// `select *` returns every column the table has, so a test seed gets every column the generated types list (null where
// the seed doesn't set one): a column missing from a seeded row would otherwise look missing live, and the query would
// (correctly) go to the database instead.
import { readFileSync } from "node:fs";
import type { Tables } from "./memory-postgrest";

/** The tables the job page's fact reads take whole (job, the caller's business, settings). */
export const FACT_TABLES = ["jobs", "workflow_events", "bookings", "job_assignments", "quotes", "quote_items", "quote_internals", "ceiling_measurements", "piesa_records", "assessments", "appointment_proposals", "customer_assignments", "installer_declarations", "rectification_items", "invoices", "payment_overrides", "ready_check_windows", "assessment_payments", "owner_esc_consents", "ready_checks", "properties", "businesses", "partner_workers", "business_members", "workflow_settings", "worker_job_links", "partner_activations", "customer_email_sends", "documents", "pre_start_checks"];

const TYPES = readFileSync(new URL("../../src/integrations/supabase/types.ts", import.meta.url), "utf8");
export function columnsOf(table: string): string[] {
  const start = TYPES.indexOf(`\n      ${table}: {\n        Row: {`);
  if (start < 0) throw new Error(`no Row type for ${table}`);
  const body = TYPES.slice(start, TYPES.indexOf("\n        }", start + 30));
  return [...body.matchAll(/^          ([a-z_0-9]+)\??:/gm)].map((m) => m[1]!);
}

/** Gives every seeded row of the fact tables all its live columns (null when not set). */
export function fillLiveColumns(tables: Tables, names: readonly string[] = FACT_TABLES) {
  for (const t of names) { if (!tables[t]) continue; const cols = columnsOf(t); tables[t] = tables[t]!.map((r) => ({ ...Object.fromEntries(cols.map((c) => [c, null])), ...r })); }
}

/** For failure tests: a fact read that takes a table whose own read fails, fails too (it reads the same rows). */
export const factReadTakes = (sel: string, failing: (table: string) => boolean) => [...sel.matchAll(/([a-z_]+)(?:![a-z_]+|:[a-z_]+)?\(/g)].some((m) => failing(m[1]!));
