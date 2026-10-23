// ONE authoritative Enquiries workspace.
// Reuses the existing enquiry-groups read + actions. Presentation only: the office-facing outcomes are a
// single label per enquiry (mapped from the canonical enquiryStatus), never a competing status system.
import { Link } from "@tanstack/react-router";
import { setEligibility } from "@/lib/portal.functions";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  existingInsulationSaveSpotFn,
  reviewedIneligibleEmailFn,
  getEnquiryGroups,
  getLeadMedia,
  noInsulationSaveSpotFn,
  morePhotosRequestFn,
  removeLeadsFn,
  reviewLeadMediaFn,
  getOwnerEmailsToReview,
  markOwnerEmailReviewedFn,
} from "@/lib/enquiry-groups.functions";
import { qualifiesOutcome } from "@/lib/enquiry-review-custom.core";
import {
  MEDIA_OUTCOME_LABEL,
  STATUS_ORDER,
  type EnquiryStatus,
  type MediaReviewOutcome,
} from "@/lib/enquiry-groups.core";
import { OFFICE_ENQUIRY_LABEL } from "@/lib/office-nav";
import { RESPONSE_STATE_LABEL, showingRange, enquiryRowTag } from "@/lib/enquiry-response.core";
import { followupSendMessage, followupRequestError, uncertainAttempt } from '@/lib/followup-result.core';
import { cn } from "@/lib/utils";
import { QuotesToCheck } from "./QuotesToCheck";
import { OwnerEmailConversation } from "./OwnerEmailConversation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { emailAge } from "@/lib/owner-email-presentation.core";
import { UnmatchedOwnerEmails } from "./OutlookReview";

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
        timeZone: 'Australia/Melbourne',
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

type SendResult = { outcome: string; detail: string; preview?: { subject: string; html: string; plainText?: string }; needsEstimate?: boolean };

/** Preview → (optional estimate update) → Send. Send is enabled only after the server's own preview validation passed. */
function GuardedFollowup({ jobId, title, run, onDone, deliveryUncertain = false }: { jobId: string; title: string; run: (mode: "preview" | "prepare" | "send") => Promise<SendResult>; onDone: () => void; deliveryUncertain?: boolean }) {
  const [busy, setBusy] = useState<null | "preview" | "prepare" | "send">(null);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" | "info" } | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [needsEstimate, setNeedsEstimate] = useState(false);
  const [sent, setSent] = useState(false);
  const [locked, setLocked] = useState(false);
  const go = async (mode: "preview" | "prepare" | "send") => {
    if (busy || locked || deliveryUncertain || sent) return;
    if (mode === "send" && !confirm(`Send the ${title} email to this owner now? It is checked again before sending.`)) return;
    setBusy(mode);
    setMessage(null);
    try {
      let r = await run(mode);
      if (mode === "preview" && r.needsEstimate && !r.preview) {
        // One tap: update the reviewed estimate and secure link (no email), then preview again.
        const p = await run("prepare");
        if (p.outcome === "blocked" || p.outcome === "failed") r = p;
        else r = await run("preview");
      }
      if (mode === "preview") {
        setNeedsEstimate(!!r.needsEstimate && !r.preview);
        setPreview(r.preview ?? null);
        setMessage(r.preview ? { text: "Preview only — not sent. Check it, then press Send.", tone: "info" } : { text: r.detail, tone: "error" });
      } else if (mode === "prepare") {
        setNeedsEstimate(!!r.needsEstimate);
        setPreview(null);
        setMessage({ text: r.detail, tone: r.outcome === 'blocked' || r.outcome === 'failed' ? 'error' : 'info' });
        onDone();
      } else {
        const status = followupSendMessage(r.outcome, r.detail);
        setSent(r.outcome === 'sent');
        setLocked(status.lock);
        setPreview(null);
        setMessage(status);
        onDone();
      }
    } catch {
      const status = followupRequestError(mode);
      setPreview(null);
      setLocked(status.lock);
      setMessage(status);
      onDone();
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Preliminary only. The free Ready Check confirms insulation, eligibility and price.
      </p>
      {!sent && !locked && !deliveryUncertain && (
        <div className="flex flex-wrap gap-2">
          {needsEstimate && (
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => go("prepare")}>
              {busy === "prepare" ? "Updating…" : "Update estimate (no email)"}
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => go("preview")}>
            {busy === "preview" ? "Preparing…" : `Preview ${title}`}
          </Button>
          <Button size="sm" disabled={busy !== null || !preview} onClick={() => go("send")}
            title={preview ? undefined : "Preview first — Send unlocks only when the server confirms this email can go out."}>
            {busy === "send" ? "Sending…" : `Send ${title}`}
          </Button>
        </div>
      )}
      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={cn("text-sm", message.tone === "error" && "text-destructive", message.tone === "ok" && "font-semibold text-primary")}>
          {message.text}
        </p>
      )}
      {deliveryUncertain && !message && <p role="alert" className="text-sm text-destructive">An earlier email attempt is pending or uncertain. Check communication history before any further send.</p>}
      {(locked || deliveryUncertain) && !sent && <Link to="/admin/jobs/$jobId" params={{ jobId }} className="text-sm text-primary underline">Open enquiry communication history</Link>}
      {preview && (
        <>
          <p className="text-sm font-semibold">{preview.subject}</p>
          <iframe title={`${title} email preview`} sandbox="" srcDoc={preview.html} className="h-[650px] w-full border" />
        </>
      )}
    </div>
  );
}

