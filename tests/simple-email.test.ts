import { expect, test } from "bun:test";
import { simpleEmail } from "../src/lib/simple-email.core";

test("welcome output stays exactly the legacy template", () => {
  const mail = simpleEmail("Welcome aboard, Jo", ["Approved"], { label: "Set up my account", url: "https://example.com" });
  expect(mail.html).toBe(`<!doctype html><html><body style="margin:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#22376B;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" style="max-width:520px;background:#FBFCFA;border:1px solid #E4E9F5;border-radius:22px;" cellpadding="0" cellspacing="0"><tr><td style="padding:28px 24px;">
<div style="font-size:13px;font-weight:bold;color:#3C51C4;">Home Insulation Victoria</div>
<div style="display:inline-block;margin-top:6px;background:#FDF2F6;color:#22376B;font-size:11px;font-weight:bold;padding:3px 8px;border-radius:999px;">TEST — only sent to Jo</div>
<h1 style="font-size:24px;line-height:1.25;margin:14px 0 12px;">Welcome aboard, Jo</h1>
<p style="font-size:15px;line-height:1.55;margin:0 0 12px;">Approved</p>
<p style="margin:20px 0 4px;"><a href="https://example.com" style="display:inline-block;background:#07BF61;color:#ffffff;font-weight:bold;text-decoration:none;padding:14px 22px;border-radius:14px;font-size:16px;">Set up my account</a></p>
</td></tr></table></td></tr></table></body></html>`);
  expect(mail.text).toBe("Welcome aboard, Jo\n\nApproved\n\nSet up my account: https://example.com\n\nTEST — only sent to Jo.");
});