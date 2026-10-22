// Mitti Ready Check build, Stages 7–8 (Jo 22 Oct 2026). Pure rules — no database, no network.
// Stage 7: an incomplete Ready Check form → text the installer what's missing; after 24h → office "Chase installer".
//          Photos not needed for the quote are carried to install day and lock "Installation complete".
// Stage 8: the "Office needs to…" Mitti items, from recorded workflow events (latest per job, resolved by a later event).
import type { ReadyCheckFacts } from "./ready-check-complete.core";

export const CHASE_AFTER_MS = 24 * 3_600_000;
/** An unfinished form untouched this long (after its booked visit) counts as left incomplete. */
export const UNFINISHED_IDLE_MS = 6 * 3_600_000;

/** What the installer can fix, in plain installer words. Office-only problems (R2+, life support) are not here. */
export function installerMissing(f: ReadyCheckFacts): string[] {
  const out: string[] = [];
  if (!f.formComplete) out.push("finish and submit the form");
  if (!f.priceKnown) out.push("your total quoted price (inc GST)");
  if (!f.electricianDecided) out.push("who is doing the electrical safety check");
  if (!f.depthPhoto) out.push("a photo showing the insulation depth");
  if (!f.overviewPhoto) out.push("an overview photo of the ceiling space");
  if (f.contactPermission === null) out.push("whether the homeowner agrees to be contacted");
  return out;
}

/** Should the installer be told the form is incomplete? Completed forms with fixable gaps: yes. Unfinished
 *  forms: only once idle 6h AND the booked visit (if any) has passed — never while they're still at the house. */
export function incompleteDecision(p: { completed: boolean; modifiedAt: string | null; visitAt: string | null; now: Date; facts: ReadyCheckFacts }): { notify: boolean; missing: string[] } {
  const missing = installerMissing(p.facts);
  if (!missing.length) return { notify: false, missing };
  if (p.completed) return { notify: true, missing };
  const now = p.now.getTime();
  const idle = p.modifiedAt ? now - new Date(p.modifiedAt).getTime() >= UNFINISHED_IDLE_MS : false;
  const visitPassed = !p.visitAt || new Date(p.visitAt).getTime() < now;
  return { notify: idle && visitPassed, missing };
}

/** Draft installer text — NOT approved; the sms type stays wordingApproved:false until Jo signs it off. */
export function readyCheckIncompleteText(jobNumber: string, address: string | null, missing: string[]): string {
  return `Ready Check ${jobNumber}${address ? ` (${address})` : ""} is missing: ${missing.join("; ")}. Please update it in Mitti. – Home Insulation Victoria`;
}

/** Stable signature so the same gaps are recorded (and texted) once, not on every 15-minute sync. */
export const missingSignature = (missing: string[]) => [...missing].sort().join("|");

// ---------- install-day photo lock ----------
/** Ready Check photos the quote doesn't need, carried to install day (taken before work starts). */
export const INSTALL_DAY_PHOTO_CATEGORIES = ["access_manhole", "before_ceiling_space"] as const;
export const INSTALL_PHOTO_LOCK = "Installation complete stays locked until these install-day photos are in";
type Req = { category: string; label: string | null; gate: string | null; required: boolean; status: string };
export function installDayPhotosOutstanding(reqs: Req[]): string[] {
  return reqs
    .filter((r) => r.required && r.gate === "installation" && (INSTALL_DAY_PHOTO_CATEGORIES as readonly string[]).includes(r.category) && ["outstanding", "rejected"].includes(r.status))
    .map((r) => r.label?.trim() || r.category.replaceAll("_", " "));
}
export function installDayPhotoBlocker(reqs: Req[]): string | null {
  const out = installDayPhotosOutstanding(reqs);
  return out.length ? `${INSTALL_PHOTO_LOCK}: ${out.join(", ")}.` : null;
}

// ---------- Stage 8: "Office needs to…" Mitti items ----------
export type MittiOfficeCode =
  | "mitti_fix_form" | "mitti_review_pickup" | "ready_check_held" | "quote_held_review"
  | "quote_not_delivered" | "mitti_setup_installer" | "ready_check_chase_installer";
