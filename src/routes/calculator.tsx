import { createFileRoute } from "@tanstack/react-router";
import { PublicCalculatorPage } from "@/components/portal/public-calculator-page";
import { publicCalculatorHead } from "@/components/portal/public-calculator-head";

export const Route = createFileRoute("/calculator")({
  headers: () => ({ "Cache-Control": "no-store" }),
  head: publicCalculatorHead,
  component: PublicCalculatorPage,
});
