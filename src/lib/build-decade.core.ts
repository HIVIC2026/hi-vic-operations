// Jo 23 Oct 2026 6:13pm: website asks "When was your home built?" (answers.build_decade). Owner-declared, never verified.
export const BUILD_DECADE_LABEL = {
  "1990_or_earlier": "1990 or earlier", "1991_1999": "1991–1999", "2000_2009": "2000–2009",
  "2010_2020": "2010–2020", last_5_years: "In the last 5 years", unknown: "Not sure",
} as const;
export type BuildDecade = keyof typeof BUILD_DECADE_LABEL;

export function buildDecadeFromAnswers(answers: Record<string, unknown> | null | undefined): BuildDecade | null {
  const v = String(answers?.["build_decade"] ?? "").trim().toLowerCase();
  return v in BUILD_DECADE_LABEL ? (v as BuildDecade) : null;
}
export function buildDecadeLabel(d: BuildDecade | null): string | null { return d ? BUILD_DECADE_LABEL[d] : null; }
