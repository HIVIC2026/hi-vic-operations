// A server function's input check fails with the raw validation issues as its message (a JSON array). Pages that show
// an error must never show that to a person: they show the page's own plain sentence instead.
import { describe, expect, test } from "bun:test";
import { readableError } from "../src/lib/readable-error.core";

// Exactly what the live /sp/zz page showed on 26 Oct 2026 (zod's parse error message).
const zodMessage = `[\n  {\n    "code": "too_small",\n    "minimum": 20,\n    "type": "string",\n    "inclusive": true,\n    "exact": false,\n    "message": "String must contain at least 20 character(s)",\n    "path": [\n      "token"\n    ]\n  }\n]`;

describe("readableError", () => {
  test("raw validation issues become the page's plain sentence", () => {
    expect(zodMessage.trim().startsWith("[")).toBe(true);
    expect(readableError(new Error(zodMessage), "This link isn't valid.")).toBe("This link isn't valid.");
  });
  test("a plain server message is kept as written", () => {
    expect(readableError(new Error("This rate offer has already been answered."), "x")).toBe("This rate offer has already been answered.");
  });
  test("network and empty failures get the fallback", () => {
    expect(readableError(new Error(""), "Try again.")).toBe("Try again.");
    expect(readableError(null, "Try again.")).toBe("Try again.");
    expect(readableError("nope", "Try again.")).toBe("Try again.");
    expect(readableError(new TypeError("Failed to fetch"), "Try again.")).toBe("Try again.");
    expect(readableError(new TypeError("Load failed"), "Try again.")).toBe("Try again.");
  });
  test("other JSON or code-looking messages never reach the page", () => {
    expect(readableError(new Error('{"code":"PGRST116","message":"0 rows"}'), "Try again.")).toBe("Try again.");
    expect(readableError(new Error("[object Object]"), "Try again.")).toBe("Try again.");
  });
  test("the /notice/ link page's live errors (26 Oct 2026)", () => {
    // What a cut-off /notice/ link showed: zod's regex issue for a token with characters that don't belong.
    const regexIssue = `[\n  {\n    "validation": "regex",\n    "code": "invalid_string",\n    "message": "Invalid",\n    "path": [\n      "token"\n    ]\n  }\n]`;
    expect(readableError(new Error(regexIssue), "We couldn't open this notice.")).toBe("We couldn't open this notice.");
    // The server's own wording for a whole-but-unknown link stays as written.
    const plain = "This link isn't valid any more. Ask your business owner or the office to send a new one.";
    expect(readableError(new Error(plain), "x")).toBe(plain);
  });
});
