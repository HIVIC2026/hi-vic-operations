import { createFileRoute } from "@tanstack/react-router";
import { PublicCalculatorPage, publicCalculatorHead } from "@/components/portal/public-calculator-page";

export const Route = createFileRoute("/calculator")({
  headers: () => ({ "Cache-Control": "no-store" }),
  head: publicCalculatorHead,
  component: PublicCalculatorPage,
});
