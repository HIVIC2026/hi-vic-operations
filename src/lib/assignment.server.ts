import { requiredDepositCents } from "./payment-gate.core";
// CENTRAL signing records (server-only, service role, after caller checks):
//   customer_agreements  – Customer Agreement / Quote Acceptance (commercial; unlocks invoice/deposit only)
//   installer_declarations – post-install installer declaration with installed product / R-value / area
//   customer_assignments (record_kind final_veec_assignment) – Activity 48 VEEC assignment prepared after installation
//     with final facts, then signed lead installer -> AP -> consumer. ESC consent: consent.server.ts.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { AP_LEGAL_ENTITY } from "./authority";
import {
  ASSIGNMENT_EVENTS as EV, activeTemplate, agreementSignBlockers, buildFinalFacts, evaluateAssignment, finalAssignmentAvailability, finalConsumerSignatureRequired, formFieldBlockers, materialChanges,
  parseFormFields, pickFieldValues, resolveInstalledDetails, retainUntil, sha256Hex, signingOrderBlocker, stableJson, templateBlockers,
  type AgreementSignInput, type FieldValue, type FinalFacts, type Party, type Snapshot, type Template,
} from "./assignment.core";
import { WorkflowError, logEvent } from "./workflow.server";
import { formatPropertyAddress } from "./address";

export async function loadTemplates(): Promise<Template[]> {
  const { data, error } = await admin.from("compliance_templates").select("template_key, version, body, approved, is_active, required, form_fields, requires_final_consumer_signature").eq("is_active", true);
  if (error) throw new WorkflowError(`Could not read compliance template approvals: ${error.message}`);
  return (data ?? []) as Template[];
}

export async function currentAgreement(jobId: string) {
  const { data } = await admin.from("customer_agreements").select("*").eq("job_id", jobId).eq("status", "signed").maybeSingle();
  return data;
}

/** Final Activity 48 VEEC assignment only (legacy quote-time records never count). */
export async function currentAssignment(jobId: string) {
  const { data } = await admin.from("customer_assignments").select("*").eq("job_id", jobId).eq("record_kind", "final_veec_assignment").neq("status", "cancelled").maybeSingle();
  return data;
}

export async function assignmentEffective(jobId: string) {
  return (await currentAssignment(jobId))?.status === "effective_complete";
}

export async function currentInstallerDeclaration(jobId: string) {
  const { data } = await admin.from("installer_declarations").select("*").eq("job_id", jobId).eq("status", "signed").maybeSingle();
  return data;
}

