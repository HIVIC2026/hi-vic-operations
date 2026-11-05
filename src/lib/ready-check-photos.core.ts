// Ready Check photo gallery (installer fixes, Task 2): who may see a job's Mitti Ready Check photos, and which rows count.
import { MITTI_PHOTO_DOC_KIND, hiddenMittiPhotoRow } from "./mitti-photos.core";

export type ReadyCheckViewer = { role: "office" } | { role: "installer_owner"; businessId: string };
export type PhotoJob = { deleted_at: string | null; originating_installer_business_id: string | null };
export type PhotoAssignment = { business_id: string | null; role: string | null; active: boolean };

export const READY_CHECK_PHOTO_REFUSAL = "Ready Check photos are only for the office and the installer business on this job.";
export const READY_CHECK_PHOTO_URL_SECONDS = 300;

/** Office sees every job's photos; an installer business owner only where their business has the active installer
 *  assignment, or supplied the job itself. Nobody else (crew, leads, owners, other businesses) is ever allowed. */
export function readyCheckPhotosAllowed(viewer: ReadyCheckViewer | null, job: PhotoJob | null, assignments: PhotoAssignment[]): boolean {
  if (!viewer || !job) return false;
  if (viewer.role === "office") return true;
  if (viewer.role !== "installer_owner" || !viewer.businessId || job.deleted_at) return false;
  return job.originating_installer_business_id === viewer.businessId
    || assignments.some((a) => a.active && a.role === "installer" && a.business_id === viewer.businessId);
}

/** The photo rows to show: finished copies only, oldest first. */
export function visiblePhotoRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows
    .filter((d) => d["kind"] === MITTI_PHOTO_DOC_KIND && !hiddenMittiPhotoRow(d) && !!d["storage_path"])
    .sort((a, b) => String(a["created_at"] ?? "").localeCompare(String(b["created_at"] ?? "")));
}

export const READY_CHECK_PHOTO_LOAD_ERROR = "Ready Check photos could not be loaded. Please try again.";
/** A refusal (not allowed) is a different signal from a failed load. */
export class ReadyCheckRefusal extends Error {}
