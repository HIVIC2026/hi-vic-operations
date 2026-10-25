// Synthetic, in-memory PostgREST-like client that COUNTS database round trips for office read paths (Needs me, Jobs,
// Enquiries) and the tick sweeps. Latency is an explicit MODEL (rtt per request + perRow per returned row) so a
// waterfall of sequential reads shows up as wall time; it is not a measurement of the live database.
// Filters: eq / neq / in / is / not(is null) / gt / gte / lt / lte / range are applied; everything else (or, contains,
// order, ilike…) is recorded but returns the unfiltered superset, which only ever OVER-counts rows, never requests.
// Writes (insert/update/upsert/delete) are recorded and refused, so a read path that writes fails loudly.
type Row = Record<string, any>;
export type QueryLog = { site?: string; table: string; op: string; filters: string[]; inSizes: number[]; rows: number; at: number; ms: number };
/** depth = the longest chain of requests that each started after the previous one finished (sequential round trips). */
export type CounterStats = { requests: number; waves: number; depth: number; rows: number; byTable: Record<string, number>; log: QueryLog[]; maxInFlight: number; writes: string[] };

export function makeCounterDb(tables: Record<string, Row[]>, opts: { rtt?: number; perRow?: number; maxIn?: number; conn?: number } = {}) {
  // conn: open connections at once (a Cloudflare Worker allows 6 simultaneous subrequests; the rest queue).
  const rtt = opts.rtt ?? 40, perRow = opts.perRow ?? 0.05, conn = opts.conn ?? Infinity;
  let open = 0; const queue: (() => void)[] = [];
  const stats: CounterStats = { requests: 0, waves: 0, depth: 0, rows: 0, byTable: {}, log: [], maxInFlight: 0, writes: [] };
  let inFlight = 0, doneDepth = 0;
  const t0 = Date.now();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const get = (r: Row, c: string) => (c in r ? r[c] : undefined);

  function builder(table: string, op = "select") {
    const site = process.env["PERF_TRACE"] ? (new Error().stack ?? "").split("\n").slice(2).filter((l) => /src\/lib/.test(l)).slice(0, 2).map((l) => l.replace(/.*src\/lib\//, "").replace(/\)$/, "")).join(" < ") : undefined;
    const preds: ((r: Row) => boolean)[] = [];
    const filters: string[] = []; const inSizes: number[] = [];
    let from = 0, to = Infinity, single: null | "one" | "maybe" = null, head = false, limit = Infinity, count = false;
    const b: any = {
      select(_c?: string, o?: { count?: string; head?: boolean }) { if (o?.head) head = true; if (o?.count) count = true; return b; },
      eq(c: string, v: unknown) { filters.push(`eq:${c}`); preds.push((r) => get(r, c) === undefined || get(r, c) === v); return b; },
      neq(c: string, v: unknown) { filters.push(`neq:${c}`); preds.push((r) => get(r, c) !== v); return b; },
      in(c: string, v: unknown[]) {
        if (opts.maxIn && v.length > opts.maxIn) throw new Error(`${table}.in(${c}) with ${v.length} values exceeds ${opts.maxIn}`);
        filters.push(`in:${c}`); inSizes.push(v.length); const s = new Set(v); preds.push((r) => get(r, c) === undefined || s.has(get(r, c))); return b;
      },
      is(c: string, v: null) { filters.push(`is:${c}`); preds.push((r) => (v === null ? get(r, c) == null : get(r, c) === v)); return b; },
      not(c: string, o: string, v: unknown) { filters.push(`not:${c}`); if (o === "is" && v === null) preds.push((r) => get(r, c) != null);
        else if (o === "in" && typeof v === "string") { const set = new Set(v.replace(/[()]/g, "").split(",").map((x) => x.trim())); preds.push((r) => !set.has(String(get(r, c)))); }
        return b; },
      gt(c: string, v: string) { filters.push(`gt:${c}`); preds.push((r) => get(r, c) === undefined || (get(r, c) !== null && String(get(r, c)) > String(v))); return b; },
      gte(c: string, v: string) { filters.push(`gte:${c}`); preds.push((r) => get(r, c) === undefined || (get(r, c) !== null && String(get(r, c)) >= String(v))); return b; },
      lt(c: string, v: string) { filters.push(`lt:${c}`); preds.push((r) => get(r, c) === undefined || (get(r, c) !== null && String(get(r, c)) < String(v))); return b; },
      lte(c: string, v: string) { filters.push(`lte:${c}`); preds.push((r) => get(r, c) === undefined || (get(r, c) !== null && String(get(r, c)) <= String(v))); return b; },
      range(a: number, z: number) { from = a; to = z; return b; },
      limit(n: number) { limit = n; return b; },
      single() { single = "one"; return b; }, maybeSingle() { single = "maybe"; return b; },
      insert() { op = "insert"; return b; }, update() { op = "update"; return b; }, upsert() { op = "upsert"; return b; }, delete() { op = "delete"; return b; },
      then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) { return run().then(res, rej); },
    };
    for (const m of ["or", "contains", "order", "ilike", "like", "match", "filter", "textSearch", "overlaps", "returns", "abortSignal", "csv"]) b[m] = (..._a: unknown[]) => { filters.push(m); return b; };
    async function run() {
      if (op !== "select") { stats.writes.push(`${op}:${table}`); return { data: null, error: { message: `counter db refuses ${op} on ${table}` } }; }
      const start = Date.now();
      if (inFlight === 0) stats.waves++;
      const depth = doneDepth + 1;
      inFlight++; stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
      let rows = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
      const total = rows.length;
      rows = rows.slice(from, Math.min(to + 1, from + limit));
      while (open >= conn) await new Promise<void>((r) => queue.push(r));
      open++; await sleep(rtt + rows.length * perRow); open--; queue.shift()?.();
      inFlight--; doneDepth = Math.max(doneDepth, depth); stats.depth = Math.max(stats.depth, depth);
      stats.requests++; stats.rows += rows.length; stats.byTable[table] = (stats.byTable[table] ?? 0) + 1;
      stats.log.push({ site, table, op, filters, inSizes, rows: rows.length, at: start - t0, ms: Date.now() - start });
      if (head) return { data: null, error: null, count: total };
      if (single) return { data: rows[0] ?? null, error: single === "one" && !rows[0] ? { message: "no row" } : null, count: count ? total : null };
      return { data: rows, error: null, count: count ? total : null };
    }
    return b;
  }
  const client: any = {
    from: (t: string) => builder(t),
    rpc: (name: string) => builder(`rpc:${name}`),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: "no storage" } }) }) },
  };
  return { client, stats };
}

