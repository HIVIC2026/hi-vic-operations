// Decision 376 (approved by Jo, decision 384): ONE "Your signed paperwork" email (O75) per signing sitting, with the signed Gate B PDFs from the
// job file attached. Swept by the 15-minute allocation tick (signGateDoc only files the copy). Each batch is recorded as
// an `owner_paperwork_copy` workflow event BEFORE anything is sent, so a signature is never copied twice. TEST jobs →
// test-send; real owners → the guarded owner email path (customer_comms_enabled + consent + opt-outs). Batches
// are recorded even when held, so nothing old goes out later; only the last PAPERWORK_COPY_LOOKBACK_DAYS are copied.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import type { EmailAttachment } from "./email-kit.core";
import {
  OWNER_PAPERWORK_COPY_APPROVED, OWNER_PAPERWORK_COPY_EVENT, OWNER_PAPERWORK_COPY_PURPOSE, PAPERWORK_COPY_LOOKBACK_DAYS, paperworkCopyBatch, paperworkCopyFilename,
  paperworkCopyKey, renderPaperworkCopyEmail, type PaperworkSignature,
} from "./paperwork-copy-email.core";

async function pdfAttachment(path: string | null, title: string, jobNumber: string | null): Promise<EmailAttachment | null> {
  if (!path) return null;
  const { data, error } = await admin.storage.from("job-files").download(path);
  if (error || !data) return null;
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (!bytes.length) return null;
  const { bytesToBase64 } = await import("./veec-emails.core");
  return { filename: paperworkCopyFilename(title, jobNumber), content: bytesToBase64(bytes), contentType: "application/pdf" };
}

async function copiedIds(jobId: string): Promise<Set<string>> {
  const { data } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", OWNER_PAPERWORK_COPY_EVENT);
  return new Set((data ?? []).flatMap((e) => ((e.details as { signature_ids?: string[] } | null)?.signature_ids ?? []).map(String)));
}

/** Copy one job's pending batch (if the sitting is over). Returns a short outcome line; never throws on send problems. */
export async function sendOwnerPaperworkCopy(jobId: string, now = new Date()): Promise<string> {
  const since = new Date(now.getTime() - PAPERWORK_COPY_LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data: rows } = await admin.from("owner_gate_signatures").select("id, gate, method, signed_at, doc_key, copy_path").eq("job_id", jobId).eq("gate", "B").gte("signed_at", since).order("signed_at");
  const { gateDoc } = await import("./owner-gates.core");
  const sigs: PaperworkSignature[] = (rows ?? []).map((r) => ({ ...r, title: (() => { try { return gateDoc(r.doc_key as never).title; } catch { return r.doc_key; } })() }));
  const batch = paperworkCopyBatch({ signatures: sigs, copiedIds: await copiedIds(jobId), now });
  if (!batch.length) return "nothing to copy";
  const ids = batch.map((s) => s.id);
  const { data: job } = await admin.from("jobs").select("owner_id, source, job_number, deleted_at, properties(address_line, suburb, postcode)").eq("id", jobId).maybeSingle();
  if (!job || job.deleted_at) return "skipped";
  // The claim: recorded before any send (held or test sends included), so these signatures are never copied again.
  await logEvent(jobId, null, OWNER_PAPERWORK_COPY_EVENT, `Copy of the owner's signed paperwork prepared (email O75): ${batch.map((s) => s.title).join(", ")}`, { signature_ids: ids, doc_keys: batch.map((s) => s.doc_key) }, { internal: true });
  const p = (job.properties ?? null) as { address_line: string | null; suburb: string | null; postcode: string | null } | null;
  const [{ data: owner }, { data: asg }, myJobUrl, files] = await Promise.all([
    admin.from("owners").select("full_name, email").eq("id", job.owner_id).maybeSingle(),
    admin.from("job_assignments").select("businesses(onboarding_notes)").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle(),
    (await import("./veec-copy-email.server")).ownerMyJobLink(jobId),
    Promise.all(batch.map((s) => pdfAttachment(s.copy_path, s.title, job.job_number ?? null).catch(() => null))),
  ]);
  const attachments = files.filter((f): f is EmailAttachment => !!f);
  // Only claim "attached" when every signed copy could be read; otherwise point to the job page alone.
  const attached = attachments.length === batch.length;
  const { firstName } = await import("./worker-links.core");
  const input = { firstName: firstName(owner?.full_name ?? null), address: [p?.address_line, p?.suburb].filter(Boolean).join(", "), titles: batch.map((s) => s.title), attached, myJobUrl };
  const withFiles = attached ? { attachments } : {};
  const note = attached ? ` (${attachments.length} PDF${attachments.length === 1 ? "" : "s"} attached)` : " (copies not all readable – job page only)";
  if (job.source === "qa_test") {
    const { isTestPartner } = await import("./test-send.core");
    const { sendTestEmail } = await import("./test-send.server");
    const mail = renderPaperworkCopyEmail({ ...input, unsubscribeUrl: null, test: true });
    const r = await sendTestEmail({ jobId, jobSource: job.source, partnerIsTest: isTestPartner((asg?.businesses ?? null) as { onboarding_notes?: string | null } | null), label: `owner_paperwork_copy:${ids[0]}`, actorId: null }, owner?.email ?? "", mail.subject, mail.html, mail.text, withFiles);
    return `${r.status}: ${r.detail}${note}`;
  }
  if (!OWNER_PAPERWORK_COPY_APPROVED) return "not sent — wording awaiting approval";
  if (!owner?.email) return "not sent — no owner email";
  try { await (await import("./comms.server")).assertCustomerDeliveryAllowed(jobId, "Signed paperwork copy email"); } catch (e) { return `not sent — ${(e as Error).message}`; }
  const r = await (await import("./owner-email-send.server")).sendGuardedOwnerEmail({
    jobId, jobSource: job.source, to: owner.email, purpose: OWNER_PAPERWORK_COPY_PURPOSE, key: paperworkCopyKey(jobId, ids),
    build: (u) => ({ ...renderPaperworkCopyEmail({ ...input, unsubscribeUrl: u, test: false }), ...withFiles }),
  });
  return `${r}${note}`;
}

/** 15-minute tick: jobs with an owner Gate B signature in the last PAPERWORK_COPY_LOOKBACK_DAYS days. */
export async function sweepOwnerPaperworkCopies(now = new Date()): Promise<{ checked: number; copied: number }> {
  const since = new Date(now.getTime() - PAPERWORK_COPY_LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data } = await admin.from("owner_gate_signatures").select("job_id").eq("gate", "B").neq("method", "office").gte("signed_at", since);
  const jobIds = [...new Set((data ?? []).map((r) => r.job_id))];
  let copied = 0;
  for (const id of jobIds) {
    try {
      const r = await sendOwnerPaperworkCopy(id, now);
      if (r !== "nothing to copy" && r !== "skipped") copied++;
    } catch (e) { console.error("owner paperwork copy failed", id, (e as Error).message); }
  }
  return { checked: jobIds.length, copied };
}
