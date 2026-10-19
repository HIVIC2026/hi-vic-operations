// Pure rules for the Communications history list.
//
// Split out from communications-centre.functions.ts so the browser can import the types and the status
// rules without pulling in the server-only Supabase client. No database, no network.
import { matchesTerm, type Paged } from "./list-paging.core";

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
  /** The bound on this list: records older than the window are not shown, and the UI says so. */
  scope: { limit: number; totalRead: number; truncated: boolean };
} & Pick<Paged<CommunicationHistoryRow>, "page" | "pageSize" | "total" | "totalPages" | "from" | "to">;

/** The three status groups the office filters by. */
export const COMM_FILTERS = ["all", "sent", "queued", "failed"] as const;
export type CommFilter = (typeof COMM_FILTERS)[number];

export const COMM_FILTER_LABEL: Record<CommFilter, string> = {
  all: "All",
  sent: "Sent",
  queued: "Queued",
  failed: "Failed",
};

const SENT = new Set(["sent", "delivered", "delivered_unrecorded"]);
const QUEUED = new Set(["queued", "sending", "processing"]);
const FAILED = new Set(["failed", "bounced", "undelivered", "rejected"]);

/** Raw log status -> the one group the office filters and colours by. */
export function commStatus(status: string | null | undefined): CommunicationHistoryRow["status"] {
  const s = (status ?? "").toLowerCase();
  if (SENT.has(s)) return "sent";
  if (QUEUED.has(s)) return "queued";
  if (FAILED.has(s)) return "failed";
  return "other";
}

/** The raw statuses each group covers, so the filter is pushed into the DATABASE, not into React. */
export const COMM_STATUS_VALUES: Record<Exclude<CommFilter, "all">, string[]> = {
  sent: ["sent", "delivered", "delivered_unrecorded"],
  queued: ["queued", "sending", "processing"],
  failed: ["failed", "bounced", "undelivered", "rejected"],
};

/**
 * Search covers each log's OWN columns only (purpose, error, subject). It deliberately does not filter
 * on the embedded owner/address of `jobs`: mixing embedded columns into a PostgREST `or=()` is not
 * reliably supported and has already broken this page once. The search box will not claim to match
 * something the database was never asked about.
 */
export const SEND_LOG_SEARCH_COLUMNS = ["purpose", "error"] as const;
export const MESSAGE_LOG_SEARCH_COLUMNS = ["subject"] as const;

/** Newest first, with the row id as the tie-breaker so equal timestamps never swap between pages. */
export function byNewestFirst(a: CommunicationHistoryRow, b: CommunicationHistoryRow): number {
  const at = (b.at ?? "").localeCompare(a.at ?? "");
  return at !== 0 ? at : a.id.localeCompare(b.id);
}

/** In-memory search for a list already loaded. Never used to page the server list. */
export function searchHistoryRows(rows: CommunicationHistoryRow[], term: string): CommunicationHistoryRow[] {
  const t = term.trim();
  if (!t) return rows;
  return rows.filter((r) => matchesTerm(t, [r.purpose, r.error, r.customer, r.email, r.jobNumber, r.address]));
}

