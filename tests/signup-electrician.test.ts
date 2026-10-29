import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { signupMainElectrician } from "../src/lib/signup-electrician.core";

const viking = { name: "Will Casdorff", email: "jesse@vikingelec.com.au", mobile: "0 4 6 6 6 5 1 9 0 8", is_primary: true, rec_number: "38603", business_name: "Viking Electrical Services Aus PTY LTD", licence_number: "A81638" };
test("main electrician from sign-up", () => {
  expect(signupMainElectrician({ electrician_choice: "have", preferred_electricians: [viking] }))
    .toEqual({ name: "Viking Electrical Services Aus PTY LTD", licence: "38603", email: "jesse@vikingelec.com.au", phone: "0466651908" });
});
test("first one when none marked main; nothing when not 'have' or empty", () => {
  const a = { ...viking, is_primary: false, business_name: "A" }, b = { ...viking, is_primary: false, business_name: "B" };
  expect(signupMainElectrician({ electrician_choice: "have", preferred_electricians: [a, b] })?.name).toBe("A");
  expect(signupMainElectrician({ electrician_choice: "hivic", preferred_electricians: [viking] })).toBeNull();
  expect(signupMainElectrician({ electrician_choice: "have", preferred_electricians: [] })).toBeNull();
  expect(signupMainElectrician({ electrician_choice: "have", preferred_electricians: [{ name: "", business_name: "" }] })).toBeNull();
});
test("approval calls it, never fails approval", () => {
  const src = readFileSync("src/lib/pilot.functions.ts", "utf8");
  expect(src).toMatch(/carrySignupElectrician\(data\.businessId, context\.userId\)\)?\.catch/);
});
