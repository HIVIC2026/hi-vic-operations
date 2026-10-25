import { createFileRoute } from "@tanstack/react-router";
import { PublicCalculatorPage } from "@/components/portal/public-calculator-page";
import { publicCalculatorHead } from "@/components/portal/public-calculator-head";
import { publicPageHeaders } from "@/lib/public-cache.core";

// Same public calculator as `/`: no per-user data in the server-rendered HTML, so it may be cached briefly.
export const Route = createFileRoute("/calculator")({
  headers: publicPageHeaders,
  head: publicCalculatorHead,
  component: PublicCalculatorPage,
});
