// Persistent simulated Mitti for TEST calls made by the running portal (Jo 27 Oct). Lives in `mitti_sim_audits`
// (service role only). Never touches the network. Ids carry the "sim_" prefix so later calls route back here.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { MittiCall } from "./mitti.core";
import { SIM_ID_PREFIX, auditIdOfPath, isTestMittiEmail } from "./mitti-test-route.core";
import { FIXES_DAY_QUESTIONS } from "./fixes-day.core";
import { simulatedInstallDayTemplate } from "./journey-sim.core";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
type Item = { item_id: string; label?: string; type?: string; [k: string]: unknown };
const db = () => (admin as Any).from("mitti_sim_audits");

/** Office fields every portal form create needs; the simulator serves these as plain text questions. */
const SIM_TEMPLATE_ITEMS: Item[] = ["Portal Job Number", "Property Address", "Owner name", "Assessor"]
  .map((label, i) => ({ item_id: `sim_tpl_${i}`, id: `sim_tpl_${i}`, label, type: "textsingle" }));
const SIM_FIXES_TEMPLATE = simulatedInstallDayTemplate(FIXES_DAY_QUESTIONS);
// Canonical questions, not completed answers. Only TEST flows enter this store.
const SIM_ITEMS: Item[] = [...SIM_TEMPLATE_ITEMS, ...SIM_FIXES_TEMPLATE.items];

const simUserId = (email: string) => `${SIM_ID_PREFIX}user_${email.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
const newAuditId = () => `${SIM_ID_PREFIX}audit_${crypto.randomUUID().replaceAll("-", "")}`;

/** Ids stored as simulated (cached per process; all ids we create are sim_-prefixed anyway). */
const known = new Set<string>();
export async function isStoredSimAudit(id: string): Promise<boolean> {
  if (known.has(id)) return true;
  try {
    const { data, error } = await db().select("id").eq("id", id).maybeSingle();
    if (error || !data) return false; // unreadable store = not known; real ids keep their real path
  } catch { return false; }
  known.add(id); return true;
}

export const persistentSimMittiCall: MittiCall = async (method, path, body) => {
  const p = path.split("?")[0] ?? path;
  if (method === "POST" && p === "/users/search") {
    const want = ((body as { email?: string[] } | undefined)?.email ?? []).filter(isTestMittiEmail);
    return want.map((email) => ({ id: simUserId(email), email }));
  }
  const t = /^\/templates\/v1\/templates\/([^/]+)$/.exec(p);
  if (method === "GET" && t?.[1]) return { template: { template_id: decodeURIComponent(t[1]), name: "Simulated TEST form", items: SIM_ITEMS, response_sets: SIM_FIXES_TEMPLATE.response_sets } };
  if (method === "POST" && p === "/audits") {
    const b = (body ?? {}) as { template_id: string; items?: Item[]; header_items?: Item[] };
    const given = new Map([...(b.items ?? []), ...(b.header_items ?? [])].map((i) => [i.item_id, i]));
    const items = SIM_ITEMS.map((x) => ({ ...x, ...(given.get(x.item_id) ?? {}) }));
    for (const g of b.items ?? []) if (!items.some((i) => i.item_id === g.item_id)) items.push(g);
    const id = newAuditId(); const now = new Date().toISOString();
    const { error } = await db().insert({ id, template_id: b.template_id, items, header_items: [], completed: false, request: body ?? null, created_at: now, modified_at: now });
    if (error) throw new Error("Simulated Mitti could not store the TEST form.");
    known.add(id);
    return { audit_id: id, created_at: now };
  }
  const id = auditIdOfPath(p);
  if (id) {
    const { data: row } = await db().select("*").eq("id", id).maybeSingle();
    if (!row) throw new Error(`Simulated Mitti: no TEST form ${id}`);
    if (/\/(share|owner)$/.test(p)) return {};
    if (method === "GET") return { audit_id: row.id, template_id: row.template_id, created_at: row.created_at, modified_at: row.modified_at, audit_data: { date_completed: row.completed ? row.modified_at : null }, items: row.items, header_items: row.header_items };
    if (method === "PUT") {
      const items: Item[] = row.items ?? [];
      for (const it of [...((body as Any)?.items ?? []), ...((body as Any)?.header_items ?? [])] as Item[]) { const ex = items.find((x) => x.item_id === it.item_id); if (ex) Object.assign(ex, it); else items.push(it); }
      await db().update({ items, modified_at: new Date().toISOString() }).eq("id", id);
      return {};
    }
  }
  throw new Error(`Simulated Mitti (TEST): unsupported ${method} ${p}`);
};
