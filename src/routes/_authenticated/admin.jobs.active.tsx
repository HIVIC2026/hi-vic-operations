import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/portal/AppShell";
import { JobsWorkspace, jobsSearchSpec } from "@/components/portal/JobsWorkspace";
import { listControlsToSearch, parseListControls } from "@/lib/list-paging.core";

const SPEC = jobsSearchSpec("active");

export const Route = createFileRoute("/_authenticated/admin/jobs/active")({
  // Page, size, search, sort, direction and stage all live in the URL, so a refresh, a shared link and
  // the back button restore exactly the same list. Defaults are dropped, keeping the link readable.
  validateSearch: (s: Record<string, unknown>) => listControlsToSearch(parseListControls(s, SPEC), SPEC),
  head: () => ({ meta: [
    { title: "Active jobs — Home Insulation Victoria Office" },
    { name: "description", content: "Every operational job with its current stage, next action and who it is waiting on." },
    { property: "og:title", content: "Active jobs — Home Insulation Victoria Office" },
    { property: "og:description", content: "One active jobs workspace." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: ActiveJobsPage,
});

function ActiveJobsPage() {
  const controls = parseListControls(Route.useSearch(), SPEC);
  const navigate = Route.useNavigate();
  return (
    <AppShell wide>
      <JobsWorkspace
        mode="active"
        controls={controls}
        navigate={(search) => void navigate({ search, resetScroll: false })}
      />
    </AppShell>
  );
}
