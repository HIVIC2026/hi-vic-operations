export const INSULATION_REVIEW_OPTIONS = [
  { id: "loose_fill_only", label: "Confirm it is loose-fill insulation only", confirmation: "I confirm it is loose-fill insulation only", explanation: "Loose material, with no insulation batts." },
  { id: "photos", label: "Upload photos of your existing insulation" },
  { id: "video", label: "Take a video from the manhole" },
  { id: "below_r2", label: "Confirm your existing insulation is less than R2", confirmation: "I confirm my existing insulation is less than R2" },
] as const;
export type InsulationReviewOption = typeof INSULATION_REVIEW_OPTIONS[number]["id"];
export type InsulationDeclaration = "loose_fill_only" | "below_r2";
export function insulationDeclarationRecord(type: unknown, confirmed: unknown) {
  if (confirmed !== true || (type !== "loose_fill_only" && type !== "below_r2")) throw new Error("Choose a declaration and confirm it before submitting.");
  const declaration = type === "loose_fill_only" ? "I confirm it is loose-fill insulation only" : "I confirm my existing insulation is less than R2";
  return { eventType: type === "loose_fill_only" ? "owner_insulation_loose_fill_only_declared" : "owner_insulation_below_r2_declared", declaration, basis: "owner_declared", reviewReason: `Owner declared — review required: ${declaration} (not verified)` };
}
export const INSULATION_REVIEW_INVITATION = "Help us check your existing insulation. Choose one option below. Confirm it is loose-fill insulation only (loose material, with no insulation batts.); upload photos of your existing insulation; take a video from the manhole; or confirm your existing insulation is less than R2. Record from the manhole opening. Please do not climb into the roof space. Not sure? You can upload photos or a video, or we can check onsite. Our office reviews your submission; eligibility still needs final onsite confirmation.";