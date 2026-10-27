// One TEST calculator registration end to end (Jo 27 Oct), then archive. TEST-domain only; prints counts, no personal data.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { parseInterest } from "@/lib/interest.core";
import { startCalculatorEnquiry, dryRunCalculatorBackfill } from "@/lib/calculator-intake.server";

const dry = await dryRunCalculatorBackfill();
console.log("DRY RUN (existing unlinked registrations):", JSON.stringify(dry));

const tag = crypto.randomUUID().slice(0, 8);
const email = `qa.calc.${tag}@hivic-test.example`;
if (!email.endsWith("@hivic-test.example")) throw new Error("SAFETY STOP");
const started = new Date().toISOString();
const draft = { fullName: "Test Calculator", mobile: "0400 000 000", email, addressLine: `${Math.floor(Math.random() * 900) + 100} Test Calc Street`, suburb: "Frankston", postcode: "3199", ceilingM2: 120, insulationDeclared: "none" as const, consent: true, honeypot: "" };
const parsed = parseInterest(draft);
if (!parsed.ok) throw new Error("parse failed " + JSON.stringify(parsed.errors));
const ins = async () => { const { data, error } = await admin.from("calculator_interests").insert({ full_name: parsed.value.fullName, mobile: parsed.value.mobile, email: parsed.value.email, address_line: parsed.value.addressLine, suburb: parsed.value.suburb, postcode: parsed.value.postcode, ceiling_m2: parsed.value.ceilingM2, insulation_declared: parsed.value.insulationDeclared, consent_version: parsed.value.consentVersion }).select("id, consented_at").single(); if (error) throw error; return data!; };
const rows = [await ins(), await ins()];
const first = await startCalculatorEnquiry(rows[0]!.id, parsed.value, rows[0]!.consented_at);
const second = await startCalculatorEnquiry(rows[1]!.id, parsed.value, rows[1]!.consented_at);
const { data: job } = await admin.from("jobs").select("job_number, source, stage, external_refs").eq("id", first.jobId!).single();
const { data: links } = await admin.from("calculator_interests").select("job_id").in("id", rows.map((r) => r.id));
const { count: consents } = await admin.from("owner_contact_consents").select("id", { count: "exact", head: true }).eq("job_id", first.jobId!);
const { count: events } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", first.jobId!).eq("event_type", "calculator_registration");
const { count: sends } = await admin.from("customer_email_sends").select("id", { count: "exact", head: true }).eq("job_id", first.jobId!);
const { count: sms } = await admin.from("sms_messages").select("id", { count: "exact", head: true }).eq("job_id", first.jobId!);
console.log("TEST RUN:", JSON.stringify({ job: job?.job_number, source: job?.source, stage: job?.stage, channel: (job?.external_refs as Record<string, unknown>)?.["intake_channel"], firstCreated: first.created, secondCreated: second.created, sameJob: first.jobId === second.jobId, rowsLinked: (links ?? []).filter((l) => l.job_id === first.jobId).length, consents, events, emailRows: sends, smsRows: sms }));
// Archive only this run's TEST job; remove its two TEST registration rows.
const now = new Date().toISOString();
await admin.from("jobs").update({ qa_archived_at: now, stage: "cancelled", cancelled_reason: "TEST calculator run archived", next_action: "Archived TEST run" }).eq("id", first.jobId!).eq("source", "qa_test").gte("created_at", started);
await admin.from("calculator_interests").delete().in("id", rows.map((r) => r.id)).eq("email", email);
const { data: after } = await admin.from("jobs").select("stage, qa_archived_at").eq("id", first.jobId!).single();
console.log("ARCHIVED:", JSON.stringify({ stage: after?.stage, archived: !!after?.qa_archived_at }));
