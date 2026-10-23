/** Offer authorization is separate from insulation evidence: never fabricate a photo review. */
export function existingInsulationTemplateFacts(x: { insulation: string | null; authorized: boolean; reviewOutcome: string | null; readFailed: boolean; type?: string | null; thickness?: string | null; coverage?: string | null }) {
 if (!x.authorized || x.readFailed || x.reviewOutcome || !['present','unknown'].includes(x.insulation ?? '')) return { declaredThinPatchy:false, declaredExisting:false };
 const thin=x.insulation==='present' && (x.type==='loose_fill'||x.thickness==='thin'||x.coverage==='partial');
 return {declaredThinPatchy:thin,declaredExisting:!thin};
}