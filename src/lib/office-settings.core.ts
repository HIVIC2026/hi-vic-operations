// O7 Settings (decisions 15/60, 154, 159, 16, 246, 248): pure catalogues for Switches, Automatic rules and the message
// register. No database, no network. A switch is one of:
//  - "column": a boolean column on workflow_settings (office-editable, audited, compare-and-swap);
//  - "sms":    one entry of workflow_settings.sms_message_switches (per message type, decision 159);
//  - "code":   a constant in code (shown read-only — changing it is a code change Jo approves, never a click);
//  - "env":    a deployment environment flag (shown read-only).
// The automatic-offer switches (decision 246) are ONLY rendered and persisted here; what they do is the backend's.
import { AUTO_QUOTE_SEND_ENABLED } from "./auto-quote-send.core";
import { CONSENT_COPY_EMAIL_APPROVED } from "./consent-copy-email.core";
import { SMS_MESSAGE_TYPES, type SmsMessageType } from "./sms.core";

export type SwitchDef =
  | { key: string; label: string; what: string; why: string; kind: "column"; column: OfficeSwitchColumn; pendingMigration?: string | undefined }
  | { key: string; label: string; what: string; why: string; kind: "sms"; smsType: string }
  | { key: string; label: string; what: string; why: string; kind: "code"; value: boolean; where: string };

/** The ONLY workflow_settings columns the Settings page may write. Anything else is refused server-side. */
export const OFFICE_SWITCH_COLUMNS = ["customer_comms_enabled", "auto_installer_offers", "auto_electrician_offers", "mitti_pickup_auto_enabled", "mitti_instant_notice_enabled", "daily_mitti_text_enabled", "esc_registry_robot_enabled"] as const;
export type OfficeSwitchColumn = (typeof OFFICE_SWITCH_COLUMNS)[number];
/** Columns that need a pending migration before they exist (fail closed: shown "waiting for the database change"). */
export const PENDING_SWITCH_COLUMNS: Partial<Record<OfficeSwitchColumn, string>> = {
  auto_installer_offers: "docs/pending-migrations/auto-offer-switches.sql",
  auto_electrician_offers: "docs/pending-migrations/auto-offer-switches.sql",
  esc_registry_robot_enabled: "docs/pending-migrations/esc-registry-robot-switch.sql",
};

export const SWITCHES: SwitchDef[] = [
  { key: "auto_quote_send", label: "Auto quote send", what: "Ready Check quotes go to the owner when the Mitti form is Complete and every check passes", why: "Jo 24 Oct (A1/A2 auto quote); AUTO_QUOTE_SEND_ENABLED", kind: "code", value: AUTO_QUOTE_SEND_ENABLED, where: "auto-quote-send.core.ts AUTO_QUOTE_SEND_ENABLED" },
  { key: "auto_installer_offers", label: "Automatic installer offers", what: "Offer goes to one installer covering the postcode (fewest active jobs, then nearest); 24h each; after 2 misses → Needs me", why: "decision 246", kind: "column", column: "auto_installer_offers", pendingMigration: PENDING_SWITCH_COLUMNS.auto_installer_offers },
  { key: "auto_electrician_offers", label: "Automatic electrician offers", what: "Nearest approved electrician covering the postcode (our leads); installer's own customers use the electrician chosen at Add a job; same 24h rule", why: "decisions 246/374", kind: "column", column: "auto_electrician_offers", pendingMigration: PENDING_SWITCH_COLUMNS.auto_electrician_offers },
  { key: "customer_comms", label: "Customer emails and texts", what: "The master switch for every owner email and text (each text type also needs its own switch below)", why: "decisions 159, 154", kind: "column", column: "customer_comms_enabled" },
  { key: "spot_saved", label: "Spot saved confirmation · text", what: "Text when a spot is saved", why: "decision 159; spot-saved-send rule", kind: "sms", smsType: "spot_saved" },
  { key: "spot_saved_email", label: "Spot saved confirmation · email", what: "Email when a spot is saved", why: "decision 159; spot-saved-send rule", kind: "sms", smsType: "spot_saved_email" },
  { key: "install_no_access", label: "We couldn't get in today", what: "Text after a no-access install day (email follows the same approval)", why: "decisions 215, 217", kind: "sms", smsType: "install_no_access" },
  { key: "veec_sign_reminder", label: "Rebate form reminders", what: "Days 1, 3 and 7 after the install", why: "decisions 120, 168", kind: "sms", smsType: "veec_sign_reminder" },
  { key: "consent_copy", label: "ESC consent copy", what: "Email after the AP signs (copy of the signed consent)", why: "decision 170", kind: "code", value: CONSENT_COPY_EMAIL_APPROVED, where: "consent-copy-email.core.ts CONSENT_COPY_EMAIL_APPROVED" },
  { key: "daily_mitti", label: "Installer good-morning texts", what: "6:30am Mitti links on job days (each installer text type also has its own switch)", why: "decision 154", kind: "column", column: "daily_mitti_text_enabled" },
  { key: "mitti_pickup", label: "Mitti pick-up", what: "Forms started in Mitti become jobs every 15 minutes", why: "Mitti-first pickup rule", kind: "column", column: "mitti_pickup_auto_enabled" },
  { key: "mitti_instant", label: "Mitti instant updates", what: "Ready Check changes reach the portal within a minute (the 15-minute check stays as backup)", why: "Jo 27 Oct 2026", kind: "column", column: "mitti_instant_notice_enabled" },
  { key: "esc_registry_robot", label: "ESC Registry robot", what: "Fills the VEU Registry install notification (24h–5 days before the install) and the VEEC creation (after the owner signs); dry run until the deployment is set live; TEST jobs never submit; a failure comes to Needs me", why: "decisions 195, 272; also needs ESC_REGISTRY_ROBOT_ENABLED on the deployment", kind: "column", column: "esc_registry_robot_enabled", pendingMigration: PENDING_SWITCH_COLUMNS.esc_registry_robot_enabled },
];

