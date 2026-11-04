// Part 4 Task 9 (touchpoint 52): what the ONE "All done" email needs from the database — the contacts block, the tax invoice
// and rebate-form PDFs, the manufacturer's instructions. Server-only. Never sends; emailOwnerInstallComplete does.
// Holds (missing office phone/email, tax invoice approved but not makeable) are recorded once per reason as an office note and
// retried on the next 15-minute tick. Layout flags off (PDF_LOOK_APPROVED) = that PDF is simply not attached.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import type { EmailAttachment } from "./email-kit.core";
import { HIV_AP_CONTACT, allDoneContactHold, type AllDoneAttached, type AllDoneContacts } from "./completion-emails.core";
import { PDF_LOOK_APPROVED } from "./pdf-approvals.core";

export const ALL_DONE_HELD_EVENT = "install_complete_email_held";
export const INSTRUCTIONS_MISSING_EVENT = "product_instructions_missing";
export const ALL_DONE_ATTACHMENT_EVENT = "all_done_attachment_missing";
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

export async function allDoneContacts(jobId: string): Promise<{ contacts: AllDoneContacts } | { hold: string }> {
  const { businessContactForJob } = await import("./owner-contact.server");
  const [installer, electrician] = await Promise.all([businessContactForJob(jobId, "installer"), businessContactForJob(jobId, "electrician")]);
  const hold = allDoneContactHold(installer, electrician);
  return hold || !installer ? { hold: hold ?? "No installer office on file" } : { contacts: { ap: HIV_AP_CONTACT, installer, electrician } };
}

/** One office note per job and reason (the tick would otherwise repeat it every 15 minutes). */
export async function logAllDoneHeld(jobId: string, why: string): Promise<void> {
  const { data } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", ALL_DONE_HELD_EVENT);
  if ((data ?? []).some((e) => (e.details as { held?: string } | null)?.held === why)) return;
  await logEvent(jobId, null, ALL_DONE_HELD_EVENT, `All done email held: ${why}. Fix it and the email goes on the next check.`, { held: why }, { internal: true });
}

async function taxInvoiceAttachment(jobId: string): Promise<{ attachment: EmailAttachment | null; hold: string | null }> {
  // Layout not approved yet: the email goes without it (O45 never carried the PDF either).
  if (!PDF_LOOK_APPROVED.taxInvoice) return { attachment: null, hold: null };
  const { fileTaxInvoicePdf } = await import("./tax-invoice-pdf.server");
  const made = await fileTaxInvoicePdf(jobId);
  if ("held" in made) return { attachment: null, hold: made.held };
  const { data } = await admin.storage.from("job-files").download(made.path);
  if (!data) return { attachment: null, hold: "Tax invoice not made: the saved file could not be read" };
  return { attachment: { filename: "Tax-invoice.pdf", content: b64(new Uint8Array(await (data as Blob).arrayBuffer())), contentType: "application/pdf" }, hold: null };
}

/** The unsigned (or part-signed) official ESC form, pre-filled from the job, to read before signing. Not attached when the layout is not approved or the form is not ready. */
async function rebateFormAttachment(jobId: string): Promise<EmailAttachment | null> {
  if (!PDF_LOOK_APPROVED.veecForm) return null;
  try {
    const [{ currentAssignment, veecPreparation }, { veecFormPdf }, { data: job }] = await Promise.all([import("./assignment.server"), import("./veec-form-pdf.server"), admin.from("jobs").select("job_number").eq("id", jobId).maybeSingle()]);
    const a = await currentAssignment(jobId);
    const facts = (a?.final_facts ?? null) as { form_values?: Record<string, never> } | null;
    const values = facts?.form_values ?? (await veecPreparation(jobId)).values;
    const at = (name: string | null | undefined, when: string | null | undefined) => (name && when ? { name, at: when } : undefined);
    const installer = at(a?.installer_signature_name, a?.installer_signed_at), ap = at(a?.ap_signature_name, a?.ap_signed_at);
    const r = await veecFormPdf(values, a ? { ...(installer ? { installer } : {}), ...(ap ? { ap } : {}) } : null, { jobNumber: job?.job_number ?? null });
    return { filename: "Rebate-form-to-read.pdf", content: b64(r.bytes), contentType: "application/pdf" };
  } catch (e) {
    await logEvent(jobId, null, ALL_DONE_ATTACHMENT_EVENT, "All done email: the rebate form could not be attached (internal)", { reason: (e as Error).message }, { internal: true }).catch(() => undefined);
    return null;
  }
}

/** Tax invoice + rebate form + manufacturer's instructions. `hold` = wait for the next tick (tax invoice approved but not makeable). A missing instructions PDF sends anyway and logs `product_instructions_missing`. */
export async function allDoneAttachments(jobId: string, products: string[]): Promise<{ attachments: EmailAttachment[]; attached: Omit<AllDoneAttached, "warranty">; hold: string | null }> {
  const [tax, form] = await Promise.all([taxInvoiceAttachment(jobId), rebateFormAttachment(jobId)]);
  const { productInstructionsFor } = await import("./product-instructions.server");
  const instructions: EmailAttachment[] = [];
  const missing: string[] = [];
  for (const p of products) {
    const f = await productInstructionsFor(p);
    if (!f) missing.push(p);
    else if (!instructions.some((x) => x.filename === f.filename)) instructions.push(f);
  }
  if (missing.length) await logEvent(jobId, null, INSTRUCTIONS_MISSING_EVENT, `Manufacturer's instructions for ${missing.join(", ")} not on file, so the All done email went without them`, { products: missing }, { internal: true }).catch(() => undefined);
  return { attachments: [...(tax.attachment ? [tax.attachment] : []), ...(form ? [form] : []), ...instructions], attached: { taxInvoice: !!tax.attachment, rebateForm: !!form, instructions: instructions.length > 0 }, hold: tax.hold };
}

/** For the day-0 step: why the All done email cannot go yet (null = ready). Checked BEFORE the step is recorded, so the tick retries. */
export async function allDoneHold(jobId: string): Promise<string | null> {
  const c = await allDoneContacts(jobId);
  if ("hold" in c) return c.hold;
  if (PDF_LOOK_APPROVED.taxInvoice) return (await taxInvoiceAttachment(jobId)).hold;
  return null;
}
