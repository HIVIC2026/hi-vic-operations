import { expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
await db.exec(`create table workflow_settings(id int primary key,sms_message_switches jsonb not null default '{}');insert into workflow_settings values(1,'{"spot_saved":false,"daily_mitti":true}');create table admin_config_events(actor_id text,event_type text,summary text,details jsonb);`);
mock.module("@/integrations/supabase/client.server",()=>({supabaseAdmin:{from:(table:string)=>{
  let patch:any,expected:any;const q={select:()=>q,eq:(key:string,v:any)=>{if(key==="sms_message_switches")expected=v;return q;},update:(v:any)=>{patch=v;return q;},insert:async(v:any)=>{await db.query("insert into admin_config_events values($1,$2,$3,$4)",[v.actor_id,v.event_type,v.summary,JSON.stringify(v.details)]);return {error:null};},single:async()=>({data:(await db.query("select * from workflow_settings where id=1")).rows[0],error:null}),maybeSingle:async()=>({data:(await db.query("update workflow_settings set sms_message_switches=$1 where id=1 and sms_message_switches=$2 returning id",[JSON.stringify(patch.sms_message_switches),JSON.stringify(expected)])).rows[0],error:null})};return q;
}}}));
const {reminderSettings,setReminderEnabled}=await import("../src/lib/save-spot-reminder-settings.server");
test("practice actual settings handler defaults OFF and changes only reminder fields with audit",async()=>{
  expect((await reminderSettings()).enabled).toBe(false);
  const on=await setReminderEnabled(true,"isolated-admin");expect(on.enabled).toBe(true);expect(on.activatedAt).not.toBeNull();
  expect((await reminderSettings()).switches.spot_saved).toBe(false);expect((await reminderSettings()).switches.daily_mitti).toBe(true);
  const again=await setReminderEnabled(true,"isolated-admin");expect(again.activatedAt).toBe(on.activatedAt);
  await setReminderEnabled(false,"isolated-admin");expect((await reminderSettings()).enabled).toBe(false);
  expect((await db.query<{n:number}>("select count(*)::int n from admin_config_events")).rows[0]?.n).toBe(3);
  await db.close();
});