async function installerFacts(jobId: string) {
  const { data: a } = await admin.from("job_assignments").select("user_id, business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
  if (!a) return { installer_user_id: null, installer_business_id: null, name: null, business: null, abn: null, licence: null };
  const { data: p } = await admin.from("profiles").select("full_name, licence_number, business_id").eq("id", a.user_id).maybeSingle();
  const bid = a.business_id ?? p?.business_id ?? null;
  const { data: b } = bid ? await admin.from("businesses").select("name, abn, licence_number").eq("id", bid).maybeSingle() : { data: null };
  return { installer_user_id: a.user_id as string | null, installer_business_id: bid as string | null, name: p?.full_name ?? null, business: b?.name ?? null, abn: b?.abn ?? null, licence: p?.licence_number ?? b?.licence_number ?? null };
}

/** Everything the customer sees when accepting the quote – built from data we already hold (never re-entered). */
export async function buildAcceptancePackage(quoteId: string) {
  const { data: q } = await admin.from("quotes").select("id, job_id, kind, option_label, option_code, version, subtotal_inc_gst, veec_discount_inc_gst, customer_total_inc_gst, status, quote_items(description, quantity, unit, unit_price_inc_gst, line_total_inc_gst, code, sort)").eq("id", quoteId).single();
  if (!q) throw new WorkflowError("Quote not found");
  const { data: job } = await admin.from("jobs").select("job_number, owners(full_name, email, phone), properties(address_line, suburb, state, postcode)").eq("id", q.job_id).single();
  const { data: m } = await admin.from("ceiling_measurements").select("measured_area_m2").eq("job_id", q.job_id).eq("is_current", true).maybeSingle();
  const { data: rect } = await admin.from("rectification_items").select("description, status").eq("job_id", q.job_id).neq("status", "cancelled");
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
    property_address: formatPropertyAddress(p),
    installer: { user_id: inst.installer_user_id, business_id: inst.installer_business_id, name: inst.name, business: inst.business, abn: inst.abn, licence: inst.licence },
    quoted_product: product, quoted_area_m2: m?.measured_area_m2 != null ? Number(m.measured_area_m2) : null,
    price_before_benefit_inc_gst: Number(q.subtotal_inc_gst), veu_benefit_inc_gst: Number(q.veec_discount_inc_gst), final_customer_price_inc_gst: total,
    rectification_scope: (rect ?? []).map((r) => r.description),
    payment_terms: `One Xero invoice for ${total.toFixed(2)} inc GST. The safety check payment of ${(requiredDepositCents(total) / 100).toFixed(2)} is required before the PIESA is booked. Balance in two halves (install booked / install day) or paid in full.`,
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

async function storeCopy(jobId: string, path: string, text: string, title: string, kind: string, actorId: string | null) {
  path = path.replace(/\.txt$/, ".pdf");
  const { textToPdf } = await import("./signed-pdf.server");
  const up = await admin.storage.from("job-files").upload(path, new Blob([await textToPdf(`Home Insulation Victoria — ${title}`, text) as BlobPart], { type: "application/pdf" }), { contentType: "application/pdf", upsert: false });
  if (up.error) return null;
  await admin.from("documents").insert({ job_id: jobId, kind, title, storage_path: path, mime_type: "application/pdf", uploaded_by: actorId });
  return path;
}

export async function assertAgreementCanSign(input: AgreementSignInput) {
  const b = agreementSignBlockers(input, await loadTemplates());
  if (b.length) throw new WorkflowError(b.join(" "));
}

/** Quote-stage signing: Customer Agreement / Quote Acceptance (commercial) only. It is not ESC consent or VEEC assignment. */
export async function signCustomerAgreement(p: { quoteId: string; actorId: string; input: AgreementSignInput; assistance: "none" | "interpreter" | "support_understanding" | "both"; ip: string | null; userAgent: string | null }) {
  const templates = await loadTemplates();
  const b = agreementSignBlockers(p.input, templates);
  if (b.length) throw new WorkflowError(b.join(" "));
  const pkg = await buildAcceptancePackage(p.quoteId);
  if (await currentAgreement(pkg.job_id)) throw new WorkflowError("A signed customer agreement already exists for this job – use a variation.");
  const rights = activeTemplate(templates, "consumer_rights")!;
  const agreement = activeTemplate(templates, "customer_agreement");
  const now = new Date();
  const snapshot = {
    kind: "customer_agreement_quote_acceptance", package: pkg, snapshot: snapOf(pkg),
    consumer_rights: { version: rights.version, body: rights.body }, agreement_wording: agreement ? { version: agreement.version, body: agreement.body } : null,
    signatory: { name: p.input.signatoryName, authority_type: p.input.authorityType, over_18: p.input.over18, assistance: p.assistance },
    signature: { typed_name: p.input.signatureName, at: now.toISOString(), ip: p.ip, user_agent: p.userAgent, user_id: p.actorId },
    scope_note: "Commercial agreement only. ESC information-sharing consent and the post-installation VEEC assignment are separate later forms.",
  };
  const json = stableJson(snapshot);
  const hash = await sha256Hex(json);
  const copyText = [`CUSTOMER AGREEMENT / QUOTE ACCEPTANCE – ${pkg.ap_legal_entity}`, `Job ${pkg.job_number} · Quote ${pkg.quote.option_label} v${pkg.quote.version}`, snapshot.scope_note, "",
    `Consumer rights information (${rights.version}):`, rights.body, "", ...(agreement ? [`Agreement (${agreement.version}):`, agreement.body, ""] : []),
    `Property: ${pkg.property_address}`, `Signatory: ${p.input.signatoryName} (${p.input.authorityType})`, `Product/scope: ${pkg.quoted_product} · Quoted area: ${pkg.quoted_area_m2 ?? "TBC"} m²`,
    ...(pkg.rectification_scope.length ? [`Approved rectification scope: ${pkg.rectification_scope.join("; ")}`] : []),
    `Price before VEU benefit: ${pkg.price_before_benefit_inc_gst.toFixed(2)} · VEU benefit: ${pkg.veu_benefit_inc_gst.toFixed(2)} · Final price: ${pkg.final_customer_price_inc_gst.toFixed(2)} (inc GST)`,
    pkg.payment_terms, `Installer: ${pkg.installer.name ?? "To be confirmed"} ${pkg.installer.business ? `(${pkg.installer.business})` : ""}`, "",
    `Typed signature: ${p.input.signatureName} · ${now.toISOString()} · IP ${p.ip ?? "unknown"}`, `SHA-256 of signed record: ${hash}`, "", "Machine-readable snapshot:", json].join("\n");
  const path = await storeCopy(pkg.job_id, `${pkg.job_id}/agreement/quote-v${pkg.quote.version}-${hash.slice(0, 12)}.txt`, copyText, "Customer Agreement / Quote Acceptance (signed copy)", "customer_agreement", p.actorId);
  const { data: row, error } = await admin.from("customer_agreements").insert({
    job_id: pkg.job_id, quote_id: pkg.quote.id, quote_version: pkg.quote.version, ap_legal_entity: pkg.ap_legal_entity,
    signatory_name: p.input.signatoryName, signatory_authority_type: p.input.authorityType, signatory_email: pkg.consumer.email, signatory_phone: pkg.consumer.phone,
    signatory_over_18: p.input.over18, assistance_requirement: p.assistance, property_address: pkg.property_address,
    installer_user_id: pkg.installer.user_id, installer_business_id: pkg.installer.business_id, installer_name: pkg.installer.name, installer_business_name: pkg.installer.business,
    quoted_product: pkg.quoted_product, quoted_area_m2: pkg.quoted_area_m2, price_before_benefit_inc_gst: pkg.price_before_benefit_inc_gst, veu_benefit_inc_gst: pkg.veu_benefit_inc_gst,
    final_customer_price_inc_gst: pkg.final_customer_price_inc_gst, payment_terms: pkg.payment_terms, rectification_scope: pkg.rectification_scope as unknown as Json,
    consumer_rights_version: rights.version, agreement_wording_version: agreement?.version ?? null, snapshot: snapshot as unknown as Json, snapshot_sha256: hash,
    signature_name: p.input.signatureName, signed_at: now.toISOString(), signed_by: p.actorId, ip: p.ip, user_agent: p.userAgent, copy_path: path, retain_until: retainUntil(now),
  }).select("id").single();
  if (error || !row) throw new Error(error?.message ?? "Could not record agreement");
  await logEvent(pkg.job_id, p.actorId, EV.CUSTOMER_AGREEMENT_SIGNED, "Customer signed Customer Agreement / Quote Acceptance (commercial)", { agreement_id: row.id, sha256: hash, rights_version: rights.version });
  return row.id;
}

// ---------- Installer declaration (post-install) ----------
export async function signInstallerDecl(p: { jobId: string; actorId: string; asQuotedProduct: boolean; installedProduct?: string | null | undefined; installedRValue?: string | null | undefined; installedArea: number; fieldValues: Record<string, FieldValue>; signatureName: string; ip: string | null; userAgent: string | null }) {
  const { data: job } = await admin.from("jobs").select("installation_completed_at").eq("id", p.jobId).single();
  if (!job?.installation_completed_at) throw new WorkflowError("The installer declaration is signed after the installation is recorded as complete.");
  if (await currentInstallerDeclaration(p.jobId)) throw new WorkflowError("Installer declaration already signed.");
  const agreement = await currentAgreement(p.jobId);
  if (!agreement) throw new WorkflowError("Customer agreement has not been signed.");
  const templates = await loadTemplates();
  const tb = templateBlockers(templates, "installer");
  if (tb.length) throw new WorkflowError(tb.join(" "));
  const decl = activeTemplate(templates, "installer_declaration")!;
  const resolved = resolveInstalledDetails({ asQuotedProduct: p.asQuotedProduct, product: p.installedProduct ?? null, area: p.installedArea }, { product: agreement.quoted_product });
  if ("error" in resolved) throw new WorkflowError(resolved.error);
  const defs = parseFormFields(decl.form_fields);
  const fb = formFieldBlockers(defs, p.fieldValues);
  if (fb.length) throw new WorkflowError(fb.join(" "));
  const fieldValues = pickFieldValues(defs, p.fieldValues);
  const inst = await installerFacts(p.jobId);
  if (inst.installer_user_id !== p.actorId) throw new WorkflowError("Only the assigned installer can sign this declaration.");
  const now = new Date().toISOString();
  const rValue = p.installedRValue?.trim() || (resolved.product.match(/R\s?\d+(\.\d+)?/i)?.[0]?.replace(/\s/g, "") ?? null);
  const snap = { declaration: { version: decl.version, body: decl.body, fields: defs }, installer: inst, installed_as_quoted: p.asQuotedProduct, installed_product: resolved.product, installed_r_value: rValue, installed_area_m2: resolved.area, field_values: fieldValues, signature: { typed_name: p.signatureName, at: now, ip: p.ip, user_agent: p.userAgent, user_id: p.actorId } };
  const hash = await sha256Hex(stableJson(snap));
  const { data: row, error } = await admin.from("installer_declarations").insert({
    job_id: p.jobId, installer_user_id: inst.installer_user_id, installer_business_id: inst.installer_business_id, installer_name: inst.name, installer_business_name: inst.business, installer_abn: inst.abn, installer_licence: inst.licence,
    template_version: decl.version, installed_product: resolved.product, installed_r_value: rValue, installed_area_m2: resolved.area, field_values: fieldValues as unknown as Json,
    snapshot: snap as unknown as Json, snapshot_sha256: hash, signature_name: p.signatureName, signed_at: now, signed_by: p.actorId, ip: p.ip, user_agent: p.userAgent,
  }).select("id").single();
  if (error || !row) throw new Error(error?.message);
  await admin.from("declarations").upsert({ job_id: p.jobId, kind: "installer_declaration", declared_by: p.actorId, statement: `${decl.version}: ${decl.body}`, declared_at: now }, { onConflict: "job_id,kind" });
  await logEvent(p.jobId, p.actorId, EV.INSTALLER_DECLARATION_SIGNED, `Installer declaration signed (${decl.version}) – ${resolved.product}${rValue ? ` ${rValue}` : ""}, ${resolved.area} m²`, { declaration_id: row.id, sha256: hash });
  return row.id;
}

// ---------- Final Activity 48 VEEC assignment (post-install, after AP QA data) ----------
async function computeFinalFacts(jobId: string, fieldValues: Record<string, FieldValue>, templates: Template[]) {
  const agreement = await currentAgreement(jobId);
  const decl = await currentInstallerDeclaration(jobId);
  const { data: job } = await admin.from("jobs").select("job_number, stage, installation_completed_at, owners(full_name, email, phone)").eq("id", jobId).single();
  const { data: reqs } = await admin.from("evidence_requirements").select("label, status").eq("job_id", jobId).eq("required", true);
  const evidenceMissing = (reqs ?? []).filter((r) => !["uploaded", "verified"].includes(r.status)).map((r) => r.label);
  const blockers = finalAssignmentAvailability({ stage: job?.stage ?? "", installationCompleted: !!job?.installation_completed_at, installerDeclared: !!decl, evidenceMissing, agreementSigned: !!agreement, templates });
  // Every official assignment is prepared from completed facts; legacy quote-stage records are retired below.
  const official = activeTemplate(templates, "consumer_declaration");
  const defs = parseFormFields(official?.form_fields);
  const { data: inv } = await admin.from("invoices").select("id, xero_invoice_number, xero_reference, amount_paid, status").eq("job_id", jobId).eq("kind", "installation").maybeSingle();
  const o = job?.owners as unknown as { full_name: string; email: string | null; phone: string | null } | null;
  if (blockers.length || !agreement || !decl || !official) return { blockers, facts: null, agreement, decl, official, defs };
  const known: Record<string, FieldValue> = { completed_date: String(job?.installation_completed_at).slice(0, 10), installed_product: decl.installed_product, r_value: decl.installed_r_value, installed_area_m2: Number(decl.installed_area_m2), installer_name: decl.installer_name, installer_abn: decl.installer_abn, final_customer_price_inc_gst: Number(agreement.final_customer_price_inc_gst), veu_benefit_inc_gst: Number(agreement.veu_benefit_inc_gst) };
  const values = { ...known, ...fieldValues };
  const fb = formFieldBlockers(defs, values);
  if (fb.length) return { blockers: fb, facts: null, agreement, decl, official, defs };
  const facts: FinalFacts = buildFinalFacts({
    job_number: job?.job_number ?? "", ap_legal_entity: agreement.ap_legal_entity, property_address: agreement.property_address ?? "",
    completed_date: String(job?.installation_completed_at).slice(0, 10), installed: [{ product: decl.installed_product, r_value: decl.installed_r_value, area_m2: Number(decl.installed_area_m2) }], zones: (decl.zones as unknown[]) ?? [],
    installer: { user_id: decl.installer_user_id, name: decl.installer_name, business: decl.installer_business_name, abn: decl.installer_abn, licence: decl.installer_licence },
    consumer: { name: o?.full_name ?? agreement.signatory_name, email: o?.email ?? null, phone: o?.phone ?? null },
    final_customer_price_inc_gst: Number(agreement.final_customer_price_inc_gst), veu_benefit_inc_gst: Number(agreement.veu_benefit_inc_gst), price_before_benefit_inc_gst: Number(agreement.price_before_benefit_inc_gst),
    payment: { status: inv?.status ?? null, reference: inv?.xero_invoice_number ?? inv?.xero_reference ?? null, amount_paid: inv?.amount_paid != null ? Number(inv.amount_paid) : null },
    template_version: official.version, form_values: pickFieldValues(defs, values),
  });
  return { blockers: [], facts, agreement, decl, official, defs };
}

/** Admin (AP QA) prepares the final assignment. Changed facts on an unsigned-or-partly-signed record => new version, re-sign. */
export async function prepareFinalAssignment(jobId: string, actorId: string, fieldValues: Record<string, FieldValue> = {}) {
  const templates = await loadTemplates();
  const r = await computeFinalFacts(jobId, fieldValues, templates);
  if (!r.facts || !r.agreement || !r.decl || !r.official) throw new WorkflowError(`Final VEEC assignment not available: ${r.blockers.join(" • ")}`);
  const sha = await sha256Hex(stableJson(r.facts));
  let prev = await currentAssignment(jobId);
  if (prev) {
    if (prev.status === "effective_complete") throw new WorkflowError("The final VEEC assignment is already effective – record a variation instead.");
    if (prev.final_facts_sha256 === sha) return prev.id;
    if (prev.signed_stage === "quote_stage_conditional") {
      await admin.from("customer_assignments").update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: "Superseded by corrected post-install official assignment sequence" }).eq("id", prev.id);
      await logEvent(jobId, actorId, "LEGACY_CONDITIONAL_ASSIGNMENT_RETIRED", "Legacy quote-stage conditional assignment retained as history; current official assignment prepared after installation", { assignment_id: prev.id }, { internal: true });
      prev = null;
    }
    if (prev) {
      await admin.from("customer_assignments").update({ status: "cancelled" }).eq("id", prev.id);
      await logEvent(jobId, actorId, "FINAL_ASSIGNMENT_SUPERSEDED", "Final VEEC assignment facts changed – previous version superseded; all parties must sign again", { assignment_id: prev.id }, { internal: true });
      prev = null;
    }
  }
  const { data: row, error } = await admin.from("customer_assignments").insert({
    job_id: jobId, quote_id: r.agreement.quote_id, quote_version: r.agreement.quote_version, record_kind: "final_veec_assignment", status: "awaiting_installer_signature",
    customer_agreement_id: r.agreement.id, installer_declaration_id: r.decl.id, ap_legal_entity: r.agreement.ap_legal_entity, final_facts: r.facts as unknown as Json, final_facts_sha256: sha, prepared_at: new Date().toISOString(),
    consumer_declaration_version: r.official.version, quoted_product: r.agreement.quoted_product, quoted_area_m2: r.agreement.quoted_area_m2,
    price_before_benefit_inc_gst: r.agreement.price_before_benefit_inc_gst, veu_benefit_inc_gst: r.agreement.veu_benefit_inc_gst, final_customer_price_inc_gst: r.agreement.final_customer_price_inc_gst,
    installer_user_id: r.decl.installer_user_id, installer_business_id: r.decl.installer_business_id, installer_name: r.decl.installer_name, installer_business_name: r.decl.installer_business_name,
    installer_abn: r.decl.installer_abn, installer_licence: r.decl.installer_licence, installer_declaration_version: r.decl.template_version,
    installed_product: r.decl.installed_product, installed_r_value: r.decl.installed_r_value, installed_area_m2: r.decl.installed_area_m2, retain_until: retainUntil(new Date()),
  }).select("id").single();
  if (error || !row) throw new Error(error?.message);
  await logEvent(jobId, actorId, EV.FINAL_ASSIGNMENT_PREPARED, `Final Activity 48 VEEC assignment prepared (${r.official.version}) – signing order: lead installer → AP representative → customer`, { assignment_id: row.id, sha256: sha });
  await evaluateAndApply(jobId, actorId);
  return row.id;
}

