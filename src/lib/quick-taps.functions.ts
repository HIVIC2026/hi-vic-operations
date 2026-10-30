// A48 batch 2: the owner's quick taps on My job (?screen=taps). Literal createServerFn chains (AGENTS). Owner functions
// take ONLY the secure My job link token; the job is resolved from it on the server, never taken from the page.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withRequestMeta } from "./request-meta";

const token = z.string().max(200);
const answers = z.object({
  name: z.string().max(200).nullish(),
  address: z.string().max(300).nullish(),
  hatch: z.enum(["yes", "no", "not_sure"]).optional(),
  roof: z.enum(["sloped", "flat", "some", "not_sure"]).optional(),
  five_years: z.enum(["no", "yes", "not_sure"]).optional(),
  go: z.enum(["yes", "no_thanks"]).optional(),
  website: z.object({ property_type: z.string().max(40), top_floor: z.string().max(40), over_five_years: z.string().max(40), insulation: z.string().max(40) }).partial().optional(),
});

/** Owner: what `?screen=taps` shows (`none` = not in a batch asking for taps). */
export const ownerQuickTapsStateFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token }).parse(d))
  .handler(async ({ data }) => (await import("./quick-taps.server")).quickTapsState(data.token));

/** Owner: address search on the address tap. */
export const ownerQuickTapsAddressSearchFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token, query: z.string().max(200) }).parse(d))
  .handler(async ({ data }) => (await import("./quick-taps.server")).searchQuickTapsAddress(data.token, data.query));

/** Owner: "Change it" / typed name or address. */
export const ownerQuickTapsDetailsFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token, fullName: z.string().max(200).nullish(), placeId: z.string().min(1).max(600).nullish() }).parse(d))
  .handler(async ({ data }) => (await import("./quick-taps.server")).saveQuickTapsDetails(data.token, { fullName: data.fullName ?? null, placeId: data.placeId ?? null }));

/** Owner: the answers (once; a repeat gets the first outcome). */
export const ownerQuickTapsSaveFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token, answers }).parse(d))
  .handler(async ({ data, context }) => (await import("./quick-taps.server")).saveQuickTaps(data.token, data.answers, { ip: context.ip, userAgent: context.userAgent }));
