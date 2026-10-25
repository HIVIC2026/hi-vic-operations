// Owner paperwork gates — persistence. Facts in, pure evaluator (owner-gates.core) out. Server-only.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { SAFETY_CHECK_FEE_DEFAULT } from "./payment-gate.core";
import { paymentPlan, toCents } from "./payments.core";
import { GATE_DOCS, RETIRED_DOC_KEYS, paymentTermsMoney, paymentTermsText, type PaymentMoney, answerVars, evaluateOwnerGates, installerVisitFromSiteCheck, fillTemplate, gateDoc, ownerGateBlockers, ownerToSign, quoteAcceptanceReady, type GateDocKey, type GateFacts, type GateResult } from "./owner-gates.core";
import { agreementSigned, assignmentStatus, logEvent, WorkflowError } from "./workflow.server";

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Approved versions: an approval only counts when it matches the catalogue's exact version AND body. */
export async function approvedVersions(): Promise<Record<string, string>> {
  const { data } = await admin.from("owner_paperwork_approvals").select("doc_key, doc_version, body_sha256");
  const out: Record<string, string> = {};
  for (const d of GATE_DOCS) {
    const h = await sha256(d.body);
    if ((data ?? []).some((a) => a.doc_key === d.key && a.doc_version === d.version && a.body_sha256 === h)) out[d.key] = d.version;
  }
  return out;
}

export async function gateFacts(jobId: string): Promise<GateFacts> {
  const [{ data: job, error: jobError }, { data: sigs }, approved, { data: quotes }, agreed, { data: tpl }, { data: esc }, { data: dels }, assign] = await Promise.all([
    admin.from("jobs").select("source, life_support, installer_site_check").eq("id", jobId).single(),
    admin.from("owner_gate_signatures").select("doc_key, doc_version, doc_draft, answers, signed_at").eq("job_id", jobId).order("signed_at"),
    approvedVersions(),
    admin.from("quotes").select("id").eq("job_id", jobId).eq("kind", "installation").in("status", ["issued", "accepted"]).limit(1),
    agreementSigned(jobId),
    admin.from("compliance_templates").select("template_key").in("template_key", ["customer_agreement", "consumer_rights"]).eq("approved", true).eq("is_active", true),
    admin.from("owner_esc_consents").select("id").eq("job_id", jobId).not("owner_signed_at", "is", null).limit(1),
    admin.from("piesa_deliveries").select("recipient").eq("job_id", jobId),
    assignmentStatus(jobId),
  ]);
  if (jobError) throw new WorkflowError("The job visit details could not load. Please retry.");
  if (!job) throw new WorkflowError("The saved job could not be found. Please retry or contact the office.");
  const { count: onsite } = await admin.from("owner_contact_consents").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("source", "onsite_ready_check").eq("consent_status", "granted");
  const latest = (k: string) => (sigs ?? []).filter((s) => s.doc_key === k).at(-1)?.answers as Record<string, unknown> | undefined;
  const keys = new Set((tpl ?? []).map((t) => t.template_key));
  return {
    isTest: job?.source === "qa_test",
    signed: (sigs ?? []).map((s) => ({ key: s.doc_key, version: s.doc_version, draft: s.doc_draft })),
    approved,
    tenant: latest("details_confirmation")?.["role"] === "tenant",
    lifeSupport: !!job?.life_support || latest("life_support_answer")?.["life_support"] === "yes",
    visitedByInstaller: installerVisitFromSiteCheck(job.installer_site_check),
    hasQuote: (quotes ?? []).length > 0,
    agreementSigned: agreed,
    agreementWordingApproved: keys.has("customer_agreement") && keys.has("consumer_rights"),
    escConsentSigned: (esc ?? []).length > 0,
    piesaCopyDelivered: (dels ?? []).some((d) => String(d.recipient).toLowerCase().includes("owner")),
    piesaDeclarationMappingApproved: !!approved["piesa_owner_declaration"],
    assignmentEffective: assign === "effective_complete",
    onsiteConsent: (onsite ?? 0) > 0,
  };
}

