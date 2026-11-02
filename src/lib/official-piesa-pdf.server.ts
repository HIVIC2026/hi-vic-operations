// Decision 317: the current official PIESA as a PDF — the job's current signed copy (official_form_signed_copies,
// status current) in the form's own order (`officialPiesaPdfText`), through the one text-to-PDF helper — or, with
// PDF_LOOK_APPROVED.officialFormPdf on (Task 12), the filled DEECA form itself. Read-only:
// no sender, no write. Used by the electrician's /field download (trade-view.server) and the electrician's email
// attachment (electrician-piesa-copy.server), so both are the same document. Callers check who may see it.
import { bytesToBase64 } from "./veec-emails.core";
import { officialPiesaPdfFilename, officialPiesaPdfHeader, officialPiesaPdfText, type PdfSignatureMarks } from "./electrician-piesa-copy.core";
import { PDF_LOOK_APPROVED } from "./pdf-approvals.core";
import type { OfficialAnswers, SignedSnapshot } from "./official-forms.core";
import type { SignatureInput, SignatureSlot } from "./official-docx.core";

export type OfficialPiesaPdf = { copyId: string; signatureDate: string | null; fileName: string; bytes: Uint8Array };

/** Null when the job has no current official PIESA (or the signed-copy storage isn't set up). */
export async function officialPiesaPdf(jobId: string, jobNumber: string): Promise<OfficialPiesaPdf | null> {
  const { currentCopy } = await import("./official-forms.server");
  const pe = await currentCopy(jobId, "piesa");
  if (pe.unavailable || !pe.copy) return null;
  // Decision 336: the electrician's Mitti signature pictures (B3 from A3, Section C from A4) when kept with the job.
  const { answersFromDocument } = await import("./official-forms.core");
  const answers = answersFromDocument(pe.copy.snapshot.document) as Record<string, unknown>;
  const sig = await (await import("./official-signature.server")).officialSignatureImages(jobId, "piesa", answers).catch(() => null);
  const bytes = await officialPiesaPdfBytes(pe.copy.snapshot, jobNumber, answers, sig?.signatures ?? {});
  return { copyId: pe.copy.id, signatureDate: pe.copy.signatureDate, fileName: officialPiesaPdfFilename(jobNumber), bytes };
}

/**
 * The PDF for a signed PIESA copy. Task 12: with PDF_LOOK_APPROVED.officialFormPdf on (after Jo approves the sample), the
 * filled DEECA form (official-form-pdf.server); off (default), today's plain-text copy, unchanged.
 */
export async function officialPiesaPdfBytes(snapshot: SignedSnapshot, jobNumber: string, answers: Record<string, unknown>, signatures: Partial<Record<SignatureSlot, SignatureInput>>): Promise<Uint8Array> {
  if (PDF_LOOK_APPROVED.officialFormPdf) return (await (await import("./official-form-pdf.server")).officialFormPdf("piesa", answers as OfficialAnswers, signatures)).bytes;
  const { textToPdf } = await import("./signed-pdf.server");
  const marks: PdfSignatureMarks = {};
  const images: Record<string, { bytes: Uint8Array; contentType: string }> = {};
  for (const slot of ["b3.signature", "c.signature"] as const) {
    const img = signatures[slot]?.images[0];
    if (img) { marks[slot] = { signedOn: img.signedOn }; images[slot] = { bytes: img.bytes, contentType: img.contentType }; }
  }
  return textToPdf(officialPiesaPdfHeader(jobNumber), officialPiesaPdfText(snapshot, marks), images);
}

export const pdfAttachment = (p: OfficialPiesaPdf) => ({ filename: p.fileName, content: bytesToBase64(p.bytes), contentType: "application/pdf" });
