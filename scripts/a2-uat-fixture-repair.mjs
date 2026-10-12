#!/usr/bin/env node
/**
 * A2 SYNTHETIC UAT FIXTURE REPAIR — LOCAL ONLY, IDEMPOTENT
 * Step 70 | W2 AI | HEAD 05783149
 *
 * Purpose: bring synthetic UAT jobs to the MINIMUM VALID fixture state required for the
 * real A2 business flow  Ready Check -> Measured Quote -> Owner Acceptance  to run,
 * WITHOUT bypassing any business gate and WITHOUT fabricating a production approval.
 *
 * HARD SAFETY RAILS (fail-closed):
 *   1. Supabase URL MUST be local loopback (127.0.0.1 / localhost). Any other host aborts.
 *   2. Only jobs whose job_number starts with "UAT-" are touched.
 *   3. Script is idempotent: re-running converges to the same state, never duplicates.
 *   4. Launch switches (auto_send_quote / customer_comms_enabled) are NOT flipped —
 *      a measured quote is released via its own office-released path (release_state='released'),
 *      which is the legitimate HEAD behaviour for the Ready Check measured-quote branch.
 *   5. No external providers, no sends, no deploy. Pure DB seeding of synthetic rows.
 *
 * What it does:
 *   UAT-2001 (hivic_sourced, has current measurement + installer + estimate + settings):
 *     - Ensures an active 'consumer_rights' (+ 'customer_agreement') compliance_template exists
 *       (TEST wording) so assertAgreementCanSign has an approved template to check.
 *     - Ensures the installation quote is status='issued', release_state='released',
 *       sent_at set (non-expired), with at least one quote_item line.
 *     - Moves the job stage to 'measured_estimate_ready' so respondToQuoteImpl accepts it
 *       via the measured-quote path (the owner no-login page surfaces it here).
 *
 *   UAT-2003 (installer_sourced, installer_invoices_owner):
 *     - DOES NOT force a HIV owner-acceptance. That job is, by business rule
 *       (commercialBlocker), an installer-invoices-owner job whose A2 path is the
 *       installer's own quote, not generateInstallerQuotes/respondToQuoteImpl.
 *       Forcing it would BYPASS a real gate (ticket rule 5). The script reports this
 *       as a design blocker and leaves the job unchanged.
 *
 * Usage:
 *   SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=<local-service-role> \
 *   node scripts/a2-uat-fixture-repair.mjs
 */

const URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) {
  console.error("ABORT: SUPABASE_SERVICE_ROLE_KEY env var is required (local service-role key). Do not hardcode credentials.");
  process.exit(1);
}

