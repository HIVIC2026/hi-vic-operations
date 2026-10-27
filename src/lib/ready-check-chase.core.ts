// Mitti Ready Check build, Stages 7–8 (Jo 22 Oct 2026). Pure rules — no database, no network.
// Stage 7: an incomplete Ready Check form → text the installer what's missing; after 24h → office "Chase installer".
//          Photos are optional on the Ready Check; decision 396 retired carrying them to install day.
// Stage 8: the "Office needs to…" Mitti items, from recorded workflow events (latest per job, resolved by a later event).
import type { ReadyCheckFacts } from "./ready-check-complete.core";

export const CHASE_AFTER_MS = 24 * 3_600_000;
/** An unfinished form untouched this long (after its booked visit) counts as left incomplete. */
export const UNFINISHED_IDLE_MS = 6 * 3_600_000;

/** What the installer can fix, in plain installer words. Office-only problems (R2+, life support) are not here. */
export function installerMissing(f: ReadyCheckFacts): string[] {
  const out: string[] = [];
  if (!f.formComplete) out.push("finish and submit the form");
  // Jo 27 Oct 2026 (HV-3385): the installer's price is never on the Mitti form any more — it is entered by the business
  // owner in the portal ("Your price" card, decision 278). The form chase must never ask Mitti for it.
  if (!f.electricianDecided) out.push("who is doing the electrical safety check");
  // Photos are optional in Mitti (Jo 23 Oct; access hatch photo optional, Jo 26 Oct) — never chased here (decision 396).
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

/** Decision 83 (Jo, 24 Oct 2026) "Missing answers" text, verbatim: "Nearly there! {HV} ({address}) still needs: {items}.
 *  Add them in Mitti and we'll prepare the owner's quote." The sender adds the brand prefix. */
export function readyCheckIncompleteText(jobNumber: string, address: string | null, missing: string[]): string {
  return `Nearly there! ${jobNumber}${address ? ` (${address})` : ""} still needs: ${missing.join("; ")}. Add them in Mitti and we'll prepare the owner's quote.`;
}

/** Stable signature so the same gaps are recorded (and texted) once, not on every 15-minute sync. */
export const missingSignature = (missing: string[]) => [...missing].sort().join("|");

// ---------- retired install-day photo chase (decision 396) ----------
/** Decision 396 (Jo, 26 Oct 2026): the "missing Ready Check photos become install-day photos" chase is gone — the A5
 *  asks the legally required ruler photos itself (install-evidence.core `rulerPhotoEvaluation`); access hatch / area
 *  overview photos are not legally required. Requirement rows the chase created earlier (gate `installation`, one of
 *  these categories, label "Install day: …" — the job's seeded checklist rows of the same categories are NOT these) are
 *  IGNORED in code wherever evidence is gated or listed; no database change. */
export const RETIRED_INSTALL_DAY_PHOTO_CATEGORIES = ["access_manhole", "before_ceiling_space", "existing_insulation_r_value"] as const;
export const RETIRED_INSTALL_DAY_PHOTO_LABEL_PREFIX = "Install day:";
export function isRetiredInstallDayPhotoRow(r: { category?: string | null; gate?: string | null; label?: string | null }): boolean {
  return r.gate === "installation" && (RETIRED_INSTALL_DAY_PHOTO_CATEGORIES as readonly string[]).includes(String(r.category ?? ""))
    && String(r.label ?? "").trim().startsWith(RETIRED_INSTALL_DAY_PHOTO_LABEL_PREFIX);
}
export const withoutRetiredInstallDayPhotos = <T extends { category?: string | null; gate?: string | null; label?: string | null }>(rows: readonly T[]): T[] => rows.filter((r) => !isRetiredInstallDayPhotoRow(r));

// ---------- Stage 8: "Office needs to…" Mitti items ----------
export type MittiOfficeCode =
  | "mitti_fix_form" | "mitti_review_pickup" | "ready_check_held" | "quote_held_review"
  | "quote_not_delivered" | "mitti_setup_installer" | "ready_check_chase_installer" | "quote_auto_send_held" | "xero_invoice_product_unconfirmed"
  | "install_deposit_unpaid_at_start" | "payment_match_unclear" | "xero_invoice_repairs_held" | "xero_invoice_repeat_piesa_held";
export type Ev = { job_id: string | null; event_type: string; created_at: string; details?: Record<string, unknown> | null; summary?: string | null };
export type MittiOfficeItem = { code: MittiOfficeCode; jobId: string | null; since: string; detail: string | null; key: string };

/** Which event raises which item, and which later events on the same job clear it. */
const RULES: { code: MittiOfficeCode; raise: (e: Ev) => boolean; clear: string[]; detail?: (e: Ev) => string | null }[] = [
  { code: "mitti_fix_form", raise: (e) => e.event_type === "mitti_measureup_sync_failed", clear: ["mitti_measureup_synced", "mitti_sync_retried"], detail: (e) => e.summary ?? null },
  { code: "ready_check_held", raise: (e) => e.event_type === "ready_check_needs_office" && !/^Quote released/i.test(e.summary ?? ""), clear: ["installer_quote_queued", "quote_hold_approved", "quote_requeued_after_review", "quote_hold_stopped"], detail: (e) => ((e.details?.["reasons"] as string[] | undefined) ?? []).join("; ") || e.summary || null },
  { code: "quote_not_delivered", raise: (e) => e.event_type === "ready_check_needs_office" && /^Quote released/i.test(e.summary ?? ""), clear: ["quote_declined", "quote_hold_stopped"], detail: (e) => e.summary ?? null },
  { code: "quote_held_review", raise: (e) => e.event_type === "installer_quote_held", clear: ["installer_quote_queued", "quote_hold_approved", "quote_requeued_after_review", "quote_hold_stopped"], detail: (e) => e.summary ?? null },
  // Jo 24 Oct: automatic send on Complete held a quote (or the form changed after sending); cleared once a quote goes out.
  { code: "quote_auto_send_held", raise: (e) => e.event_type === "quote_auto_send_held", clear: ["quote_sent_automatically", "quote_sent_by_office", "quote_hold_stopped"], detail: (e) => ((e.details?.["reasons"] as string[] | undefined) ?? []).join("; ") || e.summary || null },
  { code: "mitti_setup_installer", raise: (e) => e.event_type === "mitti_access_needed", clear: ["mitti_access_override", "mitti_audit_linked", "mitti_synced", "mitti_measureup_synced"], detail: (e) => e.summary ?? null },
  // Decision 209: the Xero invoice went out with the rate-card wording because the product or measured area was unknown.
  { code: "xero_invoice_product_unconfirmed", raise: (e) => e.event_type === "xero_invoice_product_unconfirmed", clear: ["xero_invoice_product_confirmed"], detail: (e) => ((e.details?.["reasons"] as string[] | undefined) ?? []).join("; ") || e.summary || null },
  // Decision 367: an install day started with the 10% deposit still unpaid (sweepProvisionalBookings); cleared once the
  // deposit lands (install_booking_confirmed) or the booking is released.
  { code: "install_deposit_unpaid_at_start", raise: (e) => e.event_type === "install_deposit_unpaid_at_start", clear: ["install_booking_confirmed", "install_booking_released_unpaid"], detail: (e) => e.summary ?? null },
  // Audit R02: a card + Xero pair with the same amount and no shared Stripe id (both counted); cleared once the payments
  // reconcile by Stripe id or the Xero payment is removed (payments.server flagUnclearPaymentMatches).
  { code: "payment_match_unclear", raise: (e) => e.event_type === "owner_payment_match_unclear", clear: ["owner_payment_match_resolved"], detail: (e) => e.summary ?? null },
  // Audit R07: approved electrical fixes could not be added to the job's one Xero invoice (paid/credited/voided invoice,
  // switch off, totals differ); cleared once they are on it (`xero_invoice_repairs_added`, added or adopted after Sync).
  { code: "xero_invoice_repeat_piesa_held", raise: (e) => e.event_type === "xero_invoice_repeat_piesa_held", clear: ["xero_invoice_repeat_piesa_added"], detail: (e) => (e.details?.["reason"] as string | undefined) ?? e.summary ?? null },
  { code: "xero_invoice_repairs_held", raise: (e) => e.event_type === "xero_invoice_repairs_held", clear: ["xero_invoice_repairs_added"], detail: (e) => (e.details?.["reason"] as string | undefined) ?? e.summary ?? null },
  // Decision 327 replaced the decision-314 "Electrician must be on site … tell the installer and electrician" line: the
  // electrician is asked automatically once the day is booked (install-attendance.core); the office sees only
  // `electrician_install_attendance` (no answer after 48h, or no day inside the window). Old events stay as history.
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
    const cleared = sorted.some((x) => x.job_id === jobId && x.created_at > e.created_at && ["ready_check_incomplete_cleared", "installer_quote_queued", "ready_check_needs_office"].includes(x.event_type));
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
