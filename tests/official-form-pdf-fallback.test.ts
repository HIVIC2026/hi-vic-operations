// I3: with PDF_LOOK_APPROVED.officialFormPdf on, a failed DEECA fill must never break the PIESA copy email, the
// electrician's download or the office Word store. It logs an internal event and falls back to today's output.
import { afterEach, expect, mock, test } from "bun:test";

const events: { jobId: string; type: string; internal: boolean | undefined }[] = [];
mock.module("../src/lib/official-form-pdf.server", () => ({
  officialFormPdf: async () => { throw new Error("fill broke"); },
}));
mock.module("../src/lib/workflow.server", () => ({
  logEvent: async (jobId: string, _a: string | null, type: string, _s: string, _d: unknown, o: { internal?: boolean } = {}) => { events.push({ jobId, type, internal: o.internal }); },
  WorkflowError: class extends Error {},
}));
const uploads: string[] = [];
mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { storage: { from: () => ({ upload: async (path: string) => { uploads.push(path); return { error: null }; } }) } },
}));

import { officialPiesaPdfBytes } from "../src/lib/official-piesa-pdf.server";
import { officialPiesaPdfHeader, officialPiesaPdfText } from "../src/lib/electrician-piesa-copy.core";
import { textToPdf } from "../src/lib/signed-pdf.server";
import { answersFromDocument, buildSignedSnapshot } from "../src/lib/official-forms.core";
import { PDF_LOOK_APPROVED } from "../src/lib/pdf-approvals.core";
import { fullAnswers } from "../scripts/official-form-samples";

const snap = buildSignedSnapshot({ key: "piesa", answers: fullAnswers("piesa"), signer: { userId: "u1", name: "Sam Sparks", role: "electrician" }, enteredDate: "2026-11-07", serverTimestamp: "2026-11-07T03:00:00Z", jobFacts: {}, acknowledgementIds: [], signature: "Sam Sparks" });
const answers = answersFromDocument(snap.document) as Record<string, unknown>;

afterEach(() => { PDF_LOOK_APPROVED.officialFormPdf = false; events.length = 0; uploads.length = 0; });

test("PIESA PDF: a failed DEECA fill falls back to the text copy and logs an internal event", async () => {
  PDF_LOOK_APPROVED.officialFormPdf = true;
  const bytes = await officialPiesaPdfBytes(snap, "HV-1234", answers, {}, "job-1");
  const text = await textToPdf(officialPiesaPdfHeader("HV-1234"), officialPiesaPdfText(snap, {}), {});
  expect(bytes.length).toBeGreaterThan(0);
  // Same document as the flag-off copy (pdf-lib stamps creation time, so compare sizes rather than bytes).
  expect(Math.abs(bytes.length - text.length)).toBeLessThan(64);
  expect(events).toEqual([{ jobId: "job-1", type: "official_form_pdf_fallback", internal: true }]);
});

test("Word store: a failed DEECA fill still stores the Word file, with no PDF, and logs an internal event", async () => {
  PDF_LOOK_APPROVED.officialFormPdf = true;
  mock.module("../src/lib/official-forms.server", () => ({
    OFFICIAL_BUCKET: "official-form-copies",
    currentCopy: async () => ({ unavailable: false, copy: { id: "c1", snapshot: snap, signatureDate: "2026-11-07" } }),
  }));
  mock.module("../src/lib/official-signature.server", () => ({ officialSignatureImages: async () => ({ signatures: {}, flags: [], facts: [] }) }));
  const { storeOfficialDocx } = await import("../src/lib/official-docx.server");
  const r = await storeOfficialDocx("job-2", "piesa");
  expect(r.pdfPath).toBeNull();
  expect(uploads).toEqual([`jobs/job-2/piesa/${snap.hash}.docx`]);
  expect(events).toEqual([{ jobId: "job-2", type: "official_form_pdf_fallback", internal: true }]);
});