/** Every SMS message type also has its own switch (decision 159: one type at a time); listed after the named ones. */
export function smsTypeSwitches(): SwitchDef[] {
  const named = new Set(SWITCHES.filter((s) => s.kind === "sms").map((s) => (s as { smsType: string }).smsType));
  return (Object.keys(SMS_MESSAGE_TYPES) as SmsMessageType[]).filter((t) => !named.has(t)).map((t) => ({
    key: `sms:${t}`, label: SMS_MESSAGE_TYPES[t].label.replace(/\s*\(.*$/, "").replace(/ – .*$/, ""), what: `${SMS_MESSAGE_TYPES[t].audience === "owner" ? "Text to the owner" : "Text to installers/electricians"}${SMS_MESSAGE_TYPES[t].wordingApproved ? "" : " · wording not approved, can't send"}`,
    why: "decision 159 per-type text switch", kind: "sms" as const, smsType: t,
  }));
}

export type SwitchState = { on: boolean | null; editable: boolean; note: string | null };
/** Current state of one switch from the workflow_settings row (null row/column = unknown → shown off and not editable). */
export function switchState(def: SwitchDef, row: Record<string, unknown> | null): SwitchState {
  if (def.kind === "code") return { on: def.value, editable: false, note: `Set in code (${def.where}) — changed only with Jo's approval` };
  if (!row) return { on: null, editable: false, note: "Settings could not be read" };
  if (def.kind === "column") {
    if (!(def.column in row)) return { on: false, editable: false, note: def.pendingMigration ? `Waiting for the database change (${def.pendingMigration}); off until then` : "Not available" };
    return { on: row[def.column] === true, editable: true, note: null };
  }
  const sw = row["sms_message_switches"];
  const map = sw && typeof sw === "object" && !Array.isArray(sw) ? (sw as Record<string, unknown>) : {};
  const approved = def.smsType in SMS_MESSAGE_TYPES ? SMS_MESSAGE_TYPES[def.smsType as SmsMessageType].wordingApproved : true;
  return { on: map[def.smsType] === true, editable: approved, note: approved ? null : "Wording not approved — can't be switched on" };
}

/** The new sms_message_switches value after flipping one type (other types untouched). */
export function withSmsSwitch(current: unknown, type: string, on: boolean): Record<string, boolean> {
  const base = current && typeof current === "object" && !Array.isArray(current) ? { ...(current as Record<string, boolean>) } : {};
  base[type] = on;
  return base;
}

/** Which held-message groups (office-comms groupHeld ids) a switch releases, so turning it on can offer to cancel them first. */
export function heldGroupsFor(def: SwitchDef): (groupId: string) => boolean {
  if (def.kind === "sms") return (id) => id === `held:text:${def.smsType}`;
  if (def.kind === "column" && def.column === "customer_comms_enabled") return (id) => id.startsWith("held:");
  return () => false;
}

/** Settings › Automatic rules: read-only, what the portal does on its own (decisions 220, 238, 2, 141, 120, 130, 158, 246). */
export const AUTOMATIC_RULES: { rule: string; what: string; why: string }[] = [
  { rule: "Save my spot and estimates", what: "Reminders on days 2, 7 and 21, then the lead closes itself a week later", why: "decisions 238, 242" },
  { rule: "Installer offer", what: "24 hours to answer, then it lapses and Needs me says Choose again", why: "decision 220" },
  { rule: "Automatic installer offers", what: "When switched on: one installer covering the postcode (fewest active jobs, then nearest), 24 hours each; after 2 misses the job goes to Needs me", why: "decision 246" },
  { rule: "Automatic electrician offers", what: "When switched on: the nearest approved electrician covering the postcode (our leads); installer's own customers use the electrician chosen at Add a job; same 24-hour rule", why: "decisions 246/374" },
  { rule: "Install days", what: "Installer offers 3 days after the PIESA; owner takes one or suggests 1–5; one office alert at 10 days left", why: "decisions 2, 186" },
  { rule: "Deposit hold", what: "Install day is provisional for 48 hours until the 10% deposit is in", why: "decision 141" },
  { rule: "Rebate form", what: "Owner asked at completion, reminded days 1, 3, 7; office alert on day 10", why: "decisions 119, 120, 169" },
  { rule: "Privacy notice", what: "Per person, reminders days 3 and 7; can't be on an install until acknowledged", why: "decision 130" },
  { rule: "30-day PIESA window", what: "Reminders at 20 and 10 days; a repeat PIESA is paid by whoever caused the delay", why: "decision 158" },
  { rule: "ESC Registry robot", what: "When switched on and set live: submits the install notification inside the 24h–5 day window and creates the VEECs once the owner has signed; screenshot + reference on the job; never twice; any failure goes to Needs me for the office to do by hand", why: "decisions 195, 272" },
];
