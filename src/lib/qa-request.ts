import { createMiddleware } from "@tanstack/react-start";

export const qaRequestMiddleware = createMiddleware().server(async ({ request, next }) => {
  const [{ verifiedQaRequest }, { withQaContext }] = await Promise.all([import("./qa-request.core"), import("./qa-context.server")]);
  const presented = request.headers.has("x-hivic-qa-signature") || request.headers.has("x-hivic-qa-time");
  const qa = presented && await verifiedQaRequest(request.url, request.headers, process.env["LOVABLE_API_KEY"]);
  if (presented && !qa) return Response.json({ error: "Invalid preview TEST authorisation" }, { status: 403 });
  return withQaContext(qa, () => next());
});