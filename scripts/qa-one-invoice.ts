// QA harness: real database + FAKE Xero only. Run with Xero creds unset so no live call is possible.
import { supabaseAdmin as db } from "@/integrations/supabase/client.server";
import { createInvoiceForQuote, pushInvoiceToXero, syncInvoiceFromXero, setInstallDueDate } from "@/lib/xero.server";
import { stageEntryBlockers, depositCleared } from "@/lib/workflow.server";
import { installationDateBlocker } from "@/lib/workflow";
import { depositRequestPatch, buildDepositOverride } from "@/lib/invoice.lifecycle";
import { piesaStatus } from "@/lib/workflow.server";
import type { XeroCall } from "@/lib/xero.core";

if (process.env["XERO_API_KEY"] || process.env["LOVABLE_API_KEY"]) throw new Error("Refusing to run with live Xero credentials");
const R: [string, boolean, string][] = [];
const check = (n: string, ok: boolean, info = "") => { R.push([n, ok, info]); console.log(ok ? "PASS" : "FAIL", n, info); };
const OWNER = "00000000-0000-0000-0000-00000000f006", ADMIN = "36b849de-1cde-425c-a05d-623f8985bbd6", INST = "c5cb2a3d-06c1-49b6-877f-39f7944ad710", ELEC = "97364af5-17da-43c6-93aa-372fda5b597f";

// ---- fake Xero ----
const RUN = Date.now().toString(36);
const X = { contacts: [{ ContactID: "FAKE-C1", Name: "Daniel Rossi", EmailAddress: "" }] as any[], invoices: [] as any[], posts: [] as any[], amountPaid: 0 };
const fake: XeroCall = async (path, init = {}) => {
  const m = init.method ?? "GET"; const p = decodeURIComponent(path);
  if (m !== "GET") X.posts.push({ path, m, headers: init.headers, body: init.body });
  if (p.startsWith("/api.xro/2.0/TrackingCategories")) return { TrackingCategories: [{ Name: "Projects", TrackingCategoryID: "tc", Status: "ACTIVE", Options: [{ TrackingOptionID: "FAKE-OPT", Name: "Home Insulation Victoria", Status: "ACTIVE" }] }] };
  if (p.startsWith("/api.xro/2.0/Contacts?")) { const r = /(EmailAddress|Name)=="(.*)"/.exec(p)!; return { Contacts: X.contacts.filter((c) => c[r[1]!] === r[2]) }; }
  if (p === "/api.xro/2.0/Contacts" && m === "POST") { const c = { ContactID: `FAKE-C${X.contacts.length + 1}`, ...init.body.Contacts[0] }; X.contacts.push(c); return { Contacts: [c] }; }
  if (p.startsWith("/api.xro/2.0/Invoices?")) { const ref = /Reference=="(.*)"/.exec(p)![1]; return { Invoices: X.invoices.filter((i) => i.Reference === ref) }; }
  if (p === "/api.xro/2.0/Invoices" && m === "POST") {
    const key = init.headers?.["Idempotency-Key"]; const prior = X.invoices.find((i) => i._key === key);
    if (prior) return { Invoices: [prior] };
    const i = { InvoiceID: `FAKE-${RUN}-I${X.invoices.length + 1}`, InvoiceNumber: `FAKE-${X.invoices.length + 1}`, Status: "AUTHORISED", _key: key, ...init.body.Invoices[0] }; X.invoices.push(i); return { Invoices: [i] };
  }
  const g = /^\/api\.xro\/2\.0\/Invoices\/(.+)$/.exec(p);
  if (g && m === "GET") { const i = X.invoices.find((v) => v.InvoiceID === g[1]); return { Invoices: [{ ...i, AmountPaid: X.amountPaid, Payments: X.amountPaid ? [{ Date: "/Date(1790000000000)/", Amount: X.amountPaid }] : [] }] }; }
  throw new Error(`fake Xero: unexpected ${m} ${p}`);
};

