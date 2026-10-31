// CENTRAL signing records (server-only, service role, after caller checks):
//   customer_agreements  – Customer Agreement / Quote Acceptance (commercial; unlocks invoice/deposit only)
//   installer_declarations – the installer's Mitti PIISA declaration (piisa-declaration.server.ts); the portal path below
//     (signInstallerDecl, DEECA-PIISA-March-2026-DRAFT) is superseded by decision 118a and kept only for history.
//   customer_assignments (record_kind final_veec_assignment) – official ESC VEEC assignment form v1.1 prepared from job
//     facts once the install is recorded complete, signed lead installer -> AP (four prerequisites) -> consumer via the
//     owner's secure link (decisions 119/120). ESC consent: consent.server.ts.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { AP_LEGAL_ENTITY } from "./authority";
import {
  ASSIGNMENT_EVENTS as EV,
  acceptancePaymentTerms,
  activeTemplate,
  agreementSignBlockers,
  buildFinalFacts,
  evaluateAssignment,
  finalAssignmentAvailability,
  finalConsumerSignatureRequired,
  formFieldBlockers,
  materialChanges,
  parseFormFields,
  pickFieldValues,
  resolveInstalledDetails,
  retainUntil,
  sha256Hex,
  signingOrderBlocker,
  stableJson,
  templateBlockers,
  type AgreementSignInput,
  type FieldValue,
  type FinalFacts,
  type Party,
  type Snapshot,
  type Template,
} from "./assignment.core";
import { WorkflowError, logEvent } from "./workflow.server";
import { formatPropertyAddress } from "./address";
import {
  AP_DETAILS,
  AP_PREREQ_EVENTS,
  apPrerequisiteBlockers,
  coPaymentFromQuote,
  veecPrefill,
  type ApPrerequisiteFacts,
  type VeecArea,
  type VeecFacts,
  type VeecInstaller,
} from "./veec-assignment-form.core";
import { melbourneToday } from "./melbourne-time.core";

export async function loadTemplates(): Promise<Template[]> {
  const { data, error } = await admin
    .from("compliance_templates")
    .select(
      "template_key, version, body, approved, is_active, required, form_fields, requires_final_consumer_signature",
    )
    .eq("is_active", true);
  if (error)
    throw new WorkflowError(`Could not read compliance template approvals: ${error.message}`);
  return (data ?? []) as Template[];
}

export async function currentAgreement(jobId: string) {
  const { data } = await admin
    .from("customer_agreements")
    .select("*")
    .eq("job_id", jobId)
    .eq("status", "signed")
    .maybeSingle();
  return data;
}

/** Final Activity 48 VEEC assignment only (legacy quote-time records never count). */
export async function currentAssignment(jobId: string) {
  const { data } = await admin
    .from("customer_assignments")
    .select("*")
    .eq("job_id", jobId)
    .eq("record_kind", "final_veec_assignment")
    .neq("status", "cancelled")
    .maybeSingle();
  return data;
}

export async function assignmentEffective(jobId: string) {
  return (await currentAssignment(jobId))?.status === "effective_complete";
}

export async function currentInstallerDeclaration(jobId: string) {
  const { data } = await admin
    .from("installer_declarations")
    .select("*")
    .eq("job_id", jobId)
    .eq("status", "signed")
    .maybeSingle();
  return data;
}

async function installerFacts(jobId: string) {
  const { data: a } = await admin
    .from("job_assignments")
    .select("user_id, business_id")
    .eq("job_id", jobId)
    .eq("role", "installer")
    .eq("active", true)
    .maybeSingle();
  if (!a)
    return {
      installer_user_id: null,
      installer_business_id: null,
      name: null,
      business: null,
      abn: null,
      licence: null,
    };
  const { data: p } = await admin
    .from("profiles")
    .select("full_name, licence_number, business_id")
    .eq("id", a.user_id)
    .maybeSingle();
  const bid = a.business_id ?? p?.business_id ?? null;
  const { data: b } = bid
    ? await admin.from("businesses").select("name, abn, licence_number").eq("id", bid).maybeSingle()
    : { data: null };
  return {
    installer_user_id: a.user_id as string | null,
    installer_business_id: bid as string | null,
    name: p?.full_name ?? null,
    business: b?.name ?? null,
    abn: b?.abn ?? null,
    licence: p?.licence_number ?? b?.licence_number ?? null,
  };
}

/** Everything the customer sees when accepting the quote – built from data we already hold (never re-entered). */
export async function buildAcceptancePackage(quoteId: string) {
  const { data: q } = await admin
    .from("quotes")
    .select(
      "id, job_id, kind, option_label, option_code, version, subtotal_inc_gst, veec_discount_inc_gst, customer_total_inc_gst, status, quote_items(description, quantity, unit, unit_price_inc_gst, line_total_inc_gst, code, sort)",
    )
    .eq("id", quoteId)
    .single();
  if (!q) throw new WorkflowError("Quote not found");
  const [{ data: job }, { data: m }, { data: rect }, inst] = await Promise.all([
    admin
      .from("jobs")
      .select(
        "job_number, owners(full_name, email, phone), properties(address_line, suburb, state, postcode)",
      )
      .eq("id", q.job_id)
      .single(),
    admin
      .from("ceiling_measurements")
      .select("measured_area_m2")
      .eq("job_id", q.job_id)
      .eq("is_current", true)
      .maybeSingle(),
    admin
      .from("rectification_items")
      .select("description, status")
      .eq("job_id", q.job_id)
      .neq("status", "cancelled"),
    installerFacts(q.job_id),
  ]);
  const o = job?.owners as unknown as {
    full_name: string;
    email: string | null;
    phone: string | null;
  };
  const p = job?.properties as unknown as {
    address_line: string;
    suburb: string | null;
    state: string;
    postcode: string | null;
  };
  const items = [...(q.quote_items ?? [])].sort((a, b) => a.sort - b.sort);
  const product =
    items.find((i) => /insulation|batt|R\d/i.test(i.description))?.description ?? q.option_label;
  const total = Number(q.customer_total_inc_gst);
  return {
    quote: {
      id: q.id,
      version: q.version,
      option_label: q.option_label,
      option_code: q.option_code,
      status: q.status,
      kind: q.kind,
      items,
    },
    job_id: q.job_id,
    job_number: job?.job_number ?? "",
    consumer: { name: o?.full_name ?? "", email: o?.email ?? null, phone: o?.phone ?? null },
    property_address: formatPropertyAddress(p),
    installer: {
      user_id: inst.installer_user_id,
      business_id: inst.installer_business_id,
      name: inst.name,
      business: inst.business,
      abn: inst.abn,
      licence: inst.licence,
    },
    quoted_product: product,
    quoted_area_m2: m?.measured_area_m2 != null ? Number(m.measured_area_m2) : null,
    price_before_benefit_inc_gst: Number(q.subtotal_inc_gst),
    veu_benefit_inc_gst: Number(q.veec_discount_inc_gst),
    final_customer_price_inc_gst: total,
    rectification_scope: (rect ?? []).map((r) => r.description),
    payment_terms: acceptancePaymentTerms(items, total),
    ap_legal_entity: AP_LEGAL_ENTITY,
  };
}
export type AcceptancePackage = Awaited<ReturnType<typeof buildAcceptancePackage>>;

