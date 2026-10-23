import { melbourneToday } from "./melbourne-time.core";
import { FFS_PROGRESS_EVENT } from "./ffs-progress.core";
// Pure Job File rules (no I/O): document index, correspondence, timeline, role visibility, retention, job pack plan.
// Files are INDEXED IN PLACE from existing records/private storage – never copied into folders.

export type Role = "admin" | "owner" | "electrician" | "installer";
export type Audience = Exclude<Role, "admin">;

export const DOC_CATEGORIES = [
  "Property", "Customer / Consent", "Electrical / PIESA", "Ready Check", "Quotes", "Payments", "Installation", "Evidence", "ESC / VEEC", "Correspondence attachments", "Other",
] as const;
export type DocCategory = (typeof DOC_CATEGORIES)[number];
export type DocStatus = "current" | "superseded" | "draft" | "signed" | "verified" | "rejected" | "final" | "historical" | "outstanding";

export type DocItem = {
  id: string; // `${source}:${rowId}` – stable, one per underlying record/file
  title: string; category: DocCategory; alsoIn: DocCategory[]; subcategory: string | null; docType: string; sourceSystem: string;
  at: string | null; actor: string | null; version: string | null; status: DocStatus; immutable: boolean;
  verifiedBy: string | null; verifiedAt: string | null; fileName: string | null; storagePath: string | null; sizeBytes: number | null;
  relatedEntity: string; relatedId: string; sha256: string | null; sourceUrl: string | null;
  audience: Audience[]; internal: boolean; deprecated?: boolean;
};

type Row = Record<string, unknown>;
export type JobSources = {
  documents: Row[]; evidenceFiles: (Row & { requirement?: Row | null })[]; piesaRecords: Row[]; piesaDeliveries: Row[]; measurements: Row[];
  quotes: Row[]; invoices: Row[]; assignments: Row[]; authorities: Row[]; escNotifications: Row[]; veec: Row[]; propertyFacts: Row[]; declarations: Row[];
};

const s = (v: unknown) => (v == null ? null : String(v));
const EXPORT_PREFIX = "/exports/";

const EVIDENCE_CATEGORY: Record<string, [DocCategory, Audience[]]> = {
  measurement: ["Ready Check", ["electrician", "installer"]],
  existing_insulation_r_value: ["Ready Check", ["electrician", "installer"]],
  piesa_signoff: ["Electrical / PIESA", ["electrician", "installer"]],
  rectification_completion: ["Electrical / PIESA", ["electrician"]],
  before_ceiling_space: ["Installation", ["installer"]],
  access_manhole: ["Installation", ["installer"]],
  product_evidence: ["Installation", ["installer"]],
  installation_progress: ["Installation", ["installer"]],
  completed_installation: ["Installation", ["installer"]],
  installer_declaration: ["Installation", ["installer"]],
};

