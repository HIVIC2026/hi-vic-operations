import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/portal/AppShell";
import { InboxScreen } from "@/components/portal/InboxScreen";

// Office Inbox (Jo 26 Oct 2026): emails that couldn't be put on a job by themselves, moved here from Enquiries.
export const Route = createFileRoute("/_authenticated/admin/inbox")({
  head: () => ({
    meta: [
      { title: "Inbox — Home Insulation Victoria Office" },
      { name: "description", content: "Emails that need a home: match each one to a job or mark it not a customer." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: () => <AppShell><InboxScreen /></AppShell>,
});
