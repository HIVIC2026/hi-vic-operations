import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withRequestMeta } from "./request-meta";
export const submitInsulationTapAnswers = createServerFn({method:"POST"}).middleware([withRequestMeta])
  .inputValidator((d:unknown)=>z.object({token:z.string().min(43).max(200),answers:z.object({insulation_type:z.enum(["loose_fill","batts","unknown"]),insulation_thickness:z.enum(["thin","hand","thicker","unknown"]),house_built_period:z.enum(["1990_or_earlier","1991_1999","2000_2009","2010_or_later","unknown"])})}).parse(d))
  .handler(async ({data,context})=>(await import("./insulation-details.server")).saveInsulationTapAnswers(data.token,data.answers,context.assessmentTestMode));