// Plain partner login email (DRAFT wording — Jo to approve). Link opens our own set-password page; works once.
export function partnerLoginEmail(name: string | null, link: string): { subject: string; message: string } {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return {
    subject: "Your Home Insulation Victoria portal login",
    message: [
      `${first ? `Hi ${first},` : "Hi,"}`,
      "",
      "You're approved. Tap the link below to set your password and sign in to the Home Insulation Victoria portal:",
      "",
      link,
      "",
      "The link works once and expires after 1 hour. If it has expired, open it anyway and tap \"Send me a new link\".",
      "After that, sign in any time at https://estimate.homeinsulationvictoria.com.au/portal",
    ].join("\n"),
  };
}
