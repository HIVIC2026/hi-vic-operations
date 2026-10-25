// Decision 317: the current official PIESA as a PDF — the job's current signed copy (official_form_signed_copies,
// status current) in the form's own order (`officialPiesaPdfText`), through the one text-to-PDF helper. Read-only:
// no sender, no write. Used by the electrician's /field download (trade-view.server) and the electrician's email
// attachment (electrician-piesa-copy.server), so both are the same document. Callers check who may see it.
import { bytesToBase64 } from "./veec-emails.core";
import { officialPiesaPdfFilename, officialPiesaPdfHeader, officialPiesaPdfText, type PdfSignatureMarks } from "./electrician-piesa-copy.core";

export type OfficialPiesaPdf = { copyId: string; signatureDate: string | null; fileName: string; bytes: Uint8Array };

/** Null when the job has no current official PIESA (or the signed-copy storage isn't set up). */
export async function officialPiesaPdf(jobId: string, jobNumber: string): Promise<OfficialPiesaPdf | null> {
  const { currentCopy } = await import("./official-forms.server");
  const pe = await currentCopy(jobId, "piesa");
  if (pe.unavailable || !pe.copy) return null;
  const { textToPdf } = await import("./signed-pdf.server");
  // Decision 336: the electrician's Mitti signature pictures (B3 from A3, Section C from A4) when kept with the job.
  const { answersFromDocument } = await import("./official-forms.core");
  const answers = answersFromDocument(pe.copy.snapshot.document) as Record<string, unknown>;
  const sig = await (await import("./official-signature.server")).officialSignatureImages(jobId, "piesa", answers).catch(() => null);
  const marks: PdfSignatureMarks = {};
  const images: Record<string, { bytes: Uint8Array; contentType: string }> = {};
  for (const slot of ["b3.signature", "c.signature"] as const) {
    const img = sig?.signatures[slot]?.images[0];
    if (img) { marks[slot] = { signedOn: img.signedOn }; images[slot] = { bytes: img.bytes, contentType: img.contentType }; }
  }
  const bytes = await textToPdf(officialPiesaPdfHeader(jobNumber), officialPiesaPdfText(pe.copy.snapshot, marks), images);
  return { copyId: pe.copy.id, signatureDate: pe.copy.signatureDate, fileName: officialPiesaPdfFilename(jobNumber), bytes };
}

export const pdfAttachment = (p: OfficialPiesaPdf) => ({ filename: p.fileName, content: bytesToBase64(p.bytes), contentType: "application/pdf" });