function ExistingInsulationFollowup({ jobId, onDone, deliveryUncertain }: { jobId: string; onDone: () => void; deliveryUncertain: boolean }) {
  const action = useServerFn(existingInsulationSaveSpotFn);
  return <GuardedFollowup jobId={jobId} deliveryUncertain={deliveryUncertain} title="Save your spot" onDone={onDone} run={(mode) => action({ data: { jobId, mode } })} />;
}

function NoInsulationFollowup({ jobId, onDone, deliveryUncertain }: { jobId: string; onDone: () => void; deliveryUncertain: boolean }) {
  const action = useServerFn(noInsulationSaveSpotFn);
  return <GuardedFollowup jobId={jobId} deliveryUncertain={deliveryUncertain} title="Save your spot offer" onDone={onDone} run={(mode) => action({ data: { jobId, mode } })} />;
}

function MediaReview({ row, onDone, optionsOnly = false }: { row: Row; onDone: () => void; optionsOnly?: boolean }) {
  const loadMedia = useServerFn(getLeadMedia);
  const review = useServerFn(reviewLeadMediaFn);
  const decide = useServerFn(setEligibility);
  const ineligibleEmail = useServerFn(reviewedIneligibleEmailFn);
  const query = useQuery({
    queryKey: ["lead-media", row.id],
    queryFn: () => loadMedia({ data: { jobId: row.id } }),
    enabled: !optionsOnly,
  });
  const data = optionsOnly ? undefined : query.data;
  const isLoading = optionsOnly ? false : query.isLoading;
  const error = optionsOnly ? null : query.error;
  const [busy, setBusy] = useState<MediaReviewOutcome | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [savedOutcome, setSavedOutcome] = useState<MediaReviewOutcome | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const act = async (outcome: MediaReviewOutcome) => {
    setBusy(outcome);
    setFailed(null);
    try {
      await review({ data: { jobId: row.id, outcome } });
      // R2 or above: record the Office ineligible decision (default reason; the editable email comes next) so the approved ineligible email can be sent.
      if (outcome === "over_r2") await decide({ data: { jobId: row.id, outcome: "does_not_appear_eligible", reason: "R2 or above – reviewed by office", nextAction: "Send ineligible response" } });
      setSaved(MEDIA_OUTCOME_LABEL[outcome]);
      setSavedOutcome(outcome);
      // Keep the row open so the follow-up email can be sent right here; refresh after that.
      if (outcome === "unclear") onDone();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "The review could not be saved.");
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
                <div key={f.id} className="flex flex-col gap-1">
                  <video controls playsInline preload="metadata" className="h-40 rounded-md border bg-foreground">
                    {/* iPhone .mov files are usually H.264, which most browsers play when offered as mp4. */}
                    <source src={f.url} type={f.mimeType === "video/quicktime" ? "video/mp4" : f.mimeType ?? undefined} />
                    <source src={f.url} />
                  </video>
                  <a href={f.url} target="_blank" rel="noopener" className="text-xs underline">Open video</a>
                </div>
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
          {saved && (savedOutcome === "below_r2" || savedOutcome === "no_insulation") ? (
            <div className="space-y-2">
              <p role="status" className="text-sm font-semibold text-primary">Review saved: {saved}. Now send the Save your spot email:</p>
              {savedOutcome === "below_r2"
                ? <ExistingInsulationFollowup jobId={row.id} deliveryUncertain={uncertainAttempt(row.latestAttemptStatus)} onDone={onDone} />
                : <NoInsulationFollowup jobId={row.id} deliveryUncertain={uncertainAttempt(row.latestAttemptStatus)} onDone={onDone} />}
            </div>
          ) : saved && savedOutcome === "over_r2" ? (
            <div className="space-y-2">
              <p role="status" className="text-sm font-semibold text-primary">Marked ineligible — the enquiry is closed. Nothing has been sent yet:</p>
              <EditableReviewEmail
                title="ineligible email"
                load={async () => {
                  const r = await ineligibleEmail({ data: { jobId: row.id, mode: "preview" } });
                  return r.outcome === "preview" && r.preview ? { ok: true as const, subject: r.preview.subject, plainText: r.preview.plainText ?? "" } : { ok: false as const, detail: r.detail };
                }}
                send={(text, unedited) => ineligibleEmail({ data: { jobId: row.id, mode: "send", ...(unedited ? {} : { customText: text }) } })}
                onDone={onDone}
                closeLabel="Close without email"
                onClose={onDone}
              />
            </div>
          ) : saved ? (
            <p role="status" className="text-sm font-semibold text-primary">
              Review saved: {saved}. No email has been sent — the next action now shows on this row.
            </p>
          ) : (
            <div className="space-y-2">
              {/* Jo 22 Oct 2026: three buttons replace the previous seven. Qualifies records the existing
                  below-R2 / no-insulation outcome (reports unchanged) then confirms with the email preview;
                  Not eligible records R2-or-above and closes the enquiry, then offers the editable ineligible
                  email; Needs more photos or info opens the editable request with the owner's upload link kept. */}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" className="bg-action text-action-foreground hover:bg-action/90" disabled={busy !== null} onClick={() => act(qualifiesOutcome(row.declaredInsulation))}>🟢 Qualifies – send Save my spot email</Button>
                <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => act("over_r2")}>🔴 Not eligible – close (option to email)</Button>
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => act("unclear")}>⚪ Needs more photos or info – send email</Button>
              </div>
            </div>
          )}
          {failed && <p role="alert" className="text-sm text-destructive">{failed}</p>}
        </>
      )}
    </div>
  );
}