/** Automatic filing for stored documents by kind/title – nobody chooses a folder. */
export function categoriseDocument(kind: string, title: string): { category: DocCategory; alsoIn: DocCategory[]; sub: string | null; audience: Audience[]; status: DocStatus; immutable: boolean; deprecated?: boolean } {
  const k = kind.toLowerCase(), t = title.toLowerCase();
  if (k === "owner_authority") return { category: "Customer / Consent", alsoIn: [], sub: "Legacy Owner Authority (historical – no longer a gate)", audience: ["owner"], status: "historical", immutable: true, deprecated: true };
  if (k === "intake_media") return { category: "Property", alsoIn: [], sub: "Owner photos/videos (website)", audience: [], status: "current", immutable: true };
  if (k === "veec_assignment") {
    const final = t.includes("final") || t.includes("completed");
    return { category: "ESC / VEEC", alsoIn: ["Customer / Consent", "Quotes"], sub: final ? "Completed VEEC assignment" : "Signed customer acceptance", audience: ["owner"], status: final ? "final" : "signed", immutable: true };
  }
  // Sensitive financial/customer kinds are decided by KIND first; a title can never widen who sees them.
  if (/quote|invoice|xero|payment|receipt|customer_agreement|owner_paperwork|esc_consent|installer_import/.test(k)) {
    if (/invoice|xero|payment|receipt/.test(k)) return { category: "Payments", alsoIn: ["Quotes"], sub: null, audience: ["owner"], status: "current", immutable: false };
    if (/quote/.test(k) || (k === "installer_import" && /quote|invoice/.test(t))) return { category: "Quotes", alsoIn: [], sub: null, audience: ["owner"], status: "current", immutable: false };
    return { category: k === "esc_consent" ? "ESC / VEEC" : k === "installer_import" ? "Other" : "Customer / Consent", alsoIn: [], sub: null, audience: k === "installer_import" ? [] : ["owner"], status: "current", immutable: false };
  }
  // Trade audiences come from a known trade KIND (Mitti reports: our own generated title), never from a free title.
  const trusted = k === "mitti_report" ? k + " " + t : k;
  if (/piesa|coes|piisa|electrical/.test(trusted)) return { category: "Electrical / PIESA", alsoIn: /piisa/.test(trusted) ? ["Installation", "ESC / VEEC"] : [], sub: null, audience: ["electrician", "installer", "owner"], status: "current", immutable: false };
  if (/piesa|coes|piisa|electrical/.test(t)) return { category: "Electrical / PIESA", alsoIn: [], sub: null, audience: [], status: "current", immutable: false };
  if (/floor|plan|property|imagery|outline/.test(k + " " + t)) return { category: "Property", alsoIn: [], sub: null, audience: [], status: "current", immutable: false };
  if (/measure|sketch/.test(k)) return { category: "Ready Check", alsoIn: [], sub: null, audience: ["electrician", "installer"], status: "current", immutable: false };
  if (/measure|sketch/.test(t)) return { category: "Ready Check", alsoIn: [], sub: null, audience: [], status: "current", immutable: false };
  if (/quote/.test(t)) return { category: "Quotes", alsoIn: [], sub: null, audience: ["owner"], status: "current", immutable: false };
  if (/invoice|xero|payment|receipt/.test(t)) return { category: "Payments", alsoIn: ["Quotes"], sub: null, audience: ["owner"], status: "current", immutable: false };
  if (/esc|veec/.test(k + " " + t)) return { category: "ESC / VEEC", alsoIn: [], sub: null, audience: [], status: "current", immutable: false };
  if (/declaration/.test(k + " " + t)) return { category: "Installation", alsoIn: ["ESC / VEEC"], sub: null, audience: ["installer"], status: "signed", immutable: true };
  return { category: "Other", alsoIn: [], sub: null, audience: [], status: "current", immutable: false };
}

const base = (o: Partial<DocItem> & Pick<DocItem, "id" | "title" | "category" | "docType" | "sourceSystem" | "relatedEntity" | "relatedId">): DocItem => ({
  alsoIn: [], subcategory: null, at: null, actor: null, version: null, status: "current", immutable: false, verifiedBy: null, verifiedAt: null,
  fileName: null, storagePath: null, sizeBytes: null, sha256: null, sourceUrl: null, audience: [], internal: false, ...o,
});

