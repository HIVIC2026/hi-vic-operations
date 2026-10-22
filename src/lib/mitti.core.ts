// PURE Mitti logic: label-based template prefill, audit parsing, create/reuse orchestration.
// No network, no database. The only network boundary is mitti.server.ts (injected here as MittiCall).
// Mitti sync NEVER completes an assessment, writes PIESA records, moves stages or issues quotes —
// completeAssessment remains the authoritative gate.
import { canonicalMittiTemplateId, mittiTemplateIdentity, sameMittiTemplateId } from "./mitti-identity.core";

export const MITTI_TEMPLATE_ID = "template_fd20c6437f4e4db2b49b2d6dbe0d3f91";
/** Electrical rate codes Lovable can price. Everything else from Mitti is manual office review. */
export const STANDARD_RATE_CODES = ["CALLOUT", "DOWNLIGHT_UPGRADE", "EXHAUST_CLEARANCE", "RCD_INSTALL", "SWITCHBOARD_UPGRADE"] as const;
/** Mitti PIESA forms are created only in the Ready Check-first PIESA stages (legacy assessment stages retired). */
export const MITTI_ASSIGN_STAGES = ["piesa_and_install_window_pending", "piesa_scheduled"] as const;
/** The installer's Ready Check form (never PIESA) may be sent while the Ready Check is being arranged. */
export const MITTI_READY_CHECK_STAGES = ["ready_check_ready_to_schedule", "ready_check_scheduled"] as const;

export class MittiError extends Error {
  readonly status?: number;
  readonly code?: "not_configured" | "unavailable" | "api_error";
  constructor(message: string, details: { status?: number; code?: "not_configured" | "unavailable" | "api_error" } = {}) {
    super(message);
    if (details.status !== undefined) this.status = details.status;
    if (details.code !== undefined) this.code = details.code;
  }
}

export type MittiCall = (method: "GET" | "POST" | "PUT", path: string, body?: unknown) => Promise<unknown>;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export function mittiApi(call: MittiCall) {
  return {
    /** Full template definition (v1 route) – used for form validation AND label-based prefill. */
    getTemplateDefinition: (id: string) => call("GET", `/templates/v1/templates/${encodeURIComponent(id)}`) as Promise<Any>,
    searchUsers: (email: string) => call("POST", "/users/search", { email: [email] }) as Promise<Any>,
    createAudit: (body: { template_id: string; header_items?: unknown[]; items?: unknown[] }) => call("POST", "/audits", body) as Promise<Any>,
    shareAudit: (auditId: string, userId: string) =>
      call("POST", `/audits/${encodeURIComponent(auditId)}/share`, { shares: [{ id: userId, permission: "edit" }] }),
    /** Make the assignee the owner so the form sits in THEIR Inspections list (sharing alone leaves it hidden). */
    setAuditOwner: (auditId: string, userId: string) =>
      call("PUT", `/inspections/v1/inspections/${encodeURIComponent(auditId)}/owner`, { owner_id: userId }),
    getAudit: (auditId: string) => call("GET", `/audits/${encodeURIComponent(auditId)}`) as Promise<Any>,
    /** List recently modified audits (Mitti/SafetyCulture listing route); template-filtered by the caller. */
    searchAudits: (modifiedAfterIso: string) =>
      call("GET", `/audits/search?modified_after=${encodeURIComponent(modifiedAfterIso)}&limit=200`) as Promise<Any>,
    /** Documented partial text update for header items (Portal Job Number write-back); omitted fields untouched. */
    updateAuditHeader: (auditId: string, headerItems: { item_id: string; type: string; responses: { text?: string; datetime?: string } }[]) =>
      call("PUT", `/audits/${encodeURIComponent(auditId)}`, { header_items: headerItems }) as Promise<Any>,
    /** Documented partial text update; omitted responses (including signatures) are untouched. */
    updateAuditText: (auditId: string, items: { item_id: string; type: string; responses: { text?: string; datetime?: string } }[]) => call("PUT", `/audits/${encodeURIComponent(auditId)}`, { items }),
    /** Mitti's own finished PDF report (with its photos): request, then poll until a download link is ready. */
    requestReport: (auditId: string) => call("POST", `/audits/${encodeURIComponent(auditId)}/report`, { format: "PDF" }) as Promise<Any>,
    getReport: (auditId: string, messageId: string) => call("GET", `/audits/${encodeURIComponent(auditId)}/report/${encodeURIComponent(messageId)}`) as Promise<Any>,
  };
}
export type MittiApi = ReturnType<typeof mittiApi>;

// ---------- label helpers ----------
export const norm = (s: unknown) =>
  String(s ?? "").toLowerCase().replace(/²/g, "2").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

export type Entry = { id: string; label: string; norm: string; type: string; value: string | null; parent: string | null; section: string; header: boolean };

function responseValue(it: Any): string | null {
  const r = it?.responses ?? {};
  if (Array.isArray(r.selected) && r.selected.length) return r.selected.map((s: Any) => s?.label ?? s).join(", ");
  for (const k of ["text", "value", "datetime", "date", "number"]) if (r[k] != null && String(r[k]).trim() !== "") return String(r[k]).trim();
  if (typeof it?.value === "string" || typeof it?.value === "number") return String(it.value);
  return null;
}

const TYPE_KEYS = ["textsingle", "textmulti", "question", "list", "checkbox", "media", "signature", "datetime", "number", "drawing", "site", "switch"] as const;
/** Mitti items often carry their type as a type-named key (e.g. `question`) rather than a `type` field. */
export function mittiItemType(it: Any): string {
  const direct = String(it?.type ?? "").trim();
  if (direct) return direct;
  return TYPE_KEYS.find((k) => it?.[k] != null) ?? "";
}

