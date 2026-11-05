// Receipt PDFs (website look): the $349 safety check, the 50% deposit and the final payment. Server-only.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { aud } from "./payments.core";
import type { PdfBlock } from "./pdf-look.core";
import { renderPdf } from "./pdf-look.server";
import { PDF_LOOK_APPROVED } from "./pdf-approvals.core";
import { buildReceiptInput, receiptModel, type ReceiptInput, type ReceiptStep } from "./receipt-pdf.core";

export type { ReceiptInput, ReceiptStep } from "./receipt-pdf.core";

function assertFacts(i: ReceiptInput) {
  const need: [string, string][] = [["owner name", i.ownerName], ["first name", i.firstName], ["address", i.address], ["job number", i.jobNumber], ["paid date", i.paidOn]];
  for (const [what, v] of need) if (!(v ?? "").trim()) throw new Error(`Receipt is missing the ${what}`);
  if (!(i.yourPriceCents > 0) || !(i.amountCents > 0)) throw new Error("Receipt is missing the price or the amount paid");
}

export function receiptBlocks(i: ReceiptInput): PdfBlock[] {
  assertFacts(i);
  const m = receiptModel(i);
  const [head, ...rest] = m.rows;
  const tick = m.stillToPay.includes("✓");
  return [
    { id: "r-head", kind: "header", eyebrow: `RECEIPT · JOB ${i.jobNumber}`, compact: true },
    { id: "r-title", kind: "title", text: `Thanks, ${i.firstName}`, sub: m.heading, compact: true },
    { id: "r-facts", kind: "facts", compact: true, rows: [["Receipt for", `${i.ownerName}\n${i.address}`], ["Paid", `${i.paidOn}\n${i.method === "card" ? "by card" : "by bank transfer"}`]] },
    { id: "r-paid", kind: "paid", label: "Paid", line: m.paidLine, amount: aud(i.amountCents) },
    { id: "r-ledger", kind: "ledger", head: head!, rows: rest, total: { label: "Still to pay", amount: m.stillToPay.replace(/\s*✓$/, ""), ...(tick ? { tick } : {}) }, ...(m.gstLine ? { note: m.gstLine } : {}) },
  ];
}

export async function receiptPdf(i: ReceiptInput): Promise<Uint8Array> {
  const { bytes } = await renderPdf({ title: "Receipt", blocks: receiptBlocks(i) });
  return bytes;
}

const RECEIPT_KIND = "receipt";
const STEP_TITLE: Record<ReceiptStep, string> = { safety_check: "Receipt - electrical safety check (PIESA)", install_deposit: "Receipt - 50% deposit", balance: "Receipt - final payment" };

/** Reads the job, the owner and the ledger (existing readers), builds the receipt and files it once per `receiptKey`.
 *  Anything missing returns `{ held }`; nothing is guessed. */
export async function fileReceiptPdf(jobId: string, step: ReceiptStep, receiptKey: string): Promise<{ path: string } | { held: string }> {
  // Held until Jo approves the receipt sample (pdf-approvals.core).
  if (!PDF_LOOK_APPROVED.receipts) return { held: "Receipt not made: the new receipt layout is awaiting approval" };
  const { data: have, error: haveErr } = await admin.from("documents").select("storage_path").eq("job_id", jobId).eq("kind", RECEIPT_KIND).eq("external_id", receiptKey).limit(1).maybeSingle();
  if (haveErr) return { held: "Receipt not made: the job file could not be checked" };
  if (have?.storage_path) return { path: have.storage_path };

  const { jobPaymentView } = await import("./payments.server");
  const [{ data: job, error: jobErr }, view, { data: ev, error: evErr }] = await Promise.all([
    admin.from("jobs").select("job_number, owners(full_name), properties(address_line, suburb, state, postcode)").eq("id", jobId).maybeSingle(),
    jobPaymentView(jobId),
    admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "owner_payment_recorded").contains("details", { receipt_key: receiptKey }).limit(1).maybeSingle(),
  ]);
  if (jobErr || evErr) return { held: "Receipt not made: the job or payment could not be read" };
  if (!job) return { held: "Receipt not made: the job was not found" };
  if (!view) return { held: "Receipt not made: the job has no installation invoice yet" };
  const o = job.owners as unknown as { full_name: string | null } | null;
  const p = job.properties as unknown as { address_line: string | null; suburb: string | null; state: string | null; postcode: string | null } | null;
  const address = p?.address_line ? [p.address_line, [p.suburb, p.state, p.postcode].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "";
  const d = (ev?.details ?? null) as Record<string, unknown> | null;
  const payment = d ? { amountCents: Number(d["amount_cents"] ?? 0), paidAt: String(d["paid_at"] ?? ""), source: String(d["source"] ?? "") } : null;
  const input = buildReceiptInput({ step, jobNumber: job.job_number, ownerName: o?.full_name, address, plan: view.plan, ledger: view.ledger, payment: payment?.paidAt ? payment : null });
  if ("held" in input) return input;

  const bytes = await receiptPdf(input);
  const path = `${jobId}/receipts/${step}-${receiptKey.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
  const up = await admin.storage.from("job-files").upload(path, new Blob([bytes as BlobPart], { type: "application/pdf" }), { contentType: "application/pdf", upsert: false });
  // A file already stored at this path with no document row is the same receipt: carry on and record it.
  if (up.error && !/exist|duplicate/i.test(up.error.message)) return { held: "Receipt not made: the file could not be saved" };
  const ins = await admin.from("documents").insert({ job_id: jobId, kind: RECEIPT_KIND, title: STEP_TITLE[step], storage_path: path, mime_type: "application/pdf", uploaded_by: null, source_system: "portal", external_id: receiptKey, size_bytes: bytes.byteLength });
  if (ins.error) {
    // A parallel call filed it first: use that one.
    const { data: again } = await admin.from("documents").select("storage_path").eq("job_id", jobId).eq("kind", RECEIPT_KIND).eq("external_id", receiptKey).limit(1).maybeSingle();
    if (again?.storage_path) return { path: again.storage_path };
    return { held: "Receipt not made: the file could not be recorded" };
  }
  return { path };
}
