import { a3MediaFiles, type A3MediaFile } from "./piisa-a3.core";

export const PIISA_POSTWORK = [
  { key: "completed_video", category: "post_install_video", label: "Completed-work video", accept: (type: string) => type.startsWith("video/") },
  { key: "final_plan", category: "final_zone_plan", label: "Final roof-space plan", accept: (type: string) => type.startsWith("image/") || type === "application/pdf" },
] as const;

export function currentPostworkMedia(audit: unknown): { files: { key: typeof PIISA_POSTWORK[number]["key"]; media: A3MediaFile[] }[]; blockers: string[] } {
  const media = a3MediaFiles(audit);
  const blockers: string[] = [];
  const files = PIISA_POSTWORK.map((r) => {
    const actual = media[r.key];
    if (!actual.length || actual.some((f) => !f.mediaId)) blockers.push(`${r.label}: attach the actual after-installation evidence to this PIISA; signing does not finish the form.`);
    return { key: r.key, media: actual };
  });
  return { files, blockers };
}

export function postworkReviewProblems(label: string, req: { status: string; verified_by: string | null; verified_at: string | null }, storedPaths: string[], actualPaths: string[]): string[] {
  if (JSON.stringify([...storedPaths].sort()) !== JSON.stringify([...actualPaths].sort())) return [`${label}: stored files do not match this audit's current attachments; office review required.`];
  if (req.status !== "verified" || !req.verified_by || !req.verified_at || !Number.isFinite(Date.parse(req.verified_at))) return [`${label}: office must verify the actual after-work evidence before final PIISA output or AP submission.`];
  return [];
}