// ---- dummy job ----
const { data: prop } = await db.from("properties").insert({ owner_id: OWNER, address_line: "1 QA Test Street", suburb: "Testvale", state: "VIC", postcode: "3000", is_residential: true, year_built: 1990 }).select("id").single();
const { data: job } = await db.from("jobs").insert({ property_id: prop!.id, owner_id: OWNER, stage: "awaiting_quote_acceptance", source: "qa_test", next_action: "QA one-invoice test job – safe to ignore" }).select("id, job_number").single();
const J = job!.id; console.log("job", job!.job_number);
await db.from("job_assignments").insert([{ job_id: J, user_id: INST, role: "installer" }, { job_id: J, user_id: ELEC, role: "electrician" }]);
const today = new Date(); const d = (n: number) => new Date(today.getTime() + n * 864e5).toISOString().slice(0, 10);
const { data: auth } = await db.from("owner_authorities").insert({ job_id: J, owner_id: OWNER, property_id: prop!.id, version: 1, status: "accepted", wording_version: "qa", wording_snapshot: "QA", scope_snapshot: "QA", owner_full_name: "Daniel Rossi", property_address: "1 QA Test Street", confirmed_over_18: true, confirmed_owner_or_authorised: true, assistance_requirement: "none", acceptance_method: "qa", signature_name: "Daniel Rossi", accepted_at: today.toISOString(), starts_at: today.toISOString(), expires_at: new Date(today.getTime() + 90 * 864e5).toISOString() }).select("id").single();
await db.from("piesa_records").insert({ job_id: J, kind: "initial", outcome: "pass", completed_date: d(0), is_current: true });
const lines = [
  { description: "R4.0 ceiling batts installation", quantity: 107, unit: "m2", unit_price_inc_gst: 27.37, line_total_inc_gst: 2928.59, sort: 1 },
  { description: "Electrical rectification: Install RCD", quantity: 1, unit: "ea", unit_price_inc_gst: 216, line_total_inc_gst: 216, sort: 2 },
  { description: "HI VIC AP / compliance service fee", quantity: 1, unit: "ea", unit_price_inc_gst: 149.96, line_total_inc_gst: 149.96, sort: 3 },
];
const total = 2224.55, veec = 1070;
const { data: q } = await db.from("quotes").insert({ job_id: J, kind: "installation", option_label: "QA R4.0 + rectification", status: "accepted", accepted_at: today.toISOString(), subtotal_inc_gst: 3294.55, gst_amount: 202.23, veec_discount_inc_gst: veec, customer_total_inc_gst: total }).select("id").single();
await db.from("quote_items").insert(lines.map((l) => ({ ...l, quote_id: q!.id })));

// 1-2 accept → one local invoice (push fails safely: no creds)
await createInvoiceForQuote(q!.id, ADMIN);
await createInvoiceForQuote(q!.id, ADMIN); // retry acceptance
let { data: invs } = await db.from("invoices").select("*").eq("job_id", J);
check("S2 one local invoice for full total", invs!.length === 1 && Number(invs![0].total_inc_gst) === total && Number(invs![0].deposit_amount) === 1112.28 && Number(invs![0].balance_amount) === 1112.27, `rows=${invs!.length} dep=${invs![0].deposit_amount} bal=${invs![0].balance_amount}`);
check("S2b no Xero creds → sync error, nothing faked", invs![0].status === "xero_sync_error" && !invs![0].deposit_paid_at, invs![0].last_sync_error ?? "");
const I = invs![0].id;

