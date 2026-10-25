import { createFileRoute } from "@tanstack/react-router";
import { SignInCard } from "@/components/portal/SignInCard";
import { publicPageHeaders } from "@/lib/public-cache.core";

// The sign-in card's HTML is the same for everyone (the session lives in the browser, read after hydration).
export const Route = createFileRoute("/auth")({
  headers: publicPageHeaders,
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