/** Builds the job's document index from every underlying source. One entry per record; stored files are never duplicated. */
export function buildDocumentIndex(src: JobSources): DocItem[] {
  const out: DocItem[] = [];
  const seenPaths = new Set<string>();
  const addFile = (d: DocItem) => { if (d.storagePath) { if (seenPaths.has(d.storagePath) || d.storagePath.includes(EXPORT_PREFIX)) return; seenPaths.add(d.storagePath); } out.push(d); };

  for (const d of src.documents) {
    const c = categoriseDocument(String(d["kind"] ?? ""), String(d["title"] ?? ""));
    const path = s(d["storage_path"]);
    addFile(base({ id: `documents:${d["id"]}`, title: String(d["title"] ?? "Document"), category: c.category, alsoIn: c.alsoIn, subcategory: c.sub, docType: String(d["kind"] ?? "document"),
      sourceSystem: "portal", at: s(d["created_at"]), actor: s(d["uploaded_by"]), status: c.status, immutable: c.immutable, fileName: path?.split("/").pop() ?? null, storagePath: path,
      relatedEntity: "documents", relatedId: String(d["id"]), audience: c.audience, ...(c.deprecated ? { deprecated: true } : {}), sha256: path?.match(/-([0-9a-f]{12,64})\.txt$/)?.[1] ?? null }));
  }
  for (const f of src.evidenceFiles) {
    const req = f.requirement ?? {};
    const [cat, aud] = EVIDENCE_CATEGORY[String(req["category"] ?? "")] ?? ["Evidence", []];
    const rs = String(req["status"] ?? "uploaded");
    addFile(base({ id: `evidence_files:${f["id"]}`, title: `${req["label"] ?? "Evidence"} – ${f["file_name"] ?? "file"}`, category: cat, alsoIn: cat === "Evidence" ? [] : ["Evidence"], subcategory: s(req["label"]),
      docType: String(req["category"] ?? "evidence"), sourceSystem: "portal upload", at: s(f["uploaded_at"]), actor: s(f["uploaded_by"]),
      status: rs === "verified" ? "verified" : rs === "rejected" ? "rejected" : "current", verifiedBy: s(req["verified_by"]), verifiedAt: s(req["verified_at"]),
      fileName: s(f["file_name"]), storagePath: s(f["storage_path"]), sizeBytes: f["size_bytes"] != null ? Number(f["size_bytes"]) : null, relatedEntity: "evidence_requirements", relatedId: String(f["requirement_id"] ?? f["id"]), audience: aud }));
  }
  for (const p of src.piesaRecords) out.push(base({ id: `piesa_records:${p["id"]}`, title: `PIESA ${p["kind"] ?? ""} record – ${p["outcome"] ?? "pending"} (${p["completed_date"] ?? "no date"})`, category: "Electrical / PIESA",
    docType: "piesa_record", sourceSystem: p["external_mitti_id"] ? "mitti" : "portal", at: s(p["created_at"]), actor: s(p["signed_off_by"]), status: p["is_current"] ? "signed" : "superseded", immutable: true,
    relatedEntity: "piesa_records", relatedId: String(p["id"]), audience: ["electrician", "installer", "owner"] }));
  for (const d of src.piesaDeliveries) out.push(base({ id: `piesa_deliveries:${d["id"]}`, title: `PIESA copy delivered to ${d["recipient"]} (${d["method"] ?? "method n/a"})`, category: "Electrical / PIESA", alsoIn: ["ESC / VEEC"],
    subcategory: "PIESA delivery", docType: "piesa_delivery", sourceSystem: "portal", at: s(d["delivered_at"]), actor: s(d["recorded_by"]), status: "final", immutable: true, relatedEntity: "piesa_deliveries", relatedId: String(d["id"]), audience: [] }));
  for (const m of src.measurements) out.push(base({ id: `ceiling_measurements:${m["id"]}`, title: `Ready Check ${m["measured_area_m2"] ?? "?"} m² (${m["status"]})`, category: "Ready Check", docType: "measurement",
    sourceSystem: String(m["external_source"] ?? "portal"), at: s(m["completed_at"] ?? m["created_at"]), actor: s(m["completed_by"]), status: m["is_current"] ? (m["status"] === "complete" ? "verified" : "current") : "superseded",
    verifiedBy: s(m["reviewed_by"]), verifiedAt: s(m["reviewed_at"]), relatedEntity: "ceiling_measurements", relatedId: String(m["id"]), audience: ["electrician", "installer"] }));
  for (const q of src.quotes) {
    const st = String(q["status"]);
    out.push(base({ id: `quotes:${q["id"]}`, title: `${q["kind"] === "rectification" ? "Electrical fixes" : "Installation"} quote ${q["option_label"] ?? ""} v${q["version"]}`, category: "Quotes", docType: "quote",
      sourceSystem: "portal", at: s(q["accepted_at"] ?? q["created_at"]), actor: s(q["created_by"]), version: s(q["version"]),
      status: st === "accepted" ? "signed" : st === "superseded" || st === "declined" ? "superseded" : st === "draft" ? "draft" : "current", immutable: st === "accepted",
      relatedEntity: "quotes", relatedId: String(q["id"]), audience: st === "draft" ? [] : ["owner"] }));
  }
  for (const i of src.invoices) out.push(base({ id: `invoices:${i["id"]}`, title: `Xero invoice ${i["xero_invoice_number"] ?? "(not yet created)"} · ${i["xero_reference"] ?? ""}`.trim(), category: "Payments", alsoIn: ["Quotes"],
    docType: "invoice_reference", sourceSystem: "xero", at: s(i["created_at"]), status: "current", sourceUrl: s(i["xero_online_url"]), relatedEntity: "invoices", relatedId: String(i["id"]), audience: ["owner"] }));
  for (const a of src.assignments) {
    const signed = !!a["consumer_signed_at"];
    if (signed && !(a["consumer_copy_path"] && seenPaths.has(String(a["consumer_copy_path"]))))
      addFile(base({ id: `customer_assignments:${a["id"]}:consumer`, title: "Final Activity 48 VEEC Assignment (signed)", category: "ESC / VEEC", alsoIn: ["Customer / Consent", "Quotes"], docType: "veec_assignment",
        sourceSystem: "portal e-sign", at: s(a["consumer_signed_at"]), actor: s(a["consumer_signed_by"]), version: s(a["consumer_declaration_version"]), status: "signed", immutable: true,
        storagePath: s(a["consumer_copy_path"]), fileName: s(a["consumer_copy_path"])?.split("/").pop() ?? null, sha256: s(a["consumer_snapshot_sha256"]), relatedEntity: "customer_assignments", relatedId: String(a["id"]), audience: ["owner"] }));
    if (a["installer_signed_at"]) out.push(base({ id: `customer_assignments:${a["id"]}:installer`, title: `Installer declaration ${a["installer_declaration_version"] ?? ""}`.trim(), category: "Installation", alsoIn: ["ESC / VEEC"],
      docType: "installer_declaration", sourceSystem: "portal e-sign", at: s(a["installer_signed_at"]), actor: s(a["installer_user_id"]), version: s(a["installer_declaration_version"]), status: "signed", immutable: true,
      sha256: s(a["installer_snapshot_sha256"]), relatedEntity: "customer_assignments", relatedId: String(a["id"]), audience: ["installer"] }));
    if (a["final_copy_path"] && !seenPaths.has(String(a["final_copy_path"])))
      addFile(base({ id: `customer_assignments:${a["id"]}:final`, title: "Completed VEEC Assignment (final copy)", category: "ESC / VEEC", alsoIn: ["Customer / Consent"], docType: "veec_assignment_final", sourceSystem: "portal e-sign",
        at: s(a["final_copy_at"] ?? a["effective_at"]), status: "final", immutable: true, storagePath: s(a["final_copy_path"]), fileName: s(a["final_copy_path"])?.split("/").pop() ?? null,
        relatedEntity: "customer_assignments", relatedId: String(a["id"]), audience: ["owner"] }));
  }
  for (const o of src.authorities) {
    if (o["document_path"] && seenPaths.has(String(o["document_path"]))) continue;
    out.push(base({ id: `owner_authorities:${o["id"]}`, title: `Legacy Owner Authority v${o["version"]} (${o["status"]})`, category: "Customer / Consent", subcategory: "Legacy Owner Authority (historical – no longer a gate)",
      docType: "owner_authority", sourceSystem: "portal (deprecated)", at: s(o["accepted_at"] ?? o["requested_at"]), version: s(o["wording_version"]), status: "historical", immutable: true, deprecated: true,
      storagePath: s(o["document_path"]), sha256: s(o["document_sha256"]), relatedEntity: "owner_authorities", relatedId: String(o["id"]), audience: ["owner"] }));
  }
  for (const n of src.escNotifications) {
    const st = String(n["status"]);
    out.push(base({ id: `esc_notifications:${n["id"]}`, title: `ESC notification v${n["version"]} – ${st}${n["submission_reference"] ? ` (ref ${n["submission_reference"]})` : ""}`, category: "ESC / VEEC", docType: "esc_notification",
      sourceSystem: String(n["submission_method"] ?? "portal"), at: s(n["sent_at"] ?? n["created_at"]), actor: s(n["submitted_by"]), version: s(n["payload_version"]),
      status: st === "sent" ? "final" : st === "stale" || st === "cancelled" ? "superseded" : "draft", immutable: st === "sent", sha256: s(n["payload_hash"]), relatedEntity: "esc_notifications", relatedId: String(n["id"]), audience: [] }));
  }
  for (const v of src.veec) out.push(base({ id: `veec_lodgements:${v["id"]}`, title: `VEEC lodgement – ${v["status"] ?? "not started"}${v["submission_reference"] ? ` (ref ${v["submission_reference"]})` : ""}`, category: "ESC / VEEC",
    docType: "veec_lodgement", sourceSystem: "portal", at: s(v["updated_at"]), status: v["status"] === "submitted" || v["status"] === "approved" ? "final" : "current", relatedEntity: "veec_lodgements", relatedId: String(v["id"]), audience: [] }));
  for (const f of src.propertyFacts) {
    if (!f["source_url"]) continue;
    out.push(base({ id: `property_facts:${f["id"]}`, title: `${String(f["fact_key"]).replace(/_/g, " ")} – ${f["source_name"] ?? "source"}`, category: "Property", subcategory: String(f["evidence_kind"] ?? "") || null, docType: "property_evidence",
      sourceSystem: String(f["source_type"] ?? "public"), at: s(f["retrieved_at"]), status: f["is_current"] && !f["is_stale"] ? "current" : "superseded", sha256: s(f["raw_hash"]), sourceUrl: s(f["source_url"]),
      relatedEntity: "property_facts", relatedId: String(f["id"]), audience: [] }));
  }
  for (const d of src.declarations) out.push(base({ id: `declarations:${d["id"]}`, title: `${String(d["kind"]).replace(/_/g, " ")} declaration`, category: d["kind"] === "installer_declaration" ? "Installation" : "Other",
    alsoIn: d["kind"] === "installer_declaration" ? ["ESC / VEEC"] : [], docType: String(d["kind"]), sourceSystem: "portal", at: s(d["declared_at"]), actor: s(d["declared_by"]), status: "signed", immutable: true,
    relatedEntity: "declarations", relatedId: String(d["id"]), audience: d["kind"] === "installer_declaration" ? ["installer"] : [] }));
  return out.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}

