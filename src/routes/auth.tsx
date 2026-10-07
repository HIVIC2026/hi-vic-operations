import { createFileRoute } from "@tanstack/react-router";
import { SignInCard } from "@/components/portal/SignInCard";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in – Home Insulation Victoria" },
      { name: "description", content: "Sign in to Home Insulation Victoria." },
      { property: "og:title", content: "Sign in – Home Insulation Victoria" },
      { property: "og:description", content: "Sign in to Home Insulation Victoria." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SignInCard,
});

