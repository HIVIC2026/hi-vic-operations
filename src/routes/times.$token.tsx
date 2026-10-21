import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getOwnerTimesPage, submitOwnerTimes } from "@/lib/installer-ready-check.functions";
import { ReadyCheckTimesPicker } from "@/components/portal/ready-check-times";
import { formatPiesaWindow, piesaWindowBlockers, type PiesaWindowPick } from "@/lib/piesa-windows.core";

export const Route = createFileRoute("/times/$token")({
  head: () => ({
    meta: [
      { title: "Choose your Ready Check times – Home Insulation Victoria" },
      { name: "description", content: "Choose 3 to 5 times that suit you for your free Ready Check." },
      { property: "og:title", content: "Choose your Ready Check times – Home Insulation Victoria" },
      { property: "og:description", content: "Choose 3 to 5 times that suit you for your free Ready Check." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TimesPage,
});

function TimesPage() {
  const { token } = Route.useParams();
  const get = useServerFn(getOwnerTimesPage);
  const send = useServerFn(submitOwnerTimes);
  const q = useQuery({ queryKey: ["owner-times", token], queryFn: () => get({ data: { token } }), retry: false });
  const [picks, setPicks] = useState<PiesaWindowPick[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const d = q.data;
  const open = d?.windows.filter((w) => w.status === "open") ?? [];
  const taken = d?.windows.find((w) => w.status === "taken");
  return (
    <main className="min-h-screen bg-estimate-canvas px-4 py-8 text-estimate-navy">
      <div className="mx-auto max-w-lg rounded-[22px] bg-card p-6 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-estimate-navy/60">Home Insulation Victoria</p>
        {q.isLoading ? <p className="mt-3">Loading…</p> : !d ? <p className="mt-3">This link is no longer active. Please contact your installer.</p> : (
          <>
            <h1 className="mt-1 font-display text-2xl font-extrabold">Your free Ready Check with {d.installer}</h1>
            {taken ? <p className="mt-3">Booked: <b>{formatPiesaWindow(taken.starts_at, taken.ends_at)}</b>. {d.installer} will see you then.</p>
              : open.length ? <><p className="mt-3 font-bold">Your times</p><ul className="mt-1 space-y-1 text-sm">{open.map((w) => <li key={w.starts_at}>{formatPiesaWindow(w.starts_at, w.ends_at)}</li>)}</ul><p className="mt-2 text-sm">{d.installer} will confirm one of these times.</p></>
              : d.canPick ? <div className="mt-4">
                <ReadyCheckTimesPicker value={picks} onChange={setPicks} disabled={busy} />
                {err && <p className="mt-2 text-sm font-bold text-destructive" role="alert">{err}</p>}
                <button type="button" disabled={busy || piesaWindowBlockers(picks).length > 0} className="mt-3 min-h-12 w-full rounded-xl bg-estimate-green px-5 py-3 font-extrabold text-estimate-white disabled:opacity-50"
                  onClick={async () => { setBusy(true); setErr(null); try { await send({ data: { token, picks } }); setPicks([]); await q.refetch(); } catch (e) { setErr(e instanceof Error ? e.message : "Your times could not be sent."); } finally { setBusy(false); } }}>
                  Send my times
                </button>
              </div> : <p className="mt-3">{d.installer} will be in touch to arrange your Ready Check.</p>}
          </>
        )}
      </div>
    </main>
  );
}
