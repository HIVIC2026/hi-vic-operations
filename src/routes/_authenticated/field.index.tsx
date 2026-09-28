import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/portal/AppShell";
import { JobCard } from "@/components/portal/JobCard";
import { useMe } from "@/hooks/use-me";

export const Route = createFileRoute("/_authenticated/field/")({
  head: () => ({ meta: [{ title: "My jobs – HI VIC Portal" }, { name: "description", content: "Your assigned HI VIC jobs." }, { property: "og:title", content: "My jobs – HI VIC Portal" }, { property: "og:description", content: "Your assigned HI VIC jobs." }] }),
  component: FieldJobs,
});

function FieldJobs() {
  const { data: me } = useMe();
  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["fieldjobs", me?.user.id],
    enabled: !!me,
    queryFn: async () => {
      const uid = me!.user.id;
      return (await supabase.from("job_overview").select("*").or(`electrician_id.eq.${uid},installer_id.eq.${uid}`).not("stage", "in", "(complete,cancelled)").order("last_activity_at", { ascending: false })).data ?? [];
    },
  });
  return (
    <AppShell>
      <h1 className="mb-1 text-2xl font-bold">My jobs</h1>
      <p className="mb-4 text-sm text-muted-foreground">Jobs assigned to you. Tap a job to work through it onsite.</p>
      {isLoading ? <p className="text-muted-foreground">Loading…</p> : jobs.length ? (
        <div className="grid gap-3 sm:grid-cols-2">{jobs.map((j) => <JobCard key={j.id} job={j} to="/field/$jobId" />)}</div>
      ) : <p className="rounded-xl border bg-card p-6 text-center text-muted-foreground">No jobs assigned right now.</p>}
    </AppShell>
  );
}