function snapOf(pkg: AcceptancePackage): Snapshot {
  return {
    installer_user_id: pkg.installer.user_id,
    installer_business_id: pkg.installer.business_id,
    product: pkg.quoted_product,
    area_m2: pkg.quoted_area_m2,
    price_before_benefit_inc_gst: pkg.price_before_benefit_inc_gst,
    veu_benefit_inc_gst: pkg.veu_benefit_inc_gst,
    final_customer_price_inc_gst: pkg.final_customer_price_inc_gst,
  };
}

async function storeCopy(
  jobId: string,
  path: string,
  text: string,
  title: string,
  kind: string,
  actorId: string | null,
) {
  path = path.replace(/\.txt$/, ".pdf");
  const { textToPdf } = await import("./signed-pdf.server");
  const up = await admin.storage
    .from("job-files")
    .upload(
      path,
      new Blob([(await textToPdf(`Home Insulation Victoria — ${title}`, text)) as BlobPart], {
        type: "application/pdf",
      }),
      { contentType: "application/pdf", upsert: false },
    );
  if (up.error) return null;
  await admin
    .from("documents")
    .insert({
      job_id: jobId,
      kind,
      title,
      storage_path: path,
      mime_type: "application/pdf",
      uploaded_by: actorId,
    });
  return path;
}

export async function assertAgreementCanSign(input: AgreementSignInput) {
  const b = agreementSignBlockers(input, await loadTemplates());
  if (b.length) throw new WorkflowError(b.join(" "));
}

/** Quote-stage signing: Customer Agreement / Quote Acceptance (commercial) only. It is not ESC consent or VEEC assignment. */
export async function signCustomerAgreement(p: {
  quoteId: string;
  actorId: string;
  input: AgreementSignInput;
  assistance: "none" | "interpreter" | "support_understanding" | "both";
  ip: string | null;
  userAgent: string | null;
}) {
  const templates = await loadTemplates();
  const b = agreementSignBlockers(p.input, templates);
  if (b.length) throw new WorkflowError(b.join(" "));
  const pkg = await buildAcceptancePackage(p.quoteId);
  if (await currentAgreement(pkg.job_id))
    throw new WorkflowError(
      "A signed customer agreement already exists for this job – use a variation.",
    );
  const rights = activeTemplate(templates, "consumer_rights")!;
  const agreement = activeTemplate(templates, "customer_agreement");
  const now = new Date();
  const snapshot = {
    kind: "customer_agreement_quote_acceptance",
    package: pkg,
    snapshot: snapOf(pkg),
    consumer_rights: { version: rights.version, body: rights.body },
    agreement_wording: agreement ? { version: agreement.version, body: agreement.body } : null,
    signatory: {
      name: p.input.signatoryName,
      authority_type: p.input.authorityType,
      over_18: p.input.over18,
      assistance: p.assistance,
    },
    signature: {
      typed_name: p.input.signatureName,
      at: now.toISOString(),
      ip: p.ip,
      user_agent: p.userAgent,
      user_id: p.actorId,
    },
    scope_note:
      "Commercial agreement only. ESC information-sharing consent and the post-installation VEEC assignment are separate later forms.",
  };
  const json = stableJson(snapshot);
  const hash = await sha256Hex(json);
  const copyText = [
    `CUSTOMER AGREEMENT / QUOTE ACCEPTANCE – ${pkg.ap_legal_entity}`,
    `Job ${pkg.job_number} · Quote ${pkg.quote.option_label} v${pkg.quote.version}`,
    snapshot.scope_note,
    "",
    `Consumer rights information (${rights.version}):`,
    rights.body,
    "",
    ...(agreement ? [`Agreement (${agreement.version}):`, agreement.body, ""] : []),
    `Property: ${pkg.property_address}`,
    `Signatory: ${p.input.signatoryName} (${p.input.authorityType})`,
    `Product/scope: ${pkg.quoted_product} · Quoted area: ${pkg.quoted_area_m2 ?? "TBC"} m²`,
    ...(pkg.rectification_scope.length
      ? [`Approved electrical fixes scope: ${pkg.rectification_scope.join("; ")}`]
      : []),
    `Price before VEU benefit: ${pkg.price_before_benefit_inc_gst.toFixed(2)} · VEU benefit: ${pkg.veu_benefit_inc_gst.toFixed(2)} · Final price: ${pkg.final_customer_price_inc_gst.toFixed(2)} (inc GST)`,
    pkg.payment_terms,
    `Installer: ${pkg.installer.name ?? "To be confirmed"} ${pkg.installer.business ? `(${pkg.installer.business})` : ""}`,
    "",
    `Typed signature: ${p.input.signatureName} · ${now.toISOString()} · IP ${p.ip ?? "unknown"}`,
    `SHA-256 of signed record: ${hash}`,
    "",
    "Machine-readable snapshot:",
    json,
  ].join("\n");
  const path = await storeCopy(
    pkg.job_id,
    `${pkg.job_id}/agreement/quote-v${pkg.quote.version}-${hash.slice(0, 12)}.txt`,
    copyText,
    "Customer Agreement / Quote Acceptance (signed copy)",
    "customer_agreement",
    p.actorId,
  );
  const { data: row, error } = await admin
    .from("customer_agreements")
    .insert({
      job_id: pkg.job_id,
      quote_id: pkg.quote.id,
      quote_version: pkg.quote.version,
      ap_legal_entity: pkg.ap_legal_entity,
      signatory_name: p.input.signatoryName,
      signatory_authority_type: p.input.authorityType,
      signatory_email: pkg.consumer.email,
      signatory_phone: pkg.consumer.phone,
      signatory_over_18: p.input.over18,
      assistance_requirement: p.assistance,
      property_address: pkg.property_address,
      installer_user_id: pkg.installer.user_id,
      installer_business_id: pkg.installer.business_id,
      installer_name: pkg.installer.name,
      installer_business_name: pkg.installer.business,
      quoted_product: pkg.quoted_product,
      quoted_area_m2: pkg.quoted_area_m2,
      price_before_benefit_inc_gst: pkg.price_before_benefit_inc_gst,
      veu_benefit_inc_gst: pkg.veu_benefit_inc_gst,
      final_customer_price_inc_gst: pkg.final_customer_price_inc_gst,
      payment_terms: pkg.payment_terms,
      rectification_scope: pkg.rectification_scope as unknown as Json,
      consumer_rights_version: rights.version,
      agreement_wording_version: agreement?.version ?? null,
      snapshot: snapshot as unknown as Json,
      snapshot_sha256: hash,
      signature_name: p.input.signatureName,
      signed_at: now.toISOString(),
      signed_by: p.actorId,
      ip: p.ip,
      user_agent: p.userAgent,
      copy_path: path,
      retain_until: retainUntil(now),
    })
    .select("id")
    .single();
  if (error || !row) throw new Error(error?.message ?? "Could not record agreement");
  await logEvent(
    pkg.job_id,
    p.actorId,
    EV.CUSTOMER_AGREEMENT_SIGNED,
    "Customer signed Customer Agreement / Quote Acceptance (commercial)",
    { agreement_id: row.id, sha256: hash, rights_version: rights.version },
  );
  return row.id;
}

