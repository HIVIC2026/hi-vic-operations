// PURE Mitti logic: label-based template prefill, audit parsing, create/reuse orchestration.
// No network, no database. The only network boundary is mitti.server.ts (injected here as MittiCall).
// Mitti sync NEVER completes an assessment, writes PIESA records, moves stages or issues quotes —
// completeAssessment remains the authoritative gate.

export const MITTI_BASE_URL = "https://api.mitti.com";
export const MITTI_TEMPLATE_ID = "template_fd20c6437f4e4db2b49b2d6dbe0d3f91";
/** Electrical rate codes Lovable can price. Everything else from Mitti is manual office review. */
export const STANDARD_RATE_CODES = ["CALLOUT", "DOWNLIGHT_UPGRADE", "EXHAUST_CLEARANCE", "RCD_INSTALL", "SWITCHBOARD_UPGRADE"] as const;
export const MITTI_ASSIGN_STAGES = ["assessment_booking", "assessment_booked"] as const;

export class MittiError extends Error {}

export type MittiCall = (method: "GET" | "POST", path: string, body?: unknown) => Promise<unknown>;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export function mittiApi(call: MittiCall) {
  return {
    /** Full template definition (SafetyCulture v1 route) – used only to validate form structure. */
    getTemplateDefinition: (id: string) => call("GET", `/templates/v1/templates/${encodeURIComponent(id)}`) as Promise<Any>,
    getTemplate: (id: string) => call("GET", `/templates/${encodeURIComponent(id)}`) as Promise<Any>,
    searchUsers: (email: string) => call("POST", "/users/search", { email: [email] }) as Promise<Any>,
    createAudit: (body: { template_id: string; header_items?: unknown[]; items?: unknown[] }) => call("POST", "/audits", body) as Promise<Any>,
    shareAudit: (auditId: string, userId: string) =>
      call("POST", `/audits/${encodeURIComponent(auditId)}/share`, { shares: [{ id: userId, permission: "edit" }] }),
    getAudit: (auditId: string) => call("GET", `/audits/${encodeURIComponent(auditId)}`) as Promise<Any>,
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

/** Flatten header_items + nested items; section = normalized labels of all ancestors. */
export function flatten(doc: Any): Entry[] {
  const raw: { it: Any; header: boolean }[] = [
    ...((doc?.header_items ?? []) as Any[]).map((it) => ({ it, header: true })),
    ...((doc?.items ?? []) as Any[]).map((it) => ({ it, header: false })),
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
    return { id: String(it.item_id ?? it.id ?? ""), label: String(it.label ?? ""), norm: norm(it.label), type: String(it.type ?? ""), value: responseValue(it), parent: parent ? String(parent) : null, section: chain.join(" / "), header };
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
  assessorName: string; assessmentAt?: string | null; estimatedAreaM2?: number | null; occupancy?: string | null; lifeSupport?: string | null;
};
const PREFILL: { key: keyof PrefillCtx; aliases: string[]; mandatory?: boolean; datetime?: boolean }[] = [
  { key: "jobNumber", aliases: ["Portal Job Number"], mandatory: true },
  { key: "address", aliases: ["Property Address", "Site address", "Site Address"], mandatory: true },
  { key: "ownerName", aliases: ["Owner name", "Owner full name", "Client name", "Property owner name"], mandatory: true },
  { key: "ownerEmail", aliases: ["Owner email"] },
  { key: "ownerPhone", aliases: ["Owner phone", "Owner mobile"] },
  { key: "assessorName", aliases: ["Assigned Electrician", "Assessor", "Assigned Electrician / Assessor", "Full Name (initial assessment)", "Lead installer name"], mandatory: true },
  { key: "assessmentAt", aliases: ["Assessment date/time", "Assessment date time", "Booked assessment date"], datetime: true },
  { key: "estimatedAreaM2", aliases: ["Office estimated ceiling area", "Estimated ceiling area"] },
  { key: "occupancy", aliases: ["Occupancy"] },
  { key: "lifeSupport", aliases: ["Life support status", "Office life support status"] },
];

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
    const row = { item_id: e.id, label: e.label, type: e.type, responses: f.datetime ? { datetime: String(v) } : { text: String(v) } };
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

function pickUser(res: Any, email: string): Any | null {
  const list: Any[] = Array.isArray(res) ? res : res?.users ?? res?.data ?? [];
  return list.find((u) => String(u?.email ?? "").toLowerCase() === email.toLowerCase()) ?? null;
}

export async function createOrReuseAudit(api: MittiApi, ctx: CreateCtx): Promise<CreateResult> {
  if (ctx.businessUnit !== "hivic") throw new MittiError("Mitti automation is only available for Home Insulation Victoria jobs.");
  if (!(MITTI_ASSIGN_STAGES as readonly string[]).includes(ctx.stage)) throw new MittiError("Mitti assessments can only be created while the job is in Assessment Booking or Assessment Booked.");
  const who = ctx.assigneeRole ?? "electrician";
  const templateId = ctx.templateId ?? MITTI_TEMPLATE_ID;
  if (!templateId.trim()) throw new MittiError("The Mitti template for this scope is not configured.");
  const email = ctx.electricianEmail?.trim();
  if (!email) throw new MittiError(`Assign an ${who} with an email address before creating the Mitti assessment.`);
  const user = pickUser(await api.searchUsers(email), email);
  const userId = user?.id ?? user?.user_id;
  if (!userId) throw new MittiError(`The assigned ${who} (${email}) was not found in Mitti. Invite them to Mitti with that exact email, then retry.`);

  if (ctx.existingAuditId) {
    await api.shareAudit(ctx.existingAuditId, String(userId));
    return { auditId: ctx.existingAuditId, reused: true, mittiUserId: String(userId), assigneeEmail: email, prefillCount: null, createdAt: null };
  }
  const blankRequired = (["jobNumber", "address", "ownerName", "assessorName"] as const).filter((k) => String(ctx.prefill[k] ?? "").trim() === "");
  if (blankRequired.length) throw new MittiError(`Required office details are blank: ${blankRequired.join(", ")}. Fill them in before creating the Mitti assessment.`);
  const template = await api.getTemplate(templateId);
  const tid = template?.template_id ?? template?.id;
  if (tid && tid !== templateId) throw new MittiError("Mitti returned an unexpected template.");
  const p = buildPrefill(template, ctx.prefill);
  if (p.ambiguous.length) throw new MittiError(`The Mitti template has ambiguous office fields (more than one match): ${p.ambiguous.join(", ")}.`);
  if (p.missing.length) throw new MittiError(`The Mitti template is missing required office fields: ${p.missing.join(", ")}.`);
  if (p.blank.length) throw new MittiError(`Required office details are blank: ${p.blank.join(", ")}.`);
  const audit = await api.createAudit({ template_id: templateId, header_items: p.header_items, items: p.items });
  const auditId = audit?.audit_id ?? audit?.id;
  if (!auditId) throw new MittiError("Mitti did not return an audit ID.");
  await api.shareAudit(String(auditId), String(userId));
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
  // Group per-room fields by their repeat-instance parent so each room's m2/removal/insulation stay together.
  const roomParents = new Set(entries.filter((e) => !e.header && e.norm === norm("Measured area m2") && e.value != null).map((e) => e.parent ?? e.id));
  const rooms = [...roomParents].map((p) => {
    const kids = entries.filter((e) => (e.parent ?? e.id) === p);
    const m2e = kids.find((e) => e.norm === norm("Measured area m2"));
    const m2 = physical(m2e?.value ?? null, m2e?.label ?? "Measured area m2");
    if (m2.issue) issues.push(m2.issue);
    const state = norm(val(kids, ["Existing insulation"]));
    const action = norm(val(kids, ["What happens to the existing insulation"]));
    const removal = /must be removed/.test(action) ? true : /can be topped up/.test(action) ? false : yesNo(val(kids, ["Removal required"]));
    if (/not sure/.test(action)) issues.push("A room's existing insulation is marked 'Not sure – needs office review'.");
    const removalType = val(kids, ["Existing insulation type", "Insulation type to remove"]);
    return { m2: m2.value, state, removal, removalType };
  });
  if (rooms.length > 0) {
    if (rooms.some((r) => r.m2 == null || r.m2 <= 0)) issues.push("A room's measured area was missing or invalid – whole-house area not taken from Mitti; office review required.");
    else patch.measured_area_m2 = r2(rooms.reduce((s, r) => s + (r.m2 ?? 0), 0));
    if (rooms.some((r) => r.state)) patch.insulation_present = rooms.some((r) => /under-insulated/.test(r.state));
    if (rooms.some((r) => r.removal != null)) {
      patch.removal_required = rooms.some((r) => r.removal === true);
      if (patch.removal_required) {
        const remRooms = rooms.filter((r) => r.removal === true);
        if (remRooms.some((r) => r.m2 == null || r.m2 <= 0)) issues.push("A removal room's area was missing or invalid – removal area not taken from Mitti; office review required.");
        else patch.removal_m2 = r2(remRooms.reduce((s, r) => s + (r.m2 ?? 0), 0));
        const types = [...new Set(remRooms.map((r) => r.removalType).filter(Boolean))] as string[];
        if (types.length > 0) patch.notes = [patch.notes, `Insulation type to remove: ${types.join(", ")}`].filter(Boolean).join(". ").slice(0, 4000);
        else issues.push("Insulation type to remove not captured – needed for removal pricing; office follow-up required.");
      }
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
  const rv = note(physical(val(entries, ["Existing R-value", "Measured R-value", "Confirmed R-value", "Existing insulation R-value"]), "Existing R-value"));
  if (rv != null && patch.insulation_present !== false) patch.existing_r_value = rv;
  const method = val(entries, ["How the ceiling was measured", "Measurement method"]);
  if (method) patch.notes = [patch.notes, `Measured by: ${method}`].filter(Boolean).join(". ").slice(0, 4000);
  else if (rooms.length > 0) issues.push("Measurement method not captured – how the ceiling was measured must be documented.");

  const acc = norm(val(entries, ["Ceiling access", "Access difficulty", "Roof space access"]));
  if (acc) { const a = /difficult|hard|restricted/.test(acc) ? "difficult" : /moderate|medium/.test(acc) ? "moderate" : /easy|good/.test(acc) ? "easy" : null; if (a) patch.access_difficulty = a; else issues.push("Ceiling access answer not recognised."); }

  const setInt = (k: keyof AssessmentPatch, aliases: string[]) => { const e = find(entries, aliases, { withValue: true }); const n = note(count(e?.value ?? null, e?.label ?? aliases[0]!)); if (n != null) (patch as Any)[k] = n; };
  setInt("downlights_upgrade_qty", ["Downlights requiring upgrade", "Downlights to upgrade", "Downlight upgrade qty"]);
  setInt("downlights_qty", ["Total number of luminaires", "Number of downlights", "Downlights qty", "Downlight count", "Downlights"]);
  setInt("exhaust_fans_clearance_qty", ["Exhaust fans requiring clearance", "Exhaust fan clearance", "Exhaust fans needing clearance"]);
  setInt("exhaust_fans_qty", ["Number of exhaust fans", "Exhaust fans qty", "Exhaust fans"]);
  const dt = val(entries, ["Downlight type"]); if (dt) patch.downlights_type = dt.slice(0, 200);
  const hz = val(entries, ["Hazards identified", "Hazards", "Hazards seen in the ceiling space"]); if (hz) patch.hazards = hz.slice(0, 4000);
  const roof = val(entries, ["Roof type"]); if (roof) patch.notes = [patch.notes, `Roof type: ${roof}`].filter(Boolean).join(". ").slice(0, 4000);
  const built5 = val(entries, ["Ceiling or roof built in the last 5 years", "Relevant ceiling or roof built in the last 5 years"]); if (built5) patch.notes = [patch.notes, `Ceiling/roof built in last 5 years (installer observed): ${built5}`].filter(Boolean).join(". ").slice(0, 4000);

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
  const po = norm(val(entries, ["B1 Assessment outcome", "PIESA outcome", "PIESA result", "Rectification outcome", "Rectification required"]));
  // Official B1 wording: "...is not required..." / "...is required..." / "...is not possible...".
  if (/no rectification required|rectification work is not required/.test(po)) issues.push("Mitti reports no rectification required (preliminary B1 only) – PIESA clearance stays pending until confirmed in the portal.");
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

  const readyFlag = yesNo(val(entries, ["Ready for office review"]));
  const completed = !!(audit?.completed || audit?.audit_data?.date_completed || audit?.completed_at || readyFlag);
  return {
    auditId, patch, issues, others, completed,
    templateId: String(audit?.template_id ?? audit?.audit_data?.template_id ?? ""),
    jobNumber: val(entries, ["Portal Job Number"]),
    modifiedAt: audit?.modified_at ?? audit?.audit_data?.date_modified ?? null,
    snapshot: entries.filter((e) => e.label).map((e) => ({ id: e.id, label: e.label, section: e.section, value: e.value })),
  };
}

/** Validate a fetched audit belongs to this job, then plan a safe (non-completing) sync. */
export function planSync(audit: Any, ctx: { storedAuditId: string; jobNumber: string; assessmentStatus: string | null; templateId?: string }) {
  if (ctx.assessmentStatus === "complete") return { locked: true as const };
  const p = parseAudit(audit);
  if (p.auditId && p.auditId !== ctx.storedAuditId) throw new MittiError("Mitti returned a different audit than the one stored for this job.");
  if (p.templateId !== (ctx.templateId ?? MITTI_TEMPLATE_ID)) throw new MittiError("This Mitti audit does not use the expected Home Insulation Victoria assessment template.");
  if (!p.jobNumber || p.jobNumber.trim().toUpperCase() !== ctx.jobNumber.trim().toUpperCase())
    throw new MittiError(`Mitti Portal Job Number (${p.jobNumber ?? "missing"}) does not match ${ctx.jobNumber}.`);
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
