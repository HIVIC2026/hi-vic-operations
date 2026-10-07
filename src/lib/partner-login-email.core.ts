// Plain partner login email (DRAFT wording — Jo to approve). Link opens our own set-password page; works once.
export function partnerLoginEmail(_name: string | null, link: string): { subject: string; message: string } {
  return {
    subject: "Your Home Insulation Victoria portal login",
    message: [
      "You're approved. Tap the link below to set your password and sign in to the Home Insulation Victoria portal:",
      "",
      link,
      "",
      "The link works once and expires after 24 hours. If it has expired, open it anyway and tap \"Send me a new link\".",
      "After that, sign in any time at https://estimate.homeinsulationvictoria.com.au/portal",
    ].join("\n"),
  };
}
