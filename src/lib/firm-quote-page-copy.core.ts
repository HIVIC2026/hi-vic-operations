// Jo-approved (7 Nov 2026) wording for the page shown after "Proceed to firm quote". PURE.
export const FIRM_PAGE_COPY = {
  thanks: (first: string | null) => `Thanks${first ? `, ${first}` : ""}. We're on it.`,
  assessment: "One of our certified installers will now do a desktop assessment using your photos, aerial imagery and floor plan records.",
  emailBy: "We'll email your firm quote by",
  nothingLocked: "Nothing is locked in until you accept your firm quote.",
} as const;