/** Signs the final assignment for one party, strictly in order: lead installer -> AP representative -> consumer. */
export async function signFinalAssignment(p: { jobId: string; actorId: string; party: Party; signatureName: string; ip: string | null; userAgent: string | null; signatoryName?: string | undefined; authorityType?: "owner" | "authorised_representative" | undefined; over18?: boolean | undefined }) {
  const a = await currentAssignment(p.jobId);
  if (!a) throw new WorkflowError("The final VEEC assignment has not been prepared yet (it is prepared after installation and AP review).");
  const { count: openVar } = await admin.from("assignment_variations").select("id", { count: "exact", head: true }).eq("assignment_id", a.id).eq("status", "pending");
  const ob = signingOrderBlocker({ status: a.status, installerSigned: !!a.installer_signed_at, apSigned: !!a.ap_signed_at, consumerSigned: !!a.consumer_signed_at, openVariation: (openVar ?? 0) > 0, consumerFinalRequired: a.consumer_final_required, consumerFinalSigned: !!a.consumer_final_signed_at }, p.party);
  if (ob) throw new WorkflowError(ob);
  if (p.signatureName.trim().length < 2) throw new WorkflowError("Type your full name to sign.");
  const templates = await loadTemplates();
  const official = activeTemplate(templates, "consumer_declaration");
  const preparedVersion = (a.final_facts as unknown as FinalFacts | null)?.template_version ?? a.consumer_declaration_version;
  if (!official || official.version !== preparedVersion) throw new WorkflowError("The official assignment form version changed – Home Insulation Victoria must prepare the assignment again.");
  const now = new Date().toISOString();
  const sig = { typed_name: p.signatureName, at: now, ip: p.ip, user_agent: p.userAgent, user_id: p.actorId, facts_sha256: a.final_facts_sha256, form_version: official.version };
  const hash = await sha256Hex(stableJson({ party: p.party, sig, facts: a.final_facts }));
  if (p.party === "installer") {
    if (a.installer_user_id !== p.actorId) throw new WorkflowError("Only the lead installer on this job can sign.");
    await admin.from("customer_assignments").update({ installer_signature_name: p.signatureName, installer_signed_at: now, installer_ip: p.ip, installer_user_agent: p.userAgent, installer_snapshot: sig as unknown as Json, installer_snapshot_sha256: hash }).eq("id", a.id);
  } else if (p.party === "ap") {
    const ap = activeTemplate(templates, "ap_declaration");
    await admin.from("customer_assignments").update({ ap_declaration_version: ap?.version ?? null, ap_details: { ...sig, ap_declaration: ap ? { version: ap.version, body: ap.body } : null } as unknown as Json, ap_signed_at: now, ap_signed_by: p.actorId, ap_signature_name: p.signatureName, ap_snapshot_sha256: hash }).eq("id", a.id);
  } else {
    const { data: isOwner } = await admin.rpc("is_job_owner", { _job: p.jobId, _user: p.actorId });
    if (!isOwner) throw new WorkflowError("Only the customer can sign.");
    if (!p.over18) throw new WorkflowError("Signatory must confirm they are 18 or older.");
    if (!p.signatoryName || p.signatoryName.trim().length < 2) throw new WorkflowError("Signatory name is required.");
    const { data: o } = await admin.from("jobs").select("owners(email, phone)").eq("id", p.jobId).single();
    const oo = o?.owners as unknown as { email: string | null; phone: string | null } | null;
    await admin.from("customer_assignments").update({
      signatory_name: p.signatoryName, signatory_authority_type: p.authorityType ?? "owner", signatory_over_18: true, signatory_email: oo?.email ?? null, signatory_phone: oo?.phone ?? null,
      consumer_signature_name: p.signatureName, consumer_signed_at: now, consumer_signed_by: p.actorId, consumer_ip: p.ip, consumer_user_agent: p.userAgent,
      consumer_snapshot: { ...sig, facts: a.final_facts, form: { version: official.version, body: official.body } } as unknown as Json, consumer_snapshot_sha256: hash,
    }).eq("id", a.id);
  }
  await logEvent(p.jobId, p.actorId, EV.FINAL_ASSIGNMENT_SIGNED, `Final VEEC assignment signed by ${p.party === "ap" ? "AP representative" : p.party === "installer" ? "lead installer" : "customer"}`, { assignment_id: a.id, sha256: hash });
  await evaluateAndApply(p.jobId, p.actorId);
}

