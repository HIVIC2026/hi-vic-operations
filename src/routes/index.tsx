import { createFileRoute } from "@tanstack/react-router";
import { PublicCalculatorPage, publicCalculatorHead } from "@/components/portal/public-calculator-page";

// The bare address is the customer calculator on every host. Staff sign in at /auth
// (or /home, which sends signed-out visitors to /auth).
export const Route = createFileRoute("/")({
  ssr: false,
  headers: () => ({ "Cache-Control": "no-store" }),
  head: publicCalculatorHead,
  component: PublicCalculatorPage,
});
