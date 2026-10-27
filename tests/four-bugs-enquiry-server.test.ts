import { expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";
const db = new PGlite();
await db.exec(`create table office_enquiry_index(id text, office_bucket text, created_at text, enquiry_status text, needs_first_response boolean); create table customer_email_sends(job_id text,sent_at text,created_at text,purpose text,status text); create table sms_messages(job_id text,created_at text,message_type text,status text,business_id text); create table job_communications(job_id text,sent_at text,received_at text,channel text,delivery_status text,direction text,visibility text); insert into office_enquiry_index values ('lead','enquiry','2025-01-01','offered_spot',false); insert into customer_email_sends values ('lead','2025-02-01','2025-02-01','step3_estimate','sent'); insert into job_communications values ('lead',null,'2025-03-01','email',null,'inbound','customer'),('lead','2026-10-27',null,'note','sent','internal','customer'),('lead','2026-10-27',null,'email','sent','outbound','trade');`);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db) }));
mock.module("../src/lib/office.server", () => ({ loadOffice: async () => ({}) }));
const { enquiryCloseBlocker } = await import("../src/lib/office-lists.server");
test("fresh server closure check excludes internal notes and trade mail as replies", async () => {
  expect(await enquiryCloseBlocker("lead")).toContain("has not been answered");
  await db.exec("insert into job_communications values ('lead','2025-04-01',null,'email','sent','outbound','customer')");
  expect(await enquiryCloseBlocker("lead")).toBeNull();
  await db.exec("delete from customer_email_sends");
  expect(await enquiryCloseBlocker("lead")).toContain("no confirmed first reply");
});