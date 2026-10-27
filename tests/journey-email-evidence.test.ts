import { expect, test } from "bun:test";
import { acceptedTestEmail } from "../scripts/journey-email-evidence.core";
test("TEST provider acceptance recorded in source_reference counts; held attempts do not", () => {
  expect(acceptedTestEmail({ delivery_status: "sent", provider_message_id: null, source_reference: "Resend accepted (id 01a17cfc-5a7d-72e8-8373-2c2e7e46ec7e)" })).toBe("01a17cfc-5a7d-72e8-8373-2c2e7e46ec7e");
  expect(acceptedTestEmail({ delivery_status: "blocked_prelaunch", provider_message_id: null, source_reference: "Not on allowlist" })).toBeNull();
});