async function baselineSnapshot(jobId: string, assignmentId: string): Promise<Snapshot> {
  const { data: v } = await admin.from("assignment_variations").select("proposed_snapshot").eq("assignment_id", assignmentId).eq("status", "reconfirmed").order("reconfirmed_at", { ascending: false }).limit(1).maybeSingle();
  if (v) return v.proposed_snapshot as unknown as Snapshot;
  const ag = await currentAgreement(jobId);
  return (ag?.snapshot as unknown as { snapshot: Snapshot }).snapshot;
}

/** Raises a variation. The signed agreement snapshot is never changed. */
export async function raiseVariation(jobId: string, actorId: string | null, reasons: string[], proposed?: Snapshot) {
  const a = await currentAssignment(jobId);
  if (!a) throw new WorkflowError("No final VEEC assignment on this job yet – correct the facts before it is prepared.");
  if (a.status === "effective_complete") throw new WorkflowError("Assignment already effective – variations can't be raised.");
  const { data: open } = await admin.from("assignment_variations").select("id").eq("assignment_id", a.id).eq("status", "pending").maybeSingle();
  if (open) return open.id;
  const base = proposed ?? (await baselineSnapshot(jobId, a.id));
  const resume = a.status === "variation_required" ? "awaiting_installer_signature" : a.status;
  const { data: v, error } = await admin.from("assignment_variations").insert({ assignment_id: a.id, job_id: jobId, reasons: reasons as unknown as Json, proposed_snapshot: base as unknown as Json, raised_by: actorId, resume_status: resume }).select("id").single();
  if (error || !v) throw new Error(error?.message);
  await admin.from("customer_assignments").update({ status: "variation_required", variation_reasons: reasons as unknown as Json }).eq("id", a.id);
  await admin.from("jobs").update({ next_action: `Customer must reconfirm variation: ${reasons.join(", ")}` }).eq("id", jobId);
  await logEvent(jobId, actorId, EV.ASSIGNMENT_VARIATION_REQUIRED, `Variation required: ${reasons.join(", ")}`, { assignment_id: a.id, variation_id: v.id, reasons });
  return v.id;
}

