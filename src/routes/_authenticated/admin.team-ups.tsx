import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Link2, Users } from "lucide-react";
import { AppShell } from "@/components/portal/AppShell";
import { Button } from "@/components/ui/button";
import { endTeamUp, issueTeamInviteLink, listTeamNominations, markTeamInviteSent } from "@/lib/teaming.functions";

const meta = "Preferred electricians nominated by installers, their invites and team-up status.";
export const Route = createFileRoute("/_authenticated/admin/team-ups")({
  head: () => ({ meta: [{ title: "Electrician Team-ups – HI VIC Portal" }, { name: "description", content: meta }, { property: "og:title", content: "Electrician Team-ups – HI VIC Portal" }, { property: "og:description", content: meta }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: TeamUpsPage,
});

const tone: Record<string, string> = {
  teamed: "border-success/30 bg-success-soft text-success", declined: "border-danger/40 bg-danger-soft text-danger", expired: "border-warning/40 bg-warning-soft text-foreground",
  ended: "border-muted bg-muted text-muted-foreground",
};

function TeamUpsPage() {
  const qc = useQueryClient();
  const list = useServerFn(listTeamNominations), issue = useServerFn(issueTeamInviteLink), sent = useServerFn(markTeamInviteSent), end = useServerFn(endTeamUp);
  const { data, error, isPending } = useQuery({ queryKey: ["team-ups"], queryFn: () => list(), retry: 2 });
  const [links, setLinks] = useState<Record<string, string>>({});
  const refresh = () => qc.invalidateQueries({ queryKey: ["team-ups"] });
  const run = async (f: () => Promise<unknown>, ok: string) => { try { await f(); toast.success(ok); refresh(); } catch (e) { toast.error(e instanceof Error ? e.message : "Something went wrong."); } };

  return <AppShell wide>
    <div className="mb-5 border-b pb-5">
      <h1 className="flex items-center gap-2 font-display text-2xl font-bold"><Users className="h-6 w-6" /> Electrician team-ups</h1>
      <p className="mt-1 text-sm text-muted-foreground">Installers name their preferred electricians during onboarding. Messages are locked before launch, so copy each invite link and send it yourself, then mark it sent. Once the electrician accepts and both businesses are approved, they're teamed and get that installer's jobs automatically.</p>
    </div>
    {error && <p className="rounded-lg border border-danger/40 bg-danger-soft p-3 text-sm text-danger">Could not load team-ups: {(error as Error).message}</p>}
    {isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
    {data && data.length === 0 && <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">No preferred electricians nominated yet.</p>}
    <div className="grid gap-3">
      {data?.map((r) => {
        const open = !["teamed", "declined", "ended"].includes(r.status);
        return <div key={r.id} className="rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="font-semibold">{r.name} {r.isPrimary ? <span className="text-xs text-primary">· Main</span> : <span className="text-xs text-muted-foreground">· Backup</span>}</div>
              <div className="text-sm text-muted-foreground">{r.email}{r.phone ? ` · ${r.phone}` : ""}{r.business ? ` · ${r.business}` : ""}</div>
              <div className="text-sm">Nominated by <strong>{r.installer}</strong></div>
            </div>
            <span className={`rounded-full border px-2 py-1 text-xs font-bold ${tone[r.status] ?? "border-primary/30 bg-primary/10 text-primary"}`}>{r.statusLabel}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {open && <Button size="sm" variant="outline" onClick={() => run(async () => {
              const x = await issue({ data: { id: r.id } }); const url = `${window.location.origin}${x.path}`;
              setLinks((l) => ({ ...l, [r.id]: url })); await navigator.clipboard?.writeText(url).catch(() => undefined);
            }, "Invite link copied (valid 14 days)")}><Link2 className="mr-1 h-4 w-4" />{r.expiresAt ? "New invite link" : "Create invite link"}</Button>}
            {open && r.expiresAt && <Button size="sm" variant="outline" onClick={() => run(() => sent({ data: { id: r.id } }), "Marked as sent")}>I've sent it</Button>}
            {r.status === "teamed" && <Button size="sm" variant="outline" onClick={() => confirm("End this team-up? Current jobs keep their electrician.") && run(() => end({ data: { id: r.id } }), "Team-up ended")}>End team-up</Button>}
          </div>
          {links[r.id] && <input readOnly className="mt-2 w-full rounded border bg-muted px-2 py-1 text-xs" value={links[r.id]} onFocus={(e) => e.currentTarget.select()} />}
        </div>;
      })}
    </div>
  </AppShell>;
}
