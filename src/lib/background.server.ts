// Request-lifecycle background work. On the deployed Worker, server.ts stores the platform's ctx.waitUntil here,
// so the runtime keeps the promise alive after the response. The durable queue + scheduled worker is always the
// fallback: if this best-effort run is cut short, the item's lease expires and the scheduled worker retries it.
import { AsyncLocalStorage } from "node:async_hooks";

type Ctx = { waitUntil?: ((p: Promise<unknown>) => void) | undefined };
export const requestContext = new AsyncLocalStorage<Ctx>();

/** Returns how the work was scheduled. Never throws. */
export function runAfterResponse(task: () => Promise<unknown>): "wait_until" | "dev_detached" | "queue_only" {
  const safe = () => task().catch((e) => console.error("background task failed", (e as Error).message));
  const ctx = requestContext.getStore();
  if (ctx?.waitUntil) { ctx.waitUntil(safe()); return "wait_until"; }
  // Local dev server is a long-lived Node process (not terminated after the response).
  if (process.env["NODE_ENV"] !== "production") { void safe(); return "dev_detached"; }
  return "queue_only"; // no lifecycle primitive: scheduled worker will pick it up
}
