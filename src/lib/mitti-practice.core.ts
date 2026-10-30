export const PRACTICE_FIELDS = [
  "Homeowner agrees to be contacted by Home Insulation Victoria", "Life support equipment at property?", "How easy is the ceiling access?", "How many separate ceiling areas are there?", "Enter the measured ceiling area (m²)", "Is there existing insulation?", "How was this ceiling area measured?", "Recessed downlights in this area?", "Hazards in this area?", "Was the ceiling or roof built or replaced in the last 5 years?", "What insulation product will you be using on this job?", "Are any extras needed beyond the standard install and removal?",
] as const;
export function practiceAllowed(i: { source: unknown; email: unknown; assigned: boolean; audit: string; linkedAudit: unknown; archived: unknown }) {
  return i.source === "qa_test" && typeof i.email === "string" && i.email.endsWith("@hivic-test.example") && i.assigned && i.audit.startsWith("sim_") && i.linkedAudit === i.audit && !i.archived;
}
export function practiceAnswers(values: Record<string, string>) {
  const answer = (label: string) => ({ item_id: `practice_${PRACTICE_FIELDS.indexOf(label as typeof PRACTICE_FIELDS[number])}`, label, type: "textsingle", responses: { text: values[label] ?? "" } });
  const areaLabels = PRACTICE_FIELDS.slice(4, 9);
  return [...PRACTICE_FIELDS.filter(l => !areaLabels.includes(l)).map(answer), { item_id: "practice_area", label: "Ceiling area 1", type: "section", children: areaLabels.map(answer) }];
}