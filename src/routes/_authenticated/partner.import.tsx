import { AddJobFlow } from "@/components/trade/add-job-flow";
import type { AddJobMode } from "@/lib/add-job-flow.core";
import { MODE_CHOICES } from "@/lib/add-job-flow.core";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { TradeShell } from "@/components/trade/TradeShell";
import { getPartnerProfile } from "@/lib/pilot.functions";

export const Route = createFileRoute("/_authenticated/partner/import")({
  head: () => ({ meta: [{ title: "Add a Job – Home Insulation Victoria Partner Portal" }, { name: "description", content: "Add a customer job: onsite now, booked for later, or already quoted." }, { property: "og:title", content: "Add a Job – Home Insulation Victoria Partner Portal" }, { property: "og:description", content: "Add a customer job: onsite now, booked for later, or already quoted." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: ImportPage,
});


function ImportPage() {
  const loadProfile = useServerFn(getPartnerProfile);
  const { data: profile } = useQuery({ queryKey: ["partner-profile", "mine"], queryFn: () => loadProfile({ data: {} }) });
  const [mode, setMode] = useState<"choose" | AddJobMode>("choose");
  useEffect(() => { const m = new URLSearchParams(window.location.search).get("mode"); if (m === "later" || m === "onsite" || m === "existing") setMode(m); }, []);
  const businessId = (profile?.business as { id?: string } | undefined)?.id;
  return (
    <TradeShell installer>
      <h1 className="font-display text-[26px] font-bold leading-tight">Add a job</h1>
      {!businessId ? <p className="text-sm text-estimate-navy/70">Loading…</p> : mode === "choose" ? (
        <div className="mt-4 grid gap-3" data-add-choice>
          {MODE_CHOICES.map((c, i) => (
            <button key={c.mode} type="button" onClick={() => setMode(c.mode)} data-choice={c.mode} className={`w-full rounded-[18px] border p-4 text-left ${i === 0 ? "border-primary bg-primary text-primary-foreground" : "border-line bg-paper text-ink"}`}>
              <span className="block font-display text-lg font-bold">{c.title}</span>
              <span className={`mt-1 block text-sm ${i === 0 ? "opacity-90" : "text-sub"}`}>{c.next}</span>
            </button>
          ))}
        </div>
      ) : <AddJobFlow businessId={businessId} initialMode={mode} onExit={() => setMode("choose")} />}
    </TradeShell>
  );
}
