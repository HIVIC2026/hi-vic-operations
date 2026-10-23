// Job File loader/aggregator + job pack export. Reads existing records in place with the service role;
// callers MUST have passed requireJobRole first, and every result is filtered by role here (not in the UI).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { Zip, ZipPassThrough, strToU8 } from "fflate";
import {
  buildCorrespondence, buildDocumentIndex, buildManifest, buildTimeline, manifestHtml, packPaths, packSelection, planPack, retentionFor, toCsv, visibleTo,
  type JobSources, type Role,
} from "./jobfile.core";
import { logEvent } from "./workflow.server";
import { signFile } from "./file-links.server";

const BUCKET = "job-files";

export async function loadSources(jobId: string): Promise<JobSources & { events: Record<string, unknown>[]; messages: Record<string, unknown>[]; comms: Record<string, unknown>[]; bookings: Record<string, unknown>[]; proposals: Record<string, unknown>[] }> {
  const q = <T,>(p: PromiseLike<{ data: T[] | null }>) => Promise.resolve(p).then((r) => (r.data ?? []) as never as Record<string, unknown>[]);
  const [documents, ev, reqs, piesaRecords, piesaDeliveries, measurements, quotes, invoices, assignments, authorities, escNotifications, veec, propertyFacts, declarations, events, messages, comms, bookings, proposals] = await Promise.all([
    q(admin.from("documents").select("*").eq("job_id", jobId)),
    q(admin.from("evidence_files").select("*").eq("job_id", jobId)),
    q(admin.from("evidence_requirements").select("*").eq("job_id", jobId)),
    q(admin.from("piesa_records").select("*").eq("job_id", jobId)),
    q(admin.from("piesa_deliveries").select("*").eq("job_id", jobId)),
    q(admin.from("ceiling_measurements").select("id, status, is_current, external_source, measured_area_m2, completed_by, completed_at, reviewed_by, reviewed_at, created_at").eq("job_id", jobId)),
    q(admin.from("quotes").select("id, kind, option_label, status, version, created_by, created_at, accepted_at").eq("job_id", jobId)),
    q(admin.from("invoices").select("id, xero_invoice_number, xero_reference, xero_online_url, created_at, status").eq("job_id", jobId)),
    q(admin.from("customer_assignments").select("id, status, consumer_signed_at, consumer_signed_by, consumer_declaration_version, consumer_snapshot_sha256, consumer_copy_path, installer_signed_at, installer_user_id, installer_declaration_version, installer_snapshot_sha256, final_copy_path, final_copy_at, effective_at, retain_until").eq("job_id", jobId)),
    q(admin.from("owner_authorities").select("id, version, status, wording_version, requested_at, accepted_at, document_path, document_sha256").eq("job_id", jobId)),
    q(admin.from("esc_notifications").select("id, version, status, submission_method, submission_reference, sent_at, submitted_by, payload_version, payload_hash, created_at, due_by").eq("job_id", jobId)),
    q(admin.from("veec_lodgements").select("*").eq("job_id", jobId)),
    Promise.resolve([] as Record<string, unknown>[]), // property research retired (Jo, 7 Oct): old property_facts are never shown
    q(admin.from("declarations").select("*").eq("job_id", jobId)),
    q(admin.from("workflow_events").select("*").eq("job_id", jobId)),
    q(admin.from("messages").select("*").eq("job_id", jobId)),
    q(admin.from("job_communications").select("*").eq("job_id", jobId)),
    q(admin.from("bookings").select("id, kind, status, scheduled_start, booked_by, created_at").eq("job_id", jobId)),
    q(admin.from("appointment_proposals").select("id, kind, status, starts_at, ends_at, note, proposed_by, proposer_role, created_at, responded_at, responded_by, response_note").eq("job_id", jobId)),
  ]);
  const byReq = new Map(reqs.map((r) => [r["id"], r]));
  return { documents, evidenceFiles: ev.map((f) => ({ ...f, requirement: byReq.get(f["requirement_id"]) ?? null })), piesaRecords, piesaDeliveries, measurements, quotes, invoices, assignments, authorities, escNotifications, veec, propertyFacts, declarations, events, messages, comms, bookings, proposals };
}

