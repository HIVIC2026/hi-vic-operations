// Fills the official March 2026 Word form for a job's current signed PIESA/PIISA and stores it privately.
// Server-only. The bundled .docx originals are the exact files recorded in OFFICIAL_TEMPLATES (SHA-256 checked
// at fill time); the filled copy lands in the private official-form-copies bucket next to the signed snapshot.
import { createHash } from "crypto";
import { unzipSync, zipSync } from "fflate";
import piesaDocx from "./official-docx-piesa.data";
import piisaDocx from "./official-docx-piisa.data";
import { OFFICIAL_TEMPLATES, officialFormUseBlocker, type OfficialKey } from "./official-forms.core";
import { fillOfficialDocxXml } from "./official-docx.core";
import { signFile } from "./file-links.server";

const DATA_PREFIX = "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,";

function bundledDocx(key: OfficialKey): Uint8Array {
  const uri = key === "piesa" ? piesaDocx : piisaDocx;
  const b64 = uri.startsWith(DATA_PREFIX) ? uri.slice(DATA_PREFIX.length) : uri.replace(/^data:[^,]*,/, "");
  return new Uint8Array(Buffer.from(b64, "base64"));
}

/** Fills the official Word form. Returns the filled docx bytes, the fill report, and the source SHA-256. */
export function renderOfficialDocx(key: OfficialKey, answers: import("./official-forms.core").OfficialAnswers) {
  const block = officialFormUseBlocker(key);
  if (block) throw new Error(block);
  const bytes = bundledDocx(key);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== OFFICIAL_TEMPLATES[key].sha256) throw new Error(`The bundled ${key.toUpperCase()} Word form does not match the recorded official original.`);
  const parts = unzipSync(bytes);
  const docPath = "word/document.xml";
  const doc = parts[docPath];
  if (!doc) throw new Error("The official Word form is missing its document body.");
  const { xml, filled, missed } = fillOfficialDocxXml(new TextDecoder().decode(doc), key, answers);
  const out = zipSync({ ...parts, [docPath]: new TextEncoder().encode(xml) }, { level: 0 });
  return { bytes: out, filled, missed, sha256 };
}

/** Fills from the job's current signed copy and stores the Word file privately. Office-only (caller checks). */
export async function storeOfficialDocx(jobId: string, key: OfficialKey) {
  const { currentCopy, OFFICIAL_BUCKET } = await import("./official-forms.server");
  const { copy, unavailable } = await currentCopy(jobId, key);
  if (unavailable) throw new Error("Signed-copy storage isn't set up yet.");
  if (!copy) throw new Error(`No current signed ${key.toUpperCase()} on this job.`);
  const { bytes, filled, missed, sha256 } = renderOfficialDocx(key, copy.snapshot ? Object.fromEntries(copy.snapshot.document.filter((d) => d.value != null).map((d) => [d.id, d.value])) : {});
  const path = `jobs/${jobId}/${key}/${copy.snapshot.hash}.docx`;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const up = await supabaseAdmin.storage.from(OFFICIAL_BUCKET).upload(path, new Blob([bytes.buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), { upsert: true, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  if (up.error) throw new Error(up.error.message);
  return { path, filled: filled.length, missed, sourceSha256: sha256 };
}

/** Short-lived signed URL for a stored filled Word form. Visibility decided by RLS on the caller's client. */
export async function officialDocxUrl(userClient: { from: (t: string) => any }, jobId: string, key: OfficialKey) {
  const { data, error } = await userClient.from("official_form_signed_copies").select("storage_path,snapshot").eq("job_id", jobId).eq("form_key", key).eq("status", "current").maybeSingle();
  if (error || !data) throw new Error("Not found.");
  const path = (data.storage_path as string).replace(/\.json$/, ".docx");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { OFFICIAL_BUCKET } = await import("./official-forms.server");
  const r = await signFile(OFFICIAL_BUCKET, path, 300);
  if (r.error) throw new Error(r.error.message);
  return r.data!.signedUrl;
}
