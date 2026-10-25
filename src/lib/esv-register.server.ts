// Decision 371(c): ESV public register lookup for the office application review. Read-only towards the applicant:
// records each result as an append-only `admin_config_events` row (`esv_register_lookup`) for the reviewer and never
// approves, rejects or blocks. No live adapter is configured (esv.vic.gov.au unreachable from the sandbox, no documented
// public API — see esv-register.core.ts); with the switch off or no adapter every lookup is recorded "not checked".
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import {
  ESV_REGISTER_EVENT, notChecked, registerQueries, shouldRecordLookup, switchOn,
  type EsvRegisterAdapter, type RegisterLookupQuery, type RegisterLookupResult,
} from "./esv-register.core";

/** The live adapter. Null until a reachable, permitted ESV endpoint is confirmed (stub: every lookup = "not checked"). */
export function configuredEsvRegisterAdapter(): EsvRegisterAdapter | null {
  return null;
}

export async function lookupEsvRegister(q: RegisterLookupQuery, deps: { env?: Record<string, string | undefined>; adapter?: EsvRegisterAdapter | null; now?: () => Date } = {}): Promise<RegisterLookupResult> {
  const nowIso = (deps.now ?? (() => new Date()))().toISOString();
  if (!switchOn(deps.env ?? process.env)) return notChecked(q, "register lookup switched off", nowIso);
  const adapter = deps.adapter === undefined ? configuredEsvRegisterAdapter() : deps.adapter;
  if (!adapter) return notChecked(q, "no register adapter configured", nowIso);
  try {
    const r = await adapter.lookup(q);
    return { ...r, checkedAt: nowIso, source: adapter.name };
  } catch (e) {
    return { kind: q.kind, number: q.number.trim(), status: "error", checkedAt: nowIso, source: adapter.name, detail: (e as Error).message.slice(0, 160) };
  }
}

/** Looks up the application's licence + REC numbers and records each result once (again only when it changes). */
export async function registerLookupsForApplication(applicationId: string, data: Parameters<typeof registerQueries>[0]): Promise<RegisterLookupResult[]> {
  const queries = registerQueries(data);
  if (!queries.length) return [];
  const { data: prior } = await admin.from("admin_config_events").select("details, created_at").eq("event_type", ESV_REGISTER_EVENT).contains("details", { application_id: applicationId }).order("created_at", { ascending: false });
  const out: RegisterLookupResult[] = [];
  for (const q of queries) {
    const r = await lookupEsvRegister(q);
    const prev = (prior ?? []).map((p) => p.details as unknown as RegisterLookupResult & { application_id?: string }).find((p) => p.kind === q.kind && p.number === r.number) ?? null;
    if (shouldRecordLookup(prev, r)) {
      await admin.from("admin_config_events").insert({ actor_id: null, event_type: ESV_REGISTER_EVENT, summary: `ESV register ${q.kind === "rec" ? "REC" : "licence"} ${r.number}: ${r.status.replace(/_/g, " ")}`, details: { application_id: applicationId, ...r } as unknown as Json });
    }
    out.push(r);
  }
  return out;
}
