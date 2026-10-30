export function qaNoDelivery(source: unknown, refs: unknown): boolean {
  return source === "qa_test" && !!refs && typeof refs === "object" && (refs as Record<string, unknown>)["qa_no_delivery"] === true;
}