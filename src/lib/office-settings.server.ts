// O7 Settings reads + the one write (flip an office switch). Server-only; callers are admin-checked server functions.
// Switch writes are restricted to OFFICE_SWITCH_COLUMNS and SMS message types, compare-and-swap on the value the office
// saw (JSON serialised explicitly for sms_message_switches), and audited in admin_config_events. Nothing here sends.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { OFFICE_SWITCH_COLUMNS, SWITCHES, smsTypeSwitches, switchState, withSmsSwitch, type OfficeSwitchColumn } from "./office-settings.core";
import { SMS_MESSAGE_TYPES, type SmsMessageType } from "./sms.core";
import { ACCEPTANCE_EMAIL_APPROVED } from "./acceptance-email.core";
import { INSTALL_COMPLETE_EMAIL_APPROVED } from "./completion-emails.core";
import { CONSENT_COPY_EMAIL_APPROVED } from "./consent-copy-email.core";
import { PROVISIONAL_RELEASE_OWNER_NOTICE_APPROVED } from "./deposit-release-notice.core";
import { ESTIMATE_FOLLOWUP_APPROVED } from "./estimate-followup.core";
import { SAVE_SPOT_REAL_SEND_APPROVED } from "./hot-leads.core";
import { INSTALL_BOOKED_EMAIL_APPROVED } from "./install-booked-email.core";
import { INSTALL_DAYS_EMAIL_APPROVED } from "./install-days-email.core";
import { INSTALL_NO_ACCESS_NOTICE_APPROVED } from "./install-no-access-notice.core";
import { INSTALLER_ACCEPTED_EMAIL_APPROVED, INSTALLER_DECLINED_EMAIL_APPROVED } from "./installer-accepted-email.core";
import { OWNER_QUOTE_EMAIL_APPROVED, QUOTE_REMINDER_EMAIL_APPROVED } from "./owner-quote-email.core";
import { PIESA_COPY_EMAIL_APPROVED } from "./piesa-delivery.core";
import { FIXES_QUOTE_EMAIL_APPROVED } from "./rectification-quote-email.core";
import { SAFETY_CHECK_EMAILS_APPROVED } from "./safety-check-emails.core";
import { THIRTY_DAY_REMINDER_APPROVED } from "./thirty-day-rule.core";
import { VEEC_COPY_EMAIL_APPROVED, VEEC_SIGN_EMAIL_APPROVED } from "./veec-emails.core";