export async function ownerGates(jobId: string): Promise<{ facts: GateFacts; gates: GateResult[] }> {
  const facts = await gateFacts(jobId);
  return { facts, gates: evaluateOwnerGates(facts) };
}

export async function ownerGateStageBlockers(jobId: string, to: string): Promise<string[]> {
  return ownerGateBlockers((await ownerGates(jobId)).gates, to);
}

/** Gate A must be complete before any trade is offered the job or sees the owner's details. */
export async function assertGateA(jobId: string, what: string) {
  const a = (await ownerGates(jobId)).gates.find((g) => g.gate === "A")!;
  if (!a.complete) throw new WorkflowError(`${what} can't start yet. ${a.blockers.join(" ")}`);
}
export async function gateAComplete(jobId: string) {
  return (await ownerGates(jobId)).gates.find((g) => g.gate === "A")!.complete;
}

async function jobVars(jobId: string) {
  const { data: j } = await admin.from("jobs").select("job_number, properties(address_line, suburb, postcode), owners(id, full_name, email, phone)").eq("id", jobId).single();
  const p = j?.properties as { address_line: string | null; suburb: string | null; postcode: string | null } | null;
  const o = j?.owners as { id: string; full_name: string | null; email: string | null; phone: string | null } | null;
  const { data: inst } = await admin.from("job_assignments").select("businesses(name)").eq("job_id", jobId).eq("role", "installer").eq("active", true).limit(1).maybeSingle();
  const money = await paymentMoney(jobId);
  return { jobNumber: j?.job_number ?? "", ownerId: o?.id ?? null, money, vars: {
    owner: o?.full_name, email: o?.email, phone: o?.phone,
    address: [p?.address_line, p?.suburb, p?.postcode].filter(Boolean).join(", "),
    installer: (inst?.businesses as { name: string } | null)?.name ?? "your installer",
    total: money?.total, quote_version: money?.version,
  } as Record<string, string | null | undefined> };
}

