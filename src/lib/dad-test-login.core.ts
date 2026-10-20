export const DAD_TEST_USER_ID = "1befe5c2-dc86-4503-afef-604295d8e638";
export const DAD_TEST_BUSINESS_ID = "6a1cfe8a-9314-4f41-bcd9-4b6d15b25a0f";
export const DAD_TEST_EMAIL = "installer-qa-dad-20261021@hivic-test.example";
export const DAD_TEST_PORTAL = "https://estimate.homeinsulationvictoria.com.au/portal";

export function dadTestHandoverText(setupUrl: string, expiresAt: string) {
  const expiry = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", dateStyle: "full", timeStyle: "long" }).format(new Date(expiresAt));
  return [
    "PRIVATE — Dad’s TEST installer login", "",
    `Set your password: ${setupUrl}`, `Login email: ${DAD_TEST_EMAIL}`,
    `Portal: ${DAD_TEST_PORTAL}`, `Setup link expires: ${expiry} (Australia/Sydney)`,
    `Exact expiry UTC: ${expiresAt}`, "",
    "Open the setup link once and choose your own password. Then use the login email and password at the portal.",
    "Dummy jobs only. Do not enter real customer information or upload real customer files.",
    "This practice email is not an inbox. Email recovery will not deliver. If the link expires or you forget your password, ask Office to generate a fresh private login file.",
    "Keep this file private. Anyone with the unused setup link can set this TEST account’s password.", "",
  ].join("\n");
}