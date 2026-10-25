import { test, expect, setSystemTime } from "bun:test";
import { reminderTimeBlocker, selectBlast, type BlastRow } from "../src/lib/save-spot-reminder-blast.core";
import { createOneTapCredential, verifyOneTapCredential } from "../src/lib/save-spot-one-tap.core";
import { smsBlocker } from "../src/lib/sms.core";

// Environment: these texts honour the 8pm–7am Melbourne quiet hours (Jo 22 Oct 2026). Pin the clock to 1pm Melbourne on
// today's date so the result never depends on when the suite runs.
{ const midday = new Date(); midday.setUTCHours(2, 0, 0, 0); setSystemTime(midday); }

const now = Date.parse("2026-10-21T04:28:00Z"), offer = "2026-10-20T04:28:00Z";
test("24-hour boundary uses actual offer send, not enquiry date", () => {
  expect(reminderTimeBlocker(offer,now-1)).toBe("Spot offer is less than 24 hours old");
  expect(reminderTimeBlocker(offer,now)).toBeNull();
});
test("missing or invalid sent time cannot qualify", () => {
  expect(reminderTimeBlocker(null,now)).not.toBeNull();
  expect(reminderTimeBlocker("invalid",now)).not.toBeNull();
});
test("turning automatic on never releases prior offers", () => {
  expect(reminderTimeBlocker(offer,now,"2026-10-20T04:28:01Z")).toBe("Historical offer — catch-up review only");
  expect(reminderTimeBlocker(offer,now,offer)).toBeNull();
  expect(reminderTimeBlocker(offer,now,null)).not.toBeNull();
});
test("newer not-yet-due enquiry blocks fallback to older phone enquiry", () => {
  const r: BlastRow = { id:"one", job_number:"HV-1",created_at:offer,offeredAt:offer,source:"base44",owner_name:"Jane",owner_phone:"0491234567",spot_offered:true,spot_saved:false,deleted_at:null,removed:false,stage:"new_enquiry",total:3728,rebate:1470,link:"https://example.test",consent:true };
  expect(selectBlast([r,{...r,id:"two",created_at:"2026-10-21T03:00:00Z",offeredAt:"2026-10-21T03:00:00Z",owner_phone:"+61491234567"}],[],[],[],{now}).recipients).toHaveLength(0);
});
test("automatic requires its switch while every other customer type stays off", () => {
  const x={type:"save_spot_reminder",to:"0491234567",commsEnabled:true,typeSwitchOn:false,senderConfigured:true,optedOut:false,consent:true,isTestRecord:false};
  expect(smsBlocker(x)).not.toBeNull();
  expect(smsBlocker({...x,typeSwitchOn:true})).toBeNull();
  expect(smsBlocker({...x,type:"spot_saved"})).not.toBeNull();
});
const secret="isolated-test-secret-only-".repeat(3),token="a".repeat(64);
test("secure one-tap credential decrypts only with right purpose-bound key and no visible estimate token",async()=>{
  const c=await createOneTapCredential(token,now+1000,secret);
  expect(c).not.toContain(token);expect(await verifyOneTapCredential(c,secret,now)).toBe(token);
  expect(await verifyOneTapCredential(c,"other-isolated-secret-only-".repeat(3),now)).toBeNull();
});
test("tampered one-tap credential cannot save",async()=>{
  const c=await createOneTapCredential(token,now+1000,secret);
  expect(await verifyOneTapCredential((c[0]==="a"?"b":"a")+c.slice(1),secret,now)).toBeNull();
});
test("expired one-tap credential cannot save at expiry",async()=>{
  const c=await createOneTapCredential(token,now,secret);
  expect(await verifyOneTapCredential(c,secret,now)).toBeNull();
});