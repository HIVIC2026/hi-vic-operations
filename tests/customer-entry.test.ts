import { describe, expect, it } from "bun:test";
import {
  CUSTOMER_ENTRY_PATH,
  customerEntryPoint,
  isCustomerHost,
  normalizeHost,
} from "../src/lib/customer-entry.core";

const CUSTOMER = "estimate.homeinsulationvictoria.com.au";

describe("normalizeHost", () => {
  it("lower-cases and trims", () => {
    expect(normalizeHost("  Estimate.HomeInsulationVictoria.com.au ")).toBe(CUSTOMER);
  });

  it("strips the port", () => {
    expect(normalizeHost(`${CUSTOMER}:443`)).toBe(CUSTOMER);
  });

  it("strips a trailing dot", () => {
    expect(normalizeHost(`${CUSTOMER}.`)).toBe(CUSTOMER);
  });

  it("returns empty for missing headers", () => {
    expect(normalizeHost(null)).toBe("");
    expect(normalizeHost(undefined)).toBe("");
    expect(normalizeHost("")).toBe("");
  });
});

describe("isCustomerHost", () => {
  it("recognises the customer address", () => {
    expect(isCustomerHost(CUSTOMER)).toBe(true);
    expect(isCustomerHost(`${CUSTOMER}:443`)).toBe(true);
  });

  it("refuses look-alikes and spoofs", () => {
    expect(isCustomerHost("not-us.example.com")).toBe(false);
    expect(isCustomerHost(`evil-${CUSTOMER}`)).toBe(false);
    expect(isCustomerHost(`x.${CUSTOMER}`)).toBe(false);
    expect(isCustomerHost(`${CUSTOMER}.evil.com`)).toBe(false);
    expect(isCustomerHost("homeinsulationvictoria.com.au")).toBe(false);
    expect(isCustomerHost("www.homeinsulationvictoria.com.au")).toBe(false);
    expect(isCustomerHost("hi-vic-operations.lovable.app")).toBe(false);
    expect(isCustomerHost("localhost")).toBe(false);
    expect(isCustomerHost(null)).toBe(false);
  });
});

describe("customerEntryPoint", () => {
  it("sends the bare customer address to the calculator", () => {
    expect(customerEntryPoint(CUSTOMER, "/")).toBe(CUSTOMER_ENTRY_PATH);
    expect(customerEntryPoint(`${CUSTOMER}:443`, "/")).toBe(CUSTOMER_ENTRY_PATH);
    expect(customerEntryPoint(CUSTOMER.toUpperCase(), "/")).toBe(CUSTOMER_ENTRY_PATH);
    expect(customerEntryPoint(CUSTOMER, "")).toBe(CUSTOMER_ENTRY_PATH);
  });

  it("leaves every other path on the customer address alone", () => {
    for (const path of [
      "/calculator",
      "/free-estimate",
      "/home",
      "/auth",
      "/admin/jobs/job-1",
      "/installer-onboarding",
      "/electrician-onboarding",
      "/w/abc123",
      "/api/public/address-search",
    ]) {
      expect(customerEntryPoint(CUSTOMER, path)).toBeUndefined();
    }
  });

  it("never redirects a non-customer address", () => {
    expect(customerEntryPoint("hi-vic-operations.lovable.app", "/")).toBeUndefined();
    expect(customerEntryPoint("localhost", "/")).toBeUndefined();
    expect(customerEntryPoint(undefined, "/")).toBeUndefined();
    expect(customerEntryPoint("", "/")).toBeUndefined();
  });

  it("keeps the entry path as the live calculator", () => {
    expect(CUSTOMER_ENTRY_PATH).toBe("/calculator");
  });
});
