// Owner ESC consent persistence (server-only, service role, after caller checks). Fails closed.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { logEvent, WorkflowError } from "./workflow.server";
import { activeTemplate, sha256Hex, stableJson } from "./assignment.core";
import { apConsentBlockers, apRepFullName, buildConsentFacts, ESC_AP_FULL_NAME, consentStaleReasons, isEscTemplateVersion, ownerConsentBlockers, renderConsentBody, splitFullName, type ApRep, type ConsentFacts, type ConsentSignInput, type OwnerDeclarations } from "./consent.core";
import { formatPropertyAddress } from "./address";

async function templates() {
  const { data } = await admin.from("compliance_templates").select("template_key, version, body, approved, is_active, required, form_fields").eq("is_active", true);
  return (data ?? []) as never[];
}

export async function currentConsent(jobId: string) {
  const { data } = await admin.from("owner_esc_consents").select("*").eq("job_id", jobId).not("status", "in", "(stale,cancelled)").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data;
}

async function currentFacts(jobId: string): Promise<{ facts: ConsentFacts | null; bookingId: string | null }> {
  const { data: b } = await admin.from("bookings").select("id, scheduled_start, scheduled_end").eq("job_id", jobId).eq("kind", "installation").in("status", ["confirmed", "completed"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: j } = await admin.from("jobs").select("owners(full_name, email, phone), properties(address_line, suburb, state, postcode)").eq("id", jobId).single();
  const o = j?.owners as { full_name: string | null; email: string | null; phone: string | null } | null;
  const p = j?.properties as { address_line: string; suburb: string | null; state: string; postcode: string | null } | null;
  const facts = buildConsentFacts({ scheduledStart: b?.scheduled_start ?? null, scheduledEnd: b?.scheduled_end ?? null, premisesAddress: formatPropertyAddress(p), owner: { name: o?.full_name ?? null, email: o?.email ?? null, phone: o?.phone ?? null } });
  return { facts, bookingId: b?.id ?? null };
}

/** Generates / refreshes the owner consent for the CURRENT installation booking. Locked-detail changes stale the old one. */
export async function syncOwnerConsent(jobId: string, actorId: string | null) {
  const { facts, bookingId } = await currentFacts(jobId);
  const prev = await currentConsent(jobId);
  if (!facts) {
    if (prev) { await admin.from("owner_esc_consents").update({ status: "cancelled", stale_reason: "Installation booking removed" }).eq("id", prev.id); await logEvent(jobId, actorId, "esc_consent_cancelled", "Owner ESC consent cancelled – installation booking removed", { consent_id: prev.id }, { internal: true }); }
    return null;
  }
  const tplOk = !!activeTemplate(await templates(), "esc_consent");
  if (prev) {
    const why = consentStaleReasons(prev.snapshot as unknown as ConsentFacts, facts);
    if (!why.length && prev.booking_id === bookingId) {
      if (prev.status === "configuration_required" && tplOk) await admin.from("owner_esc_consents").update({ status: "awaiting_owner" }).eq("id", prev.id);
      return prev.id;
    }
    await admin.from("owner_esc_consents").update({ status: "stale", stale_reason: why.join(", ") || "booking replaced" }).eq("id", prev.id);
    await logEvent(jobId, actorId, "esc_consent_stale", `Owner ESC consent is STALE (${why.join(", ") || "booking replaced"}) – new consent required`, { consent_id: prev.id, reasons: why }, { internal: true });
  }
  const sha = await sha256Hex(stableJson(facts));
  const { data: ins, error } = await admin.from("owner_esc_consents").insert({
    job_id: jobId, booking_id: bookingId, version: (prev?.version ?? 0) + 1, status: tplOk ? "awaiting_owner" : "configuration_required", ap_legal_entity: facts.ap_legal_entity,
    scheduled_start: facts.scheduled_start, scheduled_end: facts.scheduled_end, installation_days: facts.installation_days as Json, premises_address: facts.premises_address, owner_contact: facts.owner as Json,
    snapshot: facts as unknown as Json, snapshot_sha256: sha,
  }).select("id").single();
  if (error) throw new Error(error.message);
  await logEvent(jobId, actorId, "esc_consent_prepared", `Owner ESC consent v${(prev?.version ?? 0) + 1} prepared for ${facts.installation_days.join(", ")}${tplOk ? " – awaiting owner signature" : " – consent form wording not approved (configuration required)"}`, { consent_id: ins?.id }, { internal: true });
  return ins?.id ?? null;
}

async function storeCopy(jobId: string, path: string, text: string, title: string, actorId: string | null) {
  path = path.replace(/\.txt$/, ".pdf");
  const { textToPdf } = await import("./signed-pdf.server");
  const up = await admin.storage.from("job-files").upload(path, new Blob([await textToPdf(`Home Insulation Victoria — ${title}`, text) as BlobPart], { type: "application/pdf" }), { contentType: "application/pdf", upsert: false });
  if (up.error) return null;
  await admin.from("documents").insert({ job_id: jobId, kind: "esc_consent", title, storage_path: path, mime_type: "application/pdf", uploaded_by: actorId });
  return path;
}

export async function signOwnerConsent(p: { jobId: string; actorId: string; input: ConsentSignInput; ip: string | null; userAgent: string | null }) {
  await syncOwnerConsent(p.jobId, p.actorId);
  const c = await currentConsent(p.jobId);
  const tpl = activeTemplate(await templates(), "esc_consent");
  const b = ownerConsentBlockers({ status: c?.status ?? null, templateApproved: !!tpl, templateVersion: tpl?.version ?? null, scheduledStart: c?.scheduled_start ?? null, nowIso: new Date().toISOString(), input: p.input });
  if (!c) b.unshift("No installation date booked yet – consent is generated once the exact date is known.");
  if (b.length) throw new WorkflowError(b.join(" "));
  // ESC template (decision 123): the four Section 2 ticks are recorded with the consent; older wording keeps the single tick.
  const declarations: OwnerDeclarations | null = isEscTemplateVersion(tpl!.version) ? { ...p.input.declarations } : null;
  await admin.from("owner_esc_consents").update({
    status: "awaiting_ap", template_version: tpl!.version, owner_signatory_name: p.input.signatoryName, owner_authority_type: p.input.authorityType,
    owner_signature_name: p.input.signatureName, owner_signed_at: new Date().toISOString(), owner_signed_by: p.actorId, owner_ip: p.ip, owner_user_agent: p.userAgent,
    owner_declarations: declarations as Json,
  }).eq("id", c!.id);
  await logEvent(p.jobId, p.actorId, "esc_consent_owner_signed", `Owner signed ESC information-sharing consent (${tpl!.version})${declarations ? " – all four Section 2 declarations ticked" : ""} – awaiting AP representative`, { consent_id: c!.id, declarations });
}

/** Section 3 Part A prefill for the signing office user (their profile); role is typed by the user. */
export async function apRepPrefill(userId: string): Promise<ApRep> {
  const { data } = await admin.from("profiles").select("full_name, phone, email").eq("id", userId).maybeSingle();
  const n = splitFullName(data?.full_name);
  return { first_name: n.first, last_name: n.last, role: "", phone: data?.phone ?? null, email: data?.email ?? null };
}

export async function confirmApConsent(p: { jobId: string; actorId: string; apRepName?: string | undefined; apRep?: ApRep | null | undefined; purposeExplained: boolean; ip: string | null; userAgent: string | null }) {
  const c = await currentConsent(p.jobId);
  if (!c) throw new WorkflowError("No open owner consent.");
  const esc = isEscTemplateVersion(c.template_version);
  const rep: ApRep | null = p.apRep ? { first_name: p.apRep.first_name.trim(), last_name: p.apRep.last_name.trim(), role: p.apRep.role.trim(), phone: p.apRep.phone?.trim() || null, email: p.apRep.email?.trim() || null } : null;
  const apRepName = (rep ? apRepFullName(rep) : p.apRepName ?? "").trim();
  const b = apConsentBlockers({ status: c.status, scheduledStart: c.scheduled_start, nowIso: new Date().toISOString(), apRepName, purposeExplained: p.purposeExplained, templateVersion: c.template_version, apRep: rep });
  if (b.length) throw new WorkflowError(b.join(" "));
  const tpl = (await admin.from("compliance_templates").select("version, body").eq("template_key", "esc_consent").eq("version", c.template_version ?? "").maybeSingle()).data;
  const now = new Date().toISOString();
  const facts = c.snapshot as unknown as ConsentFacts;
  const declarations = (c.owner_declarations ?? null) as OwnerDeclarations | null;
  const signed = { facts: c.snapshot, template: { version: c.template_version, body: tpl?.body ?? null }, owner: { name: c.owner_signatory_name, authority: c.owner_authority_type, typed: c.owner_signature_name, at: c.owner_signed_at, ip: c.owner_ip, declarations }, ap: { name: apRepName, rep, purpose_explained: true, at: now, ip: p.ip, user_id: p.actorId } };
  const json = stableJson(signed); const sha = await sha256Hex(json);
  const { customerDeliveryState } = await import("./comms.server");
  const delivery = await customerDeliveryState(p.jobId);
  const form = renderConsentBody({
    version: c.template_version, body: tpl?.body ?? "", facts: { owner: facts.owner, premises_address: c.premises_address, installation_days: c.installation_days as string[] },
    owner: { signatureName: c.owner_signature_name ?? "", signedAt: c.owner_signed_at ?? now, declarations },
    ap: rep ? { rep, signedAt: now } : null,
  });
  const text = [`OWNER CONSENT – ESC INFORMATION SHARING (${c.template_version})`, `AP: ${esc ? ESC_AP_FULL_NAME : c.ap_legal_entity}`, `Premises: ${c.premises_address}`, `Installation day(s): ${(c.installation_days as string[]).join(", ")}`, "", form, "",
    `Owner/authorised representative: ${c.owner_signatory_name} (${c.owner_authority_type}) · typed signature "${c.owner_signature_name}" · ${c.owner_signed_at}`, `AP representative: ${apRepName}${rep?.role ? ` (${rep.role})` : ""} · purpose explained · ${now}`, `SHA-256: ${sha}`, "", json].join("\n");
  const path = await storeCopy(p.jobId, `${p.jobId}/consent/esc-consent-v${c.version}-${sha.slice(0, 12)}.txt`, text, `Owner ESC consent v${c.version} (signed)`, p.actorId);
  await admin.from("owner_esc_consents").update({ status: "valid", ap_rep_name: apRepName, ap_rep: rep as Json, ap_purpose_explained: true, ap_signed_at: now, ap_signed_by: p.actorId, ap_ip: p.ip, ap_user_agent: p.userAgent, signed_sha256: sha, copy_path: path, delivery_status: delivery }).eq("id", c.id);
  await logEvent(p.jobId, p.actorId, "esc_consent_valid", `Owner ESC consent complete – AP representative ${apRepName} confirmed purpose explained (copy stored; delivery ${delivery === "ready_to_send" ? "ready" : delivery === "not_ready" ? "blocked – no owner contact consent" : "pending – communications locked"})`, { consent_id: c.id, sha256: sha });
  // The ESC recommends providing the owner a copy of the executed form: best-effort through the guarded owner path.
  try {
    const { emailOwnerConsentCopy } = await import("./consent-copy-email.server");
    const r = await emailOwnerConsentCopy({ jobId: p.jobId, consentId: c.id, sha256: sha, templateVersion: c.template_version ?? "", installationDays: c.installation_days as string[], address: c.premises_address, formText: form });
    await logEvent(p.jobId, p.actorId, "esc_consent_copy_email", `Owner ESC consent copy email: ${r}`, { consent_id: c.id }, { internal: true });
  } catch (e) {
    await logEvent(p.jobId, p.actorId, "esc_consent_copy_email", `Owner ESC consent copy email failed: ${(e as Error).message}`, { consent_id: c.id }, { internal: true });
  }
  const { regenerateEscNotification } = await import("./esc.server");
  await regenerateEscNotification(p.jobId, p.actorId);
}
