// CENTRAL OWNER AUTHORITY RULES. Every state change writes a workflow_event and links it to the record.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { AP_LEGAL_ENTITY, AUTHORITY_SCOPE, AUTHORITY_WORDING_VERSION, authorityWording } from "./authority";
import { WorkflowError, logEvent } from "./workflow.server";


async function linkEvent(authorityId: string, jobId: string) {
  const { data: ev } = await admin.from("workflow_events").select("id").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).single();
  const { data: a } = await admin.from("owner_authorities").select("event_ids").eq("id", authorityId).single();
  if (ev && a) await admin.from("owner_authorities").update({ event_ids: [...a.event_ids, ev.id] }).eq("id", authorityId);
}

export async function latestAuthority(jobId: string) {
  const { data } = await admin.from("owner_authorities").select("*").eq("job_id", jobId).order("version", { ascending: false }).limit(1).maybeSingle();
  return data;
}

/** Marks an accepted-but-past-expiry authority as expired (lazily, with an audit event). */
export async function sweepAuthorityExpiry(jobId: string) {
  const a = await latestAuthority(jobId);
  if (a && a.status === "accepted" && a.expires_at && new Date(a.expires_at) < new Date()) {
    await admin.from("owner_authorities").update({ status: "expired", expired_at: new Date().toISOString() }).eq("id", a.id);
    await logEvent(jobId, null, "authority_expired", `Owner Authority v${a.version} expired on ${a.expires_at.slice(0, 10)} – renewal required`, { authority_id: a.id });
    await linkEvent(a.id, jobId);
  }
}

/** Central check used by stage guards and booking guards. */
export async function authorityValid(jobId: string) {
  await sweepAuthorityExpiry(jobId);
  const a = await latestAuthority(jobId);
  return !!a && a.status === "accepted" && !!a.expires_at && new Date(a.expires_at) > new Date();
}

/** Issue (or renew/resend) a new authority version with an immutable wording snapshot. */
export async function requestAuthority(jobId: string, actorId: string | null, reason: "initial" | "renewal" | "resend") {
  const { data: job } = await admin.from("jobs").select("id, owner_id, property_id, owners(full_name, email, phone), properties(address_line, suburb, state, postcode)").eq("id", jobId).single();
  if (!job) throw new WorkflowError("Job not found");
  const cur = await latestAuthority(jobId);
  if (cur && cur.status === "accepted" && cur.expires_at && new Date(cur.expires_at) > new Date() && reason !== "renewal")
    throw new WorkflowError("A valid Owner Authority is already in place.");
  if (cur && ["sent", "viewed"].includes(cur.status) && reason === "initial") return cur.id;
  const { data: s } = await admin.from("workflow_settings").select("authority_validity_months").eq("id", 1).maybeSingle();
  const months = s?.authority_validity_months ?? 3;
  const o = job.owners as unknown as { full_name: string; email: string | null; phone: string | null };
  const p = job.properties as unknown as { address_line: string; suburb: string | null; state: string; postcode: string | null };
  const address = [p.address_line, p.suburb, `${p.state} ${p.postcode ?? ""}`.trim()].filter(Boolean).join(", ");
  // Close any open (unaccepted) request so only one is actionable.
  if (cur && ["sent", "viewed"].includes(cur.status))
    await admin.from("owner_authorities").update({ status: "revoked", revoked_at: new Date().toISOString(), revoked_by: actorId, revocation_reason: `Superseded by ${reason}` }).eq("id", cur.id);
  const { data: created, error } = await admin
    .from("owner_authorities")
    .insert({
      job_id: jobId, owner_id: job.owner_id, property_id: job.property_id, version: (cur?.version ?? 0) + 1, status: "sent",
      wording_version: AUTHORITY_WORDING_VERSION, wording_snapshot: authorityWording({ ownerName: o.full_name, propertyAddress: address, validityMonths: months }),
      scope_snapshot: AUTHORITY_SCOPE, ap_legal_entity: AP_LEGAL_ENTITY, owner_full_name: o.full_name, owner_email: o.email, owner_phone: o.phone,
      property_address: address, requested_by: actorId,
    })
    .select("id, version")
    .single();
  if (error || !created) throw new Error(error?.message);
  const label = reason === "renewal" ? "renewal requested" : reason === "resend" ? "re-sent" : "requested";
  await logEvent(jobId, actorId, `authority_${reason === "initial" ? "requested" : reason === "renewal" ? "renewal_requested" : "resent"}`, `Owner Authority v${created.version} ${label} – owner to accept in portal`, { authority_id: created.id });
  await linkEvent(created.id, jobId);
  await admin.from("compliance_checks").update({ status: "pending" }).eq("job_id", jobId).eq("check_key", "owner_authority");
  return created.id;
}

