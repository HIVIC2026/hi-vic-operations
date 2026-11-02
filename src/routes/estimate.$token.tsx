import { createFileRoute, redirect } from "@tanstack/react-router";

// Jo 2 Nov 2026: the owner estimate page is gone. Old links open the Save my spot page and keep the token.
export const Route = createFileRoute("/estimate/$token")({
  beforeLoad: ({ params: { token } }) => {
    throw redirect({ to: "/estimate/$token/campaign", params: { token } });
  },
});