// RAIL 1: local only.
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(URL.replace(/\/+$/, ""))) {
  console.error(`ABORT: refusing to run against non-local Supabase host: ${URL}`);
  process.exit(2);
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=representation" };
const base = URL.replace(/\/+$/, "") + "/rest/v1";

async function rq(method, path, body, extraPrefer) {
  const headers = { ...H };
  if (extraPrefer) headers.Prefer = extraPrefer;
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return json;
}
const get = (p) => rq("GET", p);
const patch = (p, b) => rq("PATCH", p, b);
const post = (p, b, prefer) => rq("POST", p, b, prefer);

async function jobByNumber(num) {
  const rows = await get(`/jobs?select=id,job_number,stage,channel,installer_led,commercial_model&job_number=eq.${num}`);
  return rows && rows[0];
}

// RAIL 2: assert the target is a synthetic UAT job before any write.
function assertUat(job, num) {
  if (!job) throw new Error(`${num}: job not found`);
  if (!String(job.job_number).startsWith("UAT-")) throw new Error(`${num}: refusing to touch non-UAT job`);
}

async function ensureConsumerRightsTemplate() {
  // Real gate: assertAgreementCanSign -> templateBlockers needs an ACTIVE 'consumer_rights' template.
  // ownerAgreementFn wording also needs an approved 'customer_agreement'. Seed both as TEST wording.
  const wanted = [
    { template_key: "consumer_rights", version: "uat-test-v1", approved: true, is_active: true, required: true,
      body: "TEST (synthetic UAT only): I have read the ESC Consumer Statement of Rights for the Victorian Energy Upgrades program." },
    { template_key: "customer_agreement", version: "uat-test-v1", approved: true, is_active: true, required: true,
      body: "TEST (synthetic UAT only): Customer Agreement with DC Construction Solutions Pty Ltd trading as Home Insulation Victoria." },
  ];
  const results = [];
  for (const t of wanted) {
    const existing = await get(`/compliance_templates?select=template_key,version,approved,is_active&template_key=eq.${t.template_key}&is_active=eq.true`);
    if (existing && existing.length && existing[0].approved) { results.push(`${t.template_key}: already active+approved`); continue; }
    if (existing && existing.length) {
      await patch(`/compliance_templates?template_key=eq.${t.template_key}&is_active=eq.true`, { approved: true });
      results.push(`${t.template_key}: set approved=true`);
    } else {
      try { await post(`/compliance_templates`, t); results.push(`${t.template_key}: inserted TEST template`); }
      catch (e) { results.push(`${t.template_key}: insert skipped (${e.message.slice(0,120)})`); }
    }
  }
  return results;
}

async function repairUat2001() {
  const num = "UAT-2001";
  const job = await jobByNumber(num);
  assertUat(job, num);
  const log = [];

  // Current installation quote.
  const quotes = await get(`/quotes?select=id,kind,status,release_state,version,sent_at,customer_total_inc_gst,option_label&job_id=eq.${job.id}&kind=eq.installation&order=created_at.desc`);
  let q = quotes && quotes[0];
  if (!q) throw new Error(`${num}: no installation quote to repair (would need generateInstallerQuotes first)`);

  // Ensure issued + released + sent (non-expired) — the legitimate measured-quote released state.
  const upd = {};
  if (q.status !== "issued") upd.status = "issued";
  if (q.release_state !== "released") upd.release_state = "released";
  if (!q.sent_at) upd.sent_at = new Date().toISOString(); // today -> within 14-day window, not expired
  upd.option_label = q.option_label || "R5.0 ceiling insulation";
  if (Object.keys(upd).length) { await patch(`/quotes?id=eq.${q.id}`, upd); log.push(`quote ${q.id}: ${JSON.stringify(upd)}`); }
  else log.push(`quote ${q.id}: already issued+released+sent`);

  // Ensure at least one quote_item line (acceptance path reads lines for the package).
  const items = await get(`/quote_items?select=id&quote_id=eq.${q.id}`);
  if (!items || !items.length) {
    const total = Number(q.customer_total_inc_gst || 1600);
    try {
      await post(`/quote_items`, [{
        quote_id: q.id, description: "R5.0 ceiling insulation (synthetic UAT line)",
        quantity: 1, unit: "job", unit_price_inc_gst: total, line_total_inc_gst: total, sort: 0,
      }]);
      log.push(`quote_items: inserted 1 synthetic line (${total} inc GST)`);
    } catch (e) { log.push(`quote_items: insert skipped (${e.message.slice(0,140)})`); }
  } else log.push(`quote_items: ${items.length} already present`);

  // Stage: respondToQuoteImpl accepts installation quotes at awaiting_quote_acceptance OR measured_estimate_ready.
  // The Ready Check branch lands at measured_estimate_ready (owner no-login page surfaces the measured quote there).
  if (job.stage !== "measured_estimate_ready" && job.stage !== "awaiting_quote_acceptance") {
    await patch(`/jobs?id=eq.${job.id}`, {
      stage: "measured_estimate_ready",
      next_action: "Owner to review and accept the measured quote",
    });
    log.push(`stage: ${job.stage} -> measured_estimate_ready`);
  } else log.push(`stage: already ${job.stage}`);

  return log;
}

function reportUat2003() {
  // UAT-2003 is channel=installer_sourced, installer_led=false, commercial_model=installer_invoices_owner.
  // commercialBlocker() returns a hard blocker for exactly this combination, and generateInstallerQuotes
  // throws for installer_sourced jobs. Its A2 acceptance path is the INSTALLER's own quote, not the HIV
  // builder. Repairing it into a HIV owner-acceptance would BYPASS a real business gate (ticket rule 5).
  return [
    "UAT-2003: NOT repaired by design.",
    "  Reason: installer_sourced + installer_invoices_owner -> HIV owner quote-acceptance is gated off by commercialBlocker().",
    "  Correct A2 path for this job = installer-supplied quote flow (installer-quote.server), OR re-channel to a",
    "  NEW synthetic hivic_sourced job. Re-channelling an existing UAT job is a materially consequential choice",
    "  that needs explicit confirmation; this script will not silently flip commercial_model.",
  ];
}

(async () => {
  console.log(`A2 UAT fixture repair @ ${base} (LOCAL-ONLY, idempotent)\n`);
  console.log("== compliance_templates ==");
  for (const l of await ensureConsumerRightsTemplate()) console.log("  " + l);
  console.log("\n== UAT-2001 ==");
  for (const l of await repairUat2001()) console.log("  " + l);
  console.log("\n== UAT-2003 ==");
  for (const l of reportUat2003()) console.log("  " + l);
  console.log("\nDone. Re-run is safe (idempotent).");
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
