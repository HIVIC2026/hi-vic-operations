import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/portal/AppShell";
import { JobsWorkspace, jobsSearchSpec } from "@/components/portal/JobsWorkspace";
import { listControlsToSearch, parseListControls } from "@/lib/list-paging.core";

const SPEC = jobsSearchSpec("closed");

export const Route = createFileRoute("/_authenticated/admin/jobs/closed")({
  // The outcome tab is part of the URL, so a refresh or a shared link lands on the same tab and page.
  validateSearch: (s: Record<string, unknown>) => listControlsToSearch(parseListControls(s, SPEC), SPEC),
  head: () => ({ meta: [
    { title: "Closed jobs — Home Insulation Victoria Office" },
    { name: "description", content: "Completed, cancelled and ineligible jobs kept separate." },
    { property: "og:title", content: "Closed jobs — Home Insulation Victoria Office" },
    { property: "og:description", content: "One closed jobs workspace." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: ClosedJobsPage,
});

function ClosedJobsPage() {
  const controls = parseListControls(Route.useSearch(), SPEC);
  const navigate = Route.useNavigate();
  return (
    <AppShell wide>
      <JobsWorkspace
        mode="closed"
        controls={controls}
        navigate={(search) => void navigate({ search, resetScroll: false })}
      />
    </AppShell>
  );
}