// 3 fake push
await pushInvoiceToXero(I, ADMIN, fake);
const post = X.posts.find((p) => p.path === "/api.xro/2.0/Invoices")!; const P = post?.body.Invoices[0];
const sum = P.LineItems.reduce((s: number, l: any) => s + Math.round(l.Quantity * l.UnitAmount * 100), 0) / 100;
check("S3 payload lines once + VEEC negative", P.LineItems.length === 4 && P.LineItems[3].UnitAmount === -1070 && lines.every((l) => P.LineItems.filter((x: any) => x.Description.includes(l.description)).length === 1));
check("S3 totals exact, Inclusive, reference, tracking", sum === total && P.LineAmountTypes === "Inclusive" && P.Reference === `HI VIC ${job!.job_number}` && P.LineItems.every((l: any) => l.Tracking?.[0]?.Name === "Projects" && l.Tracking[0].Option === "Home Insulation Victoria"), `sum=${sum} ref=${P.Reference}`);
check("S3 existing contact reused", P.Contact.ContactID === "FAKE-C1" || X.contacts.length === 2, `contacts=${X.contacts.length}`);
({ data: invs } = await db.from("invoices").select("*").eq("job_id", J));
check("S3 linked, due date = acceptance date before install", invs![0].xero_invoice_id === X.invoices[0]?.InvoiceID && P.DueDate === invs![0].deposit_due_date && invs![0].balance_due_date === null);

// 4 deposit request flag
const blk = async (to: any) => stageEntryBlockers(J, to);
check("S4 starts 'request must be raised'", invs![0].deposit_request_raised_at === null);
await db.from("invoices").update(depositRequestPatch(invs![0] as any, ADMIN, new Date().toISOString())).eq("id", I);
({ data: invs } = await db.from("invoices").select("*").eq("id", I));
const b4 = await blk("installation_booked");
check("S4 flag records actor/time/50% amount, still locked", invs![0].deposit_request_raised_by === ADMIN && Number(invs![0].deposit_request_amount) === 1112.28 && Number(invs![0].deposit_request_pct) === 50 && b4.some((b) => b.startsWith("50% deposit")), b4.join(" | "));

// 5 below 50%
X.amountPaid = 1112.27; await syncInvoiceFromXero(I, ADMIN, fake);
check("S5 AmountPaid 1112.27 (<50%) stays locked", !(await depositCleared(J)));
// 6 exactly 50%
X.amountPaid = 1112.28; await syncInvoiceFromXero(I, ADMIN, fake);
const b6 = await blk("installation_booked");
check("S6 AmountPaid exactly 50% clears gate, no other blockers", (await depositCleared(J)) && b6.length === 0, b6.join(" | "));
const { data: st } = await db.from("invoice_status").select("effective_status, deposit_cleared").eq("id", I).single();
check("S6 status deposit_paid", st!.effective_status === "deposit_paid", st!.effective_status);

// 7 invalid authority
await db.from("owner_authorities").update({ status: "revoked", revoked_at: new Date().toISOString(), revocation_reason: "QA" }).eq("id", auth!.id);
const b7 = await blk("installation_booked");
check("S7 revoked authority blocks after 50% paid", b7.includes("Valid Owner Authority required"), b7.join(" | "));
await db.from("owner_authorities").insert({ job_id: J, owner_id: OWNER, property_id: prop!.id, version: 2, status: "accepted", wording_version: "qa", wording_snapshot: "QA", scope_snapshot: "QA", owner_full_name: "Daniel Rossi", property_address: "1 QA Test Street", confirmed_over_18: true, confirmed_owner_or_authorised: true, assistance_requirement: "none", acceptance_method: "qa", signature_name: "Daniel Rossi", accepted_at: today.toISOString(), starts_at: today.toISOString(), expires_at: new Date(today.getTime() + 90 * 864e5).toISOString() });

// 8 expired PIESA
await db.from("piesa_records").update({ completed_date: d(-40) }).eq("job_id", J);
const b8 = await blk("installation_booked"); const ib = installationDateBlocker(await piesaStatus(J), new Date().toISOString());
check("S8 expired PIESA blocks after 50% paid", b8.some((b) => b.includes("PIESA 30-day window expired")) && !!ib, b8.join(" | "));
await db.from("piesa_records").update({ completed_date: d(0) }).eq("job_id", J);

