import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { signFile } from "./file-links.server";
import { WorkflowError } from "./workflow.server";
import { tradeRoleOf } from "./trade-access-role.core";
import { MITTI_PHOTO_DOC_KIND } from "./mitti-photos.core";
import { READY_CHECK_PHOTO_REFUSAL, READY_CHECK_PHOTO_URL_SECONDS, readyCheckPhotosAllowed, visiblePhotoRows, type PhotoAssignment, type PhotoJob, type ReadyCheckViewer } from "./ready-check-photos.core";

export type ReadyCheckPhoto = { id: string; label: string; url: string };

/** Who this sign-in is for photos: the office (admin), the boss of an installer business, or nobody (crew/lead links never sign in). */
export async function readyCheckViewerFor(userId: string): Promise<ReadyCheckViewer | null> {
  const [{ data: roles }, { data: mem }] = await Promise.all([
    admin.from("user_roles").select("role").eq("user_id", userId),
    admin.from("business_members").select("business_id, member_role").eq("user_id", userId).eq("active", true),
  ]);
  if ((roles ?? []).some((r) => r.role === "admin")) return { role: "office" };
  const boss = (mem ?? []).find((m) => tradeRoleOf({ memberRole: m.member_role, workerTradeRole: null }) === "boss");
  return boss?.business_id ? { role: "installer_owner", businessId: boss.business_id } : null;
}

export async function readyCheckPhotos(jobId: string, viewer: ReadyCheckViewer | null): Promise<ReadyCheckPhoto[]> {
  const [{ data: job }, { data: asg }] = await Promise.all([
    admin.from("jobs").select("deleted_at, originating_installer_business_id").eq("id", jobId).maybeSingle(),
    admin.from("job_assignments").select("business_id, role, active").eq("job_id", jobId).eq("active", true),
  ]);
  if (!readyCheckPhotosAllowed(viewer, (job ?? null) as PhotoJob | null, (asg ?? []) as PhotoAssignment[])) throw new WorkflowError(READY_CHECK_PHOTO_REFUSAL);
  const { data: docs, error } = await admin.from("documents").select("id, kind, title, storage_path, size_bytes, created_at").eq("job_id", jobId).eq("kind", MITTI_PHOTO_DOC_KIND);
  if (error) throw new WorkflowError("Ready Check photos could not be loaded. Try again.");
  const rows = visiblePhotoRows((docs ?? []) as Record<string, unknown>[]);
  const out: ReadyCheckPhoto[] = [];
  for (const d of rows) {
    const { data: s } = await signFile("job-files", String(d["storage_path"]), READY_CHECK_PHOTO_URL_SECONDS);
    if (s?.signedUrl) out.push({ id: String(d["id"]), label: String(d["title"] || "Ready Check photo"), url: s.signedUrl });
  }
  return out;
}

export async function readyCheckPhotosForUser(jobId: string, userId: string): Promise<ReadyCheckPhoto[]> {
  return readyCheckPhotos(jobId, await readyCheckViewerFor(userId));
}