/** Signs a short-lived private link for each stored correspondence attachment the role can already see. */
async function withAttachmentLinks<T extends { id: string; attachmentFiles?: { name: string; path: string | null; url?: string | null }[] }>(rows: T[]): Promise<T[]> {
  const out: T[] = [];
  for (const c of rows) {
    if (!c.attachmentFiles?.length) { out.push(c); continue; }
    const files = [] as { name: string; path: string | null; url: string | null }[];
    for (const f of c.attachmentFiles) {
      if (!f.path) { files.push({ ...f, name: f.name, path: null, url: null }); continue; }
      const { data } = await signFile(BUCKET, f.path, 7 * 86400);
      files.push({ ...f, name: f.name, path: f.path, url: data?.signedUrl ?? null });
    }
    out.push({ ...c, attachmentFiles: files });
  }
  return out;
}

export async function buildJobFile(jobId: string, role: Role) {
  const [src, { data: job }] = await Promise.all([
    loadSources(jobId),
    admin.from("jobs").select("owners(user_id), created_at, stage, updated_at").eq("id", jobId).single(),
  ]);
  const docs = buildDocumentIndex(src);
  const ids = [...new Set([...src.messages.map((m) => m["sender_id"]), ...src.events.map((e) => e["actor_id"]), ...src.proposals.flatMap((p) => [p["proposed_by"], p["responded_by"]]), ...src.bookings.map((b) => b["booked_by"]), ...docs.map((d) => d.actor)].filter(Boolean) as string[])];
  const [{ data: profiles }, { data: roles }, { data: jobRoles }] = await Promise.all([
    ids.length ? admin.from("profiles").select("id, full_name").in("id", ids) : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
    ids.length ? admin.from("user_roles").select("user_id, role").in("user_id", ids) : Promise.resolve({ data: [] as { user_id: string; role: string }[] }),
    ids.length ? admin.from("job_assignments").select("user_id, role").eq("job_id", jobId).in("user_id", ids) : Promise.resolve({ data: [] as { user_id: string; role: string }[] }),
  ]);
  const name = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? "User"]));
  const isAdminUser = new Set((roles ?? []).filter((r) => r.role === "admin").map((r) => r.user_id));
  const correspondence = buildCorrespondence(src.messages, src.comms, (id) => (id && isAdminUser.has(id) ? "admin" : null));
  const timeline = buildTimeline({ events: src.events, correspondence, bookings: src.bookings, evidence: docs, proposals: src.proposals });
  const ownerUser = (job?.owners as { user_id: string | null } | null)?.user_id ?? null;
  const ROLE_NAME: Record<string, string> = { electrician: "Electrician", installer: "Installer", property_manager: "Property manager" };
  const roleOf = (id: string | null): string => {
    if (!id) return "System";
    if (isAdminUser.has(id)) return "Home Insulation Victoria";
    if (id === ownerUser) return "Owner";
    const r = (jobRoles ?? []).find((x) => x.user_id === id)?.role;
    return r ? ROLE_NAME[r] ?? r : "Portal user";
  };
  const label = (id: string | null) => (id ? name.get(id) ?? (role === "admin" ? id.slice(0, 8) : "Portal user") : "System");
  const a = src.assignments.find((x) => x["status"] !== "cancelled");
  const retention = retentionFor({ assignmentRetainUntil: (a?.["retain_until"] as string | null) ?? null, jobCreatedAt: job?.created_at ?? new Date().toISOString(), completedAt: job?.stage === "complete" ? job.updated_at : null });
  return {
    role,
    documents: visibleTo(docs, role).map((d) => ({ ...d, actor: label(d.actor), verifiedBy: d.verifiedBy ? label(d.verifiedBy) : null, ...(role === "admin" ? {} : { storagePath: d.storagePath ? "private" : null }) })),
    correspondence: await withAttachmentLinks(visibleTo(correspondence, role).map((c) => ({ ...c, from: c.source === "portal_message" ? label(c.from) : c.from }))),
    timeline: visibleTo(timeline, role).map((t) => ({ ...t, actorRole: t.actorRole ?? roleOf(t.actor), actor: label(t.actor), detail: role === "admin" ? (JSON.parse(JSON.stringify(t.detail ?? null)) as Record<string, string | number | boolean | null> | null) : null })),
    retention: role === "admin" ? retention : null,
  };
}

