import { afterAll, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { createClient } from "@supabase/supabase-js";
const db = new PGlite();
afterAll(async () => { await db.close(); });
let concurrentEdit = false;
await db.exec(`create table workflow_settings(id int primary key,sms_message_switches jsonb not null default '{}');insert into workflow_settings values(1,'{"spot_saved":false,"daily_mitti":true}');create table admin_config_events(actor_id text,event_type text,summary text,details jsonb);`);
mock.module("@/integrations/supabase/client.server",()=>({supabaseAdmin:{from:(table:string)=>{
  let patch:any,expected:any;const q={select:()=>q,eq:(key:string,v:any)=>{if(key==="sms_message_switches")expected=v;return q;},update:(v:any)=>{patch=v;return q;},insert:async(v:any)=>{await db.query("insert into admin_config_events values($1,$2,$3,$4)",[v.actor_id,v.event_type,v.summary,JSON.stringify(v.details)]);return {error:null};},single:async()=>({data:(await db.query("select * from workflow_settings where id=1")).rows[0],error:null}),maybeSingle:async()=>{
    // Match the SDK's string coercion, not an unrealistically JSON-encoded object.
    if (concurrentEdit) { concurrentEdit=false; await db.exec(`update workflow_settings set sms_message_switches=sms_message_switches || '{"other_switch":true}'::jsonb where id=1`); }
    try { return {data:(await db.query("update workflow_settings set sms_message_switches=$1 where id=1 and sms_message_switches=$2 returning id",[JSON.stringify(patch.sms_message_switches),String(expected)])).rows[0],error:null}; }
    catch (error) { return {data:null,error}; }
  }};return q;
}}}));
const {reminderSettings,setReminderEnabled}=await import("../src/lib/save-spot-reminder-settings.server");
test("practice actual settings handler defaults OFF and changes only reminder fields with audit",async()=>{
  expect((await reminderSettings()).enabled).toBe(false);
  const on=await setReminderEnabled(true,"isolated-admin");expect(on.enabled).toBe(true);expect(on.activatedAt).not.toBeNull();
  expect((await reminderSettings()).switches.spot_saved).toBe(false);expect((await reminderSettings()).switches.daily_mitti).toBe(true);
  const again=await setReminderEnabled(true,"isolated-admin");expect(again.activatedAt).toBe(on.activatedAt);
  await setReminderEnabled(false,"isolated-admin");expect((await reminderSettings()).enabled).toBe(false);
  expect((await db.query<{n:number}>("select count(*)::int n from admin_config_events")).rows[0]?.n).toBe(3);
});
test("concurrent settings edit is refused without overwriting it or recording success",async()=>{
  const before=(await db.query<{n:number}>("select count(*)::int n from admin_config_events")).rows[0]?.n;
  concurrentEdit=true;
  await expect(setReminderEnabled(true,"isolated-admin")).rejects.toThrow("Reminder switch not confirmed saved");
  const state=await reminderSettings();
  expect(state.enabled).toBe(false);
  expect(state.switches.other_switch).toBe(true);
  expect((await db.query<{n:number}>("select count(*)::int n from admin_config_events")).rows[0]?.n).toBe(before);
});
test("actual SDK sends a parseable JSON equality filter, never object Object",async()=>{
  const switches=(await reminderSettings()).switches;
  let filter:string|null=null;
  const client=createClient("https://example.invalid","isolated-test-key",{global:{fetch:async(input)=>{
    filter=new URL(String(input)).searchParams.get("sms_message_switches");
    return new Response("[]",{headers:{"content-type":"application/json"}});
  }}});
  await client.from("workflow_settings").update({sms_message_switches:switches}).eq("id",1).eq("sms_message_switches",JSON.stringify(switches)).select("id");
  expect(filter).toBe(`eq.${JSON.stringify(switches)}`);
});