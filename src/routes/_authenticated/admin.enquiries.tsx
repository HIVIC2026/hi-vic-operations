import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/portal/AppShell";
import { EnquiriesWorkspace, type EnquiryView } from "@/components/portal/EnquiriesWorkspace";

const VIEWS: EnquiryView[] = [
  "all",
  "spot_saved",
  "offered_spot",
  "insulation_requested",
  "ineligible",
  "needs_attention",
  "photos",
  "removed",
];

export const Route = createFileRoute("/_authenticated/admin/enquiries")({
  validateSearch: (s: Record<string, unknown>): { status?: EnquiryView; q?: string } => ({
    ...(VIEWS.includes(s["status"] as EnquiryView) ? { status: s["status"] as EnquiryView } : {}),
    ...(typeof s["q"] === "string" && s["q"] ? { q: s["q"] } : {}),
  }),
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
  const { status = "all", q = "" } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AppShell wide>
      <EnquiriesWorkspace
        view={status}
        q={q}
        onView={(next) =>
          void navigate({ search: (prev) => ({ ...prev, status: next }), resetScroll: false })
        }
        onQ={(next) =>
          void navigate({ search: (prev) => ({ ...prev, q: next }), resetScroll: false })
        }
      />
    </AppShell>
  );
}