/** Flatten header_items + nested items; section = normalized labels of all ancestors. */
export function flatten(doc: Any): Entry[] {
  // Audit docs carry header_items/items at the root; v1 template definitions wrap them under `template`.
  const root = doc?.template ?? doc;
  const raw: { it: Any; header: boolean }[] = [
    ...((root?.header_items ?? []) as Any[]).map((it) => ({ it, header: true })),
    ...((root?.items ?? []) as Any[]).map((it) => ({ it, header: false })),
  ];
  // Support nested children arrays as well as flat parent_id lists.
  const all: { it: Any; header: boolean; parent: string | null }[] = [];
  const walk = (it: Any, header: boolean, parent: string | null) => {
    all.push({ it, header, parent: it.parent_id ?? parent });
    for (const c of (it.children ?? it.items ?? []) as Any[]) walk(c, header, it.item_id ?? it.id ?? null);
  };
  raw.forEach(({ it, header }) => walk(it, header, null));
  const byId = new Map(all.map((a) => [String(a.it.item_id ?? a.it.id ?? ""), a]));
  return all.map(({ it, header, parent }) => {
    const chain: string[] = [];
    let p = parent, guard = 0;
    while (p && guard++ < 20) { const x = byId.get(String(p)); if (!x) break; chain.unshift(norm(x.it.label)); p = x.parent; }
    return { id: String(it.item_id ?? it.id ?? ""), label: String(it.label ?? ""), norm: norm(it.label), type: mittiItemType(it), value: responseValue(it), parent: parent ? String(parent) : null, section: chain.join(" / "), header };
  });
}

/** Exact normalized label first (must be unique — duplicates are ambiguous); prefix fallback only when it yields exactly one candidate. */
function resolve(entries: Entry[], aliases: string[], opts: { section?: string | undefined; withValue?: boolean } = {}): { entry?: Entry | undefined; ambiguous: boolean } {
  const pool = entries.filter((e) => (!opts.section || e.section.includes(opts.section) || e.norm.includes(opts.section)) && (!opts.withValue || e.value != null));
  let exact: Entry | undefined;
  for (const a of aliases.map(norm)) {
    const xs = pool.filter((e) => e.norm === a);
    if (xs.length > 1) return { ambiguous: true }; // duplicate exact labels: ambiguous, no escape via another alias
    if (xs.length === 1 && !exact) exact = xs[0];
  }
  if (exact) return { entry: exact, ambiguous: false };
  let ambiguous = false;
  for (const a of aliases.map(norm)) {
    const xs = pool.filter((e) => e.norm.startsWith(a));
    if (xs.length === 1) return { entry: xs[0], ambiguous: false };
    if (xs.length > 1) ambiguous = true;
  }
  return { ambiguous };
}
function find(entries: Entry[], aliases: string[], opts: { section?: string | undefined; withValue?: boolean } = {}): Entry | undefined {
  return resolve(entries, aliases, opts).entry;
}
const val = (entries: Entry[], aliases: string[], section?: string) => find(entries, aliases, { section, withValue: true })?.value ?? null;
/** All valued entries for the first alias that matches (exact, else prefix). >1 = repeated field. */
function candidates(entries: Entry[], aliases: string[]): Entry[] {
  const pool = entries.filter((e) => e.value != null);
  const ns = aliases.map(norm);
  const exact = pool.filter((e) => ns.includes(e.norm));
  return exact.length ? exact : pool.filter((e) => ns.some((a) => e.norm.startsWith(a)));
}

