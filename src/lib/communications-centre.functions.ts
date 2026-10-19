// Read-only history for the ONE Communications centre.
// Reuses the existing send logs (customer_email_sends + outbound job_communications). Bounded, no writes,
// no sending, no queue/status changes. Unknown/limited results are labelled as such in the UI.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { requireAdmin } from "@/lib/workflow.server";

export type CommunicationHistoryRow = {
  id: string;
  source: "auto" | "message";
  jobId: string;
  jobNumber: string | null;
  customer: string | null;
  email: string | null;
  address: string | null;
  purpose: string;
  status: "sent" | "queued" | "failed" | "other";
  statusLabel: string;
  at: string | null;
  error: string | null;
};
export type CommunicationHistory = {
  rows: CommunicationHistoryRow[];
  counts: { sent: number; queued: number; failed: number };
  scope: { limit: number; totalRead: number; truncated: boolean };
};

const LIMIT = 400;
const SENT = new Set(["sent", "delivered", "delivered_unrecorded"]);
const QUEUED = new Set(["queued", "sending", "processing"]);
const FAILED = new Set(["failed", "bounced", "undelivered", "rejected"]);

function normalise(status: string | null | undefined): CommunicationHistoryRow["status"] {
  const s = (status ?? "").toLowerCase();
  if (SENT.has(s)) return "sent";
  if (QUEUED.has(s)) return "queued";
  if (FAILED.has(s)) return "failed";
  return "other";
}

export const getCommunicationHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ filter: z.enum(["all", "sent", "queued", "failed"]).default("all") }).parse(d ?? {}),
  )
  .handler(async ({ context, data }): Promise<CommunicationHistory> => {
    await requireAdmin(context.supabase);

    const [{ data: sends }, { data: messages }] = await Promise.all([
      admin
        .from("customer_email_sends")
        .select("id, job_id, purpose, status, sent_at, created_at, error")
        .order("created_at", { ascending: false })
        .limit(LIMIT),
      admin
        .from("job_communications")
        .select("id, job_id, channel, direction, delivery_status, subject, sent_at, created_at")
        .eq("direction", "outbound")
        .eq("channel", "email")
        .order("created_at", { ascending: false })
        .limit(LIMIT),
    ]);

    const sendRows = sends ?? [];
    const messageRows = messages ?? [];
    const ids = [...new Set([...sendRows, ...messageRows].map((r) => r.job_id))];
    const jobs = new Map<
      string,
      {
        jobNumber: string | null;
        customer: string | null;
        email: string | null;
        address: string | null;
      }
    >();
    for (let i = 0; i < ids.length; i += 100) {
      const { data: rows } = await admin
        .from("jobs")
        .select("id, job_number, owners(full_name, email), properties(address_line, suburb)")
        .in("id", ids.slice(i, i + 100));
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

    const rows: CommunicationHistoryRow[] = [
      ...sendRows.map((r) => ({
        id: `send-${r.id}`,
        source: "auto" as const,
        jobId: r.job_id,
        jobNumber: jobs.get(r.job_id)?.jobNumber ?? null,
        customer: jobs.get(r.job_id)?.customer ?? null,
        email: jobs.get(r.job_id)?.email ?? null,
        address: jobs.get(r.job_id)?.address ?? null,
        purpose: r.purpose,
        status: normalise(r.status),
        statusLabel: r.status,
        at: r.sent_at ?? r.created_at ?? null,
        error: r.error ?? null,
      })),
      ...messageRows.map((r) => ({
        id: `msg-${r.id}`,
        source: "message" as const,
        jobId: r.job_id,
        jobNumber: jobs.get(r.job_id)?.jobNumber ?? null,
        customer: jobs.get(r.job_id)?.customer ?? null,
        email: jobs.get(r.job_id)?.email ?? null,
        address: jobs.get(r.job_id)?.address ?? null,
        purpose: r.subject ?? "Email",
        status: normalise(r.delivery_status),
        statusLabel: r.delivery_status,
        at: r.sent_at ?? r.created_at ?? null,
        error: null,
      })),
    ]
      .filter((r) => data.filter === "all" || r.status === data.filter)
      .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
      .slice(0, LIMIT);

    const counts = { sent: 0, queued: 0, failed: 0 };
    for (const r of rows) if (r.status !== "other") counts[r.status] += 1;

    return {
      rows,
      counts,
      scope: {
        limit: LIMIT,
        totalRead: sendRows.length + messageRows.length,
        truncated: sendRows.length >= LIMIT || messageRows.length >= LIMIT,
      },
    };
  });
