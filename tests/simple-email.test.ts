import { expect, test } from "bun:test";
import { simpleEmail } from "../src/lib/simple-email.core";

test("welcome retains its existing message and link through the approved suite", () => {
  const mail = simpleEmail("Welcome aboard, Jo", ["Approved"], { label: "Set up my account", url: "https://example.com" });
  expect(mail.html).toContain('aria-roledescription="email"');
  expect(mail.html).toContain('href="https://example.com"');
  expect(mail.text).toBe("Welcome aboard, Jo\n\nApproved\n\nSet up my account: https://example.com\n\nTEST — only sent to Jo.");
});