export async function reconfirmVariation(p: { variationId: string; actorId: string; signatureName: string; ip: string | null; userAgent: string | null; verified?: { channel: string; destination: string } | undefined }) {
  const { data: v } = await admin.from("assignment_variations").select("*").eq("id", p.variationId).single();
  if (!v || v.status !== "pending") throw new WorkflowError("This variation is no longer open.");
  if (p.signatureName.trim().length < 2) throw new WorkflowError("Type your full name to sign.");
  const now = new Date().toISOString();
  const hash = await sha256Hex(stableJson({ proposed: v.proposed_snapshot, reasons: v.reasons, signature: p.signatureName, at: now, ip: p.ip }));
  await admin.from("assignment_variations").update({ status: "reconfirmed", reconfirmed_by: p.actorId, reconfirmed_at: now, signature_name: p.signatureName, ip_address: p.ip, user_agent: p.userAgent, snapshot_sha256: hash }).eq("id", v.id);
  await admin.from("customer_assignments").update({ status: v.resume_status }).eq("id", v.assignment_id);
  const copyText = [`Reconfirmed after a change (variation ${v.id})`, "", "What changed:", ...(v.reasons as string[]).map((r) => `- ${r}`), "", "[x] I reconfirm my VEEC assignment with these changes", `Signed: ${p.signatureName.trim()}`, `Signed at: ${now}`, `Code verified: ${p.verified ? `${p.verified.channel} ${p.verified.destination}` : "signed in"}`, `IP: ${p.ip ?? "—"}`, `sha256 ${hash}`].join("\n");
  await storeCopy(v.job_id, `${v.job_id}/assignment/reconfirm-${v.id}.txt`, copyText, "VEEC assignment reconfirmation (signed copy)", "veec_assignment_reconfirm", p.actorId);
  await logEvent(v.job_id, p.actorId, "ASSIGNMENT_VARIATION_RECONFIRMED", "Customer reconfirmed the variation", { variation_id: v.id, sha256: hash });
  await evaluateAndApply(v.job_id, p.actorId);
}

