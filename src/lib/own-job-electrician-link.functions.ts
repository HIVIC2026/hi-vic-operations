// Join 4 Nov 2026: main's Part 2 (#130) /e/<token> server functions, renamed from electrician-link.functions.ts — the
// page (src/routes/e.$token.tsx) is Part 6's and falls back to these when the token is an own-job link
// (`electrician_job_links`). No auth middleware: the token is the only credential (same pattern as swms-link.functions.ts).
// Logic in own-job-electrician-link.server.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{40,64}$/);

export const bookOwnJobPiesaByLink = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: tokenSchema, day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/) }).parse(d))
  .handler(async ({ data }) => {
    const { melbourneWallToIso, melbourneWallProblem } = await import("./own-job-electrician-link.core");
    const startIso = melbourneWallToIso(data.day, data.time);
    if (!startIso) throw new Error(melbourneWallProblem(data.day, data.time) ?? "That date and time isn't valid.");
    return (await import("./own-job-electrician-link.server")).linkBookPiesa(data.token, startIso);
  });

export const ownJobCantDoByLink = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: tokenSchema, reason: z.enum(["busy", "owner_not_answering", "other"]), note: z.string().trim().max(500).optional() }).parse(d))
  .handler(async ({ data }) => (await import("./own-job-electrician-link.server")).linkCantDo(data.token, data.reason, data.note));
