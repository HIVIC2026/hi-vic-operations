import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
const db = admin as any;
export async function reminderSettings() {
  const { data, error } = await db.from("workflow_settings").select("sms_message_switches").eq("id", 1).single();
  if (error || !data) throw new Error("Could not read reminder switch");
  const switches = data.sms_message_switches ?? {};
  return { switches, enabled: switches.save_spot_reminder === true, activatedAt: typeof switches.save_spot_reminder_activated_at === "string" ? switches.save_spot_reminder_activated_at : null };
}
export async function setReminderEnabled(enabled: boolean, actorId: string) {
  const before = await reminderSettings();
  const activatedAt = enabled ? before.enabled && before.activatedAt ? before.activatedAt : new Date().toISOString() : before.activatedAt;
  const switches = { ...before.switches, save_spot_reminder: enabled, save_spot_reminder_activated_at: activatedAt };
  const { data, error } = await db.from("workflow_settings").update({ sms_message_switches: switches }).eq("id",1).eq("sms_message_switches",JSON.stringify(before.switches)).select("id").maybeSingle();
  if (error || !data) throw new Error("Reminder switch not confirmed saved; reload and try again");
  const { error: auditError } = await db.from("admin_config_events").insert({ actor_id: actorId, event_type: "save_spot_reminder_switch", summary: `24-hour spot reminder ${enabled ? "enabled" : "disabled"}`, details: { enabled, activatedAt, previousEnabled: before.enabled } });
  if (auditError) throw new Error("Reminder switch saved but audit failed; review before continuing");
  return { enabled, activatedAt };
}