// ---------- Installer declaration (post-install) ----------
export async function signInstallerDecl(p: {
  jobId: string;
  actorId: string;
  asQuotedProduct: boolean;
  installedProduct?: string | null | undefined;
  installedRValue?: string | null | undefined;
  installedArea: number;
  fieldValues: Record<string, FieldValue>;
  signatureName: string;
  ip: string | null;
  userAgent: string | null;
}) {
  const { data: job } = await admin
    .from("jobs")
    .select("installation_completed_at")
    .eq("id", p.jobId)
    .single();
  if (!job?.installation_completed_at)
    throw new WorkflowError(
      "The installer declaration is signed after the installation is recorded as complete.",
    );
  if (await currentInstallerDeclaration(p.jobId))
    throw new WorkflowError("Installer declaration already signed.");
  const agreement = await currentAgreement(p.jobId);
  if (!agreement) throw new WorkflowError("Customer agreement has not been signed.");
  const templates = await loadTemplates();
  const tb = templateBlockers(templates, "installer");
  if (tb.length) throw new WorkflowError(tb.join(" "));
  const decl = activeTemplate(templates, "installer_declaration")!;
  const resolved = resolveInstalledDetails(
    {
      asQuotedProduct: p.asQuotedProduct,
      product: p.installedProduct ?? null,
      area: p.installedArea,
    },
    { product: agreement.quoted_product },
  );
  if ("error" in resolved) throw new WorkflowError(resolved.error);
  const defs = parseFormFields(decl.form_fields);
  const fb = formFieldBlockers(defs, p.fieldValues);
  if (fb.length) throw new WorkflowError(fb.join(" "));
  const fieldValues = pickFieldValues(defs, p.fieldValues);
  const inst = await installerFacts(p.jobId);
  if (inst.installer_user_id !== p.actorId)
    throw new WorkflowError("Only the assigned installer can sign this declaration.");
  const now = new Date().toISOString();
  const rValue =
    p.installedRValue?.trim() ||
    (resolved.product.match(/R\s?\d+(\.\d+)?/i)?.[0]?.replace(/\s/g, "") ?? null);
  const snap = {
    declaration: { version: decl.version, body: decl.body, fields: defs },
    installer: inst,
    installed_as_quoted: p.asQuotedProduct,
    installed_product: resolved.product,
    installed_r_value: rValue,
    installed_area_m2: resolved.area,
    field_values: fieldValues,
    signature: {
      typed_name: p.signatureName,
      at: now,
      ip: p.ip,
      user_agent: p.userAgent,
      user_id: p.actorId,
    },
  };
  const hash = await sha256Hex(stableJson(snap));
  const { data: row, error } = await admin
    .from("installer_declarations")
    .insert({
      job_id: p.jobId,
      installer_user_id: inst.installer_user_id,
      installer_business_id: inst.installer_business_id,
      installer_name: inst.name,
      installer_business_name: inst.business,
      installer_abn: inst.abn,
      installer_licence: inst.licence,
      template_version: decl.version,
      installed_product: resolved.product,
      installed_r_value: rValue,
      installed_area_m2: resolved.area,
      field_values: fieldValues as unknown as Json,
      snapshot: snap as unknown as Json,
      snapshot_sha256: hash,
      signature_name: p.signatureName,
      signed_at: now,
      signed_by: p.actorId,
      ip: p.ip,
      user_agent: p.userAgent,
    })
    .select("id")
    .single();
  if (error || !row) throw new Error(error?.message);
  await admin
    .from("declarations")
    .upsert(
      {
        job_id: p.jobId,
        kind: "installer_declaration",
        declared_by: p.actorId,
        statement: `${decl.version}: ${decl.body}`,
        declared_at: now,
      },
      { onConflict: "job_id,kind" },
    );
  await logEvent(
    p.jobId,
    p.actorId,
    EV.INSTALLER_DECLARATION_SIGNED,
    `Installer declaration signed (${decl.version}) – ${resolved.product}${rValue ? ` ${rValue}` : ""}, ${resolved.area} m²`,
    { declaration_id: row.id, sha256: hash },
  );
  return row.id;
}

// ---------- Official ESC VEEC assignment form v1.1 (post-install; decisions 119/120) ----------

const melbDay = (iso: string | null | undefined) => (iso ? melbourneToday(new Date(iso)) : null);

async function partyFacts(jobId: string, role: "installer" | "electrician") {
  const { data: a } = await admin
    .from("job_assignments")
    .select("user_id, business_id")
    .eq("job_id", jobId)
    .eq("role", role)
    .eq("active", true)
    .maybeSingle();
  if (!a) return null;
  const { data: p } = await admin
    .from("profiles")
    .select("id, email, full_name, licence_number, phone, business_id")
    .eq("id", a.user_id)
    .maybeSingle();
  const bid = a.business_id ?? p?.business_id ?? null;
  const { data: b } = bid
    ? await admin
        .from("businesses")
        .select("id, name, trading_name, abn, licence_number, rec_number, phone, address")
        .eq("id", bid)
        .maybeSingle()
    : { data: null };
  return {
    userId: a.user_id as string,
    businessId: bid as string | null,
    profile: p ?? null,
    business: b ?? null,
  };
}

/** Lead installer + any additional crew named on the signed PIISA, with verified EEC numbers from the business's staff records. */
async function installerRows(
  jobId: string,
): Promise<{ rows: VeecInstaller[]; businessId: string | null; workerIds: (string | null)[] }> {
  const inst = await partyFacts(jobId, "installer");
  if (!inst) return { rows: [], businessId: null, workerIds: [] };
  const [{ data: workers }, { data: certs }, decl] = await Promise.all([
    inst.businessId
      ? admin
          .from("partner_workers")
          .select(
            "id, full_legal_name, email, profile_id, trade_role, approval_status, removed_at, certification",
          )
          .eq("business_id", inst.businessId)
      : Promise.resolve({ data: [] as never[] }),
    admin
      .from("partner_worker_certifications")
      .select("id, status, certificate_number, issuer, worker_id"),
    currentInstallerDeclaration(jobId),
  ]);
  const { staffFromRecords } = await import("./piisa-a3.core");
  const staff = staffFromRecords((workers ?? []) as never, (certs ?? []) as never);
  const company = inst.business?.trading_name ?? inst.business?.name ?? null;
  const phone = inst.business?.phone ?? inst.profile?.phone ?? null;
  const byName = (n: string | null) =>
    n ? (staff.find((s) => s.name.toLowerCase() === n.trim().toLowerCase()) ?? null) : null;
  const answers = ((decl?.snapshot as { official?: { answers?: Record<string, unknown> } } | null)
    ?.official?.answers ?? {}) as Record<string, unknown>;
  const names: { name: string | null; eec: string | null }[] = [];
  const leadName =
    typeof answers["p2.lead"] === "string" && String(answers["p2.lead"]).trim()
      ? String(answers["p2.lead"]).trim()
      : (inst.profile?.full_name ?? null);
  names.push({
    name: leadName,
    eec:
      typeof answers["p2.leadEec"] === "string"
        ? String(answers["p2.leadEec"]).trim() || null
        : null,
  });
  for (let i = 0; i < 3; i++) {
    const n = answers[`p2.addName#${i}`];
    if (typeof n === "string" && n.trim())
      names.push({
        name: n.trim(),
        eec:
          typeof answers[`p2.addEec#${i}`] === "string"
            ? String(answers[`p2.addEec#${i}`]).trim() || null
            : null,
      });
  }
  const rows: VeecInstaller[] = [],
    workerIds: (string | null)[] = [];
  for (const n of names) {
    const w =
      byName(n.name) ??
      (n === names[0]
        ? (staff.find((s) =>
            (workers ?? []).some(
              (pw) =>
                pw.id === s.workerId &&
                (pw.profile_id === inst.userId ||
                  (pw.email && pw.email.toLowerCase() === inst.profile?.email?.toLowerCase())),
            ),
          ) ?? null)
        : null);
    rows.push({
      name: n.name ?? w?.name ?? null,
      company,
      phone,
      eec: w?.eecVerified ? w.eec : n.eec,
    });
    workerIds.push(w?.workerId ?? null);
  }
  return { rows, businessId: inst.businessId, workerIds };
}

