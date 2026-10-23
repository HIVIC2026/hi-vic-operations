import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { pickupJobSource } from "../src/lib/mitti-quote-release.core";

test("TEST pickup source and consent fixture persist on practice database before hosted TEST writes", async () => {
  const db = new PGlite();
  await db.exec(`create table jobs(id uuid primary key,source text not null,channel text not null,stage text not null); create table owner_contact_consents(id uuid default gen_random_uuid(),job_id uuid not null,owner_id uuid not null,source text not null,consent_key text not null,consent_status text not null check(consent_status in ('granted','not_granted','unknown')),contact_consent boolean,consented_at timestamptz,snapshot jsonb not null,sha256 text not null,unique(job_id,source,consent_key));`);
  const source = pickupJobSource({ onboarding_notes: "[TEST PARTNER] Reinsulate" });
  await db.query(`insert into jobs values ($1,$2,'installer_sourced','ready_check_scheduled')`, ['05eba075-0e5e-4f96-a584-f45596799e89',source]);
  await db.query(`insert into owner_contact_consents(job_id,owner_id,source,consent_key,consent_status,contact_consent,consented_at,snapshot,sha256) values($1,$2,'qa_test','jo_e2e_test_consent','granted',true,now(),$3,$4)`, ['05eba075-0e5e-4f96-a584-f45596799e89','765fe6bf-964f-42f3-a962-6af0c3aadcc3',JSON.stringify({by:'TEST owner',permission:true}), 'practice-test-sha']);
  expect((await db.query<{source:string;stage:string}>(`select source,stage from jobs`)).rows).toEqual([{source:'qa_test',stage:'ready_check_scheduled'}]);
  expect((await db.query<{consent_status:string}>(`select consent_status from owner_contact_consents`)).rows).toEqual([{consent_status:'granted'}]);
  await db.exec(`create table customer_estimate_links(id uuid default gen_random_uuid(), job_id uuid not null references jobs(id),owner_id uuid not null,purpose text not null,token text not null unique,status text default 'active',expires_at timestamptz not null);`);
  await db.query(`insert into customer_estimate_links(job_id,owner_id,purpose,token,expires_at) values($1,$2,'step3_estimate',$3,now()+interval '30 days')`, ['05eba075-0e5e-4f96-a584-f45596799e89','765fe6bf-964f-42f3-a962-6af0c3aadcc3','practice-token']);
  expect((await db.query<{status:string}>(`select status from customer_estimate_links`)).rows).toEqual([{status:'active'}]);
  await db.exec(`create table quotes(id uuid primary key,status text,release_state text,sent_at timestamptz);insert into quotes values('a2fc6d2e-5210-4429-9e24-294268bea3a1','issued','released',now());update quotes set status='draft',release_state='held',sent_at=null where id='a2fc6d2e-5210-4429-9e24-294268bea3a1';`);
  expect((await db.query<{status:string;sent_at:null}>(`select status,sent_at from quotes`)).rows).toEqual([{status:'draft',sent_at:null}]);
  await db.close();
});