// Decision 364: the public safety plan (SWMS) page for one crew member's own secure link (/sp/<token>). The token is the
// only credential; it names one job and one signer key, and signs only that line. Logic in swms-link.server.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const tokenSchema = z.string().min(20).max(1000).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

export const getSwmsLinkView = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: tokenSchema }).parse(d))
  .handler(async ({ data }) => (await import("./swms-link.server")).swmsLinkView(data.token));

export const signSwmsByLink = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: tokenSchema, typedName: z.string().trim().min(2).max(200) }).parse(d))
  .handler(async ({ data }) => (await import("./swms-link.server")).swmsLinkSign(data.token, data.typedName));

/** Part 7 Task 3: the full plan as a PDF, fetched only when the person taps "Read the full safety plan (PDF)". */
export const getSwmsLinkPdf = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: tokenSchema }).parse(d))
  .handler(async ({ data }) => (await import("./swms-link.server")).swmsLinkPdf(data.token));

/** Part 7 Task 4: the Lead Installer opens a crew member's own sign link on the Lead's phone ("Sign on my phone"). */
export const openCrewSignOnLeadPhone = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: tokenSchema, crewKey: z.string().min(3).max(300) }).parse(d))
  .handler(async ({ data }) => (await import("./swms-link.server")).swmsLinkLeadPhone(data.token, data.crewKey));