type ReviewEmailLoad = { ok: true; subject: string; plainText: string; reviewId?: string } | { ok: false; detail: string };

/** Editable office review email (Jo, 22 Oct 2026): loads the existing approved wording as the draft,
 *  the office can edit it and add anything they want, then Send. Sending always re-runs the server's
 *  full guard stack (switch, consent, opt-out, one-offer, logging); an unedited draft sends the
 *  approved template exactly as before. */
function EditableReviewEmail({ title, load, send, onDone, closeLabel, onClose }: {
  title: string;
  load: () => Promise<ReviewEmailLoad>;
  send: (text: string, unedited: boolean, reviewId?: string) => Promise<SendResult>;
  onDone: () => void;
  closeLabel?: string;
  onClose?: () => void;
}) {
  const [draft, setDraft] = useState<(ReviewEmailLoad & { ok: true }) | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<null | "load" | "send">("load");
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "error" | "info" } | null>(null);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    let alive = true;
    load()
      .then((r) => {
        if (!alive) return;
        if (r.ok) { setDraft(r); setText(r.plainText); } else setMsg({ text: r.detail, tone: "error" });
      })
      .catch((e) => { if (alive) setMsg({ text: e instanceof Error ? e.message : "Could not load the email.", tone: "error" }); })
      .finally(() => { if (alive) setBusy(null); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const go = async () => {
    if (busy || sent || !draft || !text.trim()) return;
    if (!confirm(`Send the ${title} email to this owner now? It is checked again before sending.`)) return;
    setBusy("send");
    setMsg(null);
    try {
      const unedited = text.trim() === draft.plainText.trim();
      const r = await send(text, unedited, draft.reviewId);
      setSent(r.outcome === "sent");
      setMsg(followupSendMessage(r.outcome, r.detail));
    } catch {
      setMsg(followupRequestError("send"));
    } finally {
      setBusy(null);
      onDone();
    }
  };
  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3">
      <p className="text-sm font-semibold text-primary">{title}: check the wording — edit it or add anything you want — then Send.</p>
      {msg && (
        <p role={msg.tone === "error" ? "alert" : "status"} className={cn("text-sm", msg.tone === "error" && "text-destructive", msg.tone === "ok" && "font-semibold text-primary")}>
          {msg.text}
        </p>
      )}
      {!sent && draft && (
        <>
          <textarea
            aria-label={`${title} email text`}
            className="min-h-40 w-full rounded-md border bg-background p-2 text-sm"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy !== null}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy !== null || !text.trim()} onClick={go}>
              {busy === "send" ? "Sending…" : "Send email"}
            </Button>
            {onClose && <Button size="sm" variant="ghost" disabled={busy !== null} onClick={onClose}>{closeLabel ?? "Close without email"}</Button>}
          </div>
        </>
      )}
    </div>
  );
}

