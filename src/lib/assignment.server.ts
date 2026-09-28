// CENTRAL Customer Acceptance & VEEC Assignment rules (server-only, service role, after caller checks).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { AP_LEGAL_ENTITY } from "./authority";
import {
  ASSIGNMENT_EVENTS as EV, activeTemplate, apDeclarationRequired, formFieldBlockers, parseFormFields, pickFieldValues, resolveInstalledDetails, type FieldValue, consumerSignBlockers, evaluateAssignment, materialChanges, retainUntil, sha256Hex, stableJson, templateBlockers,
  type ConsumerSignInput, type Snapshot, type Template,
} from "./assignment.core";
import { WorkflowError, logEvent } from "./workflow.server";

export async function loadTemplates(): Promise<Template[]> {
  const { data } = await admin.from("compliance_templates").select("template_key, version, body, approved, is_active, required, form_fields").eq("is_active", true);
  return (data ?? []) as Template[];
}

export async function currentAssignment(jobId: string) {
  const { data } = await admin.from("customer_assignments").select("*").eq("job_id", jobId).neq("status", "cancelled").maybeSingle();
  return data;
}

export async function assignmentEffective(jobId: string) {
  return (await currentAssignment(jobId))?.status === "effective_complete";
}

async function installerFacts(jobId: string) {
  const { data: a } = await admin.from("job_assignments").select("user_id, business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
  if (!a) return { installer_user_id: null, installer_business_id: null, name: null, business: null, abn: null, licence: null };
  const { data: p } = await admin.from("profiles").select("full_name, licence_number, business_id").eq("id", a.user_id).maybeSingle();
  const bid = a.business_id ?? p?.business_id ?? null;
  const { data: b } = bid ? await admin.from("businesses").select("name, abn, licence_number").eq("id", bid).maybeSingle() : { data: null };
  return { installer_user_id: a.user_id, installer_business_id: bid, name: p?.full_name ?? null, business: b?.name ?? null, abn: b?.abn ?? null, licence: p?.licence_number ?? b?.licence_number ?? null };
}

/** Everything the customer sees and signs – built from data we already hold (never re-entered). */
export async function buildAcceptancePackage(quoteId: string) {
  const { data: q } = await admin.from("quotes").select("id, job_id, kind, option_label, option_code, version, subtotal_inc_gst, veec_discount_inc_gst, customer_total_inc_gst, status, quote_items(description, quantity, unit, unit_price_inc_gst, line_total_inc_gst, code, sort)").eq("id", quoteId).single();
  if (!q) throw new WorkflowError("Quote not found");
  const { data: job } = await admin.from("jobs").select("job_number, owners(full_name, email, phone), properties(address_line, suburb, state, postcode)").eq("id", q.job_id).single();
  const { data: m } = await admin.from("ceiling_measurements").select("measured_area_m2").eq("job_id", q.job_id).eq("is_current", true).maybeSingle();
  const inst = await installerFacts(q.job_id);
  const o = job?.owners as unknown as { full_name: string; email: string | null; phone: string | null };
  const p = job?.properties as unknown as { address_line: string; suburb: string | null; state: string; postcode: string | null };
  const items = [...(q.quote_items ?? [])].sort((a, b) => a.sort - b.sort);
  const product = items.find((i) => /insulation|batt|R\d/i.test(i.description))?.description ?? q.option_label;
  const total = Number(q.customer_total_inc_gst);
  return {
    quote: { id: q.id, version: q.version, option_label: q.option_label, option_code: q.option_code, status: q.status, kind: q.kind, items },
    job_id: q.job_id, job_number: job?.job_number ?? "",
    consumer: { name: o?.full_name ?? "", email: o?.email ?? null, phone: o?.phone ?? null },
    property_address: p ? [p.address_line, p.suburb, `${p.state} ${p.postcode ?? ""}`.trim()].filter(Boolean).join(", ") : "",
    installer: { user_id: inst.installer_user_id, business_id: inst.installer_business_id, name: inst.name, business: inst.business, abn: inst.abn, licence: inst.licence },
    quoted_product: product, quoted_area_m2: m?.measured_area_m2 != null ? Number(m.measured_area_m2) : null,
    price_before_benefit_inc_gst: Number(q.subtotal_inc_gst), veu_benefit_inc_gst: Number(q.veec_discount_inc_gst), final_customer_price_inc_gst: total,
    payment_terms: `One Xero invoice for ${total.toFixed(2)} inc GST. 50% deposit (${(total / 2).toFixed(2)}) due immediately; balance due on the installation day. No rectification or installation can be scheduled until the deposit is paid.`,
    ap_legal_entity: AP_LEGAL_ENTITY,
  };
}

export type AcceptancePackage = Awaited<ReturnType<typeof buildAcceptancePackage>>;

function snapOf(pkg: AcceptancePackage): Snapshot {
  return {
    installer_user_id: pkg.installer.user_id, installer_business_id: pkg.installer.business_id, product: pkg.quoted_product, area_m2: pkg.quoted_area_m2,
    price_before_benefit_inc_gst: pkg.price_before_benefit_inc_gst, veu_benefit_inc_gst: pkg.veu_benefit_inc_gst, final_customer_price_inc_gst: pkg.final_customer_price_inc_gst,
  };
}

async function storeCopy(jobId: string, path: string, text: string, title: string, actorId: string | null) {
  const up = await admin.storage.from("job-files").upload(path, new Blob([text], { type: "text/plain" }), { contentType: "text/plain", upsert: false });
  if (up.error) return null;
  await admin.from("documents").insert({ job_id: jobId, kind: "veec_assignment", title, storage_path: path, mime_type: "text/plain", uploaded_by: actorId });
  return path;
}

/** Validates without writing – used before a quote is marked accepted. */
export async function assertConsumerCanSign(input: ConsumerSignInput) {
  const b = consumerSignBlockers(input, await loadTemplates());
  if (b.length) throw new WorkflowError(b.join(" "));
}

/** Customer signs their part. Creates the staged assignment – NEVER effective at this point. */
export async function signConsumer(p: { quoteId: string; actorId: string; input: ConsumerSignInput; assistance: "none" | "interpreter" | "support_understanding" | "both"; ip: string | null; userAgent: string | null }) {
  const templates = await loadTemplates();
  const b = consumerSignBlockers(p.input, templates);
  if (b.length) throw new WorkflowError(b.join(" "));
  const pkg = await buildAcceptancePackage(p.quoteId);
  if (await currentAssignment(pkg.job_id)) throw new WorkflowError("A customer acceptance already exists for this job – use a variation.");
  const decl = activeTemplate(templates, "consumer_declaration")!;
  const rights = activeTemplate(templates, "consumer_rights")!;
  const esc = activeTemplate(templates, "esc_consent")!;
  const now = new Date();
  const snapshot = {
    package: pkg, snapshot: snapOf(pkg),
    consumer_declaration: { version: decl.version, body: decl.body }, consumer_rights: { version: rights.version, body: rights.body }, esc_consent: { version: esc.version, body: esc.body, accepted: true },
    signatory: { name: p.input.signatoryName, authority_type: p.input.authorityType, over_18: p.input.over18, assistance: p.assistance },
    signature: { typed_name: p.input.signatureName, at: now.toISOString(), ip: p.ip, user_agent: p.userAgent, user_id: p.actorId },
    assignment_effective_rule: "Assignment becomes effective only after the eligible activity is undertaken and installer final details/declaration are complete.",
  };
  const json = stableJson(snapshot);
  const hash = await sha256Hex(json);
  const copyText = [`CUSTOMER ACCEPTANCE & VEEC ASSIGNMENT – ${pkg.ap_legal_entity}`, `Job ${pkg.job_number} · Quote ${pkg.quote.option_label} v${pkg.quote.version}`, `Status: signed by consumer – NOT YET EFFECTIVE (effective after installation + installer declaration)`, "",
    `Consumer rights information (${rights.version}):`, rights.body, "", `Consumer declaration (${decl.version}):`, decl.body, "", `ESC information-sharing consent (${esc.version}):`, esc.body, "",
    `Property: ${pkg.property_address}`, `Signatory: ${p.input.signatoryName} (${p.input.authorityType})`, `Product: ${pkg.quoted_product} · Area: ${pkg.quoted_area_m2 ?? "TBC"} m²`,
    `Price before VEU benefit: ${pkg.price_before_benefit_inc_gst.toFixed(2)} · VEU benefit: ${pkg.veu_benefit_inc_gst.toFixed(2)} · Final price: ${pkg.final_customer_price_inc_gst.toFixed(2)} (inc GST)`,
    pkg.payment_terms, `Installer: ${pkg.installer.name ?? "To be confirmed"} ${pkg.installer.business ? `(${pkg.installer.business})` : ""}`, "",
    `Typed signature: ${p.input.signatureName} · ${now.toISOString()} · IP ${p.ip ?? "unknown"}`, `SHA-256 of signed record: ${hash}`, "", "Machine-readable snapshot:", json].join("\n");
  const path = await storeCopy(pkg.job_id, `${pkg.job_id}/assignment/consumer-v${pkg.quote.version}-${hash.slice(0, 12)}.txt`, copyText, "Customer Acceptance & VEEC Assignment (your signed copy)", p.actorId);
  const { data: row, error } = await admin.from("customer_assignments").insert({
    job_id: pkg.job_id, quote_id: pkg.quote.id, quote_version: pkg.quote.version, status: "consumer_signed_pending_install", ap_legal_entity: pkg.ap_legal_entity,
    signatory_name: p.input.signatoryName, signatory_email: pkg.consumer.email, signatory_phone: pkg.consumer.phone, signatory_authority_type: p.input.authorityType,
    signatory_over_18: p.input.over18, assistance_requirement: p.assistance, consumer_signature_name: p.input.signatureName, consumer_signed_at: now.toISOString(),
    consumer_signed_by: p.actorId, consumer_ip: p.ip, consumer_user_agent: p.userAgent, consumer_declaration_version: decl.version, consumer_rights_version: rights.version, esc_consent_version: esc.version, esc_consent_signed_at: now.toISOString(),
    consumer_snapshot: snapshot as unknown as Json, consumer_snapshot_sha256: hash, consumer_copy_path: path, copy_sent_at: path ? now.toISOString() : null,
    quoted_product: pkg.quoted_product, quoted_area_m2: pkg.quoted_area_m2, price_before_benefit_inc_gst: pkg.price_before_benefit_inc_gst,
    veu_benefit_inc_gst: pkg.veu_benefit_inc_gst, final_customer_price_inc_gst: pkg.final_customer_price_inc_gst,
    installer_user_id: pkg.installer.user_id, installer_business_id: pkg.installer.business_id, installer_name: pkg.installer.name,
    installer_business_name: pkg.installer.business, installer_abn: pkg.installer.abn, installer_licence: pkg.installer.licence, retain_until: retainUntil(now),
  }).select("id").single();
  if (error || !row) throw new Error(error?.message ?? "Could not record acceptance");
  await logEvent(pkg.job_id, p.actorId, EV.CONSUMER_ASSIGNMENT_SIGNED, `Customer signed acceptance & VEEC assignment (not yet effective)${path ? " – signed copy provided in Documents" : ""}`, { assignment_id: row.id, sha256: hash, declaration_version: decl.version, rights_version: rights.version });
  return row.id;
}

async function baselineSnapshot(a: { id: string; consumer_snapshot: Json | null }): Promise<Snapshot> {
  const { data: v } = await admin.from("assignment_variations").select("proposed_snapshot").eq("assignment_id", a.id).eq("status", "reconfirmed").order("reconfirmed_at", { ascending: false }).limit(1).maybeSingle();
  if (v) return v.proposed_snapshot as unknown as Snapshot;
  return (a.consumer_snapshot as unknown as { snapshot: Snapshot }).snapshot;
}

/** Raises a variation. The original signed snapshot is never changed. */
export async function raiseVariation(jobId: string, actorId: string | null, reasons: string[], proposed: Snapshot) {
  const a = await currentAssignment(jobId);
  if (!a) throw new WorkflowError("No customer acceptance on this job.");
  if (a.status === "effective_complete") throw new WorkflowError("Assignment already effective – variations can't be raised.");
  const { data: open } = await admin.from("assignment_variations").select("id").eq("assignment_id", a.id).eq("status", "pending").maybeSingle();
  if (open) return open.id;
  const resume = a.status === "variation_required" ? "consumer_signed_pending_install" : a.status;
  const { data: v, error } = await admin.from("assignment_variations").insert({ assignment_id: a.id, job_id: jobId, reasons: reasons as unknown as Json, proposed_snapshot: proposed as unknown as Json, raised_by: actorId, resume_status: resume }).select("id").single();
  if (error || !v) throw new Error(error?.message);
  await admin.from("customer_assignments").update({ status: "variation_required", variation_reasons: reasons as unknown as Json }).eq("id", a.id);
  await admin.from("jobs").update({ next_action: `Customer must reconfirm variation: ${reasons.join(", ")}` }).eq("id", jobId);
  await logEvent(jobId, actorId, EV.ASSIGNMENT_VARIATION_REQUIRED, `Variation required: ${reasons.join(", ")}`, { assignment_id: a.id, variation_id: v.id, reasons });
  return v.id;
}

export async function reconfirmVariation(p: { variationId: string; actorId: string; signatureName: string; ip: string | null; userAgent: string | null }) {
  const { data: v } = await admin.from("assignment_variations").select("*").eq("id", p.variationId).single();
  if (!v || v.status !== "pending") throw new WorkflowError("This variation is no longer open.");
  if (p.signatureName.trim().length < 2) throw new WorkflowError("Type your full name to sign.");
  const now = new Date().toISOString();
  const hash = await sha256Hex(stableJson({ proposed: v.proposed_snapshot, reasons: v.reasons, signature: p.signatureName, at: now, ip: p.ip }));
  await admin.from("assignment_variations").update({ status: "reconfirmed", reconfirmed_by: p.actorId, reconfirmed_at: now, signature_name: p.signatureName, ip_address: p.ip, user_agent: p.userAgent, snapshot_sha256: hash }).eq("id", v.id);
  await admin.from("customer_assignments").update({ status: v.resume_status }).eq("id", v.assignment_id);
  await logEvent(v.job_id, p.actorId, "ASSIGNMENT_VARIATION_RECONFIRMED", "Customer reconfirmed the variation", { variation_id: v.id, sha256: hash });
  await evaluateAndApply(v.job_id, p.actorId);
}

/** Installer signs final declaration with installed product + actual m². Material differences raise a variation. */
export async function signInstaller(p: { jobId: string; actorId: string; asQuotedProduct: boolean; installedProduct?: string | null; installedArea: number; fieldValues: Record<string, FieldValue>; signatureName: string; ip: string | null; userAgent: string | null }) {
  const a = await currentAssignment(p.jobId);
  if (!a) throw new WorkflowError("Customer acceptance has not been signed yet.");
  if (a.installer_signed_at) throw new WorkflowError("Installer declaration already signed.");
  const templates = await loadTemplates();
  const tb = templateBlockers(templates, "final");
  if (tb.length) throw new WorkflowError(tb.join(" "));
  const decl = activeTemplate(templates, "installer_declaration")!;
  const resolved = resolveInstalledDetails({ asQuotedProduct: p.asQuotedProduct, product: p.installedProduct ?? null, area: p.installedArea }, { product: a.quoted_product });
  if ("error" in resolved) throw new WorkflowError(resolved.error);
  const defs = parseFormFields(decl.form_fields);
  const fb = formFieldBlockers(defs, p.fieldValues);
  if (fb.length) throw new WorkflowError(fb.join(" "));
  const fieldValues = pickFieldValues(defs, p.fieldValues);
  const installedProduct = resolved.product, installedArea = resolved.area;
  const ap = activeTemplate(templates, "ap_declaration");
  const inst = await installerFacts(p.jobId);
  if (inst.installer_user_id !== p.actorId) {
    const { data: isAdm } = await admin.from("user_roles").select("id").eq("user_id", p.actorId).eq("role", "admin").maybeSingle();
    if (!isAdm) throw new WorkflowError("Only the assigned installer can sign this declaration.");
  }
  const now = new Date().toISOString();
  const snap = { declaration: { version: decl.version, body: decl.body, fields: defs }, installer: inst, installed_as_quoted: p.asQuotedProduct, installed_product: installedProduct, installed_area_m2: installedArea, field_values: fieldValues, signature: { typed_name: p.signatureName, at: now, ip: p.ip, user_agent: p.userAgent, user_id: p.actorId } };
  const hash = await sha256Hex(stableJson(snap));
  await admin.from("customer_assignments").update({
    installer_user_id: inst.installer_user_id, installer_business_id: inst.installer_business_id, installer_name: inst.name, installer_business_name: inst.business,
    installer_abn: inst.abn, installer_licence: inst.licence, installer_declaration_version: decl.version, installer_signature_name: p.signatureName,
    installer_signed_at: now, installer_ip: p.ip, installer_user_agent: p.userAgent, installed_product: installedProduct, installed_area_m2: installedArea, installer_form_values: fieldValues as unknown as Json,
    installer_snapshot: snap as unknown as Json, installer_snapshot_sha256: hash, ap_declaration_version: ap?.version ?? null,
  }).eq("id", a.id);
  await admin.from("declarations").upsert({ job_id: p.jobId, kind: "installer_declaration", declared_by: p.actorId, statement: `${decl.version}: ${decl.body}`, declared_at: now }, { onConflict: "job_id,kind" });
  await logEvent(p.jobId, p.actorId, EV.INSTALLER_DECLARATION_SIGNED, `Installer declaration signed (${decl.version}) – ${installedProduct}, ${installedArea} m²`, { assignment_id: a.id, sha256: hash });
  const base = await baselineSnapshot(a);
  const changes = materialChanges(base, { installer_user_id: inst.installer_user_id, installer_business_id: inst.installer_business_id, product: installedProduct, area_m2: installedArea });
  if (changes.length) await raiseVariation(p.jobId, p.actorId, changes, { ...base, installer_user_id: inst.installer_user_id, installer_business_id: inst.installer_business_id, product: installedProduct, area_m2: installedArea });
  await evaluateAndApply(p.jobId, p.actorId);
}

/** Recomputes the staged status from facts; makes the assignment effective only when every requirement is met. */
export async function evaluateAndApply(jobId: string, actorId: string | null) {
  const a = await currentAssignment(jobId);
  if (!a) return null;
  const { data: job } = await admin.from("jobs").select("installation_completed_at, job_number").eq("id", jobId).single();
  const { count: openVar } = await admin.from("assignment_variations").select("id", { count: "exact", head: true }).eq("assignment_id", a.id).eq("status", "pending");
  const templates = await loadTemplates();
  const r = evaluateAssignment({
    status: a.status, consumerSigned: !!a.consumer_signed_at, installationCompleted: !!job?.installation_completed_at, installerSigned: !!a.installer_signed_at,
    installedProduct: a.installed_product, installedArea: a.installed_area_m2 != null ? Number(a.installed_area_m2) : null, openVariation: (openVar ?? 0) > 0, templates, apSigned: !!a.ap_signed_at,
  });
  if (r.status === a.status) return r;
  if (r.status !== "effective_complete") {
    await admin.from("customer_assignments").update({ status: r.status }).eq("id", a.id);
    return r;
  }
  const now = new Date();
  const fv = (a.installer_form_values ?? {}) as Record<string, unknown>;
  const instSnap = (a.installer_snapshot ?? {}) as { declaration?: { body?: string; fields?: { key: string; label: string }[] } };
  const finalText = [`COMPLETED CUSTOMER ACCEPTANCE & VEEC ASSIGNMENT – ${a.ap_legal_entity}`, `Job ${job?.job_number} · effective ${now.toISOString()}`, "",
    "CUSTOMER", `Signatory: ${a.signatory_name} (${a.signatory_authority_type}) · ${a.signatory_email ?? ""} ${a.signatory_phone ?? ""}`,
    `Signed ${a.consumer_signed_at} · typed signature "${a.consumer_signature_name}" · IP ${a.consumer_ip ?? "unknown"}`,
    `Wording: consumer declaration ${a.consumer_declaration_version} · consumer rights ${a.consumer_rights_version} · ESC consent ${a.esc_consent_version ?? "-"}`,
    `Quoted: ${a.quoted_product} · ${a.quoted_area_m2 ?? "TBC"} m² · final price ${Number(a.final_customer_price_inc_gst).toFixed(2)} inc GST (VEU benefit ${Number(a.veu_benefit_inc_gst).toFixed(2)})`, "",
    "INSTALLER", `${a.installer_name ?? ""} ${a.installer_business_name ? `(${a.installer_business_name})` : ""} · ABN ${a.installer_abn ?? "-"} · Licence ${a.installer_licence ?? "-"}`,
    `Installed product: ${a.installed_product} · Installed area: ${a.installed_area_m2} m²`,
    ...(instSnap.declaration?.fields ?? []).map((f) => `${f.label}: ${String(fv[f.key] ?? "—")}`),
    `Installer declaration ${a.installer_declaration_version}:`, instSnap.declaration?.body ?? "", `Signed ${a.installer_signed_at} · typed signature "${a.installer_signature_name}"`, "",
    ...(a.ap_signed_at ? ["ACCREDITED PERSON", `AP declaration ${a.ap_declaration_version} signed ${a.ap_signed_at} by "${a.ap_signature_name}" (sha256 ${a.ap_snapshot_sha256})`, ""] : []),
    `Consumer record sha256 ${a.consumer_snapshot_sha256} · Installer record sha256 ${a.installer_snapshot_sha256}`, "",
    "Machine-readable records:", stableJson(a.consumer_snapshot), stableJson(a.installer_snapshot), stableJson(a.ap_details ?? null)].join("\n");
  const hash = await sha256Hex(finalText);
  const path = await storeCopy(jobId, `${jobId}/assignment/final-${hash.slice(0, 12)}.txt`, finalText, "Completed VEEC Assignment (final copy)", actorId ?? a.consumer_signed_by ?? null);
  await admin.from("customer_assignments").update({ status: "effective_complete", effective_at: now.toISOString(), completed_at: now.toISOString(), final_copy_path: path, final_copy_at: path ? now.toISOString() : null }).eq("id", a.id);
  await admin.from("compliance_checks").update({ status: "pass", checked_at: now.toISOString(), notes: "VEEC assignment effective" }).eq("job_id", jobId).eq("check_key", "owner_authority");
  await logEvent(jobId, actorId, EV.VEEC_ASSIGNMENT_EFFECTIVE, "VEEC assignment effective – final completed copy generated", { assignment_id: a.id, sha256: hash });
  return r;
}

/** HI VIC internal AP/assignee declaration: all known fields prefilled; admin reviews and signs electronically. */
export async function signApDeclaration(p: { jobId: string; actorId: string; signatureName: string; ip: string | null; userAgent: string | null }) {
  const a = await currentAssignment(p.jobId);
  if (!a) throw new WorkflowError("The customer has not signed yet.");
  if (a.ap_signed_at) throw new WorkflowError("AP declaration already signed.");
  const templates = await loadTemplates();
  const ap = activeTemplate(templates, "ap_declaration");
  if (!ap) throw new WorkflowError("AP sign-off is not ready: approve the current Accredited Person declaration.");
  if (!a.installer_signed_at) throw new WorkflowError("Wait for the installer to finalise and sign first.");
  const now = new Date().toISOString();
  const snap = { declaration: { version: ap.version, body: ap.body }, entity: a.ap_legal_entity, job_id: p.jobId, installed_product: a.installed_product, installed_area_m2: a.installed_area_m2,
    consumer_sha256: a.consumer_snapshot_sha256, installer_sha256: a.installer_snapshot_sha256, signature: { typed_name: p.signatureName, at: now, ip: p.ip, user_agent: p.userAgent, user_id: p.actorId } };
  const hash = await sha256Hex(stableJson(snap));
  await admin.from("customer_assignments").update({ ap_declaration_version: ap.version, ap_details: snap as unknown as Json, ap_signed_at: now, ap_signed_by: p.actorId, ap_signature_name: p.signatureName, ap_snapshot_sha256: hash }).eq("id", a.id);
  await logEvent(p.jobId, p.actorId, "AP_DECLARATION_SIGNED", `HI VIC AP declaration signed (${ap.version})`, { assignment_id: a.id, sha256: hash });
  await evaluateAndApply(p.jobId, p.actorId);
}

export { apDeclarationRequired };
