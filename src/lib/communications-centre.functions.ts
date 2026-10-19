// Read-only history for the ONE Communications centre.
// Reuses the existing send logs (customer_email_sends + outbound job_communications). Bounded, no writes,
// no sending, no queue/status changes. Unknown/limited results are labelled as such in the UI.
//
// The list is PAGED BY THE SERVER: the status filter and the search term are pushed into each log's own
// columns, the two logs are merged newest-first with a stable tie-breaker, and only the rows on the
// requested page are shipped. Paging to page 40 costs exactly the same two queries as page 1.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { requireAdmin } from "@/lib/workflow.server";
import { paginate, toPage, toPageSize } from "./list-paging.core";
import { searchFilter } from "./list-query.core";
import {
  byNewestFirst,
  commStatus,
  COMM_STATUS_VALUES,
  MESSAGE_LOG_SEARCH_COLUMNS,
  SEND_LOG_SEARCH_COLUMNS,
  type CommFilter,
  type CommunicationHistory,
} from "./communications-centre.core";

export type { CommunicationHistory, CommunicationHistoryRow } from "./communications-centre.core";

/**
 * Rows read from EACH log. This is the pre-existing bound on the window (it was the old `LIMIT`), kept
 * exactly as it was: the centre has always shown the most recent slice of each log and said so. Page 40
 * does not widen it — it reads the same window and pages within it.
 */
const SCAN = 400;
const JOB_CHUNK = 100;

export const getCommunicationHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        filter: z.enum(["all", "sent", "queued", "failed"]).default("all"),
        search: z.string().max(120).default(""),
        page: z.number().int().min(1).max(100_000).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ context, data }): Promise<CommunicationHistory> => {
    await requireAdmin(context.supabase);

    const filter = data.filter as CommFilter;
    const size = toPageSize(data.pageSize);
    const wanted = toPage(data.page);

    // Status filter and search go to the DATABASE, on each log's own columns only.
    // Both modifiers are applied ONLY when there is something to apply: an empty `.in([])` would emit
    // `in.()` and an empty `.or("")` would emit `or=`, and PostgREST rejects both with a 400.
    const statusValues = filter === "all" ? null : COMM_STATUS_VALUES[filter];
    const sendSearch = searchFilter(data.search, [...SEND_LOG_SEARCH_COLUMNS]);
    const messageSearch = searchFilter(data.search, [...MESSAGE_LOG_SEARCH_COLUMNS]);

    let sendQuery = admin
      .from("customer_email_sends")
      .select("id, job_id, purpose, status, sent_at, created_at, error")
      .order("created_at", { ascending: false })
      .order("id")
      .limit(SCAN);
    if (statusValues) sendQuery = sendQuery.in("status", statusValues);
    if (sendSearch) sendQuery = sendQuery.or(sendSearch);

    let messageQuery = admin
      .from("job_communications")
      .select("id, job_id, channel, direction, delivery_status, subject, sent_at, created_at")
      .eq("direction", "outbound")
      .eq("channel", "email")
      .order("created_at", { ascending: false })
      .order("id")
      .limit(SCAN);
    if (statusValues) messageQuery = messageQuery.in("delivery_status", statusValues);
    if (messageSearch) messageQuery = messageQuery.or(messageSearch);

    const [{ data: sends }, { data: messages }] = await Promise.all([sendQuery, messageQuery]);

    const sendRows = sends ?? [];
    const messageRows = messages ?? [];

    // Merge and order BEFORE choosing the page, so "page 3" always means the same 20 records.
    const merged: CommunicationHistory["rows"] = [
      ...sendRows.map((r) => ({
        id: `send-${r.id}`,
        source: "auto" as const,
        jobId: r.job_id,
        jobNumber: null,
        customer: null,
        email: null,
        address: null,
        purpose: r.purpose,
        status: commStatus(r.status),
        statusLabel: r.status,
        at: r.sent_at ?? r.created_at ?? null,
        error: r.error ?? null,
      })),
      ...messageRows.map((r) => ({
        id: `msg-${r.id}`,
        source: "message" as const,
        jobId: r.job_id,
        jobNumber: null,
        customer: null,
        email: null,
        address: null,
        purpose: r.subject ?? "Email",
        status: commStatus(r.delivery_status),
        statusLabel: r.delivery_status,
        at: r.sent_at ?? r.created_at ?? null,
        error: null,
      })),
    ].sort(byNewestFirst);

    // Counts come from the whole filtered window, so they never depend on which page is open.
    const counts = { sent: 0, queued: 0, failed: 0 };
    for (const r of merged) if (r.status !== "other") counts[r.status] += 1;

    const page = paginate(merged, wanted, size);

    // Job details are fetched for THIS PAGE ONLY, not for the whole window.
    const jobs = new Map<string, { jobNumber: string | null; customer: string | null; email: string | null; address: string | null }>();
    const ids = [...new Set(page.rows.map((r) => r.jobId))];
    for (let i = 0; i < ids.length; i += JOB_CHUNK) {
      const { data: rows } = await admin
        .from("jobs")
        .select("id, job_number, owners(full_name, email), properties(address_line, suburb)")
        .in("id", ids.slice(i, i + JOB_CHUNK));
      for (const j of rows ?? []) {
        const owner = j.owners as { full_name: string | null; email: string | null } | null;
        const prop = j.properties as { address_line: string | null; suburb: string | null } | null;
        jobs.set(j.id, {
          jobNumber: j.job_number ?? null,
          customer: owner?.full_name ?? null,
          email: owner?.email ?? null,
          address: [prop?.address_line, prop?.suburb].filter(Boolean).join(", ") || null,
        });
      }
    }
    const rows = page.rows.map((r) => {
      const j = jobs.get(r.jobId);
      return { ...r, jobNumber: j?.jobNumber ?? null, customer: j?.customer ?? null, email: j?.email ?? null, address: j?.address ?? null };
    });

    return {
      rows,
      counts,
      page: page.page,
      pageSize: page.pageSize,
      total: page.total,
      totalPages: page.totalPages,
      from: page.from,
      to: page.to,
      scope: {
        limit: SCAN,
        totalRead: sendRows.length + messageRows.length,
        truncated: sendRows.length >= SCAN || messageRows.length >= SCAN,
      },
    };
  });