// Jo 22 Oct: the Spot saved list stays on Enquiries, but without the "Continue from Active jobs" pointer.
const VIEW_ORDER: EnquiryView[] = ["needs_attention", "all", "new", ...STATUS_ORDER.filter(key => key !== "needs_attention")];
const VIEW_LABEL: Record<EnquiryView | EnquiryStatus, string> = {
  all: "Open enquiries",
  new: "New · no reply recorded",
  ...OFFICE_ENQUIRY_LABEL,
  photos: "Photos/videos to check",
  removed: "Removed",
};

/** Jo 23 Oct 2026: owner emails to info@ that still need a review or reply, with the three review buttons. */
function OwnerEmailsToReview() {
  const load = useServerFn(getOwnerEmailsToReview);
  const markDone = useServerFn(markOwnerEmailReviewedFn);
  const q = useQuery({ queryKey: ["owner-emails-to-review"], queryFn: () => load(), staleTime: 60_000 });
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const rows = q.data?.rows ?? [];
  return (
    <section aria-label="Owner emails to review" className="space-y-3 border-b pb-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold">Owner emails to review ({rows.length})</h2>
      </div>
      {q.isPending ? <p role="status" className="text-sm text-muted-foreground">Loading owner emails…</p>
        : q.error ? <p role="alert" className="text-sm text-destructive">{q.error.message}</p>
        : !rows.length ? <p className="text-sm text-muted-foreground">No owner emails waiting.</p>
        : <ul className="divide-y">{rows.map((r) => (
          <li key={r.ownerId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3">
            <div className="min-w-0"><p className="break-words text-sm font-semibold">{r.owner ?? "Owner"} · {r.jobNumber} · {r.suburb ?? ""}</p><p className="mt-1 text-xs text-muted-foreground">{emailAge(r.at)}{r.mediaCount > 0 && <span className="ml-2 rounded bg-muted px-1.5 py-0.5" aria-label={`${r.mediaCount} photos`}>📷 {r.mediaCount}</span>}</p><p className="mt-1 truncate text-sm text-muted-foreground">{r.body || "Photos attached"}</p></div>
            <Button size="sm" variant="outline" className="h-12" onClick={() => setOpenId(r.jobId)}>Open</Button>
          </li>
        ))}</ul>}
      {rows.map(r => openId === r.jobId && <Dialog key={r.jobId} open onOpenChange={open => {if(!open)setOpenId(null);}}><DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto"><DialogHeader><DialogTitle>{r.owner ?? "Owner"} · {r.jobNumber}</DialogTitle><DialogDescription>{r.suburb}</DialogDescription></DialogHeader>
        <OwnerEmailConversation jobIds={r.jobIds} />
        <div className="space-y-3 border-t pt-3">{r.canReview && <MediaReview row={{id:r.jobId,name:r.owner} as unknown as Row} optionsOnly onDone={() => void q.refetch()} />}
        <Button variant="outline" className="h-12 w-full" disabled={busy === r.jobId} onClick={async () => {setBusy(r.jobId);try {for(const jobId of r.reviewJobIds) await markDone({data:{jobId}});setOpenId(null);await q.refetch();} finally {setBusy(null);}}}>Done – no reply needed</Button></div>
      </DialogContent></Dialog>)}
      <UnmatchedOwnerEmails />
    </section>
  );
}

export function EnquiriesWorkspace({
  view: viewProp,
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
  // Old bookmarks may still carry ?status=spot_saved — saved spots live only in Active jobs now, so fall back.
  const view: EnquiryView = VIEW_ORDER.includes(viewProp) ? viewProp : "needs_attention";
  const [searchDraft, setSearchDraft] = useState(q ?? '');
  useEffect(() => { setSearchDraft(q ?? ''); }, [q]);
  useEffect(() => {
    if (searchDraft === (q ?? '')) return;
    const timer = setTimeout(() => onQ(searchDraft), 300);
    return () => clearTimeout(timer);
  }, [searchDraft, q, onQ]);
  const { data, isLoading, error, refetch, isFetching, isPlaceholderData } = useQuery({
    queryKey: ["enquiries-workspace-page", view, q, page],
    queryFn: () => load({ data: { view, search: q ?? "", page: page + 1 } }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const setPage = onPage;
  const [openId, setOpenId] = useState<string | null>(null);
  const remove = useServerFn(removeLeadsFn);
  const morePhotosRequest = useServerFn(morePhotosRequestFn);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState(false);
  const [removeMsg, setRemoveMsg] = useState<string | null>(null);
  const [removeReason, setRemoveReason] = useState("Fake or test enquiry");
  const rows = data?.rows ?? [];
  const doRemove = async () => {
    if (stale || removing) return;
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
  // Previous filter's rows stay on screen while the new filter loads; they are shown as stale and not actionable.
  const stale = isFetching && isPlaceholderData;
  const responses = data?.responses ?? null;

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

      <QuotesToCheck />
      <OwnerEmailsToReview />
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
          <p className="text-xs text-sub" data-testid="enquiries-scope">
            {data.counts.all.toLocaleString("en-AU")} open website enquiries.{" "}
            {responses ? (
              <>
                {responses.provider_confirmed.toLocaleString("en-AU")} reply accepted by the email service ·{" "}
                {responses.recorded_only.toLocaleString("en-AU")} reply recorded (delivery not confirmed) ·{" "}
                {responses.uncertain.toLocaleString("en-AU")} outcome uncertain ·{" "}
                <b>{responses.unanswered.toLocaleString("en-AU")} no reply recorded</b>
              </>
            ) : (
              "Reply breakdown unavailable."
            )}
          </p>
          {stale && (
            <p role="status" className="text-sm font-semibold text-warning">
              Loading {VIEW_LABEL[view]}… rows below are from the previous filter and cannot be acted on.
            </p>
          )}

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
                className={cn("h-auto min-h-20 flex-col items-start px-4 py-3 text-left", key === "needs_attention" && "col-span-2 border-warning bg-warning-soft text-foreground hover:bg-warning-soft md:col-span-3 lg:col-span-5", key === "needs_attention" && view === key && "ring-2 ring-warning")}
                onClick={() => {
                  onView(key);
                  setPage(0);
                  setPicked(new Set());
                }}
              >
                <span className="font-display text-2xl font-bold">{viewCount(key)}</span>
                <span className="whitespace-normal text-sm">{key === "needs_attention" ? "OFFICE REVIEW" : VIEW_LABEL[key]}</span>
              </Button>
            ))}
          </div>

          <section
            aria-label="Office review"
            className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <b>Office tools:</b>
              <Link
                to="/admin/enquiries"
                search={{ status: "needs_attention" }}
                className="font-semibold text-primary underline"
              >
                Office review ({counts?.needs_attention ?? 0})
              </Link>
              <Link
                to="/admin/board"
                search={{ tab: "quotes" }}
                className="font-semibold text-primary underline"
              >
                Quote approvals
              </Link>
              <Link to="/admin/ap-queue" className="font-semibold text-primary underline">
                Final check
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
              <strong>Photos/videos to check and exceptions needing an Office decision.</strong>
            </div>
          )}
          {view === "photos" && (
            <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
              <strong>Owners who sent photos or videos.</strong> Open each one, look at the
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
                  disabled={stale || removing}
                  value={removeReason}
                  onChange={(e) => setRemoveReason(e.target.value)}
                  className="h-9 w-56"
                />
              )}
              {view !== "removed" && (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={stale || picked.size === 0 || removing}
                  onClick={doRemove}
                >
                  {removing ? "Removing…" : `Remove selected (${picked.size})`}
                </Button>
              )}
              <span className="text-sm text-sub">{stale ? "Updating…" : showingRange(data.page, data.pageSize, rows.length, data.total)}</span>
            </div>
          </div>
          {removeMsg && (
            <p role="status" className="text-sm font-semibold">
              {removeMsg}
            </p>
          )}

          <div className={cn("overflow-x-auto rounded-md border bg-card", stale && "pointer-events-none opacity-50")} aria-busy={stale} inert={stale || undefined}>
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
                  <th className="p-3">Owner</th>
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
                        {enquiryRowTag(row.status, row.mediaToReview === true, VIEW_LABEL)}
                        <div className="text-xs font-normal text-muted-foreground">
                          {RESPONSE_STATE_LABEL[row.responseState]}
                          {row.latestAttemptStatus === "failed" && row.responseState === "none" ? ` · latest attempt failed ${when(row.latestAttemptAt)}` : ""}
                        </div>
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
                        {row.insulationDetail && <div className="text-muted-foreground">Owner says: {row.insulationDetail}</div>}
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
                        {view === "photos" || row.mediaToReview || row.mediaOutcome != null ? (
                          <div className="space-y-2">
                            {row.mediaCount > 0 && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setOpenId(openId === row.id ? null : row.id)}
                              >
                                {openId === row.id
                                  ? "Hide photos"
                                  : `View ${row.mediaCount} photo${row.mediaCount === 1 ? "" : "s"}/video`}
                              </Button>
                            )}
                            {openId === row.id && (
                              <MediaReview row={row} onDone={() => refetch()} />
                            )}
                            {/* Jo 23 Oct 2026: no photos/video → the same three review buttons, no photo loading. */}
                            {row.mediaCount === 0 && row.mediaOutcome == null && (
                              <MediaReview row={row} onDone={() => refetch()} optionsOnly />
                            )}
                            {row.mediaOutcome === "no_insulation" && !["spot_saved", "ineligible", "offered_spot"].includes(row.status) && (
                              <NoInsulationFollowup jobId={row.id} deliveryUncertain={uncertainAttempt(row.latestAttemptStatus)} onDone={() => void refetch()} />
                            )}
                            {row.mediaOutcome === "below_r2" && !["spot_saved", "ineligible", "offered_spot"].includes(row.status) && (
                              <ExistingInsulationFollowup jobId={row.id} deliveryUncertain={uncertainAttempt(row.latestAttemptStatus)} onDone={() => void refetch()} />
                            )}
                            {row.mediaOutcome === "unclear" && row.nextParty === "office" && (
                              <EditableReviewEmail
                                title="more photos request"
                                load={async () => {
                                  const r = await morePhotosRequest({ data: { jobId: row.id, mode: "preview" } });
                                  return r.outcome !== "blocked" && r.preview ? { ok: true as const, subject: r.preview.subject, plainText: r.preview.plainText ?? "", ...(r.reviewId ? { reviewId: r.reviewId } : {}) } : { ok: false as const, detail: r.detail };
                                }}
                                send={(text, unedited, reviewId) => morePhotosRequest({ data: { jobId: row.id, mode: "send", reviewId, ...(unedited ? {} : { customText: text }) } })}
                                onDone={() => void refetch()}
                              />
                            )}
                            {row.mediaOutcome === "unclear" && openId !== row.id && (
                              <MediaReview row={row} onDone={() => refetch()} optionsOnly />
                            )}
                          </div>
                        ) : view === "removed" ? (
                          "Removed by office"
                        ) : row.status === "needs_attention" && !row.mediaOutcome ? (
                          (row.attentionReason ?? row.reason)
                        ) : row.mediaCount === 0 && row.mediaOutcome == null && row.nextParty === "office" && !["spot_saved", "ineligible", "offered_spot"].includes(row.status) ? (
                          <div className="space-y-2">
                            <span className="font-semibold">{row.nextAction}</span>
                            <MediaReview row={row} onDone={() => refetch()} optionsOnly />
                          </div>
                        ) : (
                          <span className={row.nextParty === "office" ? "font-semibold" : undefined}>{row.nextAction}</span>
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
