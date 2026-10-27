// Persist simulations in existing private job history, so page, webhook and tick see the same form.
// Unknown operations/old real audit ids fail closed; no network fallback or invented completion.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { FORMS, type FormKey } from "./mitti-forms.core";
import { INSTALL_DAY_QUESTIONS } from "./install-day.core";
import { simulatedInstallDayTemplate, type SimAudit } from "./journey-sim.core";
import type { MittiCall } from "./mitti.core";

const EVENT = "qa_mitti_snapshot";
export async function simulatedJobMitti(jobId: string): Promise<MittiCall> {
  const { data: job, error } = await admin.from("jobs").select("source").eq("id", jobId).single();
  if (error || job?.source !== "qa_test") throw new Error("SAFETY STOP: simulation requires a recorded qa_test job");
  return async (method, path, body) => {
    const p = path.split("?")[0] ?? "";
    const fail = () => { throw new Error(`SAFETY STOP: simulated Mitti does not support ${method} ${p}`); };
    if (p === "/users/search" && method === "POST") {
      const emails = (body as { email?: string[] } | undefined)?.email ?? [];
      return emails.map((email, i) => ({ id: `qa-user-${jobId}-${i}`, email }));
    }
    const template = /^\/templates\/v1\/templates\/([^/]+)$/.exec(p);
    const templateOf = async (id: string) => {
      const { data: settings, error: se } = await admin.from("workflow_settings").select("*").eq("id", 1).single();
      if (se || !settings) return fail();
      const values = settings as unknown as Record<string, unknown>;
      const cols: [string, FormKey][] = [["mitti_ready_check_template_id", "ready_check"], ["mitti_ready_check_priced_template_id", "ready_check_priced"], ["mitti_piesa_template_id", "piesa"], ["mitti_piisa_template_id", "piisa"], ["mitti_fixes_template_id", "fixes"]];
      const key = cols.find(([c]) => values[c] === id)?.[1];
      if (!key) return fail();
      if (key === "piisa") return { template_id: id, name: FORMS[key].title, ...simulatedInstallDayTemplate(INSTALL_DAY_QUESTIONS) };
      const kinds: Record<string, string> = { text: "textsingle", phone: "textsingle", number: "textsingle", choice: "question", multichoice: "question", yesno: "question", media: "media", signature: "signature", datetime: "datetime", date: "datetime", tick: "checkbox", statement: "textsingle" };
      const fields = FORMS[key].fields.filter(f => !f.portalOnly);
      return { template_id: id, name: FORMS[key].title, items: fields.map((f, i) => ({ item_id: `qa-${i}`, id: `qa-${i}`, label: f.label, type: kinds[f.type] ?? "textsingle", ...(f.choices ? { question: { response_set_id: `qa-rs-${i}` } } : {}) })), response_sets: fields.flatMap((f, i) => f.choices ? [{ id: `qa-rs-${i}`, responses: f.choices.map((label, n) => ({ id: `qa-rs-${i}-${n}`, label })) }] : []) };
    };
    if (template && method === "GET") return { template: await templateOf(decodeURIComponent(template[1] ?? "")) };
    const persist = async (audit: SimAudit) => {
      const { error: e } = await admin.from("workflow_events").insert({ job_id: jobId, event_type: EVENT, summary: "TEST simulated Mitti form saved; no real Mitti call", details: { audit_id: audit.audit_id, snapshot: audit } as never });
      if (e) throw new Error("SAFETY STOP: simulated Mitti snapshot could not be saved");
    };
    if (p === "/audits" && method === "POST") {
      const b = body as { template_id: string; items?: SimAudit["items"]; header_items?: SimAudit["items"] };
      const tpl = await templateOf(b.template_id);
      const now = new Date().toISOString();
      const audit: SimAudit = { audit_id: `audit_qa_${crypto.randomUUID()}`, template_id: b.template_id, completed: false, created_at: now, modified_at: now, items: tpl.items.map(i => ({ ...i, ...(b.items?.find(x => x.item_id === i.item_id) ?? {}) })), header_items: b.header_items ?? [] };
      await persist(audit);
      return { audit_id: audit.audit_id };
    }
    const match = /^\/(?:audits|inspections\/v1\/inspections)\/([^/]+)(\/.*)?$/.exec(p);
    if (!match) return fail();
    const id = decodeURIComponent(match[1] ?? "");
    const suffix = match[2] ?? "";
    const { data: last, error: le } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", EVENT).contains("details", { audit_id: id }).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const audit = (last?.details as unknown as { snapshot?: SimAudit } | null)?.snapshot;
    if (le || !audit) throw new Error("SAFETY STOP: no saved simulated Mitti form for this qa_test job; real form untouched");
    if (method === "GET" && !suffix) return audit;
    if ((suffix === "/share" || suffix === "/owner") && (method === "PUT" || method === "POST")) return {};
    if (method === "PUT" && !suffix) {
      const b = body as { items?: SimAudit["items"]; header_items?: SimAudit["items"]; completed?: boolean };
      for (const item of b.items ?? []) { const existing = audit.items.find(x => x.item_id === item.item_id); if (existing) Object.assign(existing, item); else audit.items.push(item); }
      for (const item of b.header_items ?? []) { const existing = audit.header_items.find(x => x.item_id === item.item_id); if (existing) Object.assign(existing, item); else audit.header_items.push(item); }
      if (typeof b.completed === "boolean") audit.completed = b.completed;
      audit.modified_at = new Date().toISOString();
      await persist(audit); return {};
    }
    return fail();
  };
}