/** A small but realistic office: n jobs (most closed), with per-job child rows on the live ones. */
export function officeTables(n: number, liveShare = 0.25) {
  const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
  const iso = (d: number) => new Date(Date.UTC(2026, 8, 1) + d * 1_800_000).toISOString(); // 2,200 jobs ≈ 1 Sep → 16 Oct
  const liveStages = ["new_enquiry", "ready_check_ready_to_schedule", "quote_sent", "piesa_complete", "installation_scheduling", "installation_booked", "ready_for_veec"];
  const jobs = Array.from({ length: n }, (_, i) => {
    const live = i < n * liveShare;
    return {
      id: id(i), job_number: `HV-${1000 + i}`, stage: live ? liveStages[i % liveStages.length] : i % 2 ? "cancelled" : "complete", prior_stage: null,
      source: i % 41 === 0 ? "qa_test" : "base44", channel: i % 5 === 0 ? "installer_sourced" : "hivic_sourced", installer_site_check: null,
      created_at: iso(i), last_activity_at: iso(i + 5), hold_revisit_at: null, cancelled_reason: null, next_action: null, installation_completed_at: !live && i % 2 === 0 ? iso(i + 40) : null,
      qa_archived_at: null, deleted_at: null, offer_dispatch_override: null, install_10day_flagged_at: null, estimated_area_m2: 120,
      owners: { full_name: `Owner ${i} Smith` }, properties: { suburb: "Testville", postcode: "3000", address_line: `${i} Test St`, answers: null },
    };
  });
  const per = (k: number, f: (j: Row, i: number) => Row[]) => jobs.flatMap((j, i) => f(j, i).slice(0, k));
  return {
    jobs,
    workflow_settings: [{ id: 1, office_time_limits: {}, safety_check_payment_inc_gst: 349 }],
    workflow_events: per(30, (j, i) => [
      { job_id: j.id, event_type: "stage_changed", to_stage: "new_enquiry", created_at: iso(i), details: {} },
      { job_id: j.id, event_type: "stage_changed", to_stage: j.stage, created_at: iso(i + 2), details: {} },
      ...Array.from({ length: 16 }, (_, k) => ({ job_id: j.id, event_type: `note_${k % 6}`, to_stage: null, created_at: iso(i + 3 + k), details: {} })),
    ]),
    customer_email_sends: per(6, (j, i) => Array.from({ length: 5 }, (_, k) => ({ job_id: j.id, purpose: "estimate", status: "sent", sent_at: iso(i + k), created_at: iso(i + k), error: null }))),
    job_communications: per(4, (j, i) => [{ job_id: j.id, direction: "outbound", sent_at: iso(i + 1), channel: "email", delivery_status: "sent" }, { job_id: j.id, direction: "outbound", sent_at: iso(i + 2), channel: "sms", delivery_status: "sent" }]),
    sms_messages: per(3, (j, i) => [{ job_id: j.id, message_type: "x", status: "sent", created_at: iso(i), business_id: null }]),
    lead_campaign_responses: per(1, (j, i) => (i % 3 ? [] : [{ job_id: j.id, spot_saved_at: null, opted_out_at: null, created_at: iso(i) }])),
    customer_estimate_links: per(1, (j, i) => [{ job_id: j.id, created_at: iso(i), revoked_at: null }]),
    piesa_records: per(2, (j, i) => (i % 4 ? [] : [{ job_id: j.id, is_current: true, kind: "initial", outcome: "pass", completed_date: "2026-10-01", created_at: iso(i) }])),
    job_piesa_deadlines: jobs.map((j) => ({ job_id: j.id, install_deadline: null })),
    invoice_status: per(1, (j, i) => (i % 3 ? [] : [{ job_id: j.id, deposit_cleared: false, effective_status: "draft" }])),
    // Quotes: on a live job one in ten is a draft for the office to check, a third were sent; closed jobs keep sent ones.
    quotes: per(1, (j, i) => (i % 10 === 3 && i < n * liveShare ? [{ id: `q${i}`, job_id: j.id, kind: "installation", status: "draft", sent_at: null, release_state: "held", created_at: iso(i) }]
      : i % 3 === 0 ? [{ id: `q${i}`, job_id: j.id, kind: "installation", status: i < n * liveShare ? "issued" : "accepted", sent_at: iso(i + 1), release_state: "released", created_at: iso(i) }] : [])),
    evidence_requirements: per(3, (j) => [{ job_id: j.id, status: "outstanding", required: true }]),
    // Install bookings: done ones are "completed"; live jobs at installation_booked have one confirmed in the coming days.
    bookings: per(1, (j, i) => (j.stage === "installation_booked" ? [{ id: `b${i}`, job_id: j.id, kind: "installation", status: "confirmed", scheduled_start: new Date(Date.now() + (1 + (i % 9)) * 86_400_000).toISOString(), created_at: iso(i) }]
      : j.installation_completed_at ? [{ id: `b${i}`, job_id: j.id, kind: "installation", status: "completed", scheduled_start: iso(i + 30), created_at: iso(i) }] : [])),
    office_snoozes: [],
    // Office bucket views: live jobs at new_enquiry are enquiries, the other live ones are active; a third of the
    // closed jobs are still enquiries the owner never answered (they stay on the one Enquiries list until closed).
    office_enquiry_index: jobs.filter((j, i) => j.stage === "new_enquiry" || (i >= n * liveShare && i % 3 === 0)).map((j) => ({ id: j.id, job_number: j.job_number, created_at: j.created_at, source: "base44", channel: "hivic_sourced", office_bucket: "enquiry", enquiry_status: "new", needs_first_response: false, latest_attempt_status: null, owner_name: j.owners.full_name, owner_email: "a@b.c", owner_phone: "0400000000" })),
    office_job_list: jobs.filter((j, i) => i < n * liveShare && j.stage !== "new_enquiry").map((j) => ({ id: j.id, job_number: j.job_number, stage: j.stage, source: j.source, channel: j.channel, owner_name: j.owners.full_name, office_bucket: "active", installer_name: "Installer Co", life_support: false, last_activity_at: j.last_activity_at, created_at: j.created_at })),
    indicative_estimates: jobs.map((j) => ({ id: `e-${j.id}`, job_id: j.id, status: "current", area_m2: 120, scenarios: [], created_at: j.created_at })),
  } as Record<string, Row[]>;
}
