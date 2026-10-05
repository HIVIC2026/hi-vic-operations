import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/portal/AppShell";
import { JobCard } from "@/components/portal/JobCard";
import { useMe } from "@/hooks/use-me";

export const Route = createFileRoute("/_authenticated/owner/")({
  head: () => ({ meta: [{ title: "My home – Home Insulation Victoria" }, { name: "description", content: "Your insulation job with Home Insulation Victoria." }, { property: "og:title", content: "My home – Home Insulation Victoria" }, { property: "og:description", content: "Your insulation job with Home Insulation Victoria." }] }),
  component: OwnerHome,
});

function OwnerHome() {
  const { data: me } = useMe();
  const { data: jobs, isLoading } = useQuery({
    queryKey: ["ownerjobs"],
    enabled: !!me,
    queryFn: async () => {
      const { data: owner } = await supabase.from("owners").select("id").eq("user_id", me.user.id);
      const ids = (owner ?? []).map((o) => o.id);
      if (!ids.length) return [];
      return (await supabase.from("job_overview").select("*").in("owner_id", ids).not("stage", "eq", "cancelled").order("created_at", { ascending: false })).data ?? [];
    },
  });
  if (!isLoading && jobs?.length === 1) return <Navigate to="/owner/$jobId" params={{ jobId: jobs[0]!.id! }} />;
  return (
    <AppShell>
      <h1 className="mb-4 text-2xl font-bold">My insulation jobs</h1>
      {jobs?.length ? <div className="grid gap-3 sm:grid-cols-2">{jobs.map((j) => <JobCard key={j.id} job={j} to="/owner/$jobId" />)}</div> : !isLoading && <p className="rounded-xl border bg-card p-6 text-center text-muted-foreground">We couldn't find a job linked to your email yet.</p>}
    </AppShell>
  );
}