export type Ev = { job_id: string | null; event_type: string; created_at: string; details?: Record<string, unknown> | null; summary?: string | null };
export type MittiOfficeItem = { code: MittiOfficeCode; jobId: string | null; since: string; detail: string | null; key: string };

/** Which event raises which item, and which later events on the same job clear it. */
const RULES: { code: MittiOfficeCode; raise: (e: Ev) => boolean; clear: string[]; detail?: (e: Ev) => string | null }[] = [
  { code: "mitti_fix_form", raise: (e) => e.event_type === "mitti_measureup_sync_failed", clear: ["mitti_measureup_synced", "mitti_sync_retried"], detail: (e) => e.summary ?? null },
  { code: "ready_check_held", raise: (e) => e.event_type === "ready_check_needs_office" && !/^Quote released/i.test(e.summary ?? ""), clear: ["installer_quote_queued", "quote_released"], detail: (e) => ((e.details?.["reasons"] as string[] | undefined) ?? []).join("; ") || e.summary || null },
  { code: "quote_not_delivered", raise: (e) => e.event_type === "ready_check_needs_office" && /^Quote released/i.test(e.summary ?? ""), clear: ["quote_ready_notified"], detail: (e) => e.summary ?? null },
  { code: "quote_held_review", raise: (e) => e.event_type === "installer_quote_held", clear: ["installer_quote_queued", "quote_released", "quote_stopped"], detail: (e) => e.summary ?? null },
  { code: "mitti_setup_installer", raise: (e) => e.event_type === "mitti_access_needed", clear: ["mitti_access_confirmed", "mitti_audit_linked", "mitti_measureup_synced"], detail: (e) => e.summary ?? null },
];

export function mittiOfficeItems(events: Ev[], now: Date): MittiOfficeItem[] {
  const sorted = [...events].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const out: MittiOfficeItem[] = [];
  for (const r of RULES) {
    const latest = new Map<string, Ev>();
    for (const e of sorted) if (e.job_id && r.raise(e)) latest.set(e.job_id, e);
    for (const [jobId, e] of latest) {
      const cleared = sorted.some((x) => x.job_id === jobId && x.created_at > e.created_at && r.clear.includes(x.event_type));
      if (!cleared) out.push({ code: r.code, jobId, since: e.created_at, detail: r.detail?.(e) ?? null, key: `${r.code}:${jobId}` });
    }
  }
  // Chase installer: an incomplete-form record still open after 24h (cleared by a later complete sync or held/queued quote).
  const inc = new Map<string, Ev>();
  for (const e of sorted) if (e.job_id && e.event_type === "ready_check_incomplete") inc.set(e.job_id, e);
  for (const [jobId, e] of inc) {
    const cleared = sorted.some((x) => x.job_id === jobId && x.created_at > e.created_at && ["ready_check_complete_clean", "installer_quote_queued", "ready_check_needs_office"].includes(x.event_type));
    if (!cleared && now.getTime() - new Date(e.created_at).getTime() >= CHASE_AFTER_MS)
      out.push({ code: "ready_check_chase_installer", jobId, since: e.created_at, detail: ((e.details?.["missing"] as string[] | undefined) ?? []).join("; ") || null, key: `ready_check_chase_installer:${jobId}` });
  }
  // Forms started in Mitti that need linking/review: job-less pickup events, one per form, cleared once linked.
  const linked = new Set(sorted.filter((e) => e.event_type === "mitti_audit_linked" || e.event_type === "mitti_pickup_auto_created").map((e) => String(e.details?.["audit_id"] ?? "")));
  const seen = new Set<string>();
  for (const e of sorted) {
    if (e.event_type !== "mitti_pickup_needs_review") continue;
    const a = String(e.details?.["audit_id"] ?? ""); if (!a || seen.has(a) || linked.has(a)) continue;
    seen.add(a);
    out.push({ code: "mitti_review_pickup", jobId: null, since: e.created_at, detail: ((e.details?.["reasons"] as string[] | undefined) ?? []).join("; ") || null, key: `mitti_review_pickup:${a}` });
  }
  return out;
}