/** Server-enforced visibility. Admin sees everything; others only what their role needs, never internal items. */
export function visibleTo<T extends { audience: Audience[]; internal: boolean }>(items: T[], role: Role): T[] {
  if (role === "admin") return items;
  return items.filter((i) => !i.internal && i.audience.includes(role));
}

export function inCategory(items: DocItem[], cat: DocCategory) { return items.filter((i) => i.category === cat || i.alsoIn.includes(cat)); }

export function searchItems<T>(items: T[], q: string, fields: (i: T) => (string | null | undefined)[]) {
  const t = q.trim().toLowerCase();
  if (!t) return items;
  return items.filter((i) => fields(i).some((f) => f?.toLowerCase().includes(t)));
}

// ---------- Correspondence ----------
export type CorrespondenceAttachment = { name: string; path: string | null; url?: string | null; skipped?: string | null; contentType?: string | null; isInline?: boolean };
export type Correspondence = { id: string; at: string; direction: "inbound" | "outbound" | "internal"; channel: string; from: string | null; subject: string | null; body: string; status: string; source: "portal_message" | "job_communication"; audience: Audience[]; internal: boolean; provider?: string | null; to?: string[]; attachments?: string[]; attachmentFiles?: CorrespondenceAttachment[] };

export function buildCorrespondence(messages: Row[], comms: Row[], senderRole: (userId: string | null) => Role | null): Correspondence[] {
  const out: Correspondence[] = [];
  for (const m of messages) {
    const internal = m["internal"] === true;
    const r = senderRole(s(m["sender_id"]));
    out.push({ id: `messages:${m["id"]}`, at: String(m["created_at"]), direction: internal ? "internal" : r === "admin" ? "outbound" : "inbound", channel: String(m["channel"] ?? "portal"), from: s(m["sender_id"]),
      subject: null, body: String(m["body"] ?? ""), status: "recorded", source: "portal_message", internal, audience: internal ? [] : ["owner", "electrician", "installer"] });
  }
  for (const c of comms) {
    const vis = String(c["visibility"]);
    out.push({ id: `job_communications:${c["id"]}`, at: String(c["sent_at"] ?? c["received_at"] ?? c["created_at"]), direction: c["direction"] as Correspondence["direction"], channel: String(c["channel"]),
      from: s(c["sender_text"]) ?? s(c["sender_user_id"]), subject: s(c["subject"]), body: String(c["body"] ?? ""), status: String(c["delivery_status"]), source: "job_communication",
      internal: vis === "internal", audience: vis === "customer" ? ["owner"] : vis === "trade" ? ["electrician", "installer"] : [],
      provider: s(c["provider"]), to: Array.isArray(c["recipients"]) ? (c["recipients"] as unknown[]).map(String) : [],
      attachments: Array.isArray(c["attachment_refs"]) ? (c["attachment_refs"] as { name?: unknown }[]).map((a) => String(a?.name ?? "attachment")) : [],
      attachmentFiles: Array.isArray(c["attachment_refs"])
        ? (c["attachment_refs"] as { name?: unknown; path?: unknown; skipped?: unknown; contentType?: string; isInline?: boolean }[]).map((a) => ({ name: String(a?.name ?? "attachment"), path: typeof a?.path === "string" && a.path ? a.path : null, skipped: typeof a?.skipped === "string" && a.skipped ? a.skipped : null, ...(a.contentType ? {contentType:a.contentType} : {}), ...(a.isInline !== undefined ? {isInline:a.isInline} : {}) }))
        : [] });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

// ---------- Timeline ----------
export type TimelineFilter = "all" | "customer" | "trades" | "money" | "compliance" | "documents" | "internal";
export type TimelineItem = { id: string; at: string; actor: string | null; source: string; summary: string; detail: unknown; tags: Exclude<TimelineFilter, "all">[]; audience: Audience[]; internal: boolean; actorRole?: string | null };

export function tagEvent(type: string): Exclude<TimelineFilter, "all" | "internal">[] {
  const t = type.toLowerCase(); const tags: Exclude<TimelineFilter, "all" | "internal">[] = [];
  if (/quote|invoice|deposit|payment|xero|override/.test(t)) tags.push("money");
  if (/eligib|piesa|assessment|compliance|assignment|authority|esc|veec|declaration|ap_|consent|variation/.test(t)) tags.push("compliance");
  if (/evidence|document|upload|copy|intelligence/.test(t)) tags.push("documents");
  if (/owner|customer|consumer|quote_accept|message/.test(t)) tags.push("customer");
  if (/electrician|installer|assign|booking|measure|install|rectification|electrical fixes|ready check/i.test(t)) tags.push("trades");
  return tags;
}

const KIND_LABEL: Record<string, string> = { assessment: "PIESA", rectification: "rectification", installation: "installation", ready_check: "Ready Check" };
const when = (iso: unknown) => (iso ? new Date(String(iso)).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" }) : "");
const partyName = (r: unknown) => (r === "owner" ? "Owner" : r === "electrician" ? "Electrician" : r === "installer" ? "Installer" : r === "admin" ? "Home Insulation Victoria" : "Trade");

export function buildTimeline(p: { events: Row[]; correspondence: Correspondence[]; bookings: Row[]; evidence: DocItem[]; proposals?: Row[] }): TimelineItem[] {
  const out: TimelineItem[] = [];
  for (const a of p.proposals ?? []) {
    const k = KIND_LABEL[String(a["kind"])] ?? String(a["kind"]);
    const aud: Audience[] = a["kind"] === "installation" ? ["owner", "installer"] : ["owner", "electrician"];
    out.push({ id: `proposal:${a["id"]}`, at: String(a["created_at"]), actor: s(a["proposed_by"]), actorRole: partyName(a["proposer_role"]), source: "booking",
      summary: `Proposed ${k} date: ${when(a["starts_at"])}`, detail: a["note"] ? { note: a["note"] } : null, tags: ["trades", "customer"], internal: false, audience: aud });
    if (a["responded_at"]) {
      const st = String(a["status"]);
      const verb = st === "accepted" ? "Accepted" : st === "declined" ? "Declined" : st === "superseded" ? "Superseded" : st === "cancelled" ? "Cancelled" : `Replied (${st})`;
      out.push({ id: `proposal-reply:${a["id"]}`, at: String(a["responded_at"]), actor: s(a["responded_by"]), actorRole: null, source: "booking",
        summary: `${verb} ${k} date ${when(a["starts_at"])}${st === "accepted" ? " – locked in" : ""}`, detail: a["response_note"] ? { note: a["response_note"] } : null, tags: ["trades", "customer"], internal: false, audience: aud });
    }
  }
  for (const e of p.events) {
    // P1-FA02 (owner decision, 14 Oct 2026; restored after the bdf1da3c reconcile silently dropped it):
    // FFS is not a user-facing role. Its field-progress events are excluded here, at the single
    // presentation boundary where workflow_events become timeline items — so they leave the Office
    // timeline, the field/owner/electrician/installer History timelines AND the job-pack export
    // (timeline.json/csv) together, with or without "Include internal items". The dormant write path
    // in src/lib/ffs-progress.* and the stored rows are untouched: this hides, never deletes, and it
    // filters no other event type (internal or otherwise).
    if (e["event_type"] === FFS_PROGRESS_EVENT) continue;
    const internal = e["internal"] === true;
    out.push({ id: `workflow_events:${e["id"]}`, at: String(e["created_at"]), actor: s(e["actor_id"]), source: "workflow", summary: String(e["summary"] ?? e["event_type"]),
      detail: { event_type: e["event_type"], from: e["from_stage"], to: e["to_stage"], ...(e["details"] as object ?? {}) }, tags: [...tagEvent(String(e["event_type"])), ...(internal ? ["internal" as const] : [])],
      internal, audience: internal ? [] : ["owner", "electrician", "installer"] });
  }
  for (const c of p.correspondence) out.push({ id: c.id, at: c.at, actor: c.from, source: c.source === "portal_message" ? "message" : `communication (${c.channel})`, summary: c.subject ?? c.body.slice(0, 140), detail: { body: c.body, status: c.status },
    tags: [c.internal ? "internal" : c.audience.includes("owner") && c.audience.length === 1 ? "customer" : "trades"], internal: c.internal, audience: c.audience });
  for (const b of p.bookings) out.push({ id: `bookings:${b["id"]}`, at: String(b["created_at"]), actor: s(b["booked_by"]), source: "booking", summary: `${b["kind"]} booking ${b["status"]} for ${b["scheduled_start"]}`,
    detail: b, tags: ["trades", "customer"], internal: false, audience: b["kind"] === "assessment" || b["kind"] === "rectification" ? ["owner", "electrician"] : ["owner", "installer"] });
  for (const d of p.evidence) if (d.relatedEntity === "evidence_requirements") {
    out.push({ id: `upload:${d.id}`, at: d.at ?? "", actor: d.actor, source: "evidence", summary: `Uploaded ${d.title}`, detail: { file: d.fileName }, tags: ["documents"], internal: false, audience: d.audience });
    if (d.verifiedAt) out.push({ id: `verify:${d.id}`, at: d.verifiedAt, actor: d.verifiedBy, source: "evidence", summary: `${d.status === "rejected" ? "Rejected" : "Verified"} ${d.subcategory ?? d.title}`, detail: null, tags: ["documents", "compliance"], internal: false, audience: d.audience });
  }
  return out.filter((i) => i.at).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

export function filterTimeline(items: TimelineItem[], f: TimelineFilter) { return f === "all" ? items : items.filter((i) => i.tags.includes(f)); }

// ---------- Retention ----------
export const RETENTION_MIN_YEARS = 6;
export function retentionFor(p: { assignmentRetainUntil: string | null; jobCreatedAt: string; completedAt: string | null }) {
  const from = new Date(p.completedAt ?? p.jobCreatedAt);
  const d = new Date(from); d.setFullYear(d.getFullYear() + RETENTION_MIN_YEARS + 1); // 6-year minimum + 1-year margin (matches assignment retainUntil)
  const computed = melbourneToday(d);
  const until = p.assignmentRetainUntil && p.assignmentRetainUntil > computed ? p.assignmentRetainUntil : computed;
  return { retainUntil: until, rule: `Minimum ${RETENTION_MIN_YEARS} years + 1-year margin; signed/terminal records are never deleted or overwritten – superseded versions are kept.` };
}

// ---------- Job pack ----------
export const PACK_ZIP_LIMIT_BYTES = 150 * 1024 * 1024;
export const PACK_DEFAULT_FILE_BYTES = 256 * 1024; // estimate for small text/PDF records without a stored size

export function packSelection(items: DocItem[], o: { includeSuperseded?: boolean; includeInternal?: boolean } = {}) {
  return items.filter((i) => (o.includeInternal || !i.internal) && (o.includeSuperseded || !["superseded", "historical", "draft", "rejected"].includes(i.status)));
}

const slug = (c: string) => c.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** Folder + unique file name inside the ZIP; original file name preserved (suffix only on collision). */
export function packPaths(items: DocItem[]): Map<string, string> {
  const used = new Set<string>(); const out = new Map<string, string>();
  for (const i of items) {
    if (!i.storagePath) continue;
    const name = (i.fileName ?? i.storagePath.split("/").pop() ?? "file").replace(/[\\/:*?"<>|]/g, "_");
    let p = `${slug(i.category)}/${name}`, n = 1;
    while (used.has(p)) { const dot = name.lastIndexOf("."); p = `${slug(i.category)}/${dot > 0 ? `${name.slice(0, dot)} (${++n})${name.slice(dot)}` : `${name} (${++n})`}`; }
    used.add(p); out.set(i.id, p);
  }
  return out;
}

export function planPack(items: DocItem[], limit = PACK_ZIP_LIMIT_BYTES) {
  const files = items.filter((i) => i.storagePath);
  const total = files.reduce((t, i) => t + (i.sizeBytes ?? PACK_DEFAULT_FILE_BYTES), 0);
  return { mode: total > limit ? ("manifest_with_links" as const) : ("zip" as const), totalBytes: total, fileCount: files.length };
}

export type ManifestEntry = { id: string; title: string; category: string; also_in: string[]; doc_type: string; source_system: string; status: string; immutable: boolean; version: string | null;
  at: string | null; actor: string | null; verified_by: string | null; verified_at: string | null; original_file_name: string | null; pack_path: string | null; storage_ref: string | null;
  size_bytes: number | null; sha256: string | null; source_url: string | null; related_entity: string; related_id: string };

export function buildManifest(items: DocItem[], paths: Map<string, string>): ManifestEntry[] {
  return items.map((i) => ({ id: i.id, title: i.title, category: i.category, also_in: i.alsoIn, doc_type: i.docType, source_system: i.sourceSystem, status: i.status, immutable: i.immutable, version: i.version,
    at: i.at, actor: i.actor, verified_by: i.verifiedBy, verified_at: i.verifiedAt, original_file_name: i.fileName, pack_path: paths.get(i.id) ?? null,
    storage_ref: i.storagePath ? `job-files:${i.storagePath}` : null, size_bytes: i.sizeBytes, sha256: i.sha256, source_url: i.sourceUrl, related_entity: i.relatedEntity, related_id: i.relatedId }));
}

const csvCell = (v: unknown) => { const t = v == null ? "" : Array.isArray(v) ? v.join("; ") : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]!);
  return [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n");
}
const esc = (t: unknown) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
export function manifestHtml(title: string, header: Record<string, unknown>, m: ManifestEntry[]): string {
  const rows = m.map((e) => `<tr><td>${esc(e.category)}</td><td>${esc(e.title)}</td><td>${esc(e.status)}${e.immutable ? " (immutable)" : ""}</td><td>${esc(e.version)}</td><td>${esc(e.source_system)}</td><td>${esc(e.at)}</td><td>${esc(e.pack_path ?? (e.storage_ref ? "see links" : "record only"))}</td><td style="font-family:monospace">${esc(e.sha256)}</td></tr>`).join("");
  return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:sans-serif;font-size:13px}td,th{border:1px solid #ccc;padding:4px;text-align:left}table{border-collapse:collapse}</style><h1>${esc(title)}</h1><dl>${Object.entries(header).map(([k, v]) => `<dt><b>${esc(k)}</b></dt><dd>${esc(v)}</dd>`).join("")}</dl><table><tr><th>Category</th><th>Title</th><th>Status</th><th>Version</th><th>Source</th><th>Date</th><th>File</th><th>SHA-256</th></tr>${rows}</table>`;
}

/** The ONE decision the private-file signer uses: the indexed file this role may open, or null (deny). */
export function authorizedStoredDoc(src: JobSources, role: Role, docId: string): DocItem | null {
  const doc = visibleTo(buildDocumentIndex(src), role).find((d) => d.id === docId);
  return doc?.storagePath ? doc : null;
}