/** Section 2 facts, read from the job record. Anything not held stays null (the office completes it; nothing is guessed). */
export async function veecJobFacts(
  jobId: string,
): Promise<{ facts: VeecFacts; businessId: string | null; workerIds: (string | null)[] }> {
  const agreement = await currentAgreement(jobId);
  const [{ data: job }, elec, inst, decl, { data: rect }, { data: esc }, { data: m }] =
    await Promise.all([
      admin
        .from("jobs")
        .select(
          "installation_completed_at, owners(full_name, email, phone), properties(address_line, suburb, state, postcode)",
        )
        .eq("id", jobId)
        .single(),
      partyFacts(jobId, "electrician"),
      installerRows(jobId),
      currentInstallerDeclaration(jobId),
      admin
        .from("rectification_items")
        .select("id")
        .eq("job_id", jobId)
        .neq("status", "cancelled")
        .limit(1),
      admin
        .from("esc_notifications")
        .select("payload_json")
        .eq("job_id", jobId)
        .neq("status", "cancelled")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("ceiling_measurements")
        .select("measured_area_m2, insulation_present, existing_r_value, removal_required")
        .eq("job_id", jobId)
        .eq("is_current", true)
        .maybeSingle(),
    ]);
  const o = job?.owners as unknown as {
    full_name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  const p = job?.properties as unknown as {
    address_line: string;
    suburb: string | null;
    state: string;
    postcode: string | null;
  } | null;
  // CES: the number recorded on the ESC notice (office-entered) or the signed PIESA Part C item; "No" only when no electrical fixes existed.
  const payload = (esc?.payload_json ?? {}) as Record<string, unknown>;
  let cesNumber =
    typeof payload["coes_number"] === "string" && payload["coes_number"].trim()
      ? payload["coes_number"].trim()
      : null;
  if (!cesNumber) {
    const { currentCopy } = await import("./official-forms.server");
    const copy = (await currentCopy(jobId, "piesa").catch(() => ({ copy: null }))).copy;
    const item = copy?.snapshot?.document?.find((d) => d.id === "c.coes");
    const v = item?.value;
    cesNumber = typeof v === "string" && v.trim() ? v.trim() : null;
  }
  const rectification = (rect ?? []).length > 0;
  // Installed product: the office-reviewed product labels (PIISA products) first, else the installer's signed PIISA declaration.
  let areas: VeecArea[] = [];
  const area =
    decl?.installed_area_m2 != null
      ? Number(decl.installed_area_m2)
      : m?.measured_area_m2 != null
        ? Number(m.measured_area_m2)
        : null;
  const existing: VeecArea["existing"] =
    m?.insulation_present === false
      ? "uninsulated"
      : m?.insulation_present === true
        ? "under_insulated"
        : null;
  const existingR = m?.existing_r_value != null ? `R${Number(m.existing_r_value)}` : null;
  const removed = m?.removal_required == null ? null : !!m.removal_required;
  const { reviewedProductAnswers } = await import("./piisa-products.core");
  const { data: prod } = await admin
    .from("evidence_requirements")
    .select(
      "id,job_id,status,verified_by,verified_at,notes,evidence_files(id,job_id,requirement_id,mime_type,uploaded_at,storage_path)",
    )
    .eq("job_id", jobId)
    .eq("category", "product_evidence");
  const reviewed = (prod ?? [])
    .map((r) => {
      try {
        return JSON.parse(r.notes ?? "") as {
          products?: { brand: string; model: string; rValue: number }[];
        };
      } catch {
        return null;
      }
    })
    .find(
      (x) =>
        x &&
        Array.isArray(x.products) &&
        x.products.length &&
        (prod ?? []).some(
          (r) =>
            reviewedProductAnswers({
              jobId,
              requirementId: r.id,
              status: r.status,
              verifiedBy: r.verified_by,
              verifiedAt: r.verified_at,
              notes: r.notes,
              files: r.evidence_files,
            }).blockers.length === 0,
        ),
    );
  const products = reviewed?.products ?? [];
  if (products.length)
    areas = products.map((pr, i) => ({
      name: `Area ${i + 1}`,
      existing,
      existingRValue: existingR,
      removed,
      productType: null,
      brand: pr.brand,
      model: pr.model,
      rValue: `R${pr.rValue}`,
      areaM2: i === 0 ? area : null,
    }));
  else {
    // Decisions 148/149: no reviewed label yet → the product declared on the Mitti form (Jo's six options; all ESC category 48A).
    const { productForHivQuote } = await import("./insulation-product.server");
    const { productBrandModel } = await import("./insulation-product.core");
    const declared = (await productForHivQuote(jobId).catch(() => ({ product: null }))).product;
    const bm = declared ? productBrandModel(declared) : null;
    areas = [
      {
        name: "Area 1",
        existing,
        existingRValue: existingR,
        removed,
        productType: bm ? "48A" : null,
        brand: bm?.brand ?? null,
        model: bm?.model ?? null,
        rValue: decl?.installed_r_value ?? declared?.rValue ?? null,
        areaM2: area,
      },
    ];
  }
  const facts: VeecFacts = {
    ap: {
      fullName: AP_DETAILS.fullName,
      companyName: AP_DETAILS.companyName,
      companyAddress: AP_DETAILS.companyAddress,
      phone: AP_DETAILS.phone,
    },
    electrician: {
      name: elec?.profile?.full_name ?? null,
      phone: elec?.profile?.phone ?? elec?.business?.phone ?? null,
      licence: elec?.profile?.licence_number ?? elec?.business?.licence_number ?? null,
      company: elec?.business?.trading_name ?? elec?.business?.name ?? null,
      companyAddress: elec?.business?.address ?? null,
      recNumber: elec?.business?.rec_number ?? null,
    },
    ces: { issued: cesNumber ? true : rectification ? null : false, number: cesNumber },
    installers: inst.rows,
    installationAddress: formatPropertyAddress(p) || null,
    dateCompleted: melbDay(job?.installation_completed_at),
    areas,
    ...(agreement
      ? coPaymentFromQuote({
          subtotalIncGst: Number(agreement.price_before_benefit_inc_gst),
          customerTotalIncGst: Number(agreement.final_customer_price_inc_gst),
          veecDiscountIncGst: Number(agreement.veu_benefit_inc_gst),
        })
      : { priceBeforeIncentive: null, consumerPaymentAfter: null, benefitAmount: null }),
    consumer: { name: o?.full_name ?? null, phone: o?.phone ?? null, email: o?.email ?? null },
  };
  return { facts, businessId: inst.businessId, workerIds: inst.workerIds };
}

/** Everything the AP declaration (Section 3 Part A) asserts, as recorded facts. */
export async function apPrerequisites(jobId: string): Promise<string[]> {
  const { facts, businessId, workerIds } = await veecJobFacts(jobId);
  const [{ data: book }, { data: dels }, { data: esc }, { data: warranty }, { data: notices }] =
    await Promise.all([
      admin
        .from("bookings")
        .select("scheduled_start")
        .eq("job_id", jobId)
        .eq("kind", "installation")
        .in("status", ["confirmed", "completed"])
        .order("scheduled_start", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin.from("piesa_deliveries").select("recipient, delivered_at").eq("job_id", jobId),
      admin
        .from("esc_notifications")
        .select("sent_at, status")
        .eq("job_id", jobId)
        .in("status", ["sent", "accepted"])
        .not("sent_at", "is", null)
        .order("sent_at")
        .limit(1)
        .maybeSingle(),
      admin
        .from("workflow_events")
        .select("created_at")
        .eq("job_id", jobId)
        .eq("event_type", AP_PREREQ_EVENTS.WARRANTY_COPY_PROVIDED)
        .order("created_at")
        .limit(1)
        .maybeSingle(),
      businessId
        ? admin
            .from("admin_config_events")
            .select("created_at, details")
            .eq("event_type", AP_PREREQ_EVENTS.ESC_COLLECTION_NOTICE_PROVIDED)
            .contains("details", { business_id: businessId })
        : Promise.resolve({ data: [] as { created_at: string; details: unknown }[] }),
    ]);
  const first = (role: string) =>
    (dels ?? [])
      .filter((d) => String(d.recipient).toLowerCase().includes(role))
      .map((d) => d.delivered_at)
      .sort()[0] ?? null;
  // Decision 130: an installer's own acknowledgement (secure link / My business / onboarding) counts, as does an office record.
  const acks = businessId
    ? await (
        await import("./esc-collection-notice.server")
      )
        .businessNoticeStatuses(businessId)
        .catch(() => [])
    : [];
  const ackAt = (workerId: string | null) =>
    acks.find(
      (a) => workerId && a.workerId === workerId && a.state === "acknowledged" && !a.superseded,
    )?.at ?? null;
  const noticeFor = (workerId: string | null) =>
    [
      ackAt(workerId),
      ...(notices ?? [])
        .filter((n) => {
          const w = (n.details as { worker_id?: string | null } | null)?.worker_id ?? null;
          return w == null || w === workerId;
        })
        .map((n) => n.created_at),
    ]
      .filter((x): x is string => !!x)
      .sort()[0] ?? null;
  const f: ApPrerequisiteFacts = {
    installStart: book?.scheduled_start ?? null,
    piesaCopyToInstallerAt: first("installer"),
    piesaCopyToOwnerAt: first("owner"),
    escNotificationSentAt: esc?.sent_at ?? null,
    warrantyCopyProvidedAt: warranty?.created_at ?? null,
    collectionNotices: facts.installers.map((i, n) => ({
      installer: i.name ?? `installer ${n + 1}`,
      providedAt: noticeFor(workerIds[n] ?? null),
    })),
  };
  // G1 (Jo 25 Oct) + decision 321: when no copy is recorded, say which installed product's warranty PDF is not on file (the All done email at install complete — or the completion pack — would have recorded it otherwise).
  if (!f.warrantyCopyProvidedAt)
    f.warrantyProductsNotOnFile = await (
      await import("./product-warranty.server")
    )
      .warrantyGapsFor(jobId)
      .catch(() => []);
  return apPrerequisiteBlockers(f);
}

/** The VEEC form's payment facts: the job's NEWEST installation invoice (batch 3b: a job also has fixes and repeat safety
 *  check invoices, and a re-quote leaves an older installation invoice — never more than one row is read). */
export async function assignmentPaymentFacts(jobId: string) {
  const { data: inv, error } = await admin
    .from("invoices")
    .select("xero_invoice_number, xero_reference, amount_paid, status")
    .eq("job_id", jobId)
    .eq("kind", "installation")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not read the installation invoice: ${error.message}`);
  return {
    status: inv?.status ?? null,
    reference: inv?.xero_invoice_number ?? inv?.xero_reference ?? null,
    amount_paid: inv?.amount_paid != null ? Number(inv.amount_paid) : null,
  };
}

async function computeFinalFacts(
  jobId: string,
  fieldValues: Record<string, FieldValue>,
  templates: Template[],
) {
  const agreement = await currentAgreement(jobId);
  const { data: job } = await admin
    .from("jobs")
    .select("job_number, installation_completed_at")
    .eq("id", jobId)
    .single();
  const official = activeTemplate(templates, "consumer_declaration");
  const blockers = finalAssignmentAvailability({
    installationCompleted: !!job?.installation_completed_at,
    agreementSigned: !!agreement,
    templates,
  });
  const defs = parseFormFields(official?.form_fields);
  if (blockers.length || !agreement || !official)
    return {
      blockers,
      facts: null,
      agreement,
      official,
      defs,
      values: {} as Record<string, FieldValue>,
      missing: [] as string[],
    };
  const { facts: jf } = await veecJobFacts(jobId);
  const { values, missing } = veecPrefill(jf, fieldValues);
  const fb = [
    ...missing.map((m) => `Missing: ${m}`),
    ...formFieldBlockers(defs, values).filter((b) => !missing.some((m) => b.includes(m))),
  ];
  if (fb.length) return { blockers: fb, facts: null, agreement, official, defs, values, missing };
  const payment = await assignmentPaymentFacts(jobId);
  const installed = jf.areas
    .filter((a) => a.areaM2 != null || a.brand)
    .map((a) => ({
      product:
        [a.brand, a.model].filter(Boolean).join(" ") || String(values["area_1_product_type"] ?? ""),
      r_value: a.rValue,
      area_m2: Number(a.areaM2 ?? 0),
    }));
  const lead = jf.installers[0] ?? null;
  const facts: FinalFacts = buildFinalFacts({
    job_number: job?.job_number ?? "",
    ap_legal_entity: agreement.ap_legal_entity,
    property_address: jf.installationAddress ?? agreement.property_address ?? "",
    completed_date: jf.dateCompleted ?? "",
    installed,
    zones: [],
    installer: {
      user_id: agreement.installer_user_id,
      name: lead?.name ?? null,
      business: lead?.company ?? null,
      abn: null,
      licence: lead?.eec ?? null,
    },
    consumer: {
      name: jf.consumer.name ?? agreement.signatory_name,
      email: jf.consumer.email,
      phone: jf.consumer.phone,
    },
    final_customer_price_inc_gst: Number(agreement.final_customer_price_inc_gst),
    veu_benefit_inc_gst: Number(agreement.veu_benefit_inc_gst),
    price_before_benefit_inc_gst: Number(agreement.price_before_benefit_inc_gst),
    payment,
    template_version: official.version,
    form_values: pickFieldValues(defs, values),
  });
  return { blockers: [], facts, agreement, official, defs, values, missing };
}

/** Read-only: the prefilled Section 2 and what still blocks preparing the form (office panel). */
export async function veecPreparation(jobId: string, fieldValues: Record<string, FieldValue> = {}) {
  const templates = await loadTemplates();
  const r = await computeFinalFacts(jobId, fieldValues, templates);
  return { blockers: r.blockers, values: r.values, missing: r.missing, fields: r.defs };
}

/** Prepares the official form from job facts (office, or the lead installer's first signature). Changed facts on an unsigned-or-partly-signed record => new version, re-sign. */
export async function prepareFinalAssignment(
  jobId: string,
  actorId: string,
  fieldValues: Record<string, FieldValue> = {},
) {
  const templates = await loadTemplates();
  const r = await computeFinalFacts(jobId, fieldValues, templates);
  if (!r.facts || !r.agreement || !r.official)
    throw new WorkflowError(`VEEC assignment form not ready: ${r.blockers.join(" • ")}`);
  const sha = await sha256Hex(stableJson(r.facts));
  let prev = await currentAssignment(jobId);
  if (prev) {
    if (prev.status === "effective_complete")
      throw new WorkflowError(
        "The final VEEC assignment is already effective – record a variation instead.",
      );
    if (prev.final_facts_sha256 === sha) return prev.id;
    if (prev.signed_stage === "quote_stage_conditional") {
      await admin
        .from("customer_assignments")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          cancel_reason: "Superseded by corrected post-install official assignment sequence",
        })
        .eq("id", prev.id);
      await logEvent(
        jobId,
        actorId,
        "LEGACY_CONDITIONAL_ASSIGNMENT_RETIRED",
        "Legacy quote-stage conditional assignment retained as history; current official assignment prepared after installation",
        { assignment_id: prev.id },
        { internal: true },
      );
      prev = null;
    }
    if (prev) {
      await admin.from("customer_assignments").update({ status: "cancelled" }).eq("id", prev.id);
      await logEvent(
        jobId,
        actorId,
        "FINAL_ASSIGNMENT_SUPERSEDED",
        "Final VEEC assignment facts changed – previous version superseded; all parties must sign again",
        { assignment_id: prev.id },
        { internal: true },
      );
      prev = null;
    }
  }
  const f = r.facts,
    lead = f.installed[0] ?? null;
  const decl = await currentInstallerDeclaration(jobId);
  const { data: row, error } = await admin
    .from("customer_assignments")
    .insert({
      job_id: jobId,
      quote_id: r.agreement.quote_id,
      quote_version: r.agreement.quote_version,
      record_kind: "final_veec_assignment",
      status: "awaiting_installer_signature",
      customer_agreement_id: r.agreement.id,
      installer_declaration_id: decl?.id ?? null,
      ap_legal_entity: r.agreement.ap_legal_entity,
      final_facts: f as unknown as Json,
      final_facts_sha256: sha,
      prepared_at: new Date().toISOString(),
      consumer_declaration_version: r.official.version,
      quoted_product: r.agreement.quoted_product,
      quoted_area_m2: r.agreement.quoted_area_m2,
      price_before_benefit_inc_gst: r.agreement.price_before_benefit_inc_gst,
      veu_benefit_inc_gst: r.agreement.veu_benefit_inc_gst,
      final_customer_price_inc_gst: r.agreement.final_customer_price_inc_gst,
      installer_user_id: r.agreement.installer_user_id,
      installer_business_id: r.agreement.installer_business_id,
      installer_name: f.installer.name,
      installer_business_name: f.installer.business,
      installer_abn: decl?.installer_abn ?? null,
      installer_licence: f.installer.licence,
      installer_declaration_version: decl?.template_version ?? null,
      installed_product: lead?.product ?? null,
      installed_r_value: lead?.r_value ?? null,
      installed_area_m2: f.total_installed_area_m2,
      retain_until: retainUntil(new Date()),
    })
    .select("id")
    .single();
  if (error || !row) throw new Error(error?.message);
  await logEvent(
    jobId,
    actorId,
    EV.FINAL_ASSIGNMENT_PREPARED,
    `Official VEEC assignment form prepared (${r.official.version}) – signing order: lead installer → AP representative → owner`,
    { assignment_id: row.id, sha256: sha },
  );
  await evaluateAndApply(jobId, actorId);
  return row.id;
}

/** The ONE write for Section 3 Part A (manual office fallback and the automatic signature, decision 271). Conditional on the
 *  signature not being there yet, so the 15-minute tick and the installer-sign hook can never record it twice. Returns false when already signed. */
export async function writeApSignature(p: {
  assignmentId: string;
  templates: Template[];
  officialVersion: string;
  sig: Record<string, unknown>;
  hash: string;
  signatureName: string;
  actorId: string | null;
  method: "manual" | "automatic";
}): Promise<boolean> {
  const { AP_DECLARATION } = await import("./veec-assignment-form.core");
  const ap = activeTemplate(p.templates, "ap_declaration");
  const now = String(p.sig["at"] ?? new Date().toISOString());
  const { data } = await admin
    .from("customer_assignments")
    .update({
      ap_declaration_version: ap?.version ?? p.officialVersion,
      ap_details: {
        ...p.sig,
        part: "Section 3 Part A",
        method: p.method,
        declaration: AP_DECLARATION.replace("<insert name>", p.signatureName.trim()),
        prerequisites_checked_at: now,
      } as unknown as Json,
      ap_signed_at: now,
      ap_signed_by: p.actorId,
      ap_signature_name: p.signatureName.trim(),
      ap_snapshot_sha256: p.hash,
    })
    .eq("id", p.assignmentId)
    .is("ap_signed_at", null)
    .select("id");
  return (data ?? []).length > 0;
}

/** Signs the official form for one party, strictly in order: lead installer (Part B) -> AP representative (Part A) -> consumer (Section 4 Part B). */
export async function signFinalAssignment(p: {
  jobId: string;
  actorId: string;
  party: Party;
  signatureName: string;
  ip: string | null;
  userAgent: string | null;
  signatoryName?: string | undefined;
  authorityType?: "owner" | "authorised_representative" | undefined;
  over18?: boolean | undefined;
  confirmsSection2?: boolean | undefined;
}) {
  let a = await currentAssignment(p.jobId);
  if (!a && p.party === "installer") {
    // The lead installer's signature is the first step: prepare the form from job facts on the spot (decision 119).
    try {
      await prepareFinalAssignment(p.jobId, p.actorId, {});
    } catch (e) {
      throw new WorkflowError(
        `The form can't be signed yet – Home Insulation Victoria must finish it first. ${(e as Error).message}`,
      );
    }
    a = await currentAssignment(p.jobId);
  }
  if (!a)
    throw new WorkflowError(
      "The VEEC assignment form has not been prepared yet (it is prepared once the installation is recorded complete).",
    );
  const { count: openVar } = await admin
    .from("assignment_variations")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", a.id)
    .eq("status", "pending");
  const ob = signingOrderBlocker(
    {
      status: a.status,
      installerSigned: !!a.installer_signed_at,
      apSigned: !!a.ap_signed_at,
      consumerSigned: !!a.consumer_signed_at,
      openVariation: (openVar ?? 0) > 0,
      consumerFinalRequired: a.consumer_final_required,
      consumerFinalSigned: !!a.consumer_final_signed_at,
    },
    p.party,
  );
  if (ob) throw new WorkflowError(ob);
  if (p.signatureName.trim().length < 2) throw new WorkflowError("Type your full name to sign.");
  const templates = await loadTemplates();
  const official = activeTemplate(templates, "consumer_declaration");
  const preparedVersion =
    (a.final_facts as unknown as FinalFacts | null)?.template_version ??
    a.consumer_declaration_version;
  if (!official || official.version !== preparedVersion)
    throw new WorkflowError(
      "The official assignment form version changed – Home Insulation Victoria must prepare the assignment again.",
    );
  const now = new Date().toISOString();
  const sig = {
    typed_name: p.signatureName,
    at: now,
    ip: p.ip,
    user_agent: p.userAgent,
    user_id: p.actorId,
    facts_sha256: a.final_facts_sha256,
    form_version: official.version,
  };
  const hash = await sha256Hex(stableJson({ party: p.party, sig, facts: a.final_facts }));
  if (p.party === "installer") {
    if (a.installer_user_id !== p.actorId)
      throw new WorkflowError("Only the lead installer on this job can sign.");
    const { INSTALLER_DECLARATION } = await import("./veec-assignment-form.core");
    await admin
      .from("customer_assignments")
      .update({
        installer_signature_name: p.signatureName,
        installer_signed_at: now,
        installer_ip: p.ip,
        installer_user_agent: p.userAgent,
        installer_snapshot: {
          ...sig,
          part: "Section 3 Part B",
          declaration: INSTALLER_DECLARATION,
        } as unknown as Json,
        installer_snapshot_sha256: hash,
      })
      .eq("id", a.id);
  } else if (p.party === "ap") {
    // Manual fallback (decision 271: Part A normally signs itself from veec-ap-auto.server.ts) — same prerequisites, same write.
    const pre = await apPrerequisites(p.jobId);
    if (pre.length)
      throw new WorkflowError(`The AP declaration can't be signed yet: ${pre.join(" ")}`);
    const written = await writeApSignature({
      assignmentId: a.id,
      templates,
      officialVersion: official.version,
      sig,
      hash,
      signatureName: p.signatureName,
      actorId: p.actorId,
      method: "manual",
    });
    if (!written) throw new WorkflowError("The AP representative signature was already recorded.");
  } else {
    const { data: isOwner } = await admin.rpc("is_job_owner", { _job: p.jobId, _user: p.actorId });
    if (!isOwner) throw new WorkflowError("Only the customer can sign.");
    if (!p.over18) throw new WorkflowError("Signatory must confirm they are 18 or older.");
    if (p.confirmsSection2 === false)
      throw new WorkflowError(
        "Please confirm the installation details in Section 2 are correct before signing.",
      );
    if (!p.signatoryName || p.signatoryName.trim().length < 2)
      throw new WorkflowError("Signatory name is required.");
    const { data: o } = await admin
      .from("jobs")
      .select("owners(email, phone)")
      .eq("id", p.jobId)
      .single();
    const oo = o?.owners as unknown as { email: string | null; phone: string | null } | null;
    await admin
      .from("customer_assignments")
      .update({
        signatory_name: p.signatoryName,
        signatory_authority_type: p.authorityType ?? "owner",
        signatory_over_18: true,
        signatory_email: oo?.email ?? null,
        signatory_phone: oo?.phone ?? null,
        consumer_signature_name: p.signatureName,
        consumer_signed_at: now,
        consumer_signed_by: p.actorId,
        consumer_ip: p.ip,
        consumer_user_agent: p.userAgent,
        consumer_snapshot: {
          ...sig,
          part: "Section 4 Part B",
          facts: a.final_facts,
          form: { version: official.version, body: official.body },
        } as unknown as Json,
        consumer_snapshot_sha256: hash,
      })
      .eq("id", a.id);
  }
  await logEvent(
    p.jobId,
    p.actorId,
    EV.FINAL_ASSIGNMENT_SIGNED,
    `VEEC assignment form signed by ${p.party === "ap" ? "AP representative (Section 3 Part A)" : p.party === "installer" ? "lead installer (Section 3 Part B)" : "owner (Section 4 Part B)"}`,
    { assignment_id: a.id, sha256: hash, party: p.party },
  );
  await evaluateAndApply(p.jobId, p.actorId);
}

