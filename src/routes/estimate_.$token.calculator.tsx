import { createFileRoute, redirect } from "@tanstack/react-router";

// Jo 2 Nov 2026: the owner calculator is gone. Old links open the Save my spot page and keep the token.
export const Route = createFileRoute("/estimate_/$token/calculator")({
  beforeLoad: ({ params: { token } }) => {
    throw redirect({ to: "/estimate/$token/campaign", params: { token } });
  },
});