/** Builds the ZIP server-side and stores it privately; the browser only ever receives a short-lived signed link. */
export async function exportJobPack(jobId: string, actorId: string, opts: { includeSuperseded: boolean; includeInternal: boolean }) {
  const src = await loadSources(jobId);
  const { data: job } = await admin.from("job_overview").select("job_number, property_address, owner_name, stage").eq("id", jobId).single();
  const all = buildDocumentIndex(src);
  const items = packSelection(all, opts);
  const plan = planPack(items);
  const linkMode = plan.mode === "manifest_with_links";
  const paths = linkMode ? new Map<string, string>() : packPaths(items);
  const manifest = buildManifest(items, paths);
  const correspondence = buildCorrespondence(src.messages, src.comms, () => null);
  const timeline = buildTimeline({ events: src.events, correspondence, bookings: src.bookings, evidence: all, proposals: src.proposals }).filter((t) => opts.includeInternal || !t.internal);
  const stamp = new Date().toISOString();
  const header = { Job: job?.job_number, Property: job?.property_address, Owner: job?.owner_name, Stage: job?.stage, Generated: stamp, Mode: linkMode ? "manifest + signed links (pack too large for one ZIP)" : "complete ZIP",
    "Superseded included": opts.includeSuperseded, "Internal included": opts.includeInternal };

  const chunks: Uint8Array[] = [];
  let failed: string | null = null;
  const zip = new Zip((err, data) => { if (err) failed = String(err); else chunks.push(data); });
  const add = (path: string, bytes: Uint8Array) => { const f = new ZipPassThrough(path); zip.add(f); f.push(bytes, true); };

  const missing: string[] = [];
  if (linkMode) {
    const { getRequest } = await import("@tanstack/react-start/server");
    const origin = new URL(getRequest().url).origin;
    const links = [] as { id: string; title: string; signed_url: string | null; expires_in_days: number }[];
    for (const i of items) if (i.storagePath) {
      const { data } = await signFile(BUCKET, i.storagePath, 7 * 86400);
      links.push({ id: i.id, title: i.title, signed_url: data?.signedUrl ? `${origin}${data.signedUrl}` : null, expires_in_days: 7 });
    }
    add("download-links.json", strToU8(JSON.stringify(links, null, 2)));
  } else {
    for (const i of items) {
      const p = paths.get(i.id); if (!p || !i.storagePath) continue;
      const { data: blob } = await admin.storage.from(BUCKET).download(i.storagePath);
      if (!blob) { missing.push(i.storagePath); continue; }
      add(p, new Uint8Array(await blob.arrayBuffer())); // one file at a time, server-side only
    }
  }
  add("manifest.json", strToU8(JSON.stringify({ header, missing_files: missing, entries: manifest }, null, 2)));
  add("manifest.csv", strToU8(toCsv(manifest as never)));
  add("manifest.html", strToU8(manifestHtml(`Job pack ${job?.job_number ?? ""}`, header, manifest)));
  add("timeline.json", strToU8(JSON.stringify(timeline, null, 2)));
  add("timeline.csv", strToU8(toCsv(timeline.map((t) => ({ at: t.at, source: t.source, actor: t.actor, summary: t.summary, tags: t.tags.join(" "), internal: t.internal })))));
  add("records.json", strToU8(JSON.stringify({ quotes: src.quotes, invoices: src.invoices.map(({ ...i }) => i), esc_notifications: src.escNotifications, veec: src.veec, piesa: src.piesaRecords, piesa_deliveries: src.piesaDeliveries }, null, 2)));
  zip.end();
  if (failed) throw new Error(`Could not build job pack: ${failed}`);
  const body = new Blob(chunks as BlobPart[], { type: "application/zip" });
  const path = `${jobId}/exports/job-pack-${stamp.replace(/[:.]/g, "-")}.zip`;
  const up = await admin.storage.from(BUCKET).upload(path, body, { contentType: "application/zip", upsert: false });
  if (up.error) throw new Error(`Could not store job pack: ${up.error.message}`);
  const { data: signed } = await signFile(BUCKET, path, 3600);
  await logEvent(jobId, actorId, "job_pack_exported", `Job pack exported (${items.length} items, ${plan.mode})`, { path, ...opts, mode: plan.mode, count: items.length, missing }, { internal: true });
  return { url: signed?.signedUrl ?? null, mode: plan.mode, count: items.length, missing: missing.length };
}
