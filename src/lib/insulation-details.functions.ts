import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withRequestMeta } from "./request-meta";
import { BUILD_DECADE_VALUES } from "./build-decade.core";
export const submitInsulationTapAnswers = createServerFn({method:"POST"}).middleware([withRequestMeta])
  .inputValidator((d:unknown)=>z.object({token:z.string().min(43).max(200),answers:z.object({insulation_type:z.enum(["loose_fill","batts","unknown"]),insulation_thickness:z.enum(["thin","hand","thicker","unknown"]),house_built_period:z.enum(BUILD_DECADE_VALUES)})}).parse(d))
  .handler(async ({data,context})=>(await import("./insulation-details.server")).saveInsulationTapAnswers(data.token,data.answers,context.assessmentTestMode));