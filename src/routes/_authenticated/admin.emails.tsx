import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/portal/AppShell";
import { EmailsScreen } from "@/components/portal/EmailsScreen";

// Office Emails tab (Jo 27 Oct 2026, decision 414): owner emails and emails with no job yet, apart from Enquiries and Jobs.
export const Route = createFileRoute("/_authenticated/admin/emails")({
  head: () => ({
    meta: [
      { title: "Emails — Home Insulation Victoria Office" },
      { name: "description", content: "Owner emails and emails with no job yet, each with an AI reply to check and send." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: () => <AppShell><EmailsScreen /></AppShell>,
});