/** Recomputes the staged status from facts; effective only when every signature and final fact is complete. */
export async function evaluateAndApply(jobId: string, actorId: string | null) {
  const a = await currentAssignment(jobId);
  if (!a) return null;
  const { data: job } = await admin.from("jobs").select("job_number").eq("id", jobId).single();
  const { count: openVar } = await admin.from("assignment_variations").select("id", { count: "exact", head: true }).eq("assignment_id", a.id).eq("status", "pending");
  const templates = await loadTemplates();
  if (a.installer_signed_at && a.ap_signed_at && !a.consumer_signed_at && !(openVar ?? 0)) {
    const applied = await applyAcceptanceAssignment(jobId, actorId, a);
    if (applied) return evaluateAndApply(jobId, actorId);
  }
  const r = evaluateAssignment({
    status: a.status, prepared: !!a.prepared_at && !!a.final_facts, installerSigned: !!a.installer_signed_at, apSigned: !!a.ap_signed_at, consumerSigned: !!a.consumer_signed_at,
    installedProduct: a.installed_product, installedArea: a.installed_area_m2 != null ? Number(a.installed_area_m2) : null, openVariation: (openVar ?? 0) > 0, templates,
    consumerFinalRequired: a.consumer_final_required, consumerFinalSigned: !!a.consumer_final_signed_at,
  });
  if (r.status === a.status) return r;
  if (r.status !== "effective_complete") { await admin.from("customer_assignments").update({ status: r.status }).eq("id", a.id); return r; }
  const now = new Date();
  const f = a.final_facts as unknown as FinalFacts;
  const official = (a.consumer_snapshot as { form?: { body?: string } } | null)?.form?.body ?? "";
  const finalText = [`ACTIVITY 48 VEEC ASSIGNMENT (official form ${a.consumer_declaration_version}) – ${a.ap_legal_entity}`, `Job ${job?.job_number} · effective ${now.toISOString()}`, "", official, "",
    "FINAL FACTS", `Completed: ${f.completed_date} · Property: ${f.property_address}`, ...f.installed.map((x) => `Installed: ${x.product}${x.r_value ? ` (${x.r_value})` : ""} · ${x.area_m2} m²`), `Total installed area: ${f.total_installed_area_m2} m²`,
    `Installer: ${f.installer.name ?? ""} ${f.installer.business ? `(${f.installer.business})` : ""} · ABN ${f.installer.abn ?? "-"}`,
    `Final customer price ${f.final_customer_price_inc_gst.toFixed(2)} inc GST · VEU benefit ${f.veu_benefit_inc_gst.toFixed(2)} · Payment ${f.payment.status ?? "-"} ref ${f.payment.reference ?? "-"}`,
    ...Object.entries(f.form_values).map(([k, v]) => `${k}: ${String(v ?? "—")}`), "",
    "SIGNATURES", `Lead installer: "${a.installer_signature_name}" · ${a.installer_signed_at}`, `AP representative: "${a.ap_signature_name}" · ${a.ap_signed_at}`, `Consumer: ${a.signatory_name} (${a.signatory_authority_type}) "${a.consumer_signature_name}" · ${a.consumer_signed_at} · IP ${a.consumer_ip ?? "unknown"}`, "",
    `Facts sha256 ${a.final_facts_sha256}`, "", "Machine-readable facts:", stableJson(f)].join("\n");
  const hash = await sha256Hex(finalText);
  const path = await storeCopy(jobId, `${jobId}/assignment/final-${hash.slice(0, 12)}.txt`, finalText, "Final Activity 48 VEEC Assignment (signed copy)", "veec_assignment_final", actorId ?? a.consumer_signed_by ?? null);
  const { customerDeliveryState } = await import("./comms.server");
  const delivery = await customerDeliveryState(jobId); // global lock first, then owner contact consent
  await admin.from("customer_assignments").update({ status: "effective_complete", effective_at: now.toISOString(), completed_at: now.toISOString(), final_copy_path: path, final_copy_at: path ? now.toISOString() : null, delivery_status: delivery }).eq("id", a.id);
  await admin.from("compliance_checks").update({ status: "pass", checked_at: now.toISOString(), notes: "Final VEEC assignment effective" }).eq("job_id", jobId).eq("check_key", "owner_authority");
  await logEvent(jobId, actorId, EV.VEEC_ASSIGNMENT_EFFECTIVE, `Final VEEC assignment effective – signed copy stored (customer delivery ${delivery === "pending_comms_lock" ? "pending: communications locked" : delivery === "not_ready" ? "blocked: no owner contact consent" : "ready"})`, { assignment_id: a.id, sha256: hash });
  return r;
}

