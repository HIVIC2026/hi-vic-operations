// testRigor TEST logins (decision 403). Fixed TEST personas only; the file carries one-time set-password links, never passwords.
export const TESTRIGOR_INSTALLER_EMAIL = "qa.installer.alpha@hivic-test.example";
export const TESTRIGOR_ELECTRICIAN_EMAIL = "qa.rec.delta@hivic-test.example";
export const TESTRIGOR_OFFICE_EMAIL = "admin@hivic.test";
export const TESTRIGOR_PORTAL = "https://portal.homeinsulationvictoria.com.au/auth";
export const TESTRIGOR_FILENAME = "testRigor-TEST-logins.txt";

export type TestRigorPersona = "installer" | "electrician";
export const TESTRIGOR_PERSONAS: ReadonlyArray<{ persona: TestRigorPersona; email: string; label: string }> = [
  { persona: "installer", email: TESTRIGOR_INSTALLER_EMAIL, label: "TEST installer" },
  { persona: "electrician", email: TESTRIGOR_ELECTRICIAN_EMAIL, label: "TEST electrician" },
];
export type TestRigorLink = { setupUrl: string; expiresAt: string };

function sydney(expiresAt: string) {
  return new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", dateStyle: "full", timeStyle: "long" }).format(new Date(expiresAt));
}

/** Pure file text. Line names match the testRigor stored values in docs/testrigor/README.md. */
export function testRigorHandoverText(links: Record<TestRigorPersona, TestRigorLink>) {
  const sections = TESTRIGOR_PERSONAS.flatMap(({ persona, email, label }) => {
    const link = links[persona];
    return [
      `--- ${label} ---`,
      `${persona}Email: ${email}`,
      `${persona}Password: the password you choose at this one-time link`,
      `Set your password: ${link.setupUrl}`,
      `Setup link expires: ${sydney(link.expiresAt)} (Australia/Sydney)`,
      `Exact expiry UTC: ${link.expiresAt}`, "",
    ];
  });
  return [
    "PRIVATE — testRigor TEST logins", "",
    "For each account: open its Set your password link once, type a New password twice, press Save password & continue.",
    "Then put the email and the password you chose into testRigor > Test Data, using the names below.", "",
    ...sections,
    "--- TEST office ---",
    `officeEmail: ${TESTRIGOR_OFFICE_EMAIL}`,
    "officePassword: not in this file. Use the office password you already have.",
    "(The office TEST account is a full Office admin, not a reserved TEST-only account, so no set-password link is issued for it here.)", "",
    `Portal sign-in: ${TESTRIGOR_PORTAL}`,
    "TEST jobs only. Do not enter real customer information or upload real customer files.",
    "These practice emails are not inboxes. Forgot password will not deliver. If a link expires or a password is lost, press the button again for a fresh file.",
    "Each link works once and only before it expires. Keep this file private: anyone with an unused link can set that TEST account's password.",
    "Never paste these links or passwords into chat, email or the code repository.", "",
  ].join("\n");
}
