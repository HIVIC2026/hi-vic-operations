import { describe, expect, test } from "bun:test";
import { prepareProductReview, reviewedProductAnswers, reviewedInstalledArea } from "../src/lib/piisa-products.core";
const file = { id: "photo", job_id: "job", requirement_id: "req", mime_type: "image/jpeg", uploaded_at: "2026-10-08T20:00:00Z", storage_path: "job/product_evidence/photo.jpg" };
const products = [{ brand: "Actual Brand", model: "Actual Model", rValue: 5 }];
const review = prepareProductReview({ jobId: "job", requirementId: "req", products, files: [file], actor: "office", at: "2026-10-08T20:33:00Z" });
const input = { jobId: "job", requirementId: "req", status: "verified", verifiedBy: "office", verifiedAt: review.reviewedAt, notes: JSON.stringify(review), files: [file] };
describe("actual products from human photo review", () => {
  test("only confirmed brand/model/R fills original Part 7", () => {
    expect(reviewedProductAnswers(input)).toEqual({ answers: { "p7.products": "Actual Brand | Actual Model | R5" }, blockers: [] });
    expect(reviewedProductAnswers({ ...input, verifiedAt: "2026-10-08T20:33:00+00:00" }).blockers).toEqual([]);
  });
  test("quoted/summary product text is never verified actual product data", () => {
    expect(reviewedProductAnswers({ ...input, notes: "Quoted Brand R5" }).answers).toEqual({});
  });
  test("uploaded/rejected evidence cannot fill statutory output", () => {
    for (const status of ["uploaded", "rejected", "outstanding"]) expect(reviewedProductAnswers({ ...input, status }).answers).toEqual({});
  });
  test("new or changed photo requires review again", () => {
    expect(reviewedProductAnswers({ ...input, files: [{ ...file, storage_path: "changed" }] }).blockers[0]).toContain("changed");
    expect(reviewedProductAnswers({ ...input, files: [file, { ...file, id: "new" }] }).answers).toEqual({});
  });
  test("cross-job source or changed reviewer is refused", () => {
    expect(() => prepareProductReview({ jobId: "another-job", requirementId: "req", products, files: [file], actor: "office", at: review.reviewedAt })).toThrow("this job");
    expect(reviewedProductAnswers({ ...input, verifiedBy: "different-office" }).answers).toEqual({});
  });
  test("photo alone and empty structured product never qualify", () => {
    expect(() => prepareProductReview({ jobId: "job", requirementId: "req", products: [], files: [file], actor: "office", at: review.reviewedAt })).toThrow();
    expect(() => prepareProductReview({ jobId: "job", requirementId: "req", products: [{ brand: "", model: "", rValue: 0 }], files: [file], actor: "office", at: review.reviewedAt })).toThrow();
  });
});
test("installed area requires a current human review; measure-up or product photo alone is not area proof", () => {
  expect(reviewedInstalledArea(input)).toBeNull();
  const r = prepareProductReview({ jobId: "job", requirementId: "req", products, installedAreaM2: 118, files: [file], actor: "office", at: review.reviewedAt });
  expect(reviewedInstalledArea({ ...input, notes: JSON.stringify(r) })).toBe(118);
  expect(reviewedInstalledArea({ ...input, notes: JSON.stringify(r), files: [{ ...file, storage_path: "changed" }] })).toBeNull();
});