async function baselineSnapshot(jobId: string, assignmentId: string): Promise<Snapshot> {
  const { data: v } = await admin
    .from("assignment_variations")
    .select("proposed_snapshot")
    .eq("assignment_id", assignmentId)
    .eq("status", "reconfirmed")
    .order("reconfirmed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (v) return v.proposed_snapshot as unknown as Snapshot;
  const ag = await currentAgreement(jobId);
  return (ag?.snapshot as unknown as { snapshot: Snapshot }).snapshot;
}

/** Raises a variation. The signed agreement snapshot is never changed. */
export async function raiseVariation(
  jobId: string,
  actorId: string | null,
  reasons: string[],
  proposed?: Snapshot,
) {
  const a = await currentAssignment(jobId);
  if (!a)
    throw new WorkflowError(
      "No final VEEC assignment on this job yet – correct the facts before it is prepared.",
    );
  if (a.status === "effective_complete")
    throw new WorkflowError("Assignment already effective – variations can't be raised.");
  const { data: open } = await admin
    .from("assignment_variations")
    .select("id")
    .eq("assignment_id", a.id)
    .eq("status", "pending")
    .maybeSingle();
  if (open) return open.id;
  const base = proposed ?? (await baselineSnapshot(jobId, a.id));
  const resume = a.status === "variation_required" ? "awaiting_installer_signature" : a.status;
  const { data: v, error } = await admin
    .from("assignment_variations")
    .insert({
      assignment_id: a.id,
      job_id: jobId,
      reasons: reasons as unknown as Json,
      proposed_snapshot: base as unknown as Json,
      raised_by: actorId,
      resume_status: resume,
    })
    .select("id")
    .single();
  if (error || !v) throw new Error(error?.message);
  await admin
    .from("customer_assignments")
    .update({ status: "variation_required", variation_reasons: reasons as unknown as Json })
    .eq("id", a.id);
  await admin
    .from("jobs")
    .update({ next_action: `Customer must reconfirm variation: ${reasons.join(", ")}` })
    .eq("id", jobId);
  await logEvent(
    jobId,
    actorId,
    EV.ASSIGNMENT_VARIATION_REQUIRED,
    `Variation required: ${reasons.join(", ")}`,
    { assignment_id: a.id, variation_id: v.id, reasons },
  );
  return v.id;
}

export async function reconfirmVariation(p: {
  variationId: string;
  actorId: string;
  signatureName: string;
  ip: string | null;
  userAgent: string | null;
  verified?: { channel: string; destination: string } | undefined;
}) {
  const { data: v } = await admin
    .from("assignment_variations")
    .select("*")
    .eq("id", p.variationId)
    .single();
  if (!v || v.status !== "pending") throw new WorkflowError("This variation is no longer open.");
  if (p.signatureName.trim().length < 2) throw new WorkflowError("Type your full name to sign.");
  const now = new Date().toISOString();
  const hash = await sha256Hex(
    stableJson({
      proposed: v.proposed_snapshot,
      reasons: v.reasons,
      signature: p.signatureName,
      at: now,
      ip: p.ip,
    }),
  );
  await admin
    .from("assignment_variations")
    .update({
      status: "reconfirmed",
      reconfirmed_by: p.actorId,
      reconfirmed_at: now,
      signature_name: p.signatureName,
      ip_address: p.ip,
      user_agent: p.userAgent,
      snapshot_sha256: hash,
    })
    .eq("id", v.id);
  await admin
    .from("customer_assignments")
    .update({ status: v.resume_status })
    .eq("id", v.assignment_id);
  const copyText = [
    `Reconfirmed after a change (variation ${v.id})`,
    "",
    "What changed:",
    ...(v.reasons as string[]).map((r) => `- ${r}`),
    "",
    "[x] I reconfirm my VEEC assignment with these changes",
    `Signed: ${p.signatureName.trim()}`,
    `Signed at: ${now}`,
    `Code verified: ${p.verified ? `${p.verified.channel} ${p.verified.destination}` : "signed in"}`,
    `IP: ${p.ip ?? "—"}`,
    `sha256 ${hash}`,
  ].join("\n");
  await storeCopy(
    v.job_id,
    `${v.job_id}/assignment/reconfirm-${v.id}.txt`,
    copyText,
    "VEEC assignment reconfirmation (signed copy)",
    "veec_assignment_reconfirm",
    p.actorId,
  );
  await logEvent(
    v.job_id,
    p.actorId,
    "ASSIGNMENT_VARIATION_RECONFIRMED",
    "Customer reconfirmed the variation",
    { variation_id: v.id, sha256: hash },
  );
  await evaluateAndApply(v.job_id, p.actorId);
}

/** Recomputes the staged status from facts; effective only when every signature and final fact is complete.
 *  Decision 119: the owner's Gate B consent-to-assign is never applied as the form signature – the owner signs Section 4 Part B. */
export async function evaluateAndApply(jobId: string, actorId: string | null) {
  const a = await currentAssignment(jobId);
  if (!a) return null;
  const { data: job } = await admin.from("jobs").select("job_number").eq("id", jobId).single();
  const { count: openVar } = await admin
    .from("assignment_variations")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", a.id)
    .eq("status", "pending");
  const templates = await loadTemplates();
  const r = evaluateAssignment({
    status: a.status,
    prepared: !!a.prepared_at && !!a.final_facts,
    installerSigned: !!a.installer_signed_at,
    apSigned: !!a.ap_signed_at,
    consumerSigned: !!a.consumer_signed_at,
    installedProduct: a.installed_product,
    installedArea: a.installed_area_m2 != null ? Number(a.installed_area_m2) : null,
    openVariation: (openVar ?? 0) > 0,
    templates,
    consumerFinalRequired: a.consumer_final_required,
    consumerFinalSigned: !!a.consumer_final_signed_at,
  });
  if (r.status === a.status) return r;
  if (r.status !== "effective_complete") {
    await admin.from("customer_assignments").update({ status: r.status }).eq("id", a.id);
    return r;
  }
  const now = new Date();
  const f = a.final_facts as unknown as FinalFacts;
  const official = (a.consumer_snapshot as { form?: { body?: string } } | null)?.form?.body ?? "";
  const { veecFormRows } = await import("./veec-assignment-form.core");
  const finalText = [
    `ACTIVITY 48 VEEC ASSIGNMENT (official form ${a.consumer_declaration_version}) – ${a.ap_legal_entity}`,
    `Job ${job?.job_number} · effective ${now.toISOString()}`,
    "",
    official,
    "",
    "SECTION 2: ACTIVITY AND PERSONNEL DETAILS",
    ...veecFormRows(f.form_values).map((r) => `${r.label}: ${r.value}`),
    "",
    "FINAL FACTS",
    `Completed: ${f.completed_date} · Property: ${f.property_address}`,
    ...f.installed.map(
      (x) => `Installed: ${x.product}${x.r_value ? ` (${x.r_value})` : ""} · ${x.area_m2} m²`,
    ),
    `Total installed area: ${f.total_installed_area_m2} m²`,
    `Lead installer: ${f.installer.name ?? ""} ${f.installer.business ? `(${f.installer.business})` : ""} · EEC ${f.installer.licence ?? "-"}`,
    `Final customer price ${f.final_customer_price_inc_gst.toFixed(2)} inc GST · VEU benefit ${f.veu_benefit_inc_gst.toFixed(2)} · Payment ${f.payment.status ?? "-"} ref ${f.payment.reference ?? "-"}`,
    "",
    "SIGNATURES",
    `Lead installer (Section 3 Part B): "${a.installer_signature_name}" · ${a.installer_signed_at}`,
    `AP representative (Section 3 Part A): "${a.ap_signature_name}" · ${a.ap_signed_at}`,
    `Consumer (Section 4 Part B): ${a.signatory_name} (${a.signatory_authority_type}) "${a.consumer_signature_name}" · ${a.consumer_signed_at} · IP ${a.consumer_ip ?? "unknown"}`,
    "",
    `Facts sha256 ${a.final_facts_sha256}`,
    "",
    "Machine-readable facts:",
    stableJson(f),
  ].join("\n");
  const hash = await sha256Hex(finalText);
  const path = await storeCopy(
    jobId,
    `${jobId}/assignment/final-${hash.slice(0, 12)}.txt`,
    finalText,
    "Final Activity 48 VEEC Assignment (signed copy)",
    "veec_assignment_final",
    actorId ?? a.consumer_signed_by ?? null,
  );
  const { customerDeliveryState } = await import("./comms.server");
  const delivery = await customerDeliveryState(jobId); // global lock first, then owner contact consent
  await admin
    .from("customer_assignments")
    .update({
      status: "effective_complete",
      effective_at: now.toISOString(),
      completed_at: now.toISOString(),
      final_copy_path: path,
      final_copy_at: path ? now.toISOString() : null,
      delivery_status: delivery,
    })
    .eq("id", a.id);
  await admin
    .from("compliance_checks")
    .update({
      status: "pass",
      checked_at: now.toISOString(),
      notes: "Final VEEC assignment effective",
    })
    .eq("job_id", jobId)
    .eq("check_key", "owner_authority");
  await logEvent(
    jobId,
    actorId,
    EV.VEEC_ASSIGNMENT_EFFECTIVE,
    `Final VEEC assignment effective – signed copy stored (customer delivery ${delivery === "pending_comms_lock" ? "pending: communications locked" : delivery === "not_ready" ? "blocked: no owner contact consent" : "ready"})`,
    { assignment_id: a.id, sha256: hash },
  );
  // Copy to the consumer within 10 business days: sent by the signing entry points / tick (veec-copy-email.server.ts),
  // never from here — this module sits in the autoAdvanceJob import graph, which must hold no sender.
  return r;
}
