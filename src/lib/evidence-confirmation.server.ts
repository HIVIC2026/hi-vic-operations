import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type EvidenceInsert = Database["public"]["Tables"]["evidence_files"]["Insert"];
/** Stable primary key serialises concurrent confirmations without changing the existing schema. */
export async function evidencePathId(path: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`job-files:${path}`)));
  hash[6] = ((hash[6] ?? 0) & 15) | 80;
  hash[8] = ((hash[8] ?? 0) & 63) | 128;
  const hex = [...hash.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

/** Called only after the existing role, prestart, stored-byte and location guards. */
export async function persistEvidenceConfirmation(sb: SupabaseClient<Database>, file: EvidenceInsert, afterSave: () => Promise<void>) {
  const find = async () => {
    const { data, error } = await sb.from("evidence_files").select("id,job_id,requirement_id").eq("storage_path", file.storage_path);
    if (error) throw new Error(`Evidence confirmation could not be checked: ${error.message}`);
    if ((data ?? []).some((row) => row.job_id !== file.job_id || row.requirement_id !== file.requirement_id)) throw new Error("This stored file belongs to another evidence requirement.");
    return data?.[0] ?? null;
  };
  let existing = await find();
  if (!existing) {
    const { error } = await sb.from("evidence_files").insert({ ...file, id: await evidencePathId(file.storage_path) });
    if (error) {
      if (error.code !== "23505") throw new Error(`Evidence file could not be saved: ${error.message}`);
      existing = await find();
      if (!existing) throw new Error(`Evidence file could not be saved: ${error.message}`);
    }
  }
  // Never undo a review on a retry of an already saved file.
  const { data: requirement, error: readError } = await sb.from("evidence_requirements").select("id,status").eq("id", file.requirement_id).single();
  if (readError || !requirement) throw new Error(`Evidence status could not be checked: ${readError?.message ?? "Requirement missing"}`);
  if (!(existing && ["verified", "not_required", "rejected"].includes(requirement.status))) {
    const { data, error } = await sb.from("evidence_requirements").update({ status: "uploaded", verified_by: null, verified_at: null }).eq("id", file.requirement_id).eq("status", requirement.status).select("id");
    if (error || !data?.length) throw new Error(`Evidence status could not be saved: ${error?.message ?? "The requirement changed; retry confirmation"}`);
  }
  await afterSave(); // A later failure is surfaced; retry reuses the file instead of inserting again.
  return { ok: true as const };
}