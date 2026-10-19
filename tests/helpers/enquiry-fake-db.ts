// Synthetic, in-memory PostgREST-like client for the enquiries list performance tests: counts requests, rows,
// bytes and requests in flight. Latency is an explicit MODEL (rtt + perRow per returned row), not a measurement.
// It supports only what the enquiry loader uses; anything else (e.g. an embedded-column or=) throws.
export type Stats = { bytes: number; requests: number; rows: number; byTable: Record<string, { requests: number; rows: number }>; maxInFlight: number };
export function makeDb(n: number, opts: { rtt?: number; perRow?: number; jobPerRow?: number; rejectLean?: boolean; failTable?: string } = {}) {
  const rtt = opts.rtt ?? 60, perRow = opts.perRow ?? 0.02, jobPerRow = opts.jobPerRow ?? 0.15;
  const T: Record<string, any[]> = {};
  const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
  const outcomes = ["likely_eligible", "needs_onsite_confirmation", "does_not_appear_eligible", null];
  const ins = ["No", "Yes - some batts", "Not sure"];
  T.jobs = Array.from({ length: n }, (_, i) => ({
    id: id(i), job_number: `HV-${1000 + i}`, external_enquiry_id: `ENQ-${i}`, stage: "new_enquiry", hold_reason: null, source: "base44", channel: "hivic_sourced",
    created_at: new Date(Date.UTC(2026, 8, 1) + i * 600_000).toISOString(), eligibility_set_at: i % 3 ? new Date(Date.UTC(2026, 8, 2) + i * 600_000).toISOString() : null,
    eligibility_outcome: outcomes[i % 4], eligibility_decision_source: "system", eligibility_review_required: i % 17 === 0, eligibility_decision_rules: { hard_failures: i % 4 === 2 ? ["Built after 2005"] : [] },
    estimated_area_m2: i % 5 ? 120 + (i % 40) : null, estimated_area_unknown: i % 5 === 0,
    owners: { full_name: `Owner ${i} ${i % 7 === 0 ? "Smith" : "Nguyen"}`, email: i % 9 === 0 ? `dup${i % 90}@gmail.com` : `owner${i}@${i % 2 ? "gmail.com" : "example.org"}`, phone: `04${String(10000000 + i)}` },
    properties: { address_line: `${i % 9 === 0 ? 1 : i} Test St`, suburb: "Testville", state: "VIC", postcode: String(3000 + (i % 200)),
      enrichment: { base44: { raw: { answers: { existing_insulation: ins[i % 3] }, media: [] } }, research: { blob: "x".repeat(4000) } } },
  }));
  const each = (k: number, f: (i: number) => any) => T.jobs.flatMap((j: any, i: number) => (i % k === 0 ? [f(i)] : []));
  T.ceiling_measurements = each(10, (i) => ({ job_id: id(i), verified_area_m2: 130, measured_area_m2: 131, is_current: true, status: "complete" }));
  T.property_area_estimates = each(3, (i) => ({ id: `e${i}`, job_id: id(i), tier: "address_research", net_m2: 140, created_at: "2026-09-01" }));
  T.evidence_files = each(8, (i) => ({ job_id: id(i), mime_type: "image/jpeg", storage_path: `${id(i)}/intake/a.jpg` }));
  T.post_intake_work = each(50, (i) => ({ job_id: id(i), status: "queued" }));
  T.customer_email_sends = T.jobs.flatMap((j: any, i: number) => (i % 2 ? [{ job_id: j.id, purpose: "existing_leads_launch_v1", status: "sent", sent_at: "2026-09-10", created_at: "2026-09-10", error: null, idempotency_key: `k${i}` }, ...(i % 6 === 1 ? [{ job_id: j.id, purpose: "preliminary_ineligible", status: "sent", sent_at: "2026-09-11", created_at: "2026-09-11", error: null, idempotency_key: `p${i}` }] : [])] : []));
  T.owner_contact_consents = T.jobs.map((j: any) => ({ job_id: j.id, consent_status: "granted", created_at: "2026-09-01" }));
  T.customer_email_optouts = each(25, (i) => ({ job_id: id(i), opted_out_at: "2026-09-12" }));
  T.customer_engagement_events = [...each(40, (i) => ({ job_id: id(i), event_type: "email_bounced", occurred_at: "2026-09-12", metadata: {} })), ...each(12, (i) => ({ job_id: id(i), event_type: "intake_media_reviewed", occurred_at: "2026-09-12", metadata: { outcome: "below_r2" } }))];
  T.calculator_interests = Array.from({ length: Math.round(n * 0.6) }, (_, i) => ({ email: `calc${i}@x.com`, address_line: `${i} Calc Rd`, postcode: "3000", created_at: "2026-09-01" }));
  T.customer_delivery_settings = [{ id: 1, jobs_created_after: "2026-09-01" }];
  T.lead_campaign_responses = each(7, (i) => ({ job_id: id(i), spot_saved_at: "2026-09-15" }));
  T.documents = each(15, (i) => ({ job_id: id(i), kind: "intake_media", mime_type: "video/mp4", storage_path: `${id(i)}/intake/v.mp4`, source_system: "base44", external_id: `x${i}` }));
  T.workflow_events = each(100, (i) => ({ job_id: id(i), event_type: "lead_removed" }));
  // non-website jobs for head counts
  const other = Array.from({ length: Math.round(n * 0.1) }, (_, i) => ({ id: `o${i}`, source: i % 2 ? "qa_test" : "manual", channel: i % 3 ? "installer_sourced" : "x" }));

  const ors: string[] = [];
  const stats: Stats = { bytes: 0, requests: 0, rows: 0, byTable: {}, maxInFlight: 0 };
  let inFlight = 0;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  function from(table: string) {
    const filters: ((r: any) => boolean)[] = [];
    let range: [number, number] | null = null, single = false, head = false, count = false, cols = "*";
    const orders: [string, boolean][] = [];
    const base = () => (table === "jobs" ? [...T.jobs, ...other] : T[table] ?? []);
    const pick = (r: any, k: string) => k.split(".").reduce((o, p) => o?.[p], r);
    const q: any = {
      select(c: string, o?: { count?: string; head?: boolean }) { cols = c; head = !!o?.head; count = !!o?.count; return q; },
      eq(k: string, v: any) { filters.push((r) => pick(r, k) === v); return q; },
      neq(k: string, v: any) { filters.push((r) => pick(r, k) !== v); return q; },
      in(k: string, v: any[]) { const s = new Set(v); filters.push((r) => s.has(pick(r, k))); return q; },
      like(k: string, v: string) { const re = new RegExp("^" + v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$"); filters.push((r) => re.test(String(pick(r, k)))); return q; },
      ilike(k: string, v: string) { const re = new RegExp("^" + v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$", "i"); filters.push((r) => re.test(String(pick(r, k) ?? ""))); return q; },
      or(expr: string) { ors.push(expr); if (/^source\.neq/.test(expr)) filters.push((r) => r.source !== "base44" || r.channel !== "hivic_sourced"); else throw new Error("unsupported or: " + expr); return q; },
      order(k: string, o?: { ascending?: boolean }) { orders.push([k, o?.ascending ?? true]); return q; },
      range(a: number, b: number) { range = [a, b]; return q; },
      limit(n: number) { range = [0, n - 1]; return q; },
      maybeSingle() { single = true; return q; },
      single() { single = true; return q; },
      then(res: any, rej: any) { return run().then(res, rej); },
    };
    async function run() {
      if (opts.failTable === table) { stats.requests++; return { data: null, error: { message: `${table} unavailable (test)` }, count: null }; }
      if (opts.rejectLean && table === "jobs" && /->/.test(cols)) { stats.requests++; return { data: null, error: { message: "PGRST100 (test): json path rejected" }, count: null }; }
      inFlight++; stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
      let rows = base().filter((r: any) => filters.every((f) => f(r)));
      for (const [k, asc] of [...orders].reverse()) rows = [...rows].sort((a, b) => { const x = pick(a, k), y = pick(b, k); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1); });
      const total = rows.length;
      if (range) rows = rows.slice(range[0], range[1] + 1);
      if (table === "jobs" && /base44_raw:enrichment->base44->raw/.test(cols)) rows = rows.map((r: any) => ({ ...r, properties: r.properties ? (({ enrichment, ...rest }: any) => ({ ...rest, base44_raw: enrichment?.base44?.raw ?? null }))(r.properties) : null }));
      if (!head) stats.bytes += JSON.stringify(single ? rows.slice(0, 1) : rows).length;
      const returned = head ? 0 : single ? Math.min(1, rows.length) : rows.length;
      stats.requests++; stats.rows += returned;
      const t = (stats.byTable[table] ??= { requests: 0, rows: 0 }); t.requests++; t.rows += returned;
      await sleep(rtt + returned * (table === "jobs" ? jobPerRow : perRow));
      inFlight--;
      if (head) return { data: null, error: null, count: total };
      if (single) return { data: rows[0] ?? null, error: null, count: count ? total : null };
      return { data: rows, error: null, count: count ? total : null };
    }
    return q;
  }
  return { client: { from }, stats, tables: T, ors, reset() { stats.bytes = 0; stats.requests = 0; stats.rows = 0; stats.byTable = {}; stats.maxInFlight = 0; } };
}
