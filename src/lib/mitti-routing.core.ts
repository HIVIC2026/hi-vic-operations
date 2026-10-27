export type MittiRoute = "real" | "simulated";
export function mittiRoute(source: string | null | undefined, qaActive: boolean, attributed: boolean): MittiRoute {
  if (attributed && source === "qa_test") return "simulated";
  if (!attributed && qaActive) throw new Error("SAFETY STOP: unattributed Mitti call refused in active qa_test context");
  return "real";
}