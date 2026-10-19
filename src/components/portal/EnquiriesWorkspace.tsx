// ONE authoritative Enquiries workspace.
// Reuses the existing enquiry-groups read + actions. Presentation only: the office-facing outcomes are a
// single label per enquiry (mapped from the canonical enquiryStatus), never a competing status system.
import { Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  existingInsulationSaveSpotFn,
  getEnquiryGroups,
  getLeadMedia,
  removeLeadsFn,
  reviewLeadMediaFn,
} from "@/lib/enquiry-groups.functions";
import {
  MEDIA_OUTCOME_LABEL,
  STATUS_ORDER,
  type EnquiryStatus,
  type MediaReviewOutcome,
} from "@/lib/enquiry-groups.core";
import { OFFICE_ENQUIRY_LABEL } from "@/lib/office-nav";
import { cn } from "@/lib/utils";

export type EnquiryView = EnquiryStatus | "all" | "new" | "photos" | "removed";

type Data = Awaited<ReturnType<typeof getEnquiryGroups>>;
type Row = Data["rows"][number];

const when = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString("en-AU", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";
const ageDays = (value: string | null | undefined) => {
  if (!value) return null;
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  return Number.isFinite(days) ? Math.max(0, days) : null;
};
const INSULATION_LABEL: Record<string, string> = {
  none: "No insulation",
  present: "Has insulation",
  unknown: "Not sure",
};

function ExistingInsulationFollowup({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const action = useServerFn(existingInsulationSaveSpotFn);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const run = async (previewOnly: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await action({ data: { jobId, preview: previewOnly } });
      setMessage(r.detail);
      if (r.preview) setPreview(r.preview);
      if (!previewOnly && r.outcome === "sent") onDone();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not prepare the follow-up. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Preliminary only. The free Ready Check confirms insulation, eligibility and price.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => run(true)}>
          Preview Save your spot
        </Button>
        <Button size="sm" disabled onClick={() => run(false)}>
          Send Save your spot
        </Button>
      </div>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {preview && (
        <>
          <p className="text-sm font-semibold">{preview.subject}</p>
          <iframe
            title="Existing-insulation Save your spot email"
            sandbox=""
            srcDoc={preview.html}
            className="h-[650px] w-full border"
          />
        </>
      )}
    </div>
  );
}

function MediaReview({ row, onDone }: { row: Row; onDone: () => void }) {
  const loadMedia = useServerFn(getLeadMedia);
  const review = useServerFn(reviewLeadMediaFn);
  const { data, isLoading, error } = useQuery({
    queryKey: ["lead-media", row.id],
    queryFn: () => loadMedia({ data: { jobId: row.id } }),
  });
  const [busy, setBusy] = useState<MediaReviewOutcome | null>(null);
  const [reason, setReason] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const act = async (outcome: MediaReviewOutcome) => {
    setBusy(outcome);
    try {
      await review({ data: { jobId: row.id, outcome, reason } });
      setSaved(MEDIA_OUTCOME_LABEL[outcome]);
      onDone();
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3">
      {isLoading ? (
        <p role="status" className="text-sm">
          Loading photos…
        </p>
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load the photos. Try again.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            {(data?.files ?? []).map((f) =>
              f.mimeType?.startsWith("video/") ? (
                <video
                  key={f.id}
                  src={f.url}
                  controls
                  className="h-40 rounded-md border bg-black"
                />
              ) : (
                <a key={f.id} href={f.url} target="_blank" rel="noopener">
                  <img
                    src={f.url}
                    alt={`Uploaded by ${row.name ?? "owner"}`}
                    className="h-40 rounded-md border object-cover"
                  />
                </a>
              ),
            )}
            {data?.pendingSync && (
              <p role="status" className="text-sm">
                Original enquiry attachments are awaiting import. Do not ask the owner to upload
                again.
              </p>
            )}
            {data && data.files.length === 0 && !data.pendingSync && (
              <p className="text-sm text-muted-foreground">No files found.</p>
            )}
          </div>
          {saved ? (
            <p role="status" className="text-sm font-semibold text-primary">
              Saved: {saved}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy !== null} onClick={() => act("no_insulation")}>{MEDIA_OUTCOME_LABEL.no_insulation}</Button>
              <Input aria-label="Ineligible reason" placeholder="Reason for R2 or above decision" value={reason} onChange={e => setReason(e.target.value)} />
              <Button size="sm" disabled={busy !== null} onClick={() => act("below_r2")}>
                {MEDIA_OUTCOME_LABEL.below_r2}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={busy !== null || !reason.trim()}
                onClick={() => act("over_r2")}
              >
                {MEDIA_OUTCOME_LABEL.over_r2}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => act("unclear")}
              >
                {MEDIA_OUTCOME_LABEL.unclear}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const VIEW_ORDER: EnquiryView[] = ["all", "new", ...STATUS_ORDER, "photos", "removed"];
const VIEW_LABEL: Record<EnquiryView, string> = {
  all: "All enquiries",
  new: "New · no email sent",
  ...OFFICE_ENQUIRY_LABEL,
  photos: "Photos/videos to check",
  removed: "Removed",
};

export function EnquiriesWorkspace({
  view,
  q,
  onView,
  onQ,
  page, onPage,
}: {
  view: EnquiryView;
  q: string;
  page: number; onPage: (page: number) => void;
  onView: (next: EnquiryView) => void;
  onQ: (next: string) => void;
}) {
  const load = useServerFn(getEnquiryGroups);
  const [searchDraft, setSearchDraft] = useState(q ?? '');
  useEffect(() => { setSearchDraft(q ?? ''); }, [q]);
  useEffect(() => {
    if (searchDraft === (q ?? '')) return;
    const timer = setTimeout(() => onQ(searchDraft), 300);
    return () => clearTimeout(timer);
  }, [searchDraft, q, onQ]);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["enquiries-workspace-page", view, q, page],
    queryFn: () => load({ data: { view, search: q ?? "", page: page + 1 } }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const setPage = onPage;
  const [openId, setOpenId] = useState<string | null>(null);
  const remove = useServerFn(removeLeadsFn);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState(false);
  const [removeMsg, setRemoveMsg] = useState<string | null>(null);
  const [removeReason, setRemoveReason] = useState("Fake or test enquiry");
  const rows = data?.rows ?? [];
  const doRemove = async () => {
    const ids = [...picked].filter((id) => rows.some((r) => r.id === id && r.kind === "job"));
    if (!ids.length) return;
    const reason = removeReason.trim() || "Fake or test enquiry";
    setRemoving(true);
    try {
      const r = await remove({ data: { ids, reason } });
      setRemoveMsg(`Removed ${r.removed} enquiry${r.removed === 1 ? "" : "s"}.`);
      setPicked(new Set());
      await refetch();
    } catch (e) {
      setRemoveMsg((e as Error).message);
    } finally {
      setRemoving(false);
    }
  };
  const counts = data?.counts;
  const viewCount = (key: EnquiryView) => counts?.[key] ?? 0;
  const pages = data?.totalPages ?? 1;
  const safePage = (data?.page ?? 1) - 1;
  const visible = rows;
  const officeReview = view === "needs_attention" || view === "photos";

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase text-primary">Home Insulation Victoria</p>
          <h1 className="mt-1 font-display text-3xl font-bold">Enquiries</h1>
          <p className="mt-1 text-sm text-sub">
            Every website enquiry with one current outcome and the next office action.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Button asChild size="sm" variant="outline">
            <Link to="/admin/communications">Email centre</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/admin/board" search={{ tab: "quotes" }}>
              Quote approvals
            </Link>
          </Button>
        </div>
      </header>

      {isLoading ? (
        <p role="status" className="rounded-md border bg-card p-6 text-sm">
          Loading enquiries…
        </p>
      ) : error || !data ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm"
        >
          Could not load enquiries. Your records are safe.{" "}
          <Button variant="link" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          <p className="text-xs text-sub">
            {data.counts.all} enquiries awaiting an owner’s next step.
          </p>

          <div
            role="tablist"
            aria-label="Enquiry outcome filters"
            className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5"
          >
            {VIEW_ORDER.map((key) => (
              <Button
                key={key}
                role="tab"
                aria-selected={view === key}
                data-testid={`enquiries-view-${key}`}
                variant={view === key ? "default" : "outline"}
                className="h-auto min-h-20 flex-col items-start px-4 py-3 text-left"
                onClick={() => {
                  onView(key);
                  setPage(0);
                  setPicked(new Set());
                }}
              >
                <span className="font-display text-2xl font-bold">{viewCount(key)}</span>
                <span className="whitespace-normal text-sm">{VIEW_LABEL[key]}</span>
              </Button>
            ))}
          </div>

          <section
            aria-label="Office review"
            className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <b>Office review:</b>
              <Link
                to="/admin/enquiries"
                search={{ status: "needs_attention" }}
                className="font-semibold text-primary underline"
              >
                Eligibility &amp; sending decisions ({counts?.needs_attention ?? 0})
              </Link>
              <Link
                to="/admin/enquiries"
                search={{ status: "photos" }}
                className="font-semibold text-primary underline"
              >
                Photos/videos ({counts?.photos ?? 0})
              </Link>
              <Link
                to="/admin/board"
                search={{ tab: "quotes" }}
                className="font-semibold text-primary underline"
              >
                Quote approvals
              </Link>
              <Link to="/admin/ap-queue" className="font-semibold text-primary underline">
                AP review
              </Link>
            </div>
            {officeReview && (
              <p className="mt-1 text-xs text-sub">
                Open a record to see its evidence, photos and recorded decision. Nothing advances
                automatically.
              </p>
            )}
          </section>

          {view === "needs_attention" && (
            <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
              <strong>Only exceptions appear here.</strong> The reason tells the office what stopped
              automatic sending.
            </div>
          )}
          {view === "photos" && (
            <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
              <strong>Homeowners who sent photos or videos.</strong> Open each one, look at the
              pictures, then choose: no insulation or below R2 makes them ready to offer Save My Spot, R2 or above moves
              them to Ineligible, and unclear records need more pictures.
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Input
              aria-label="Search enquiries"
              placeholder="Search name, address, email, phone or job number"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              className="max-w-md"
            />
            <div className="flex flex-wrap items-center gap-2">
              {view !== "removed" && (
                <Input
                  aria-label="Reason for removing"
                  value={removeReason}
                  onChange={(e) => setRemoveReason(e.target.value)}
                  className="h-9 w-56"
                />
              )}
              {view !== "removed" && (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={picked.size === 0 || removing}
                  onClick={doRemove}
                >
                  {removing ? "Removing…" : `Remove selected (${picked.size})`}
                </Button>
              )}
              <span className="text-sm text-sub">{data.total} shown</span>
            </div>
          </div>
          {removeMsg && (
            <p role="status" className="text-sm font-semibold">
              {removeMsg}
            </p>
          )}

          <div className="overflow-x-auto rounded-md border bg-card">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="w-10 p-3">
                    {view !== "removed" && (
                      <input
                        type="checkbox"
                        aria-label="Select all on this page"
                        checked={visible.length > 0 && visible.every((r) => picked.has(r.id))}
                        onChange={(e) =>
                          setPicked((prev) => {
                            const n = new Set(prev);
                            for (const r of visible) {
                              if (e.target.checked) n.add(r.id);
                              else n.delete(r.id);
                            }
                            return n;
                          })
                        }
                      />
                    )}
                  </th>
                  <th className="p-3">Homeowner</th>
                  <th className="p-3">Property</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Insulation · area</th>
                  <th className="p-3">Photos/videos</th>
                  <th className="p-3">Age</th>
                  <th className="p-3">Next office action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted-foreground">
                      No enquiries match this view or search.
                    </td>
                  </tr>
                )}
                {visible.map((row) => {
                  const age = ageDays(row.createdAt);
                  return (
                    <tr key={row.id} className="align-top hover:bg-muted/30">
                      <td className="p-3">
                        {view !== "removed" && row.kind === "job" && (
                          <input
                            type="checkbox"
                            aria-label={`Select ${row.name ?? row.jobNumber ?? "enquiry"}`}
                            checked={picked.has(row.id)}
                            onChange={(e) =>
                              setPicked((prev) => {
                                const n = new Set(prev);
                                if (e.target.checked) n.add(row.id);
                                else n.delete(row.id);
                                return n;
                              })
                            }
                          />
                        )}
                      </td>
                      <td className="p-3">
                        <Link
                          to="/admin/jobs/$jobId"
                          params={{ jobId: row.id }}
                          className="font-semibold text-primary underline"
                        >
                          {row.name ?? "—"}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {row.jobNumber} · {row.email ?? "No email"}
                          {row.phone ? ` · ${row.phone}` : ""}
                        </div>
                      </td>
                      <td className="p-3">{row.address ?? "—"}</td>
                      <td className="p-3 font-semibold">
                        {VIEW_LABEL[row.status]}
                        {row.mediaOutcome && (
                          <div className="text-xs font-normal text-muted-foreground">
                            Photo review: {MEDIA_OUTCOME_LABEL[row.mediaOutcome]}
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-xs">
                        <div className="font-semibold">
                          {row.declaredInsulation
                            ? (INSULATION_LABEL[row.declaredInsulation] ?? row.declaredInsulation)
                            : "Not provided"}
                        </div>
                        <div className="text-muted-foreground">
                          {row.area.m2 != null ? `${row.area.m2} m²` : "Area unknown"}
                        </div>
                      </td>
                      <td className="p-3 text-xs">
                        {row.mediaCount > 0
                          ? `${row.mediaCount} received${row.mediaChecked ? " · checked" : " · to check"}`
                          : "None received"}
                      </td>
                      <td className="p-3 text-xs">
                        <div
                          className={cn(
                            "font-semibold",
                            age !== null && age >= 14 ? "text-danger" : "",
                          )}
                        >
                          {age === null ? "—" : `${age} day${age === 1 ? "" : "s"}`}
                        </div>
                        <div className="text-muted-foreground">{when(row.createdAt)}</div>
                      </td>
                      <td className="p-3">
                        {view === "photos" ? (
                          <div className="space-y-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setOpenId(openId === row.id ? null : row.id)}
                            >
                              {openId === row.id
                                ? "Hide photos"
                                : `View ${row.mediaCount} photo${row.mediaCount === 1 ? "" : "s"}/video`}
                            </Button>
                            {openId === row.id && (
                              <MediaReview row={row} onDone={() => refetch()} />
                            )}
                          </div>
                        ) : view === "removed" ? (
                          "Removed by office"
                        ) : row.mediaOutcome === 'no_insulation' ? (
                          row.nextAction
                        ) : row.mediaOutcome === "below_r2" &&
                          row.status !== "spot_saved" &&
                          row.status !== "ineligible" ? (
                          <ExistingInsulationFollowup jobId={row.id} onDone={() => refetch()} />
                        ) : row.status === "needs_attention" ? (
                          (row.attentionReason ?? row.reason)
                        ) : row.status === "spot_saved" ? (
                          "Continue from Active jobs"
                        ) : row.status === "ineligible" ? (
                          "No action unless the owner replies"
                        ) : (
                          "Waiting for the homeowner"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
            >
              Previous
            </Button>
            <span className="text-sm">
              Page {safePage + 1} of {pages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage + 1 >= pages}
              onClick={() => setPage(safePage + 1)}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