export function yesNo(v: string | null): boolean | null {
  if (v == null) return null;
  const n = norm(v);
  if (/^(yes|y|true|present|confirmed)\b/.test(n)) return true;
  if (/^(no|n|false|none|not present|absent|nil)\b/.test(n)) return false;
  return null;
}
const NUM_RE = /^(?:r\s*)?\$?\s*(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(?:m2|m²|sq\s?m|sqm|m|mm|ea|x)?$/i;
/** Strict: the whole value must be one finite number (optional R prefix, $, thousands commas, unit). */
export function num(v: string | null): number | null {
  if (v == null) return null;
  const m = String(v).trim().match(NUM_RE);
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
type Parsed = { value: number | null; issue: string | null };
/** Nonnegative finite physical value; malformed/negative → issue, never coerced. */
function physical(v: string | null, what: string): Parsed {
  if (v == null) return { value: null, issue: null };
  const n = num(v);
  if (n == null) return { value: null, issue: `${what} "${v}" is not a valid number – office review required.` };
  if (n < 0) return { value: null, issue: `${what} "${v}" is negative – office review required.` };
  return { value: n, issue: null };
}
/** Nonnegative whole count; fractional values are rejected, never rounded. */
function count(v: string | null, what: string): Parsed {
  const p = physical(v, what);
  if (p.value != null && !Number.isInteger(p.value)) return { value: null, issue: `${what} "${v}" is not a whole number – office review required.` };
  return p;
}
const r2 = (n: number) => Math.round(n * 100) / 100;

export function melbourneDay(v: string | null): string | null {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// ---------- prefill ----------
export type PrefillCtx = {
  jobNumber: string; address: string; ownerName: string; ownerEmail?: string | null; ownerPhone?: string | null;
  assessorName: string; assessmentAt?: string | null; estimatedAreaM2?: number | null; occupancy?: string | null;
  lifeSupport?: string | null; propertyType?: string | null;
  /** Official PIESA "Date of inspection" default (today, Melbourne); the electrician can change it. */ inspectionDate?: string | null;
  /** Ready Check "built or replaced in the last 5 years?" — from the owner's DECLARED enquiry answer: over 5 years "yes" → "No", "no" → "Yes"; unknown stays blank. */ builtLast5Years?: string | null;
  /** Official PIESA life-support question, from the owner's DECLARED enquiry answer ("Yes"/"No"); blank when unknown. */ lifeSupportDeclared?: string | null;
};
const PREFILL: { key: keyof PrefillCtx; aliases: string[]; mandatory?: boolean; datetime?: boolean }[] = [
  { key: "jobNumber", aliases: ["Portal Job Number", "Job Reference ID"], mandatory: true },
  { key: "address", aliases: ["Property Address", "Site address", "Site Address", "Address including postcode"], mandatory: true },
  { key: "ownerName", aliases: ["Owner name", "Homeowner name", "Owner full name", "Client name", "Property owner name"], mandatory: true },
  { key: "ownerEmail", aliases: ["Owner email", "Homeowner email"] },
  { key: "ownerPhone", aliases: ["Owner phone", "Owner mobile", "Homeowner mobile", "Homeowner phone"] },
  { key: "assessorName", aliases: ["Assigned Electrician", "Assessor", "Assigned Electrician / Assessor", "Full Name (initial assessment)", "Lead installer name"], mandatory: true },
  { key: "assessmentAt", aliases: ["Assessment date/time", "Assessment date time", "Booked assessment date"], datetime: true },
  { key: "estimatedAreaM2", aliases: ["Office estimated ceiling area", "Estimated ceiling area"] },
  { key: "occupancy", aliases: ["Occupancy"] },
  { key: "lifeSupport", aliases: ["Life support status", "Office life support result", "Office life support status", "Life support equipment at property?"] },
  { key: "propertyType", aliases: ["Property type"] },
  { key: "builtLast5Years", aliases: ["Was the ceiling or roof built or replaced in the last 5 years?"] },
  { key: "inspectionDate", aliases: ["Date of inspection"], datetime: true },
  { key: "lifeSupportDeclared", aliases: ["Is anyone at this property dependent on life support?"] },
];

const PROPERTY_TYPE_OPTIONS = ["House", "Townhouse", "Unit or apartment"] as const;
/** Pure: owner's declared "over five years" → Ready Check "built in last 5 years" option. Never guesses. */
export function builtLast5YearsOption(overFive: unknown): string | null {
  return overFive === "yes" ? "No" : overFive === "no" ? "Yes" : null;
}
/** Pure: maps a declared property type to a Ready Check option. Unknown values return null — never invented. */
export function propertyTypeOption(v: string | null | undefined): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "house") return "House";
  if (s === "townhouse") return "Townhouse";
  if (s.startsWith("unit") || s.includes("apartment") || s.includes("flat")) return "Unit or apartment";
  return null;
}

/** Find the Mitti option ID for a choice answer (v1 definitions keep options in template.response_sets). */
function choiceOption(template: Any, itemId: string, label: string): { id: string; label: string } | null {
  const root = template?.template ?? template;
  let rsId: string | null = null;
  const walk = (x: Any) => { if (!x || typeof x !== "object" || rsId) return; if (x.id === itemId && x.question?.response_set_id) { rsId = x.question.response_set_id; return; } for (const v of Object.values(x)) walk(v); };
  walk(root?.items);
  const sets: Any[] = [...(root?.response_sets ?? []), ...(root?.global_response_sets ?? [])];
  const opt = (sets.find((s) => s.id === rsId)?.responses ?? []).find((o: Any) => norm(String(o.label)) === norm(label));
  return opt ? { id: String(opt.id), label: String(opt.label) } : null;
}

export function buildPrefill(template: Any, ctx: PrefillCtx) {
  const entries = flatten(template);
  const header_items: Any[] = [], items: Any[] = [], missing: string[] = [], ambiguous: string[] = [], blank: string[] = [];
  for (const f of PREFILL) {
    const v = ctx[f.key];
    const empty = v == null || String(v).trim() === "";
    if (f.mandatory && empty) blank.push(f.aliases[0]!);
    const r = resolve(entries, f.aliases);
    if (!r.entry) { if (r.ambiguous) ambiguous.push(f.aliases[0]!); else if (f.mandatory) missing.push(f.aliases[0]!); continue; }
    const e = r.entry;
    if (empty) continue;
    const vStr = String(v);
    const choiceLike = /choice|question|switch|list/i.test(e.type);
    let type = e.type, responses: Any;
    if (f.datetime) responses = { datetime: vStr };
    else if (choiceLike) {
      const opt = choiceOption(template, e.id, vStr);
      if (!opt) { if (f.mandatory) missing.push(`${f.aliases[0]} option "${vStr}"`); continue; } // never guess an option
      type = "question"; responses = { selected: [opt] };
    } else if (/^site$/i.test(e.type)) { missing.push(`${e.label} (Mitti "Site" fields can't be prefilled – change it to a text answer)`); continue; }
    else if (/^address$/i.test(e.type)) responses = { location_text: vStr };
    else responses = { text: vStr };
    const row = { item_id: e.id, label: e.label, type, responses };
    (e.header ? header_items : items).push(row);
  }
  return { header_items, items, count: header_items.length + items.length, missing, ambiguous, blank };
}

// ---------- create / reuse ----------
export type CreateCtx = {
  businessUnit: string; stage: string; jobNumber: string; existingAuditId: string | null;
  electricianEmail: string | null; prefill: PrefillCtx;
  /** Defaults to the electrician PIESA template. Installer measure-up passes the configured measure-up template (never invented). */
  templateId?: string; assigneeRole?: "electrician" | "installer";
};
export type CreateResult = { auditId: string; reused: boolean; mittiUserId: string; assigneeEmail: string; prefillCount: number | null; createdAt: string | null };

export function pickUser(res: Any, email: string): Any | null {
  const list: Any[] = Array.isArray(res) ? res : res?.users ?? res?.data ?? [];
  return list.find((u) => String(u?.email ?? "").toLowerCase() === email.toLowerCase()) ?? null;
}

export async function createOrReuseAudit(api: MittiApi, ctx: CreateCtx): Promise<CreateResult> {
  if (ctx.businessUnit !== "hivic") throw new MittiError("Mitti automation is only available for Home Insulation Victoria jobs.");
  const readyCheckSend = ctx.assigneeRole === "installer" && (MITTI_READY_CHECK_STAGES as readonly string[]).includes(ctx.stage);
  if (!readyCheckSend && !(MITTI_ASSIGN_STAGES as readonly string[]).includes(ctx.stage)) throw new MittiError("Mitti assessments can only be created once the job is waiting on or has booked its PIESA.");
  const who = ctx.assigneeRole ?? "electrician";
  const templateId = ctx.templateId ?? MITTI_TEMPLATE_ID;
  if (!canonicalMittiTemplateId(templateId)) throw new MittiError("The Mitti template for this scope is not configured with a valid form ID.");
  const email = ctx.electricianEmail?.trim();
  if (!email) throw new MittiError(`Assign an ${who} with an email address before creating the Mitti assessment.`);
  const user = pickUser(await api.searchUsers(email), email);
  const userId = user?.id ?? user?.user_id;
  if (!userId) throw new MittiError(`The assigned ${who} (${email}) was not found in Mitti. Invite them to Mitti with that exact email, then retry.`);

  if (ctx.existingAuditId) {
    validateStoredMittiAudit(await api.getAudit(ctx.existingAuditId), {
      storedAuditId: ctx.existingAuditId, jobNumber: ctx.jobNumber, templateId,
    });
    await api.shareAudit(ctx.existingAuditId, String(userId));
    await api.setAuditOwner(ctx.existingAuditId, String(userId));
    return { auditId: ctx.existingAuditId, reused: true, mittiUserId: String(userId), assigneeEmail: email, prefillCount: null, createdAt: null };
  }
  const blankRequired = (["jobNumber", "address", "ownerName", "assessorName"] as const).filter((k) => String(ctx.prefill[k] ?? "").trim() === "");
  if (blankRequired.length) throw new MittiError(`Required office details are blank: ${blankRequired.join(", ")}. Fill them in before creating the Mitti assessment.`);
  const template = await api.getTemplateDefinition(templateId);
  if (!sameMittiTemplateId(mittiTemplateIdentity(template).id, templateId))
    throw new MittiError("Mitti returned an unexpected or unidentifiable template.");
  const p = buildPrefill(template, ctx.prefill);
  if (p.ambiguous.length) throw new MittiError(`The Mitti template has ambiguous office fields (more than one match): ${p.ambiguous.join(", ")}.`);
  if (p.missing.length) throw new MittiError(`The Mitti template is missing required office fields: ${p.missing.join(", ")}.`);
  if (p.blank.length) throw new MittiError(`Required office details are blank: ${p.blank.join(", ")}.`);
  const audit = await api.createAudit({ template_id: templateId, header_items: p.header_items, items: p.items });
  const auditId = audit?.audit_id ?? audit?.id;
  if (!auditId) throw new MittiError("Mitti did not return an audit ID.");
  await api.shareAudit(String(auditId), String(userId));
  await api.setAuditOwner(String(auditId), String(userId));
  return { auditId: String(auditId), reused: false, mittiUserId: String(userId), assigneeEmail: email, prefillCount: p.count, createdAt: audit?.created_at ?? audit?.audit_data?.date_started ?? null };
}

// ---------- parse ----------
export type AssessmentPatch = Partial<{
  measured_area_m2: number; insulation_present: boolean; existing_r_value: number; removal_required: boolean; removal_m2: number;
  access_difficulty: "easy" | "moderate" | "difficult"; downlights_qty: number; downlights_type: string; downlights_upgrade_qty: number;
  exhaust_fans_qty: number; exhaust_fans_clearance_qty: number; hazards: string; switchboard_condition: "ok" | "upgrade_required";
  rcds_present: boolean; rcds_required_qty: number; life_support_confirmed: boolean; piesa_outcome: "pass" | "fail"; assessed_on: string; notes: string;
}>;
export type OtherItem = { external_key: string; description: string; quantity: number; unit_price_inc_gst: number | null; explanation: string; needs_office_pricing: boolean; unsupported: boolean };

const UNSUPPORTED_WORK: [string, string][] = [
  ["circuit protection", "Circuit protection work"], ["cable replacement", "Cable replacement"], ["basic protection", "Basic protection work"],
];

export function parseAudit(audit: Any) {
  const entries = flatten(audit?.audit_data ? { header_items: audit.header_items, items: audit.items } : audit);
  const auditId = String(audit?.audit_id ?? audit?.id ?? "");
  const patch: AssessmentPatch = {};
  const issues: string[] = [];

  const note = (p: Parsed) => { if (p.issue) issues.push(p.issue); return p.value; };

  // Area: per-room answers in the repeating "Ceiling area" section are the single source — the installer
  // is never asked for whole-house totals. The portal sums validated per-room values itself. Legacy
  // whole-house fields are only used when no per-room groups exist (old templates).
  const AREA = {
    net: ["Net insulation area (m²) = Gross minus Excluded", "Net insulation area"],
    total: ["Total measured ceiling area m2", "Total area to insulate", "Area to insulate", "Total insulation area"],
    gross: ["Gross ceiling area", "Gross area"],
    excl: ["Excluded area", "Excluded ceiling area"],
  };
  // Group per-area fields by their repeat-instance parent so each area's m2/removal/insulation stay together.
  // A2 (our leads) captures "Length (m)" × "Width (m)" per area; A1 (installer's own customers) captures the
  // measured m² directly. Legacy forms used "Measured area m2".
  const isAreaKid = (e: Any) => !e.header && [norm("Measured area m2"), norm("Length (m)"), norm("Enter the measured ceiling area (m²)")].includes(e.norm) && e.value != null;
  const roomParents = new Set(entries.filter(isAreaKid).map((e) => e.parent ?? e.id));
  const areaM2Label = (kids: Entry[]) => kids.find((e) => [norm("Measured area m2"), norm("Enter the measured ceiling area (m²)")].includes(e.norm)) ?? kids.find((e) => e.norm.startsWith(norm("Measured area m2")));
  // Per-area questions can sit inside conditional sub-branches (empty-label containers), so an area's
  // fields are its whole descendant subtree, not just direct children.
  const entryById = new Map(entries.map((e) => [e.id, e]));
  const areaKids = (p: string) => entries.filter((e) => {
    if (e.id === p || e.parent === p) return true;
    let anc = e.parent, guard = 0;
    while (anc && guard++ < 20) { if (anc === p) return true; anc = entryById.get(anc)?.parent ?? null; }
    return false;
  });
  const rooms = [...roomParents].map((p) => {
    const kids = areaKids(p);
    const m2e = areaM2Label(kids);
    let m2 = physical(m2e?.value ?? null, m2e?.label ?? "Measured area m2");
    if (m2.value == null) {
      const len = physical(val(kids, ["Length (m)"]), "Length (m)");
      const wid = physical(val(kids, ["Width (m)"]), "Width (m)");
      if (len.issue) issues.push(len.issue);
      if (wid.issue) issues.push(wid.issue);
      if (len.value != null && len.value > 0 && wid.value != null && wid.value > 0) m2 = { value: r2(len.value * wid.value), issue: null } as typeof m2;
    }
    if (m2.issue) issues.push(m2.issue);
    const present = yesNo(val(kids, ["Is there existing insulation?", "Is there existing insulation in this ceiling area?"]));
    const state = norm(val(kids, ["Existing insulation"])) || (present === true ? "under-insulated" : present === false ? "uninsulated" : "");
    const action = norm(val(kids, ["What needs to happen to it?", "What is required for the existing insulation?", "What happens to the existing insulation"]));
    const removal = /^(remove|must be removed)/.test(action) ? true : /^(top up|can be topped up)/.test(action) ? false : yesNo(val(kids, ["Removal required"]));
    if (/not sure/.test(action)) issues.push("A ceiling area's existing insulation is marked 'Not sure' – office review required.");
    // The insulation type can arrive as one multichoice (A1) or as separate Batts / Loose fill checkboxes (A2).
    const tickTypes = ["Batts", "Loose fill"].filter((l) => { const e = find(kids, [l]); return e?.value != null && !/^(false|no|n a|na)$/.test(norm(e.value)); });
    const mc = val(kids, ["Insulation type (tick all that apply)", "What type of existing insulation is installed? Select all that apply", "Existing insulation type", "Insulation type to remove"]);
    const removalType = [mc, ...tickTypes].filter(Boolean).join(", ") || null;
    const rv = physical(val(kids, ["What is the determined R value of the existing ceiling insulation?", "Existing R-value", "Measured R-value"]), "R value").value;
    return { parent: p, m2: m2.value, state, removal, removalType, rv };
  });
  if (rooms.length > 0) {
    if (rooms.some((r) => r.m2 == null || r.m2 <= 0)) issues.push("A room's measured area was missing or invalid – whole-house area not taken from Mitti; office review required.");
    else patch.measured_area_m2 = r2(rooms.reduce((s, r) => s + (r.m2 ?? 0), 0));
    if (rooms.some((r) => r.state)) patch.insulation_present = rooms.some((r) => /under-insulated/.test(r.state));
    if (rooms.some((r) => r.removal != null)) {
      patch.removal_required = rooms.some((r) => r.removal === true);
      if (patch.removal_required) {
        const remRooms = rooms.filter((r) => r.removal === true);
        // Prefer the per-area "Area to remove (m2)" answer; fall back to the area's full m2.
        const remM2 = remRooms.map((r) => { const kids = areaKids(r.parent); const v = physical(val(kids, ["Area to remove (m2)", "How much existing insulation needs to be removed? (m²)"]), "Area to remove (m2)"); return v.value != null && v.value > 0 ? v.value : r.m2; });
      if (remM2.some((m) => m == null || m <= 0)) issues.push("A removal area's size was missing or invalid – removal area not taken from Mitti; office review required.");
        else patch.removal_m2 = r2(remM2.reduce<number>((s, m) => s + (m ?? 0), 0));
        const types = [...new Set(remRooms.flatMap((r) => (r.removalType ?? "").split(/[,;\n]+/)).map((t) => t.trim()).filter(Boolean))];
        if (types.length > 0) patch.notes = [patch.notes, `Insulation type to remove: ${types.join(", ")}${types.length > 1 ? " (mixed)" : ""}`].filter(Boolean).join(". ").slice(0, 4000);
        if (types.length > 1) issues.push("More than one existing insulation type was ticked (batts + loose fill) – mixed insulation needs office review.");
        if (types.length === 0) issues.push("Insulation type to remove not captured – needed for removal pricing; office follow-up required.");
      }
    }
    // Per-area R-values (A1): record the lowest; differing values across areas need office review.
    const rvs = rooms.map((r) => r.rv).filter((v): v is number => v != null && v > 0);
    if (rvs.length > 0) {
      patch.existing_r_value = Math.min(...rvs);
      if (new Set(rvs).size > 1) issues.push("Existing insulation R-values differ between ceiling areas – the lowest was recorded; office review required.");
    }
  } else {
    const repeated = Object.values(AREA).some((a) => candidates(entries, a).length > 1);
    if (repeated) issues.push("Repeated ceiling area fields found (per-zone values) – whole-house area not taken from Mitti; office review required.");
    else {
      const areaStart = issues.length;
      const net = note(physical(val(entries, AREA.net), "Net insulation area"));
      const total = note(physical(val(entries, AREA.total), "Total area to insulate"));
      const gross = note(physical(val(entries, AREA.gross), "Gross ceiling area")), excl = note(physical(val(entries, AREA.excl), "Excluded area"));
      const area = net ?? total ?? (gross != null ? r2(gross - (excl ?? 0)) : null);
      // Invalid supplied area fields fail closed: no fallback to other area fields.
      if (issues.length > areaStart) issues.push("Ceiling area not taken from Mitti because a supplied area value was invalid.");
      else if (area != null && area > 0) patch.measured_area_m2 = r2(area); else issues.push("Measured ceiling area not found in Mitti.");
    }

    const ins = yesNo(val(entries, ["Existing insulation present", "Insulation present", "Any existing insulation present", "Is there insulation present in the ceiling?"]));
    if (ins != null) patch.insulation_present = ins;
    const rem = yesNo(val(entries, ["Removal required", "Existing insulation removal required"]));
    if (rem != null) patch.removal_required = rem;
    const remM2 = note(physical(val(entries, ["Total removal area m2", "Removal area", "Removal m2", "Area to remove"]), "Removal area"));
    if (rem && remM2 != null) patch.removal_m2 = remM2;
  }
  const rv = note(physical(val(entries, ["Existing R-value", "Measured R-value", "Confirmed R-value", "Existing insulation R-value", "What is the determined R value of the existing ceiling insulation?"]), "Existing R-value"));
  if (rv != null && patch.existing_r_value == null && patch.insulation_present !== false) patch.existing_r_value = rv;
  // Measurement provenance: whole-job question (A2) or per-area questions (A1). Aerial/online estimates are never accepted.
  const methodWhole = val(entries, ["How was the ceiling measured?", "How the ceiling was measured", "Measurement method"]);
  const perAreaMethods = rooms.length ? [...new Set(rooms.map((r) => { const kids = areaKids(r.parent); return [val(kids, ["How was this ceiling area measured?", "How was the ceiling measured?"]), val(kids, ["Tell us how you measured it", "Explain the method"])].filter(Boolean).join(" — "); }).filter(Boolean))] : [];
  const methodText = methodWhole ? [methodWhole, ...perAreaMethods] : perAreaMethods;
  if (methodText.length) patch.notes = [patch.notes, `Measured by: ${methodText.join("; ")}`].filter(Boolean).join(". ").slice(0, 4000);
  else if (rooms.length > 0) issues.push("Measurement method not captured – how the ceiling was measured must be documented.");

  const acc = norm(val(entries, ["How easy is the ceiling access?", "How would you rate the ceiling access?", "Ceiling access", "Access difficulty", "Roof space access"]));
  if (acc) { const a = /difficult|hard|restricted/.test(acc) ? "difficult" : /moderate|medium|standard/.test(acc) ? "moderate" : /easy|good/.test(acc) ? "easy" : null; if (a) patch.access_difficulty = a; else issues.push("Ceiling access answer not recognised – office review required."); }

  const setInt = (k: keyof AssessmentPatch, aliases: string[]) => { const e = find(entries, aliases, { withValue: true }); const n = note(count(e?.value ?? null, e?.label ?? aliases[0]!)); if (n != null) (patch as Any)[k] = n; };
  setInt("downlights_upgrade_qty", ["Downlights requiring upgrade", "Downlights to upgrade", "Downlight upgrade qty"]);
  // Per-area downlight counts ("How many?") are summed; whole-job aliases cover legacy forms.
  const perAreaDownlights = rooms.length ? rooms.reduce((s, r) => { const kids = areaKids(r.parent); const n = count(val(kids, ["How many?", "How many recessed downlights?"]), "How many?"); return s + (n.value ?? 0); }, 0) : 0;
  if (perAreaDownlights > 0) patch.downlights_qty = perAreaDownlights;
  else setInt("downlights_qty", ["Total number of luminaires", "Number of downlights", "Downlights qty", "Downlight count", "Downlights"]);
  setInt("exhaust_fans_clearance_qty", ["Exhaust fans requiring clearance", "Exhaust fan clearance", "Exhaust fans needing clearance"]);
  setInt("exhaust_fans_qty", ["Number of exhaust fans", "Exhaust fans qty", "Exhaust fans"]);
  const dt = val(entries, ["Downlight type"]); if (dt) patch.downlights_type = dt.slice(0, 200);
  const hz = val(entries, ["Hazards identified", "Hazards", "Hazards seen in the ceiling space"]); if (hz) patch.hazards = hz.slice(0, 4000);
  // Installer-flagged hazards per ceiling area (both A1 and A2 per-area questions) — flagged jobs go to office review.
  if (rooms.length && patch.hazards == null) {
    const flagged = rooms.filter((r) => { const kids = areaKids(r.parent); const a = val(kids, ["Are there any issues that could affect the insulation installation?", "Hazards in this area?"]); return a != null && /^(yes|y|true)\b/.test(norm(a)); });
    if (flagged.length > 0) { patch.hazards = `Installer flagged hazards in ${flagged.length} ceiling area(s) – confirm details and evidence in office.`; issues.push("Installer flagged hazards in a ceiling area – office review required."); }
  }
  const roof = val(entries, ["Roof type", "What type of roof does the home have?"]); if (roof) patch.notes = [patch.notes, `Roof type: ${roof}`].filter(Boolean).join(". ").slice(0, 4000);
  const built5 = val(entries, ["Was the ceiling or roof built or replaced in the last 5 years?", "Ceiling or roof built in the last 5 years", "Relevant ceiling or roof built in the last 5 years"]); if (built5) patch.notes = [patch.notes, `Ceiling/roof built in last 5 years (Ready Check answer, pre-filled from owner's declared enquiry answer): ${built5}`].filter(Boolean).join(". ").slice(0, 4000);

  const sbUp = val(entries, ["Switchboard upgrade required"]);
  const sbCond = norm(val(entries, ["Switchboard condition", "Switchboard"]));
  if (yesNo(sbUp) === true || /upgrade required/.test(sbCond)) patch.switchboard_condition = "upgrade_required";
  else if (yesNo(sbUp) === false || /^(ok|satisfactory|compliant|good|no upgrade)/.test(sbCond)) patch.switchboard_condition = "ok";
  else if (sbUp || sbCond) issues.push("Switchboard condition is not explicit – confirm in office.");

  const rcd = yesNo(val(entries, ["RCDs present", "RCD present", "RCD protection present", "Are Residual Current Devices (RCDs) (safety switches) present for circuit/s within the ceiling insulation area, as per the most current version of AS/NZS 3000?"])); if (rcd != null) patch.rcds_present = rcd;
  setInt("rcds_required_qty", ["RCDs required", "RCDs to install", "Number of RCDs required"]);

  const ls = yesNo(val(entries, ["Life support equipment onsite", "Life support equipment present", "Life support confirmed", "Is life support equipment"], "piesa"))
    ?? yesNo(val(entries, ["Life support equipment onsite", "Life support equipment present", "Life support confirmed"]));
  if (ls != null) patch.life_support_confirmed = ls;

  // Imported B1 "No rectification required" is a preliminary result only – it never establishes a PIESA pass.
  const po = norm(val(entries, ["B1 Assessment outcome", "Check ONE option only", "PIESA outcome", "PIESA result", "Electrical fixes outcome", "Electrical fixes required"]));
  // Official B1 wording: "...is not required..." / "...is required..." / "...is not possible...".
  if (/no rectification required|rectification work is not required/.test(po)) issues.push("Mitti reports no electrical fixes required (preliminary B1 only) – PIESA clearance stays pending until confirmed in the portal.");
  else if (/rectification required|rectification work is required|rectification work is not possible/.test(po)) patch.piesa_outcome = "fail";
  else issues.push("PIESA outcome not recorded or ambiguous – stays pending.");

  const ad = melbourneDay(val(entries, ["PIESA assessment date", "Date of inspection", "Assessment date/time", "Assessment date", "Assessment datetime", "Conducted on"]));
  if (ad) patch.assessed_on = ad;
  const nt = val(entries, ["Assessor notes", "Final notes", "Notes"]); if (nt) patch.notes = nt.slice(0, 4000);

  // Non-standard work items: grouped by parent; never invent a price.
  const others: OtherItem[] = [];
  const descs = entries.filter((e) => e.value && /^(work item description|other work description|non standard (work|item) description|additional work description)/.test(e.norm));
  for (const d of descs) {
    const sib = entries.filter((e) => e.parent === d.parent);
    const qRaw = val(sib, ["Quantity", "Qty"]);
    const qty = qRaw == null ? 1 : note(physical(qRaw, `Quantity for "${d.value}"`)) ?? 0;
    const totalInc = note(physical(val(sib, ["Proposed total price inc GST", "Proposed total price", "Total price inc GST", "Price inc GST"]), `Price for "${d.value}"`));
    const expl = val(sib, ["Explanation", "Reason", "Why is this needed"]) ?? "From Mitti assessment";
    const priced = totalInc != null && totalInc > 0 && qty > 0;
    if (!priced) issues.push(`"${d.value}" needs office pricing.`);
    others.push({ external_key: `mitti:${auditId}:${d.id}`, description: d.value!.slice(0, 300), quantity: qty > 0 ? qty : 1, unit_price_inc_gst: priced ? r2(totalInc! / qty) : null, explanation: expl.slice(0, 2000), needs_office_pricing: !priced, unsupported: false });
  }
  for (const [key, label] of UNSUPPORTED_WORK) {
    for (const e of entries.filter((x) => x.norm.includes(key) && x.value)) {
      const yn = yesNo(e.value), n = num(e.value);
      if (yn === false || n === 0 || /^(n a|na|none)$/.test(norm(e.value))) continue;
      others.push({ external_key: `mitti:${auditId}:${e.id}`, description: `${label} (manual review – no approved rate)`, quantity: n && n > 0 ? n : 1, unit_price_inc_gst: null, explanation: `Mitti: ${e.label}: ${e.value}`.slice(0, 2000), needs_office_pricing: true, unsupported: true });
      issues.push(`${label} has no approved Lovable rate – office review required.`);
    }
  }

  // Installer's Ready Check outcome (Form A1): a failed check is an office matter, never an auto-rejection.
  const rcOutcome = norm(val(entries, ["Based on your onsite assessment, does this property meet the Ready Check requirements to proceed?"]));
  if (/failed|^no\b/.test(rcOutcome)) {
    issues.push("Installer marked the Ready Check as failed – office review required.");
    const reason = val(entries, ["Why did the property fail the ready check"]);
    if (reason) patch.notes = [patch.notes, `Ready Check failed – installer reasons: ${reason}`].filter(Boolean).join(". ").slice(0, 4000);
  }

  const readyFlag = yesNo(val(entries, ["Ready for office review"]));
  const completed = !!(audit?.completed || audit?.audit_data?.date_completed || audit?.completed_at || readyFlag);
  return {
    auditId, patch, issues, others, completed,
    templateId: String(audit?.template_id ?? audit?.audit_data?.template_id ?? ""),
    jobNumber: val(entries, ["Portal Job Number", "Job Reference ID"]),
    modifiedAt: audit?.modified_at ?? audit?.audit_data?.date_modified ?? null,
    snapshot: entries.filter((e) => e.label).map((e) => ({ id: e.id, label: e.label, section: e.section, value: e.value })),
  };
}

/** New A1 answers (Jo 23 Oct): contact details, contact permission and the electrician choice.
 *  Absent-safe: a label that isn't on the form returns null — nothing is invented. */
export type MittiContactAnswers = {
  phone: string | null; email: string | null; contactPermission: boolean | null;
  electricianChoice: "hivic" | "usual" | "different" | "own" | null; electricianPriceIncGst: string | null; electricianName: string | null; electricianLicence: string | null;
};
export function contactAnswersFromEntries(entries: { label: string; value: string | null }[]): MittiContactAnswers {
  const find = (labels: string[]): string | null => {
    for (const l of labels) {
      const hit = entries.find((e) => (e.label ?? "").trim().toLowerCase() === l.toLowerCase());
      if (hit?.value != null && String(hit.value).trim() !== "") return String(hit.value).trim();
    }
    return null;
  };
  const raw = find(["Who is doing the electrical safety check?"]);
  const choice = norm(raw);
  const electricianChoice = choice === norm("My usual electrician") ? "usual" as const : choice === norm("A different electrician") ? "different" as const : choice === norm("Home Insulation Victoria electrician") ? "hivic" as const : /own electrician/i.test(raw ?? "") ? "own" as const : null;
  return {
    phone: find(["Homeowner phone", "Owner phone"]),
    email: find(["Homeowner email", "Owner email"]),
    contactPermission: yesNo(find(["Homeowner agrees to be contacted by Home Insulation Victoria"])),
    electricianChoice,
    electricianPriceIncGst: find(["Electrician price (inc GST)"]),
    electricianName: find(["Electrician name"]),
    electricianLicence: find(["Electrician licence number"]),
  };
}

/** Verify the stored audit's exact identity, template and job before any reuse write or sync. */
export function validateStoredMittiAudit(audit: Any, ctx: { storedAuditId: string; jobNumber: string; templateId?: string }) {
  const p = parseAudit(audit);
  if (!p.auditId || p.auditId !== ctx.storedAuditId) throw new MittiError("Mitti returned a different audit or no verifiable audit ID for this job.");
  if (!sameMittiTemplateId(p.templateId, ctx.templateId ?? MITTI_TEMPLATE_ID)) throw new MittiError("This Mitti audit does not use the expected Home Insulation Victoria assessment template.");
  if (!ctx.jobNumber?.trim() || !p.jobNumber || p.jobNumber.trim().toUpperCase() !== ctx.jobNumber.trim().toUpperCase())
    throw new MittiError(`Mitti Portal Job Number (${p.jobNumber ?? "missing"}) does not match ${ctx.jobNumber}.`);
  return p;
}

/** Validate a fetched audit belongs to this job, then plan a safe (non-completing) sync. */
export function planSync(audit: Any, ctx: { storedAuditId: string; jobNumber: string; assessmentStatus: string | null; templateId?: string }) {
  if (ctx.assessmentStatus === "complete") return { locked: true as const };
  const p = validateStoredMittiAudit(audit, ctx);
  return {
    locked: false as const, ...p,
    syncStatus: (p.completed ? "synced" : "pending") as "synced" | "pending",
  };
}

const MEASURE_KEYS = ["measured_area_m2", "insulation_present", "existing_r_value", "removal_required", "removal_m2", "access_difficulty"] as const;
/** Split a parsed Mitti patch into ceiling measure-up values and electrical/PIESA values. */
export function splitPatch(patch: AssessmentPatch) {
  const measure: Partial<Pick<AssessmentPatch, (typeof MEASURE_KEYS)[number]>> = {};
  const electrical: AssessmentPatch = {};
  for (const [k, v] of Object.entries(patch)) {
    if ((MEASURE_KEYS as readonly string[]).includes(k)) (measure as Any)[k] = v; else (electrical as Any)[k] = v;
  }
  return { measure, electrical };
}

// ---------- official PIISA / PIESA prefill from LR-003 hints ----------
/** Mitti template for the official PIISA. Empty = not configured: sending is blocked, never guessed. */
/** @deprecated The PIISA Mitti form ID is saved in workflow_settings.mitti_piisa_template_id via Compliance → Mitti forms. */
export const MITTI_PIISA_TEMPLATE_ID = "";
export type OfficialPrefillItem = { itemId: string; label: string; kind: string; value: string };
/** Places "prefill" values on the template by official label. Labels the form repeats are matched in form order
 * (`occurrence`). Attachments can't be pre-loaded into Mitti, and choice values must match an option exactly. */
/** Keyed mapping contract for a native template: portal item id -> stable Mitti item ids and/or plain-language label
 * aliases. The official wording stays in OFFICIAL_ITEMS / the DOCX; only the native Mitti label may be simpler. */
export type NativeMapping = Record<string, { itemIds?: string[]; labels?: string[]; byRow?: boolean }>;

export function buildOfficialPrefill(template: Any, items: (OfficialPrefillItem & { occurrence: number; row?: number })[], mapping: NativeMapping = {}) {
  const entries = flatten(template);
  const header_items: Any[] = [], rows: Any[] = [], skipped: string[] = [];
  for (const f of items) {
    const m = mapping[f.itemId];
    // byRow: itemIds[row] is the exact native field for that row — never another row's or the first ID.
    const wantId = m?.byRow ? m.itemIds?.[f.row ?? 0] : undefined;
    if (m?.byRow) { const hit = wantId ? entries.find((x) => String(x.id) === wantId) : undefined; if (!hit) { skipped.push(`${f.itemId}${f.row ? ` row ${f.row + 1}` : ""} (not on the Mitti form)`); continue; } }
    const byId = m?.byRow ? entries.find((x) => String(x.id) === wantId) : m?.itemIds?.length ? entries.find((x) => m.itemIds!.includes(String(x.id))) : undefined;
    // Repeated native labels (crew rows, EEC numbers) resolve by OCCURRENCE in form order, never first-match.
    const byAlias = !byId && m?.labels?.length ? entries.filter((x) => m.labels!.some((l) => norm(l) === x.norm))[f.occurrence] : undefined;
    const e = byId ?? byAlias ?? entries.filter((x) => x.norm === norm(f.label))[f.occurrence];
    if (!e) { skipped.push(`${f.itemId} (not on the Mitti form)`); continue; }
    let type = e.type, responses: Any;
    if (f.kind === "attachment") { skipped.push(`${f.itemId} (attachment — shown in the portal)`); continue; }
    if (f.kind === "date") responses = { datetime: f.value };
    else if (/choice|question|switch|list/i.test(e.type)) {
      // One exact option, or a multi-select seed ("Removed, Topped up") resolved to EVERY real option id.
      const whole = choiceOption(template, e.id, f.value);
      const parts = whole ? [whole] : f.value.split(/\s*,\s*/).filter(Boolean).map((v) => choiceOption(template, e.id, v));
      if (!parts.length || parts.some((o) => !o)) { skipped.push(`${f.itemId} (no "${f.value}" option)`); continue; }
      // A native "question" is single choice: two known answers can't both go in, so the installer picks on site.
      if (parts.length > 1 && e.type === "question") { skipped.push(`${f.itemId} (single choice on the Mitti form — installer chooses on site)`); continue; }
      type = "question"; responses = { selected: parts };
    } else responses = { text: f.value };
    const list = e.header ? header_items : rows;
    const prior = list.find((x) => x.item_id === e.id);
    // Two seeds for the same multi-select item merge into ONE response (never overwrite or duplicate).
    if (prior && type === "question" && prior.type === "question") {
      const ids = new Set(prior.responses.selected.map((o: Any) => o.id));
      const extra = responses.selected.filter((o: Any) => !ids.has(o.id));
      // Single-choice native question: a second, different answer can't be added — drop the seed, installer picks on site.
      if (extra.length && e.type === "question") { list.splice(list.indexOf(prior), 1); skipped.push(`${f.itemId} (single choice on the Mitti form — installer chooses on site)`); continue; }
      prior.responses.selected.push(...extra);
      continue;
    }
    list.push({ item_id: e.id, label: e.label, type, responses });
  }
  return { header_items, items: rows, count: header_items.length + rows.length, skipped };
}

/** Known PIISA fields that are prefilled. A known field missing from the native template is a visible failure, never a silent skip. */
export function missingKnownFields(skipped: string[]): string[] {
  return skipped.filter((x) => !/attachment — shown in the portal|single choice on the Mitti form/.test(x));
}

/** A3 template id + mapping now live in piisa-a3.core.ts (observed native aliases, occurrence-aware). */
export const PIISA_A3_TEMPLATE_ID = "template_f6a2597479164eb181453eb335ce5125";