const db = admin as any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function settingsRow(): Promise<Record<string, unknown> | null> {
  // select("*") so a pending column that is not applied yet is simply absent (fail closed), never a query error.
  const { data, error } = await db.from("workflow_settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw new Error(`Settings could not be read: ${error.message}`);
  return data ?? null;
}

export async function officeSwitches() {
  const row = await settingsRow();
  const defs = [...SWITCHES, ...smsTypeSwitches()];
  return { switches: defs.map((d) => ({ key: d.key, label: d.label, what: d.what, why: d.why, kind: d.kind, ...switchState(d, row) })), named: SWITCHES.length };
}

/** Flip one office switch. `expected` is the value the office saw; if it changed meanwhile nothing is written. */
export async function setOfficeSwitch(key: string, on: boolean, expected: boolean, reason: string, actorId: string) {
  const def = [...SWITCHES, ...smsTypeSwitches()].find((d) => d.key === key);
  if (!def) throw new Error("Unknown switch.");
  if (def.kind === "code") throw new Error("This switch is set in code and can only be changed with Jo's approval.");
  const row = await settingsRow();
  if (!row) throw new Error("Settings could not be read; nothing changed.");
  const state = switchState(def, row);
  if (!state.editable) throw new Error(state.note ?? "This switch can't be changed here.");
  if (state.on !== expected) throw new Error("Someone changed this switch a moment ago — reload and try again. Nothing changed.");
  if (state.on === on) return { ok: true, unchanged: true };
  const stamp = new Date().toISOString();
  let q;
  if (def.kind === "column") {
    const column: OfficeSwitchColumn = def.column;
    if (!(OFFICE_SWITCH_COLUMNS as readonly string[]).includes(column)) throw new Error("This setting can't be changed here.");
    q = db.from("workflow_settings").update({ [column]: on, updated_at: stamp }).eq("id", 1).eq(column, expected);
  } else {
    if (def.smsType in SMS_MESSAGE_TYPES && on && !SMS_MESSAGE_TYPES[def.smsType as SmsMessageType].wordingApproved) throw new Error("This text's wording isn't approved, so it can't be switched on.");
    const before = row["sms_message_switches"] ?? {};
    // Compare-and-swap on the whole map, serialised explicitly (src/lib rule: JSON equality filters are serialised).
    q = db.from("workflow_settings").update({ sms_message_switches: withSmsSwitch(before, def.smsType, on), updated_at: stamp }).eq("id", 1).eq("sms_message_switches", JSON.stringify(before));
  }
  const { data, error } = await q.select("id");
  if (error) throw new Error(`Switch not changed: ${error.message}`);
  if (!data?.length) throw new Error("Someone changed the settings a moment ago — reload and try again. Nothing changed.");
  await db.from("admin_config_events").insert({ actor_id: actorId, event_type: "office_switch_changed", summary: `${def.label} turned ${on ? "on" : "off"}`, details: { key, kind: def.kind, from: expected, to: on, reason } });
  return { ok: true, unchanged: false };
}

/** Settings › Templates register: who gets each email/text, when, automatic or pressed, and whether Jo approved the wording. */
export function messageRegister() {
  const email = (message: string, who: string, how: "Automatic" | "Pressed", approved: boolean, why: string) => ({ message, channel: "email", who, how, approved, why });
  const emails = [
    email("Your estimate / Save my spot", "Owner · on enquiry", "Automatic", SAVE_SPOT_REAL_SEND_APPROVED, "decision 180"),
    email("Save my spot reminders (O66–O68)", "Owner · days 2, 7, 21", "Automatic", ESTIMATE_FOLLOWUP_APPROVED, "decision 242"),
    email("Your quote is ready", "Owner · when the office presses Send", "Pressed", OWNER_QUOTE_EMAIL_APPROVED, "decision 87"),
    email("Quote reminder", "Owner · while the quote is open", "Automatic", QUOTE_REMINDER_EMAIL_APPROVED, "quote expiry nudges"),
    email("Quote accepted", "Owner · on acceptance", "Automatic", ACCEPTANCE_EMAIL_APPROVED, "acceptance email"),
    email("Safety check (PIESA) emails", "Owner · booking and payment", "Automatic", SAFETY_CHECK_EMAILS_APPROVED, "decision 139"),
    email("PIESA copy", "Owner · after the PIESA", "Automatic", PIESA_COPY_EMAIL_APPROVED, "PIESA delivery rule"),
    email("Electrical fixes quote", "Owner · fixes quote released", "Automatic", FIXES_QUOTE_EMAIL_APPROVED, "decision 142"),
    email("Your installer has offered 3 days", "Owner · install days offered", "Automatic", INSTALL_DAYS_EMAIL_APPROVED, "decision 186"),
    email("Your install is booked", "Owner · install day agreed", "Automatic", INSTALL_BOOKED_EMAIL_APPROVED, "decision 151"),
    email("Install day released (deposit not received)", "Owner · 48h after booking", "Automatic", PROVISIONAL_RELEASE_OWNER_NOTICE_APPROVED, "decision 170"),
    email("30-day window reminder", "Owner · 20 and 10 days left", "Automatic", THIRTY_DAY_REMINDER_APPROVED, "decision 167"),
    email("We couldn't get in today", "Owner · install no access", "Automatic", INSTALL_NO_ACCESS_NOTICE_APPROVED, "decision 217"),
    email("All done — please sign the rebate form", "Owner · install complete", "Automatic", INSTALL_COMPLETE_EMAIL_APPROVED, "decision 169"),
    email("Please sign the rebate form — reminder", "Owner · days 1, 3, 7", "Automatic", VEEC_SIGN_EMAIL_APPROVED, "decision 168"),
    email("Your signed rebate form (copy)", "Owner · within 10 business days", "Automatic", VEEC_COPY_EMAIL_APPROVED, "decision 120"),
    email("Your signed ESC consent (copy)", "Owner · after the AP signs", "Automatic", CONSENT_COPY_EMAIL_APPROVED, "decision 170"),
    email("Offer accepted / not for me", "Installer · offer answered", "Automatic", INSTALLER_ACCEPTED_EMAIL_APPROVED && INSTALLER_DECLINED_EMAIL_APPROVED, "installer emails"),
  ];
  const texts = (Object.keys(SMS_MESSAGE_TYPES) as SmsMessageType[]).map((t) => ({
    message: SMS_MESSAGE_TYPES[t].label.replace(/\s*\(.*$/, "").replace(/ – .*$/, ""), channel: "text", who: SMS_MESSAGE_TYPES[t].audience === "owner" ? "Owner" : "Installer / electrician",
    how: "Automatic" as const, approved: SMS_MESSAGE_TYPES[t].wordingApproved as boolean, why: "decision 159 per-type text",
  }));
  return [...emails, ...texts];
}

/** Settings › Xero payments health: webhook key and poll switch are environment flags; last payment = latest ledger event. */
export async function xeroPaymentsHealth() {
  const { data } = await db.from("workflow_events").select("created_at").eq("event_type", "owner_payment_recorded").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return {
    webhookConfigured: !!process.env["XERO_WEBHOOK_KEY"],
    pollEnabled: process.env["XERO_PAYMENT_POLL_ENABLED"] === "true",
    stripeEnabled: process.env["STRIPE_PAYMENTS_ENABLED"] === "true",
    lastPaymentAt: (data?.created_at as string | undefined) ?? null,
  };
}