/**
 * Gate D (Jo, 5 Oct): the owner signed the VEEC assignment at quote acceptance (Gate B). After install, once the lead installer and AP
 * have signed in order, that signature completes the official form — unless facts changed materially (owner reconfirms via a variation)
 * or the "re-sign after install" setting is on (owner signs the completed form). Returns true when the consumer signature was applied.
 */
async function applyAcceptanceAssignment(jobId: string, actorId: string | null, a: NonNullable<Awaited<ReturnType<typeof currentAssignment>>>): Promise<boolean> {
  const { data: ws } = await admin.from("workflow_settings").select("owner_resign_after_install").limit(1).maybeSingle();
  if (ws?.owner_resign_after_install) return false;
  const { data: sig } = await admin.from("owner_gate_signatures").select("id, signatory_name, signed_at, signed_by, ip, user_agent, signed_text, signed_text_sha256, doc_version, method, verified_channel, verified_destination")
    .eq("job_id", jobId).eq("doc_key", "veec_assignment_consent").order("signed_at", { ascending: false }).limit(1).maybeSingle();
  if (!sig) return false;
  const base = await baselineSnapshot(jobId, a.id);
  const f = a.final_facts as unknown as FinalFacts;
  const changes = base ? materialChanges(base, {
    installer_user_id: a.installer_user_id, installer_business_id: a.installer_business_id, product: a.installed_product,
    area_m2: a.installed_area_m2 != null ? Number(a.installed_area_m2) : null, veu_benefit_inc_gst: f?.veu_benefit_inc_gst ?? null, final_customer_price_inc_gst: f?.final_customer_price_inc_gst ?? null,
  }) : [];
  if (changes.length) {
    const { count } = await admin.from("assignment_variations").select("id", { count: "exact", head: true }).eq("assignment_id", a.id).eq("status", "reconfirmed");
    if (!count) { await raiseVariation(jobId, actorId, changes); return false; }
  }
  const templates = await loadTemplates();
  const official = activeTemplate(templates, "consumer_declaration");
  const { data: o } = await admin.from("jobs").select("owners(email, phone)").eq("id", jobId).single();
  const oo = o?.owners as unknown as { email: string | null; phone: string | null } | null;
  const snap = { acceptance_signature_id: sig.id, typed_name: sig.signatory_name, at: sig.signed_at, ip: sig.ip, method: sig.method, verified: sig.verified_channel ? `${sig.verified_channel} ${sig.verified_destination}` : null,
    wording_version: sig.doc_version, signed_text: sig.signed_text, facts_sha256: a.final_facts_sha256, facts: a.final_facts, form: official ? { version: official.version, body: official.body } : null };
  const { error } = await admin.from("customer_assignments").update({
    signatory_name: sig.signatory_name, signatory_authority_type: "owner", signatory_over_18: true, signatory_email: oo?.email ?? null, signatory_phone: oo?.phone ?? null,
    consumer_signature_name: sig.signatory_name, consumer_signed_at: sig.signed_at, consumer_signed_by: sig.signed_by, consumer_ip: sig.ip, consumer_user_agent: sig.user_agent,
    consumer_snapshot: snap as unknown as Json, consumer_snapshot_sha256: await sha256Hex(stableJson(snap)),
  }).eq("id", a.id).is("consumer_signed_at", null);
  if (error) throw new Error(error.message);
  await logEvent(jobId, actorId, EV.FINAL_ASSIGNMENT_SIGNED, "Completed VEEC assignment uses the owner's quote-acceptance assignment (no material change)", { assignment_id: a.id, acceptance_signature_id: sig.id });
  return true;
}
