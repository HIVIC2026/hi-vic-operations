// Fills the official DEECA PDF from completed answers and files it privately in the Job File.
import { PDFDocument } from "pdf-lib";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { planOfficialFill, TEMPLATE_PATH, type Answers, type OfficialFormKey } from "./official-pdf.core";
import { logEvent } from "./workflow.server";

const BUCKET = "job-files";

export async function fillOfficialPdf(key: OfficialFormKey, answers: Answers): Promise<{ bytes: Uint8Array; missing: string[] }> {
  const { data, error } = await admin.storage.from(BUCKET).download(TEMPLATE_PATH[key]);
  if (error || !data) throw new Error(`Official form template unavailable: ${error?.message ?? "missing"}`);
  const doc = await PDFDocument.load(await data.arrayBuffer());
  const form = doc.getForm();
  const plan = planOfficialFill(key, answers);
  for (const [n, v] of Object.entries(plan.text)) form.getTextField(n).setText(v);
  for (const [n, v] of Object.entries(plan.radio)) form.getRadioGroup(n).select(v);
  for (const n of plan.check) form.getCheckBox(n).check();
  return { bytes: await doc.save(), missing: plan.missing };
}

export async function fileOfficialPdf(jobId: string, actorId: string, key: OfficialFormKey, answers: Answers) {
  const { bytes, missing } = await fillOfficialPdf(key, answers);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `${jobId}/official-forms/${key}-${stamp}.pdf`;
  const up = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: "application/pdf" });
  if (up.error) throw new Error(`storage: ${up.error.message}`);
  const title = key === "piesa" ? "Official PIESA (DEECA form) – filled" : "Official PIISA (DEECA form) – filled";
  const { error } = await admin.from("documents").insert({
    job_id: jobId, kind: `official_${key}`, title: missing.length ? `${title} – INCOMPLETE` : title, storage_path: path, mime_type: "application/pdf",
    source_system: "portal", original_name: `${key}.pdf`, size_bytes: bytes.byteLength, uploaded_by: actorId,
  });
  if (error) throw new Error(error.message);
  await logEvent(jobId, actorId, "official_form_filled", `${title}${missing.length ? ` (${missing.length} answers missing)` : ""}`, { form: key, path, missing });
  return { path, missing };
}
