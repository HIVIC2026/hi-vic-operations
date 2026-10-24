// Saved-spot campaign review, reused from the legacy /admin/launch-campaign page.
// Review only: campaign sending is switched off in code; nothing here sends email.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getLaunchCampaignOffice,
  saveDesktopInsulationCheck,
} from "@/lib/launch-campaign.functions";
import { SpotPhotoCheck } from "./SpotPhotoCheck";

const LABEL: Record<string, string> = {
  pending: "Needs desk check",
  looks_eligible: "Looks eligible",
  not_eligible: "Not eligible",
  needs_onsite_check: "Needs onsite check",
  not_needed: "No desk check",
};
const COUNT_LABEL: Record<string, string> = {
  opened: "Emails opened (both campaigns)",
  optedOut: "Opted out",
  videosUploaded: "Videos uploaded",
  looksEligible: "Looks eligible",
  notEligible: "Not eligible",
  needsOnsite: "Needs onsite",
};

export function CampaignsPanel() {
  const load = useServerFn(getLaunchCampaignOffice);
  const save = useServerFn(saveDesktopInsulationCheck);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["launch_campaign_office"],
    queryFn: () => load(),
    staleTime: 60_000,
  });
  const [reason, setReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const decide = async (
    id: string,
    outcome: "looks_eligible" | "not_eligible" | "needs_onsite_check",
  ) => {
    setBusy(id);
    try {
      await save({ data: { responseId: id, outcome, reason: reason[id] ?? "" } });
      toast.success("Desktop check saved");
      await refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(null);
    }
  };

  if (isLoading)
    return (
      <p role="status" className="rounded-md border bg-card p-6 text-sm">
        Loading campaign…
      </p>
    );
  if (isError || !data)
    return (
      <p
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm"
      >
        Could not load the campaign.
      </p>
    );

  return (
    <div className="space-y-6">
      <section aria-label="Campaign numbers" className="grid gap-2 md:grid-cols-2">
        <div className="rounded-md border bg-card p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-sub">Save my spot</div>
          <div className="mt-2 font-display text-2xl font-bold">
            Save my spot emails sent: {data.counts.spotsOffered.toLocaleString("en-AU")}
          </div>
          <div className="mt-1 text-sm">
            <b>Spots saved: {data.counts.spotSaved.toLocaleString("en-AU")}</b>
          </div>
        </div>
        <div className="rounded-md border bg-card p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-sub">Insulation details requested (Group B)</div>
          <div className="mt-2 font-display text-2xl font-bold">
            Insulation details requested: {data.counts.insulationDetails.toLocaleString("en-AU")}
          </div>
          <div className="mt-1 text-sm text-sub">“Tell us about your insulation” email — a separate email, not a spot offer</div>
        </div>
      </section>
      <section className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {(["opened", "optedOut", "videosUploaded", "looksEligible", "notEligible", "needsOnsite"] as const).map((k) => (
          <div key={k} className="rounded-md border bg-card p-3">
            <div className="font-display text-2xl font-bold">{data.counts[k]}</div>
            <div className="text-xs text-sub">{COUNT_LABEL[k] ?? k}</div>
          </div>
        ))}
      </section>
      <p className="text-xs text-sub">
        Save my spot emails sent includes the initial and follow-up versions together.
        “Spots saved” counts all saved responses across both email groups, excluding opted-out owners,
        TEST jobs and cancelled jobs. Insulation details requested counts the separate Group B “tell us about your insulation” email
        only. TEST copies and failed sends never count in either.
      </p>
      <div className="rounded-md border border-warning/40 bg-warning/5 p-4 text-sm">
        <strong>Campaign sending is off.</strong> Saved-spot follow-ups are sent by the existing
        automatic rules, and the wording lives in Templates › Email.
      </div>

      <section>
        <h2 className="font-display text-xl font-bold">Spots saved</h2>
        <p className="text-sm text-sub">
          Most likely eligible first, then longest waiting. Saving a spot does not book a visit.
        </p>
        <ul className="mt-3 divide-y rounded-md border bg-card">
          {data.rows
            .filter((r) => r.spotSavedAt && !r.optedOutAt)
            .map((r) => (
              <li key={r.id} className="flex flex-wrap items-start gap-2 p-3 text-sm">
                <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold" title={r.rankLabel ?? undefined}>
                  {r.rank ?? "–"} · {r.rankLabel ?? "—"}
                </span>
                <Link to="/admin/jobs/$jobId" params={{ jobId: r.jobId }} className="min-w-0 flex-1 hover:underline">
                  {r.summary ?? r.owner ?? r.jobNumber ?? "Enquiry"}
                </Link>
                {r.mediaCount > 0 && <SpotPhotoCheck jobId={r.jobId} owner={r.owner} count={r.mediaCount} onDone={() => void refetch()} />}
                {r.priceChanged && <span className="w-full text-xs font-semibold text-destructive">{r.priceChanged}</span>}
              </li>
            ))}
        </ul>
      </section>

      <section>
        <h2 className="font-display text-xl font-bold">Desktop insulation checks</h2>
        <p className="text-sm text-sub">
          The owner's answer stays declared. This is a desk check, not final verification.
        </p>
        <div className="mt-3 space-y-3">
          {data.rows
            .filter((r) => r.mediaReceivedAt || r.deskCheckStatus === "pending")
            .map((r) => (
              <article key={r.id} className="rounded-md border bg-card p-4">
                <div className="flex flex-wrap justify-between gap-2">
                  <div>
                    <Link
                      to="/admin/jobs/$jobId"
                      params={{ jobId: r.jobId }}
                      className="font-bold hover:underline"
                    >
                      {r.owner ?? r.jobNumber ?? "Enquiry"}
                    </Link>
                    <p className="text-sm text-sub">{r.property}</p>
                  </div>
                  <span className="text-sm font-semibold">
                    {LABEL[r.deskCheckStatus] ?? r.deskCheckStatus}
                  </span>
                </div>
                {r.deskCheckStatus === "pending" && (
                  <div className="mt-4 space-y-3">
                    <Input
                      value={reason[r.id] ?? ""}
                      onChange={(e) => setReason((x) => ({ ...x, [r.id]: e.target.value }))}
                      placeholder="Reason (required if not eligible)"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={busy === r.id}
                        onClick={() => void decide(r.id, "looks_eligible")}
                      >
                        Looks eligible (under R2.0)
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy === r.id}
                        onClick={() => void decide(r.id, "needs_onsite_check")}
                      >
                        Needs onsite check
                      </Button>
                      <Button
                        variant="destructive"
                        disabled={busy === r.id}
                        onClick={() => void decide(r.id, "not_eligible")}
                      >
                        Not eligible
                      </Button>
                    </div>
                  </div>
                )}
              </article>
            ))}
        </div>
      </section>
    </div>
  );
}
