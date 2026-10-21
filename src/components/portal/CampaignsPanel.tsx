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
      <section className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-8">
        {Object.entries(data.counts).map(([k, v]) => (
          <div key={k} className="rounded-md border bg-card p-3">
            <div className="font-display text-2xl font-bold">{v}</div>
            <div className="text-xs text-sub">{COUNT_LABEL[k] ?? k}</div>
          </div>
        ))}
      </section>
      <p className="text-xs text-sub">
        “Spots saved (total)” counts every enquiry that has saved a spot, including any that have
        since moved to an active job or been closed. The Enquiries “Spot saved” filter counts
        enquiries still waiting for an installer.
      </p>
      <div className="rounded-md border border-warning/40 bg-warning/5 p-4 text-sm">
        <strong>Campaign sending is off.</strong> Saved-spot follow-ups are sent by the existing
        automatic rules, and the wording lives in Templates › Email.
      </div>

      <section>
        <h2 className="font-display text-xl font-bold">Spot saved</h2>
        <p className="text-sm text-sub">
          Video priority first, then oldest saved spot. Saving a spot does not book a visit.
        </p>
        <div className="mt-3 overflow-x-auto rounded-md border bg-card">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="p-3">Owner</th>
                <th className="p-3">Property</th>
                <th className="p-3">Saved</th>
                <th className="p-3">Saved price</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.rows
                .filter((r) => r.spotSavedAt && !r.optedOutAt)
                .map((r) => (
                  <tr key={r.id}>
                    <td className="p-3 font-semibold">
                      <Link
                        to="/admin/jobs/$jobId"
                        params={{ jobId: r.jobId }}
                        className="hover:underline"
                      >
                        {r.owner ?? r.jobNumber ?? "Enquiry"}
                      </Link>
                    </td>
                    <td className="p-3">{r.property || "—"}</td>
                    <td className="p-3">
                      {r.spotSavedAt ? new Date(r.spotSavedAt).toLocaleString("en-AU") : "—"}
                    </td>
                    <td className="p-3">
                      {r.savedPrice ?? "—"}
                      {r.priceChanged && (
                        <span className="block text-xs font-semibold text-destructive">
                          {r.priceChanged}
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      {r.queuePriority === "video"
                        ? "Spot saved · video sent"
                        : "Spot saved, needs an installer"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
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