export async function markViewed(authorityId: string, actorId: string) {
  const { data: a } = await admin.from("owner_authorities").select("id, job_id, status, version").eq("id", authorityId).single();
  if (!a || a.status !== "sent") return;
  await admin.from("owner_authorities").update({ status: "viewed", viewed_at: new Date().toISOString() }).eq("id", a.id);
  await logEvent(a.job_id, actorId, "authority_viewed", `Owner viewed Owner Authority v${a.version}`, { authority_id: a.id });
  await linkEvent(a.id, a.job_id);
}

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function acceptAuthority(input: {
  authorityId: string; actorId: string; over18: boolean; authorised: boolean;
  assistance: "none" | "interpreter" | "support_understanding" | "both"; signatureName: string; ip: string | null; userAgent: string | null;
}) {
  const { data: a } = await admin.from("owner_authorities").select("*").eq("id", input.authorityId).single();
  if (!a) throw new WorkflowError("Authority not found");
  if (!["sent", "viewed"].includes(a.status)) throw new WorkflowError("This authority is no longer open. Please ask HI VIC to re-send it.");
  if (!input.over18 || !input.authorised) throw new WorkflowError("Both confirmations are required to give authority.");
  const { data: s } = await admin.from("workflow_settings").select("authority_validity_months").eq("id", 1).maybeSingle();
  const now = new Date();
  const expires = new Date(now);
  expires.setMonth(expires.getMonth() + (s?.authority_validity_months ?? 3));
  // Locked record: exact wording + acceptance evidence, hashed and stored privately.
  const record = [
    `OWNER AUTHORITY – ${a.ap_legal_entity}`, `Version ${a.version} · Wording ${a.wording_version}`, "",
    a.wording_snapshot, "", "---- Acceptance evidence ----",
    `Owner: ${a.owner_full_name} · ${a.owner_email ?? ""} · ${a.owner_phone ?? ""}`, `Property: ${a.property_address}`,
    `Confirmed 18+: yes`, `Confirmed owner / legally authorised: yes`, `Assistance requirement: ${input.assistance}`,
    `Typed signature: ${input.signatureName}`, `Accepted at: ${now.toISOString()}`, `Expires at: ${expires.toISOString()}`,
    `IP: ${input.ip ?? "unknown"}`, `User agent: ${input.userAgent ?? "unknown"}`, `Portal user id: ${input.actorId}`,
  ].join("\n");
  const hash = await sha256(record);
  const path = `${a.job_id}/authority/v${a.version}-${hash.slice(0, 12)}.txt`;
  const up = await admin.storage.from("job-files").upload(path, new Blob([record], { type: "text/plain" }), { contentType: "text/plain", upsert: false });
  await admin.from("owner_authorities").update({
    status: "accepted", accepted_at: now.toISOString(), starts_at: now.toISOString(), accepted_by: input.actorId, expires_at: expires.toISOString(),
    confirmed_over_18: true, confirmed_owner_or_authorised: true, assistance_requirement: input.assistance,
    acceptance_method: "portal_explicit_acceptance_typed_signature", signature_name: input.signatureName,
    ip_address: input.ip, user_agent: input.userAgent, document_path: up.error ? null : path, document_sha256: hash,
  }).eq("id", a.id);
  if (!up.error) await admin.from("documents").insert({ job_id: a.job_id, kind: "owner_authority", title: `Owner Authority v${a.version} (accepted)`, storage_path: path, mime_type: "text/plain", uploaded_by: input.actorId });
  await logEvent(a.job_id, input.actorId, "authority_accepted", `Owner Authority v${a.version} accepted – valid until ${expires.toISOString().slice(0, 10)}`, { authority_id: a.id, sha256: hash, assistance: input.assistance });
  await linkEvent(a.id, a.job_id);
  await admin.from("compliance_checks").update({ status: "pass", checked_at: now.toISOString(), notes: `v${a.version} accepted ${now.toISOString().slice(0, 10)}` }).eq("job_id", a.job_id).eq("check_key", "owner_authority");
}

export async function declineAuthority(authorityId: string, actorId: string, reason: string) {
  const { data: a } = await admin.from("owner_authorities").select("id, job_id, status, version").eq("id", authorityId).single();
  if (!a || !["sent", "viewed"].includes(a.status)) throw new WorkflowError("This authority is no longer open.");
  await admin.from("owner_authorities").update({ status: "declined", declined_at: new Date().toISOString(), decline_reason: reason }).eq("id", a.id);
  await logEvent(a.job_id, actorId, "authority_declined", `Owner declined Owner Authority v${a.version}`, { authority_id: a.id, reason });
  await linkEvent(a.id, a.job_id);
  await admin.from("compliance_checks").update({ status: "fail" }).eq("job_id", a.job_id).eq("check_key", "owner_authority");
}

export async function revokeAuthority(authorityId: string, actorId: string, reason: string) {
  const { data: a } = await admin.from("owner_authorities").select("id, job_id, status, version").eq("id", authorityId).single();
  if (!a || ["declined", "revoked", "expired"].includes(a.status)) throw new WorkflowError("Authority is not active.");
  await admin.from("owner_authorities").update({ status: "revoked", revoked_at: new Date().toISOString(), revoked_by: actorId, revocation_reason: reason }).eq("id", a.id);
  await logEvent(a.job_id, actorId, "authority_revoked", `Owner Authority v${a.version} revoked: ${reason}`, { authority_id: a.id });
  await linkEvent(a.id, a.job_id);
  await admin.from("compliance_checks").update({ status: "fail" }).eq("job_id", a.job_id).eq("check_key", "owner_authority");
}