/** Step B money from the current installation quote: the same `paymentPlan()` the payment steps charge (decision 365). */
async function paymentMoney(jobId: string): Promise<(PaymentMoney & { version: string }) | undefined> {
  const [{ data: q }, { data: ws }] = await Promise.all([
    admin.from("quotes").select("id, customer_total_inc_gst, version").eq("job_id", jobId).eq("kind", "installation").in("status", ["issued", "accepted"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("workflow_settings").select("safety_check_payment_inc_gst" as never).eq("id", 1).maybeSingle(),
  ]);
  if (!q) return undefined;
  // Decision 302: the quote's PIESA line is the upfront amount; the setting (default $349) only when the quote has none.
  const setting = Number((ws as { safety_check_payment_inc_gst?: number } | null)?.safety_check_payment_inc_gst ?? SAFETY_CHECK_FEE_DEFAULT);
  const fee = (await (await import("./safety-check-amount.server")).quoteSafetyCheck(q.id, setting)).incGst;
  const plan = paymentPlan({ quoteTotalCents: toCents(q.customer_total_inc_gst), safetyCheckCents: toCents(fee) });
  return { ...paymentTermsMoney(plan), version: String(q.version ?? "") };
}

/** What the owner still needs to sign now, with the exact text they would sign. */
export async function ownerPaperworkToSign(jobId: string) {
  const { facts, gates } = await ownerGates(jobId);
  const { vars, money } = await jobVars(jobId);
  const quoteReady = quoteAcceptanceReady(vars);
  const todo = ownerToSign(gates).filter((t) => t.gate === "A" || (t.gate === "B" && facts.hasQuote && quoteReady) || (t.gate === "C" && facts.agreementSigned));
  const { data: pv } = await admin.from("assignment_variations").select("id, reasons").eq("job_id", jobId).eq("status", "pending").order("raised_at", { ascending: false }).limit(1).maybeSingle();
  return {
    pendingVariation: pv ? { id: pv.id, reasons: (Array.isArray(pv.reasons) ? pv.reasons : []).map(String) } : null,
    gates: gates.filter((g) => g.gate !== "A").map((g) => ({ gate: g.gate, label: g.label, complete: g.complete, items: g.items })),
    todo: todo.map((t) => { const d = gateDoc(t.key); return { gate: t.gate, key: t.key, title: d.title, tick: d.tick, version: d.version, draft: !facts.approved[t.key], text: t.key === "payment_terms" && money ? paymentTermsText(money) : fillTemplate(d.body, vars) }; }),
    isTest: facts.isTest,
  };
}

const ANSWERS: Partial<Record<GateDocKey, (a: Record<string, string>) => string | null>> = {
  details_confirmation: (a) => (["owner", "tenant", "buying", "other"].includes(a["role"] ?? "") ? null : "Tell us who owns the home."),
  life_support_answer: (a) => (["yes", "no"].includes(a["life_support"] ?? "") ? null : "Please answer the life support question."),
  tenancy_details: (a) => ((a["landlord_name"] ?? "").trim().length >= 2 && ((a["landlord_phone"] ?? "").trim().length >= 6 || /@/.test(a["landlord_email"] ?? "")) ? null : "Add your landlord or agent's name and phone or email."),
};

export type SignInput = { jobId: string; key: GateDocKey; signatoryName: string; ticked: boolean; answers: Record<string, string>;
  method: "link_code" | "login" | "office"; signedBy: string | null; ip: string | null; userAgent: string | null;
  verified?: { channel: "sms" | "email"; destination: string; codeId: string } };

/** Records one signed document: exact text, version, identity, IP; files a PDF copy; queues the owner's emailed copy. */
export async function signGateDoc(i: SignInput) {
  const d = gateDoc(i.key);
  if (!i.ticked) throw new WorkflowError("Please tick the box to sign.");
  if (i.signatoryName.trim().length < 2) throw new WorkflowError("Please type your full name.");
  if (d.signer === "office" && i.method !== "office") throw new WorkflowError("The office records this one.");
  if (d.signer === "owner" && i.method === "office") throw new WorkflowError("Only the owner can sign this.");
  const bad = ANSWERS[i.key]?.(i.answers);
  if (bad) throw new WorkflowError(bad);
  const { facts } = await ownerGates(i.jobId);
  const draft = facts.approved[i.key] !== d.version;
  if (draft && !facts.isTest) throw new WorkflowError(`"${d.title}" is still DRAFT wording. It can be signed on real jobs once Jo approves it.`);
  const { vars, jobNumber, ownerId, money } = await jobVars(i.jobId);
  // Decision 365: one plain statement of the payment steps — no option to choose; the amounts come from the quote.
  if (i.key === "payment_terms" && !money) throw new WorkflowError("Your quote isn't ready yet, so the payment amounts can't be shown. Please try again shortly.");
  const text = fillTemplate(d.body, { ...vars, ...answerVars(i.answers, money) });
  const signedText = `${d.title} (version ${d.version}${draft ? ", DRAFT" : ""})\n\n${text}\n\n[x] ${d.tick}\nSigned: ${i.signatoryName.trim()}${d.gate === "B" ? (await import("./owner-confirm.core")).signedSummaryNote() : ""}`;
  const { data: row, error } = await admin.from("owner_gate_signatures").insert({
    job_id: i.jobId, gate: d.gate, doc_key: d.key, doc_version: d.version, doc_draft: draft, signed_text: signedText, signed_text_sha256: await sha256(signedText),
    answers: i.answers, signatory_name: i.signatoryName.trim(), ticked: true, method: i.method, signed_by: i.signedBy,
    verified_channel: i.verified?.channel ?? null, verified_destination: i.verified?.destination ?? null, code_id: i.verified?.codeId ?? null,
    ip: i.ip, user_agent: i.userAgent,
  }).select("id, signed_at").single();
  if (error || !row) throw new Error(error?.message ?? "Could not save the signature");

  // Facts the signature establishes (fail closed: only ever switch life support ON).
  if (i.key === "life_support_answer" && i.answers["life_support"] === "yes") await admin.from("jobs").update({ life_support: true }).eq("id", i.jobId);
  if (i.key === "details_confirmation" && ["buying", "other"].includes(i.answers["role"] ?? "")) await logEvent(i.jobId, i.signedBy, "owner_paperwork_office_review", `Owner says "${i.answers["role"] === "buying" ? "I'm buying it" : "Other"}" for who owns the home — office review needed.`, { signature_id: row.id });
  if (i.key === "contact_privacy" && ownerId) {
    await admin.from("owner_contact_consents").upsert({ job_id: i.jobId, owner_id: ownerId, source: "owner_paperwork", consent_key: `gateA:${row.id}`, consent_status: "granted", contact_consent: true, consent_version: d.version, consented_at: row.signed_at, snapshot: { signature_id: row.id, text: signedText }, sha256: await sha256(signedText) }, { onConflict: "job_id,source,consent_key", ignoreDuplicates: true });
  }

  // PDF copy in the job file.
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let page = pdf.addPage([595, 842]); let y = 800;
  const lines = [`Home Insulation Victoria — job ${jobNumber}`, "", ...signedText.split("\n"), "", `Signed at: ${row.signed_at}`, `Method: ${i.method}${i.verified ? ` (code verified by ${i.verified.channel}: ${i.verified.destination})` : ""}`, `IP: ${i.ip ?? "—"}`, `Record: ${row.id}`];
  for (const raw of lines) {
    const words = raw.replace(/[^\x20-\x7E]/g, "-").split(" "); let line = "";
    const flush = () => { if (y < 50) { page = pdf.addPage([595, 842]); y = 800; } page.drawText(line, { x: 48, y, size: 10, font }); y -= 14; line = ""; };
    for (const w of words) { if (font.widthOfTextAtSize(`${line} ${w}`, 10) > 500) flush(); line = line ? `${line} ${w}` : w; }
    flush();
  }
  const path = `${i.jobId}/owner-paperwork/${d.key}-${row.id}.pdf`;
  const up = await admin.storage.from("job-files").upload(path, new Blob([await pdf.save() as BlobPart], { type: "application/pdf" }), { contentType: "application/pdf", upsert: false });
  if (!up.error) {
    await admin.from("owner_gate_signatures").update({ copy_path: path }).eq("id", row.id);
    await admin.from("documents").insert({ job_id: i.jobId, kind: "owner_paperwork", title: `${d.title} — signed`, storage_path: path, mime_type: "application/pdf", uploaded_by: i.signedBy, source_system: "portal", original_name: `${d.key}.pdf` });
  }
  await logEvent(i.jobId, i.signedBy, "owner_paperwork_signed", `Owner paperwork ${d.gate}: "${d.title}" ${d.signer === "office" ? "recorded" : "signed"}${draft ? " (DRAFT wording, TEST job)" : ""}`, { signature_id: row.id, doc_key: d.key, version: d.version });

  // Emailed copy: queued for real jobs only; delivery follows the sending switches.
  if (!facts.isTest) {
    const { data: ev } = await admin.from("workflow_events").select("id").eq("job_id", i.jobId).eq("event_type", "owner_paperwork_signed").contains("details", { signature_id: row.id }).limit(1).maybeSingle();
    if (ev) {
      const { error: e } = await admin.rpc("enqueue_external_action", { _job: i.jobId, _event: ev.id, _action: "customer_email", _target: `owner_paperwork:${row.id}`, _basis: "transactional_signed_copy", _version: d.version, _payload: `owner_paperwork:${row.id}`, _facts: row.id, _key: `owner-paperwork-${row.id}` });
      if (!e) await admin.from("owner_gate_signatures").update({ copy_email_queued: true }).eq("id", row.id);
      else console.error("signed copy enqueue skipped", e.message);
    }
  }
  return { id: row.id, draft };
}

export async function approvePaperwork(key: GateDocKey, version: string, actorId: string) {
  const d = gateDoc(key);
  if (d.version !== version) throw new WorkflowError("That version is no longer current.");
  if (d.body.startsWith("DRAFT")) throw new WorkflowError("This is still placeholder DRAFT text. Load Jo's final wording as a new version first, then approve it.");
  const { error } = await admin.from("owner_paperwork_approvals").insert({ doc_key: key, doc_version: version, body_sha256: await sha256(d.body), approved_by: actorId });
  if (error) throw new WorkflowError(error.message.includes("duplicate") ? "Already approved." : error.message);
}

/** The ONE template approval, used by both Compliance templates and Owner paperwork. */
export async function approveTemplateVersion(id: string, actorId: string) {
  const { data: t } = await admin.from("compliance_templates").select("template_key").eq("id", id).single();
  if (!t) throw new WorkflowError("Template not found");
  await admin.from("compliance_templates").update({ is_active: false }).eq("template_key", t.template_key).eq("is_active", true);
  const { error } = await admin.from("compliance_templates").update({ approved: true, approved_by: actorId, approved_at: new Date().toISOString(), is_active: true }).eq("id", id);
  if (error) throw new WorkflowError(error.message);
}

/** Settings list: every owner document, its version, Draft/Approved and who approved it. */
export async function paperworkCatalogue() {
  const { templateDocState } = await import("./owner-paperwork.core");
  const [{ data: appr }, { data: tpl }, approved] = await Promise.all([
    admin.from("owner_paperwork_approvals").select("doc_key, doc_version, approved_by, approved_at"),
    admin.from("compliance_templates").select("id, template_key, version, body, approved, approved_by, approved_at, is_active, created_at").in("template_key", ["customer_agreement", "consumer_rights", "esc_consent", "consumer_declaration", "installer_declaration"]),
    approvedVersions(),
  ]);
  const ids = [...new Set([...(appr ?? []).map((a) => a.approved_by), ...(tpl ?? []).map((t) => t.approved_by)].filter(Boolean) as string[])];
  const { data: people } = ids.length ? await admin.from("profiles").select("id, full_name").in("id", ids) : { data: [] as { id: string; full_name: string | null }[] };
  const who = (id: string | null) => (people ?? []).find((p) => p.id === id)?.full_name ?? (id ? "Admin" : null);
  const TEMPLATE_GATE: Record<string, string> = { customer_agreement: "B", consumer_rights: "B", esc_consent: "C", consumer_declaration: "D", installer_declaration: "D" };
  const TEMPLATE_TITLE: Record<string, string> = { customer_agreement: "Customer agreement (HIV wording)", consumer_rights: "Consumer rights", esc_consent: "ESC information-sharing consent (Reg 23A)", consumer_declaration: "Official Activity 48 assignment form", installer_declaration: "Installer declaration (PIISA)" };
  const fromTemplates = Object.keys(TEMPLATE_GATE).map((k) => {
    const s = templateDocState((tpl ?? []) as never, k);
    return { key: k, gate: TEMPLATE_GATE[k]!, title: TEMPLATE_TITLE[k]!, version: s.version, status: s.status, approvedBy: who(s.approvedBy), approvedAt: s.approvedAt, managedIn: "Templates", templateId: s.templateId, body: s.body };
  });
  const own = GATE_DOCS.filter((d) => !RETIRED_DOC_KEYS.has(d.key)).map((d) => {
    const a = (appr ?? []).find((x) => x.doc_key === d.key && x.doc_version === d.version);
    return { key: d.key, gate: d.gate, title: d.title, version: d.version, status: approved[d.key] ? "Approved" : (d.draftNote ?? "Draft"), approvedBy: approved[d.key] && d.approvalNote ? d.approvalNote : who(a?.approved_by ?? null), approvedAt: a?.approved_at ?? null, managedIn: "Here", templateId: null, body: d.body };
  });
  return [...own, ...fromTemplates].sort((x, y) => x.gate.localeCompare(y.gate));
}
