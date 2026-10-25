import { createFileRoute } from "@tanstack/react-router";

// ESC Registry robot API (decision 385, Jo 25 Oct 2026). The robot runs outside the portal (scripts/esc-registry-robot.ts,
// Playwright, e.g. a scheduled Claude cloud session) and talks to the portal ONLY through this route with its own secret
// ESC_ROBOT_TOKEN (Authorization: Bearer …; set in Lovable secrets AND the robot environment) – never the database key.
// POST JSON { op, input } → { ok, result | error }. No/wrong token = 401 (token never logged); other methods = 405.
// Validation and dispatch are pure in esc-robot-api.core.ts; the operations and all their guards are in
// esc-robot-api.server.ts. Registry login secrets never pass through here.
const handle = async ({ request }: { request: Request }) => {
  const { handleRobotApi } = await import("@/lib/esc-robot-api.core");
  return handleRobotApi(request, process.env, async () => (await import("@/lib/esc-robot-api.server")).robotApiOps);
};

export const Route = createFileRoute("/api/public/hooks/esc-robot")({
  server: {
    handlers: { POST: handle, GET: handle, PUT: handle, PATCH: handle, DELETE: handle },
  },
});
