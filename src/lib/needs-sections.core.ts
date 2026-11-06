// Presentation only: partition the existing authorised Needs me rows without changing their actions or guards.
import type { NeedsKind, NeedsRow, SystemRow } from "./office-needs.core";

export const NEEDS_SECTIONS = [
  { key: "deadlines", label: "Deadlines" },
  { key: "quotes", label: "Quotes to check" },
  { key: "partners", label: "Partner & Team" },
  { key: "installers", label: "Choose installers" },
  { key: "forms", label: "Forms" },
] as const;
export type NeedsSection = typeof NEEDS_SECTIONS[number]["key"];
const deadlines = new Set<NeedsKind>(["in_house_ready_check_not_booked", "in_house_piesa_overdue", "in_house_install_not_booked", "esc_window", "sign_consent", "prestart_failed", "certificate_not_in", "booking_overdue", "lapsed_window", "repeat_piesa_choose", "upgrades_past_30_days", "upgrades_day_red", "ready_check_person_missing", "complaint_ack_due", "complaint_resolve_due", "payment_overdue", "piesa_owner_unsigned", "piesa_fixes_owner_unsigned", "veec_day_10", "tenant_notice_held"]);
const partners = new Set<NeedsKind>(["in_house_handed_back", "own_job_piesa_handed_back", "in_house_esc_lead_changed", "choose_electrician", "choose_again", "mitti_electrician_choice", "own_job_piesa_held", "release_lapsed"]);
const forms = new Set<NeedsKind>(["send_failed", "robot_failed", "piisa_form_failed", "piesa_form_failed", "mitti_form_problem", "in_house_form_sync_failed", "piesa_auto_complete_held", "same_day_part_c_failed", "own_job_swap_form_not_moved", "own_job_installer_not_told", "stop_release_failed", "unsubscribe_cleanup_failed", "invoice_failed", "install_deposit_request_failed", "new_quote_unfinished"]);

export function needsSection(row: NeedsRow, _now: number): NeedsSection {
  if (row.kind === "choose_installer") return "installers";
  if (row.kind === "ten_days_left") return "deadlines"; // Keep the existing clock alert; never discard it.
  if (deadlines.has(row.kind)) return "deadlines";
  // An elapsed waiting age is not a due date. Only explicit due/overdue wording puts other money/reply rows here.
  if (/\b(?:due on|due by|overdue|deadline)\b/i.test(row.line) && !forms.has(row.kind)) return "deadlines";
  if (partners.has(row.kind)) return "partners";
  if (forms.has(row.kind)) return "forms";
  return "quotes";
}
export function systemSection(row: SystemRow): NeedsSection {
  if (row.tag === "Quote" || row.key.startsWith("feedback:")) return "quotes";
  if (row.tag === "System" || row.key.startsWith("sync:") || row.key.startsWith("pickup:") || row.key.startsWith("partner-send:") || /send failed|sync problem/i.test(row.line)) return "forms";
  return "partners";
}
export function partitionNeeds(rows: NeedsRow[], system: SystemRow[], now: number) {
  return NEEDS_SECTIONS.map(s => {
    const selected = rows.filter(r => needsSection(r, now) === s.key);
    if (s.key === "quotes") selected.sort((a, b) => Number(b.kind === "quote_check" || b.kind === "fixes_quote_check") - Number(a.kind === "quote_check" || a.kind === "fixes_quote_check"));
    return { ...s, rows: selected, system: system.filter(r => systemSection(r) === s.key) };
  });
}
export function deadlineDisplay(row: NeedsRow, now: number): string {
  const prefix = row.kind === "prestart_failed" ? "DON'T START · " : "";
  if (/\b\d+\s*(?:business )?days?\b/i.test(row.line)) return prefix + row.line;
  const elapsed = Math.max(0, Math.floor((now - Date.parse(row.since)) / 86400000));
  return prefix + row.line + (Number.isFinite(elapsed) ? ` · waiting ${elapsed} day${elapsed === 1 ? "" : "s"}` : " · due date not recorded");
}