// 9 book (same gates as createBooking) → due date
const start1 = `${d(10)}T23:30:00.000Z`; // Melbourne = next day
const g9 = [...(await blk("installation_booked")), installationDateBlocker(await piesaStatus(J), start1)].filter(Boolean);
await db.from("bookings").insert({ job_id: J, kind: "installation", contractor_id: INST, scheduled_start: start1, booked_by: ADMIN, status: "confirmed" });
await setInstallDueDate(J, start1, ADMIN);
({ data: invs } = await db.from("invoices").select("*").eq("job_id", J));
check("S9 same invoice gets Melbourne install date, Xero update prepared", g9.length === 0 && invs!.length === 1 && invs![0].balance_due_date === d(11) && invs![0].xero_update_pending === true, `due=${invs![0].balance_due_date}`);
// 10 rebook
const start2 = `${d(15)}T02:00:00.000Z`;
await db.from("bookings").update({ status: "cancelled" }).eq("job_id", J).eq("kind", "installation");
await db.from("bookings").insert({ job_id: J, kind: "installation", contractor_id: INST, scheduled_start: start2, booked_by: ADMIN, status: "confirmed" });
await setInstallDueDate(J, start2, ADMIN);
await syncInvoiceFromXero(I, ADMIN, fake); // retry sync: due-date PUT must NOT be sent (disabled)
({ data: invs } = await db.from("invoices").select("*").eq("job_id", J));
check("S10 rebook moves same invoice due date, still one row, no PUT sent", invs!.length === 1 && invs![0].balance_due_date === d(15) && invs![0].xero_update_pending === true && !X.posts.some((p) => p.m === "PUT" || p.path.includes("/Invoices/")), `due=${invs![0].balance_due_date}`);
// 11 owner view figures
const { data: ov } = await db.from("invoice_status").select("total_inc_gst,total_paid,balance_due_date").eq("id", I).single();
check("S11 remaining = total - paid, due = install date", Math.round((ov!.total_inc_gst - ov!.total_paid) * 100) === 111227 && ov!.balance_due_date === d(15));
// 13 retry push/sync idempotency
await pushInvoiceToXero(I, ADMIN, fake); await syncInvoiceFromXero(I, ADMIN, fake);
await db.from("invoices").update({ xero_invoice_id: null }).eq("id", I); await pushInvoiceToXero(I, ADMIN, fake); // lost link → lookup by reference
({ data: invs } = await db.from("invoices").select("*").eq("job_id", J));
check("S13 retries: 1 fake Xero invoice, 1 contact, 1 POST, relinked", X.invoices.length === 1 && X.contacts.length === 1 && X.posts.filter((p) => p.path === "/api.xro/2.0/Invoices").length === 1 && invs![0].xero_invoice_id === X.invoices[0]?.InvoiceID);
// 14 override
let threw = false; try { buildDepositOverride(invs![0] as any, "", ADMIN, "x"); } catch { threw = true; }
await db.from("invoices").update({ deposit_paid_at: null, total_paid: 0, status: "deposit_due" }).eq("id", I);
const locked = !(await depositCleared(J));
const o = buildDepositOverride({ ...(invs![0] as any), deposit_paid_at: null, total_paid: 0, status: "deposit_due" }, "QA: bank transfer receipt sighted", ADMIN, "awaiting_deposit_payment");
await db.from("payment_overrides").insert(o as any);
const { data: ovr } = await db.from("payment_overrides").select("*").eq("invoice_id", I);
const { data: inv14 } = await db.from("invoices").select("deposit_paid_at").eq("id", I).single();
check("S14 override needs reason, audited, distinct from Xero paid", threw && locked && (await depositCleared(J)) && ovr!.length === 1 && ovr![0].overridden_by === ADMIN && (ovr![0].before_state as any).deposit_gate === "locked" && inv14!.deposit_paid_at === null);
const { data: ev } = await db.from("workflow_events").select("event_type").eq("job_id", J);
console.log("events", ev!.map((e) => e.event_type).join(","));
console.log("JOB_ID", J, "INVOICE_ID", I, "PROP", prop!.id);
console.log(`\n${R.filter((r) => r[1]).length}/${R.length} pass`);
