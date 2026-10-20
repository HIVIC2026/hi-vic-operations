// ONE Communications workspace: overview, outgoing, sent history, failures and campaign review.
// Every section reuses an existing read/sender; nothing here changes queues, switches, consent or statuses.
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { keepPreviousData, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { AppShell } from "@/components/portal/AppShell";
import { EnquiryResponseOverview } from "@/components/portal/EnquiryResponseOverview";
import { CampaignsPanel } from "@/components/portal/CampaignsPanel";
import { OutlookReview } from "@/components/portal/OutlookReview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListPagination } from "@/components/portal/ListPagination";
import { getEnquiryResponseOverview } from "@/lib/enquiry-response.functions";
import {
  getCommunicationHistory,
  type CommunicationHistoryRow,
} from "@/lib/communications-centre.functions";
import { type CommFilter } from "@/lib/communications-centre.core";
import { parseListControls, type ListSearchSpec } from "@/lib/list-paging.core";
import { useListControls } from "@/hooks/use-list-controls";
import { cn } from "@/lib/utils";
import { retryFailedIneligibleEmail } from "@/lib/ineligible-retry.functions";

type Tab = "overview" | "outgoing" | "sent" | "failed" | "campaigns" | "inbox";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "outgoing", label: "Outgoing" },
  { key: "sent", label: "Sent & history" },
  { key: "failed", label: "Failed / attention" },
  { key: "campaigns", label: "Campaigns" },
  { key: "inbox", label: "Outlook & review" },
];

/** Page, page size and the search term live in the URL, so a tab can be shared or reloaded. */
const LIST_SPEC: ListSearchSpec = { scopeKey: "listFilter", scopes: ["all"], defaultScope: "all" };

