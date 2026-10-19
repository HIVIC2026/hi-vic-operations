import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/portal/AppShell";
import { EnquiriesWorkspace, ENQUIRY_SPEC } from "@/components/portal/EnquiriesWorkspace";
import { listControlsToSearch, parseListControls } from "@/lib/list-paging.core";

export const Route = createFileRoute("/_authenticated/admin/enquiries")({
  // The view, page, size, search, sort and direction all live in the URL. Defaults are dropped, so the
  // default view stays on a clean link and anything filtered is fully described by its own URL.
  validateSearch: (s: Record<string, unknown>) => listControlsToSearch(parseListControls(s, ENQUIRY_SPEC), ENQUIRY_SPEC),
  head: () => ({
    meta: [
      { title: "Enquiries — Home Insulation Victoria Office" },
      {
        name: "description",
        content:
          "One enquiry workspace: current outcome, photos, eligibility and the next office action.",
      },
      { property: "og:title", content: "Enquiries — Home Insulation Victoria Office" },
      { property: "og:description", content: "One enquiry workspace for the office." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: EnquiriesPage,
});

function EnquiriesPage() {
  const controls = parseListControls(Route.useSearch(), ENQUIRY_SPEC);
  const navigate = Route.useNavigate();
  return (
    <AppShell wide>
      <EnquiriesWorkspace
        controls={controls}
        navigate={(search) => void navigate({ search, resetScroll: false })}
      />
    </AppShell>
  );
}
