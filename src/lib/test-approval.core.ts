// Approving Jo's own TEST installer/REC application (office test mark) into a TEST partner business.
// Pure rules. Real applications are unaffected; real partners still get nothing sent.
import { TEST_ALLOWLIST, TEST_PARTNER_MARK } from "./test-send.core";

/** null = this test-marked application may be approved as a TEST partner. */
export function testApprovalBlocker(x: { testMode: boolean }): string | null {
  return x.testMode ? "Automatic test-run applications can never be approved." : null;
}

/** TEST partner login: a plus-alias of Jo's test inbox, one per application, so it never takes over another TEST login.
 * The welcome itself is only ever sent to the allowlisted address. */
export const testLoginEmail = (appId: string) => {
  const [user, domain] = TEST_ALLOWLIST.email[0].split("@");
  return `${user}+app${appId.replace(/-/g, "").slice(0, 8)}@${domain}`;
};

/** 12 digits: can never equal a real 11-digit ABN, so a TEST approval never touches a real business. */
export const testAbn = (appId: string) => `999${appId.replace(/\D/g, "").padEnd(9, "0").slice(0, 9)}`;
export const testBusinessName = (name: string) => (name.startsWith(TEST_PARTNER_MARK) ? name : `${TEST_PARTNER_MARK} ${name}`);

/** Enquiry status "Approved" is only ever set by the real approval; the dropdown can't fake it. */
export function enquiryStatusBlocker(x: { status: string | undefined; hasSignedApplication: boolean }): string | null {
  if (x.status === "approved" && x.hasSignedApplication) return "Use \"Approve partner\" on the signed application below. Changing the status here doesn't approve anyone or send anything.";
  return null;
}

/** DRAFT welcome wording (Jo must approve before real partners receive it). */
export function testWelcomeCopy(x: { firstName: string | null; businessName: string; link: string; loginEmail?: string }) {
  const hi = x.firstName ? `Welcome aboard, ${x.firstName}` : "Welcome aboard";
  return {
    subject: "You're approved — welcome to Home Insulation Victoria",
    heading: hi,
    paragraphs: [
      `${x.businessName.replace(TEST_PARTNER_MARK, "").trim()} is approved as a Home Insulation Victoria partner.`,
      "Tap the button to set your password and sign in to your online portal. The link works once and expires in 24 hours.",
      ...(x.loginEmail ? [`Your sign-in email is ${x.loginEmail}.`] : []),
    ],
    button: { label: "Set my password", url: x.link },
  };
}
