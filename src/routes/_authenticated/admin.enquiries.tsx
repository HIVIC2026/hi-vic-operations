import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/portal/AppShell";
import { EnquiriesWorkspace, type EnquiryView } from "@/components/portal/EnquiriesWorkspace";

const VIEWS: EnquiryView[] = [
  "all",
  "new",
  "spot_saved",
  "offered_spot",
  "insulation_requested",
  "ineligible",
  "needs_attention",
  "photos",
  "removed",
];

export const Route = createFileRoute("/_authenticated/admin/enquiries")({
  validateSearch: (s: Record<string, unknown>): { status?: EnquiryView; q?: string; page: number } => ({
    page: Math.max(0, Number(s["page"]) || 0),
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
  const { status = "all", q = "", page } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AppShell wide>
      <EnquiriesWorkspace
        view={status}
        q={q}
        page={page}
        onPage={next => void navigate({ search: prev => ({ ...prev, page: next }), resetScroll: false })}
        onView={(next) =>
          void navigate({ search: (prev) => ({ ...prev, status: next, page: 0 }), resetScroll: false })
        }
        onQ={(next) =>
          void navigate({ search: (prev) => ({ ...prev, q: next, page: 0 }), resetScroll: false })
        }
      />
    </AppShell>
  );
}