export const Route = createFileRoute("/_authenticated/admin/communications")({
  validateSearch: (s: Record<string, unknown>) => ({
    ...(TABS.some((t) => t.key === s["tab"]) ? { tab: s["tab"] as Tab } : {}),
    ...(typeof s["key"] === "string" ? { key: s["key"] } : {}),
    ...(s["page"] !== undefined ? { page: Number(s["page"]) || 1 } : {}),
    ...(s["size"] !== undefined ? { size: Number(s["size"]) || 20 } : {}),
    ...(typeof s["q"] === "string" ? { q: s["q"].slice(0, 120) } : {}),
  }),
  // The old communications page was a template draft editor. Drafts now live only in Templates.
  beforeLoad: ({ search }) => {
    if (search.key)
      throw redirect({ to: "/admin/templates", search: { cat: "email" }, replace: true });
  },
  head: () => ({
    meta: [
      { title: "Communications — Home Insulation Victoria Office" },
      {
        name: "description",
        content: "One email operations centre: outgoing, sent history, failures and campaigns.",
      },
      { property: "og:title", content: "Communications — Home Insulation Victoria Office" },
      { property: "og:description", content: "One email operations centre." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: CommunicationsPage,
});

const when = (v: string | null) =>
  v
    ? new Date(v).toLocaleString("en-AU", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";
const TONE: Record<CommunicationHistoryRow["status"], string> = {
  sent: "bg-success-soft text-success",
  queued: "bg-workspace-sun text-foreground",
  failed: "bg-danger-soft text-danger",
  other: "bg-muted text-muted-foreground",
};

function IneligibleRetry({ row }: { row: CommunicationHistoryRow }) {
  const retry = useServerFn(retryFailedIneligibleEmail);
  const cache = useQueryClient();
  const action = useMutation({
    mutationFn: () => retry({ data: { jobId: row.jobId, sendId: row.id.slice(5) } }),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["communication-history"] });
      void cache.invalidateQueries({ queryKey: ["enquiry-response-overview"] });
    },
  });
  return (
    <div className="mt-2 space-y-1">
      <Button
        size="sm"
        variant="outline"
        disabled={action.isPending || action.data?.outcome === "sent"}
        onClick={() => {
          if (
            window.confirm(
              `Retry only the failed ineligible email for ${row.jobNumber ?? "this job"}? All current sending checks still apply.`,
            )
          )
            action.mutate();
        }}
      >
        {action.isPending ? "Retrying…" : "Retry ineligible email"}
      </Button>
      {action.data && (
        <p role="status">
          {action.data.outcome === "sent" ? "Sent" : "Blocked"}: {action.data.detail}
        </p>
      )}
      {action.error && (
        <p role="alert">Retry could not be confirmed. Refresh history before trying again.</p>
      )}
    </div>
  );
}

function HistoryTable({ filter, label }: { filter: CommFilter; label: string }) {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  // Page, page size and the search term are the URL. Switching tab drops them, so a new tab starts at
  // page 1 rather than inheriting page 7 from the tab the office just left.
  const controls = useMemo(() => parseListControls(search, LIST_SPEC), [search]);
  const ui = useListControls(controls, LIST_SPEC, (next) =>
    void navigate({ search: { ...(search.tab ? { tab: search.tab } : {}), ...next }, resetScroll: false }),
  );
  const load = useServerFn(getCommunicationHistory);
  const {
    data,
    isPending,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery({
    // The control set is part of the key, so a slow page 1 can never overwrite a fast page 2.
    queryKey: ["communication-history", filter, controls],
    queryFn: () =>
      load({
        data: {
          filter,
          search: controls.search,
          page: controls.page,
          pageSize: controls.pageSize,
        },
      }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: 2,
  });
  const busy = isFetching && !isPending;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase text-sub">Search {label}</span>
          <Input
            value={ui.term}
            onChange={(e) => ui.setTerm(e.target.value)}
            placeholder="Purpose, subject or error"
            className="w-full min-w-[16rem] sm:w-80"
            aria-label={`Search ${label} by purpose, subject or error`}
          />
        </label>
        <p role="status" aria-live="polite" className="pb-2 text-xs text-sub">
          {isPending
            ? "Loading…"
            : `${data?.total ?? 0} matching · Sent ${data?.counts.sent ?? 0} · Queued ${data?.counts.queued ?? 0} · Failed ${data?.counts.failed ?? 0}`}
          {busy ? " · Updating…" : ""}
        </p>
      </div>
      {isPending ? (
        <p role="status" className="rounded-md border bg-card p-6 text-sm">
          Loading email history…
        </p>
      ) : isError || !data ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm"
        >
          Email history could not be loaded. Nothing has been changed.{" "}
          <Button variant="link" onClick={() => void refetch()}>
            Try again
          </Button>
          {error instanceof Error ? <span className="ml-2 text-xs text-sub">{error.message}</span> : null}
        </p>
      ) : (
        <>
          <p className="text-xs text-sub">
            Showing the most recent {data.scope.limit} records per send log
            {data.scope.truncated ? " (older records are beyond this window)" : ""}.
          </p>
          <div className="overflow-x-auto rounded-md border bg-card">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3">Customer</th>
                  <th className="p-3">Email</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">When</th>
                  <th className="p-3">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-muted-foreground">
                      {controls.search
                        ? `No communications match “${controls.search}” in this view.`
                        : "No communications in this view."}
                    </td>
                  </tr>
                )}
                {data.rows.map((r) => (
                  <tr key={r.id} className="align-top hover:bg-muted/30">
                    <td className="p-3">
                      <Link
                        to="/admin/jobs/$jobId"
                        params={{ jobId: r.jobId }}
                        className="font-semibold text-primary underline"
                      >
                        {r.customer ?? r.jobNumber ?? "Record"}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {r.jobNumber} · {r.address ?? "No address"}
                      </div>
                    </td>
                    <td className="p-3 text-xs">
                      {r.email ?? "—"}
                      <div className="text-muted-foreground">{r.purpose}</div>
                    </td>
                    <td className="p-3">
                      <span
                        className={cn(
                          "inline-block rounded-full px-2 py-0.5 text-xs font-semibold",
                          TONE[r.status],
                        )}
                      >
                        {r.status === "other" ? r.statusLabel || "recorded" : r.status}
                      </span>
                    </td>
                    <td className="p-3 text-xs">{when(r.at)}</td>
                    <td className="p-3 text-xs">
                      {r.error ? (
                        <span className="font-semibold text-danger">{r.error}</span>
                      ) : (
                        <span className="text-muted-foreground">
                          {r.source === "auto" ? "Automatic sender" : "Job email"}
                        </span>
                      )}
                      {r.source === "auto" &&
                      r.statusLabel === "failed" &&
                      r.purpose === "preliminary_ineligible" ? (
                        <IneligibleRetry row={r} />
                      ) : (
                        r.status === "failed" && (
                          <Link
                            to="/admin/communications"
                            search={{ tab: "failed" }}
                            className="ml-2 font-semibold text-primary underline"
                          >
                            How to retry
                          </Link>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ListPagination
            paged={data}
            busy={busy}
            label={label}
            onPage={(page) => ui.setPage(page)}
            onPageSize={(pageSize) => ui.setPageSize(pageSize)}
          />
        </>
      )}
    </div>
  );
}

function Overview() {
  const load = useServerFn(getEnquiryResponseOverview);
  const { data } = useQuery({
    queryKey: ["enquiry-response-overview"],
    queryFn: () => load(),
    staleTime: 30_000,
  });
  const c = data?.counts;
  const tile = "rounded-md border bg-card p-4";
  return (
    <div className="space-y-6">
      <section aria-label="Outstanding customer responses">
        <h2 className="font-display text-lg font-bold">Outstanding customer responses</h2>
        <p className="text-sm text-sub">
          Open enquiries with no confirmed initial response yet. These are the counts the Office can
          act on.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
          <div className={tile}>
            <div className="font-display text-2xl font-bold">{c?.awaiting ?? "—"}</div>
            <div className="text-sm">Awaiting send</div>
          </div>
          <div className={tile}>
            <div className="font-display text-2xl font-bold">{c?.inFlight ?? "—"}</div>
            <div className="text-sm">Sending / queued</div>
          </div>
          <div className={tile}>
            <div className="font-display text-2xl font-bold">{c?.sent ?? "—"}</div>
            <div className="text-sm">Sent</div>
          </div>
          <div className={tile}>
            <div className="font-display text-2xl font-bold">{c?.manualReview ?? "—"}</div>
            <div className="text-sm">Requires office review</div>
          </div>
          <div className={tile}>
            <div
              className={cn(
                "font-display text-2xl font-bold",
                (c?.failed ?? 0) > 0 && "text-danger",
              )}
            >
              {c?.failed ?? "—"}
            </div>
            <div className="text-sm">Failed</div>
          </div>
        </div>
        <p className="mt-2 text-xs text-sub">
          Initial enquiry responses only. Sent = a confirmed send is recorded; Sending/queued =
          queued or in progress; Failed = the last attempt failed; Requires office review = held
          before sending.
        </p>
      </section>
      <section aria-label="Recent send log">
        <h2 className="font-display text-lg font-bold">Recent send log</h2>
        <p className="text-sm text-sub">
          The most recent recorded sends — history, not outstanding work.
        </p>
        <div className="mt-3">
          <HistoryTable filter="all" label="Email history" />
        </div>
      </section>
    </div>
  );
}

function CommunicationsPage() {
  const { tab = "overview" } = Route.useSearch();
  return (
    <AppShell wide>
      <header className="mb-4">
        <p className="text-xs font-bold uppercase text-primary">Home Insulation Victoria</p>
        <h1 className="mt-1 font-display text-3xl font-bold">Communications</h1>
        <p className="mt-1 text-sm text-sub">
          One place for what is waiting to send, what went out, what failed, and saved-spot campaign
          review.
        </p>
      </header>
      <nav aria-label="Communications sections" className="mb-5 flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <Link
            key={t.key}
            to="/admin/communications"
            search={{ tab: t.key }}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-semibold",
              tab === t.key
                ? "border-hiv-blue text-ink"
                : "border-transparent text-sub hover:text-ink",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "overview" && <Overview />}
      {tab === "inbox" && <OutlookReview />}

      {tab === "outgoing" && (
        <div className="space-y-4">
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
            <b>Outgoing</b> reuses the existing automatic enquiry sender. Each send re-checks
            consent, opt-out, in-flight and manual-review rules; nothing is re-enqueued by opening
            this page.
          </div>
          <EnquiryResponseOverview />
          <p className="text-xs text-sub">
            Batch sending sends at most 10 real customer emails and only when you confirm. The
            production backlog worker is unchanged.
          </p>
        </div>
      )}

      {tab === "sent" && <HistoryTable filter="sent" label="Sent history" />}
      {tab === "failed" && (
        <div className="space-y-4">
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <b>Failed / attention.</b> Retry uses the existing failed-send path and keeps
            idempotency; already-answered or opted-out customers are never re-sent.
          </div>
          <EnquiryResponseOverview />
          <HistoryTable filter="failed" label="Failed emails" />
        </div>
      )}
      {tab === "campaigns" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-xl font-bold">Saved-spot campaign</h2>
            <Button asChild size="sm" variant="outline">
              <Link to="/admin/templates" search={{ cat: "email" }}>
                Campaign wording in Templates
              </Link>
            </Button>
          </div>
          <CampaignsPanel />
        </div>
      )}
    </AppShell>
  );
}
