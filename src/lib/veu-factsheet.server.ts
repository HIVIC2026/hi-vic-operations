// VEU consumer factsheet I/O (decision 320). Reads the bundled PDF (`veu-factsheet.data.ts`, generated from the repo
// file), files one copy on the job (private job-files bucket + documents row kind `veu_consumer_factsheet`, keyed by
// content hash) and records `veu_factsheet_provided` once per job. Never sends anything itself — the O22 sender
// (`approved-owner-emails.server.ts` emailOwnerYoureIn) attaches the file and calls `recordFactsheetGiven` after a send.
import { createHash } from "node:crypto";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import type { EmailAttachment } from "./email-kit.core";
import {
  VEU_FACTSHEET_ATTACHMENT_NAME, VEU_FACTSHEET_DOC_KIND, VEU_FACTSHEET_PATH, VEU_FACTSHEET_PROVIDED_EVENT, VEU_FACTSHEET_TITLE,
  factsheetDecision, factsheetProvidedSummary, shouldRecordFactsheet,
} from "./veu-factsheet.core";
import { VEU_FACTSHEET_PDF } from "./veu-factsheet.data";

/** The bundled factsheet bytes, or null when it is not on file (or not a PDF). */
export function factsheetBytes(): Uint8Array | null {
  if (!VEU_FACTSHEET_PDF) return null;
  const bytes = new Uint8Array(Buffer.from(VEU_FACTSHEET_PDF.replace(/^data:[^,]*,/, ""), "base64"));
  return factsheetDecision(bytes).attach ? bytes : null;
}

/** The email attachment for O22, or the reason it is left off. */
export function factsheetAttachment(): { attachment: EmailAttachment | null; reason: string | null } {
  const bytes = factsheetBytes();
  const d = factsheetDecision(bytes);
  if (!d.attach || !bytes) return { attachment: null, reason: d.attach ? null : d.reason };
  return { attachment: { filename: VEU_FACTSHEET_ATTACHMENT_NAME, content: Buffer.from(bytes).toString("base64"), contentType: "application/pdf" }, reason: null };
}

async function alreadyRecorded(jobId: string): Promise<boolean> {
  const { data } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", VEU_FACTSHEET_PROVIDED_EVENT).limit(1);
  return (data ?? []).length > 0;
}

/** After a confirmed send with the factsheet attached: file the copy on the job and record it once. Never throws. */
export async function recordFactsheetGiven(jobId: string, x: { sent: boolean; attached: boolean; via: string; result: string }): Promise<boolean> {
  try {
    if (!shouldRecordFactsheet({ sent: x.sent, attached: x.attached, alreadyRecorded: await alreadyRecorded(jobId) })) return false;
    const bytes = factsheetBytes();
    if (!bytes) return false;
    const sha = createHash("sha256").update(bytes).digest("hex");
    const key = `${VEU_FACTSHEET_DOC_KIND}:${sha.slice(0, 32)}`;
    const { data: ex } = await admin.from("documents").select("id, storage_path").eq("job_id", jobId).eq("source_system", "portal").eq("external_id", key).maybeSingle();
    let path = ex?.storage_path ?? null;
    if (!ex) {
      path = `${jobId}/consumer-docs/veu-consumer-factsheet-${sha.slice(0, 16)}.pdf`;
      const up = await admin.storage.from("job-files").upload(path, bytes, { contentType: "application/pdf", upsert: false });
      if (up.error && !/exists/i.test(up.error.message)) throw new Error(`Factsheet copy could not be stored: ${up.error.message}`);
      const { error } = await admin.from("documents").insert({ job_id: jobId, kind: VEU_FACTSHEET_DOC_KIND, title: VEU_FACTSHEET_TITLE, storage_path: path, mime_type: "application/pdf", uploaded_by: null, source_system: "portal", external_id: key, original_name: VEU_FACTSHEET_ATTACHMENT_NAME, size_bytes: bytes.byteLength });
      if (error) throw new Error(error.message);
    }
    await logEvent(jobId, null, VEU_FACTSHEET_PROVIDED_EVENT, factsheetProvidedSummary(x.via), { via: x.via, result: x.result, path, sha256: sha, source_path: VEU_FACTSHEET_PATH });
    return true;
  } catch (e) {
    console.error("VEU factsheet record skipped", jobId, (e as Error).message);
    return false;
  }
}
