import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RegisterInterest } from "../src/components/portal/register-interest";
test("public calculator no longer promises a spot-release queue", () => {
  const html = renderToStaticMarkup(<RegisterInterest address="" suburb="" postcode="" ceilingM2={150} insulation="none" />);
  expect(html).not.toContain("Spots are released in the order they were saved");
  expect(html).not.toContain("when your spot is released");
  expect(html).toContain("Register my interest");
});