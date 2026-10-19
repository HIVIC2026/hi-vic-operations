// P1-R2-S33 (R2): RegisterInterest validation feedback — D21-2 fix coverage.
//
// The component itself runs; only the server call is replaced, so no Supabase, no network and
// no production service is touched. happy-dom stands in for the browser so the real focus() /
// aria association behaviour can be asserted rather than guessed.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

type Payload = Record<string, unknown>;
type Call = { data: Payload };

const calls: Call[] = [];
let nextResult: Payload | null = null;
let nextThrow: string | null = null;
let gate: Promise<void> | null = null;

mock.module("@tanstack/react-start", () => ({
  // On the server-bound hook is the real one; here it just hands the function straight back.
  useServerFn: (fn: unknown) => fn,
}));
mock.module("@/lib/interest.functions", () => ({
  registerInterest: async (args: Call) => {
    calls.push(args);
    if (gate) await gate;
    if (nextThrow) throw new Error(nextThrow);
    return nextResult;
  },
}));

const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { RegisterInterest } = await import("../src/components/portal/register-interest");

afterEach(() => cleanup());
beforeEach(() => {
  calls.length = 0;
  nextResult = { ok: true, duplicate: false };
  nextThrow = null;
  gate = null;
});

const VALID = {
  address: "34 Watsons Road, Bundoora VIC 3757",
  suburb: "Bundoora",
  postcode: "3757",
  ceilingM2: 150,
  insulation: "unknown" as const,
};

const mount = (over: Partial<typeof VALID> = {}) => render(<RegisterInterest {...VALID} {...over} />);

const field = (label: "Full name" | "Mobile" | "Email") => screen.getByLabelText(label) as HTMLInputElement;
const consent = () => screen.getByRole("checkbox") as HTMLInputElement;
const submit = () => screen.getByRole("button", { name: /register my interest/i });

const fill = (which: "Full name" | "Mobile" | "Email", value: string) =>
  fireEvent.change(field(which), { target: { value } });
const tick = (value = true) => {
  const box = consent();
  if (box.checked !== value) fireEvent.click(box);
};

async function press() {
  await act(async () => {
    fireEvent.click(submit());
  });
}

/**
 * A malformed email never reaches our handler when the button is clicked: the input is
 * type="email", so the browser's own validity check holds the submit first (pre-existing
 * product behaviour — this patch neither adds nor removes it). The form event is used for
 * those cases so our own message is still covered.
 */
async function pressBypassingNative() {
  await act(async () => {
    fireEvent.submit(document.querySelector("form")!);
  });
}

const validForm = () => {
  fill("Full name", "Jane Doe");
  fill("Mobile", "0400 123 456");
  fill("Email", "jane@example.com");
  tick();
};

const textOf = (id: string) => document.getElementById(id)?.textContent?.trim() ?? null;

describe("T01 empty form", () => {
  test("blocks the submit, marks every missing answer and names none of them twice", async () => {
    mount();
    await press();
    expect(calls.length).toBe(0);
    expect(screen.getByText("Please enter your name so we know who to ask for.")).toBeTruthy();
    expect(screen.getByText("Please enter a valid email address.")).toBeTruthy();
    expect(screen.getByText("Please enter a valid mobile number.")).toBeTruthy();
    expect(screen.getByText("Please tick the box so we can contact you.")).toBeTruthy();
    // Still on the form — nothing confirmed.
    expect(screen.queryByTestId("register-interest-done")).toBeNull();
  });
});

describe("T02 missing full name", () => {
  test("only the name box is marked when everything else is fine", async () => {
    mount();
    fill("Mobile", "0400 123 456");
    fill("Email", "jane@example.com");
    tick();
    await press();
    expect(calls.length).toBe(0);
    expect(textOf("ri-name-error")).toBe("Please enter your name so we know who to ask for.");
    expect(field("Mobile").getAttribute("aria-invalid")).toBe("false");
    expect(field("Email").getAttribute("aria-invalid")).toBe("false");
    expect(consent().getAttribute("aria-invalid")).toBe("false");
  });

  test("a single character is still not a name", async () => {
    mount();
    fill("Full name", "J");
    fill("Mobile", "0400 123 456");
    fill("Email", "jane@example.com");
    tick();
    await press();
    expect(calls.length).toBe(0);
    expect(textOf("ri-name-error")).toBeTruthy();
  });
});

describe("T03 invalid email", () => {
  test("a malformed address is held by the browser before our own check runs", async () => {
    mount();
    fill("Full name", "Jane Doe");
    fill("Mobile", "0400 123 456");
    fill("Email", "jane-at-example");
    tick();
    await press();
    expect(calls.length).toBe(0);
    expect(document.activeElement).not.toBe(field("Email"));
  });

  test("our own email message still shows when the answer is checked by the form", async () => {
    mount();
    fill("Full name", "Jane Doe");
    fill("Mobile", "0400 123 456");
    fill("Email", "jane-at-example");
    tick();
    await pressBypassingNative();
    expect(calls.length).toBe(0);
    expect(textOf("ri-email-error")).toBe("Please enter a valid email address.");
    expect(field("Full name").getAttribute("aria-invalid")).toBe("false");
    expect(document.activeElement).toBe(field("Email"));
  });
});

describe("T04 invalid mobile", () => {
  test("a short number is refused and marked on its own box", async () => {
    mount();
    fill("Full name", "Jane Doe");
    fill("Mobile", "0400");
    fill("Email", "jane@example.com");
    tick();
    await press();
    expect(calls.length).toBe(0);
    expect(textOf("ri-mobile-error")).toBe("Please enter a valid mobile number.");
  });
});

describe("T05 missing consent", () => {
  test("an otherwise complete form is held back by the consent box", async () => {
    mount();
    fill("Full name", "Jane Doe");
    fill("Mobile", "0400 123 456");
    fill("Email", "jane@example.com");
    await press();
    expect(calls.length).toBe(0);
    expect(textOf("ri-consent-error")).toBe("Please tick the box so we can contact you.");
    expect(field("Full name").getAttribute("aria-invalid")).toBe("false");
  });
});

describe("T06 address", () => {
  test("an address without a postcode opens the editor and marks it", async () => {
    mount({ address: "34 Watsons Road, Bundoora", suburb: "Bundoora", postcode: "" });
    validForm();
    await press();
    expect(calls.length).toBe(0);
    expect(textOf("register-address-error")).toBe(
      "Please include your postcode in the address, for example 34 Watsons Road, Bundoora VIC 3757.",
    );
    expect(document.getElementById("register-address")?.getAttribute("aria-invalid")).toBe("true");
  });

  test("the address is optional when nothing has been typed", async () => {
    mount({ address: "", suburb: "", postcode: "" });
    validForm();
    await press();
    expect(calls.length).toBe(1);
    expect(calls[0]?.data.addressLine).toBe("");
  });
});

describe("T07 partially completed form", () => {
  test("two problems are shown together and focus lands on the first one on screen", async () => {
    mount();
    fill("Full name", "Jane Doe");
    fill("Email", "jane@example.com");
    await press();
    expect(calls.length).toBe(0);
    expect(textOf("ri-mobile-error")).toBeTruthy();
    expect(textOf("ri-consent-error")).toBeTruthy();
    expect(textOf("ri-name-error")).toBeNull();
    expect(document.activeElement).toBe(field("Mobile"));
  });
});

describe("T08 valid submission", () => {
  test("a complete form is accepted", async () => {
    mount();
    validForm();
    await press();
    expect(calls.length).toBe(1);
    expect(nextResult).not.toBeNull();
  });
});

describe("T09 server payload", () => {
  test("exactly the promised draft is sent — nothing added, nothing renamed", async () => {
    mount();
    validForm();
    await press();
    expect(calls.length).toBe(1);
    expect(calls[0]?.data).toEqual({
      fullName: "Jane Doe",
      mobile: "0400 123 456",
      email: "jane@example.com",
      addressLine: "34 Watsons Road, Bundoora VIC 3757",
      suburb: "Bundoora",
      postcode: "3757",
      ceilingM2: 150,
      insulationDeclared: "unknown",
      consent: true,
      honeypot: "",
    });
  });

  test("the suburb falls back to the typed line, as before", async () => {
    mount({ suburb: "" });
    validForm();
    await press();
    expect(calls[0]?.data.suburb).toBeTruthy();
    expect(calls[0]?.data.postcode).toBe("3757");
  });
});

describe("T10 no record is created by an invalid submit", () => {
  test("empty, short, wrong and unticked forms all make zero server calls", async () => {
    mount();
    await press(); // empty
    fill("Full name", "Jane Doe");
    await press(); // no mobile/email/consent
    fill("Mobile", "0400 123 456");
    fill("Email", "jane@example.com");
    await press(); // no consent
    fill("Email", "broken");
    tick();
    await press(); // bad email
    expect(calls.length).toBe(0);
  });
});

describe("T11 error association", () => {
  test("every message is wired to its own input through aria-describedby", async () => {
    mount();
    await press();
    for (const [inputId, message] of [
      ["ri-name", "Please enter your name so we know who to ask for."],
      ["ri-mobile", "Please enter a valid mobile number."],
      ["ri-email", "Please enter a valid email address."],
      ["ri-consent", "Please tick the box so we can contact you."],
    ] as const) {
      const el = document.getElementById(inputId)!;
      const describedBy = el.getAttribute("aria-describedby");
      expect(describedBy).toBe(`${inputId}-error`);
      expect(describedBy).not.toBeNull();
      expect(textOf(describedBy!)).toBe(message);
      expect(el.getAttribute("aria-invalid")).toBe("true");
      expect(el.getAttribute("aria-required")).toBe("true");
    }
  });

  test("a clean form carries no error ids", () => {
    mount();
    for (const id of ["ri-name", "ri-mobile", "ri-email", "ri-consent"]) {
      expect(document.getElementById(id)!.getAttribute("aria-describedby")).toBeNull();
      expect(document.getElementById(id)!.getAttribute("aria-invalid")).toBe("false");
    }
  });
});

describe("T12 focus moves to the first invalid control", () => {
  test("empty form focuses the name", async () => {
    mount();
    await press();
    expect(document.activeElement).toBe(field("Full name"));
  });

  test("when only consent is missing, focus goes to the tick box", async () => {
    mount();
    fill("Full name", "Jane Doe");
    fill("Mobile", "0400 123 456");
    fill("Email", "jane@example.com");
    await press();
    expect(document.activeElement).toBe(consent());
  });

  test("when only the email is wrong, focus goes to the email", async () => {
    mount();
    fill("Full name", "Jane Doe");
    fill("Mobile", "0400 123 456");
    fill("Email", "nope");
    tick();
    await pressBypassingNative();
    expect(document.activeElement).toBe(field("Email"));
  });

  test("the address problem pulls focus to the address box it just opened", async () => {
    mount({ address: "34 Watsons Road, Bundoora", suburb: "Bundoora", postcode: "" });
    validForm();
    await press();
    expect(document.activeElement?.id).toBe("register-address");
  });
});

describe("T13 errors clear as the person fixes them", () => {
  test("typing a valid answer clears that field's message but not the others", async () => {
    mount();
    await press();
    expect(textOf("ri-name-error")).toBeTruthy();
    expect(textOf("ri-mobile-error")).toBeTruthy();
    fill("Full name", "Jane Doe");
    expect(textOf("ri-name-error")).toBeNull();
    expect(field("Full name").getAttribute("aria-invalid")).toBe("false");
    expect(textOf("ri-mobile-error")).toBeTruthy();
  });

  test("ticking consent clears the consent message", async () => {
    mount();
    fill("Full name", "Jane Doe");
    fill("Mobile", "0400 123 456");
    fill("Email", "jane@example.com");
    await press();
    expect(textOf("ri-consent-error")).toBeTruthy();
    tick();
    expect(textOf("ri-consent-error")).toBeNull();
  });

  test("a corrected form then submits and sends one call", async () => {
    mount();
    await press();
    expect(calls.length).toBe(0);
    validForm();
    await press();
    expect(calls.length).toBe(1);
  });

  test("a second failed submit re-reports what is still wrong", async () => {
    mount();
    fill("Full name", "Jane Doe");
    await press();
    expect(textOf("ri-mobile-error")).toBeTruthy();
    fill("Mobile", "0400 123 456");
    await press();
    expect(textOf("ri-mobile-error")).toBeNull();
    expect(textOf("ri-email-error")).toBeTruthy();
    expect(calls.length).toBe(0);
  });
});

describe("T14 busy state", () => {
  test("the button is disabled and the form cannot be sent twice while saving", async () => {
    let release = () => {};
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = gate;
    mount();
    validForm();
    // The click is dispatched synchronously; the save parks on the gate until we release it.
    act(() => {
      fireEvent.click(submit());
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(submit().hasAttribute("disabled")).toBe(true);
    await press(); // second press while busy — the disabled button takes no second order
    expect(calls.length).toBe(1);
    await act(async () => {
      release();
      await held;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(calls.length).toBe(1);
    expect(screen.getByTestId("register-interest-done")).toBeTruthy();
  });
});

describe("T15 confirmation", () => {
  test("success greets the person by first name and says nothing is booked", async () => {
    mount();
    validForm();
    await press();
    const panel = screen.getByTestId("register-interest-done");
    expect(panel.textContent).toContain("Thanks Jane");
    expect(panel.textContent).toContain("Nothing has been booked and no payment is due.");
    // The form is replaced — no leftover boxes.
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  test("a duplicate success confirms without mentioning duplication to the person", async () => {
    nextResult = { ok: true, duplicate: true };
    mount();
    validForm();
    await press();
    expect(screen.getByTestId("register-interest-done").textContent).toContain("Thanks Jane");
  });
});

describe("T16 server-side refusals", () => {
  test("a server field error sits on that field and nothing else changes", async () => {
    nextResult = { ok: false, errors: { email: "We could not read that email address." } };
    mount();
    validForm();
    await press();
    expect(calls.length).toBe(1);
    expect(textOf("ri-email-error")).toBe("We could not read that email address.");
    expect(field("Email").getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(field("Email"));
    expect(screen.queryByTestId("register-interest-done")).toBeNull();
  });

  test("a submission-level refusal stays a whole-form message", async () => {
    nextResult = { ok: false, errors: { submit: "We could not save your details just now. Please try again." } };
    mount();
    validForm();
    await press();
    expect(screen.getByText("We could not save your details just now. Please try again.")).toBeTruthy();
    expect(textOf("ri-name-error")).toBeNull();
  });

  test("a thrown error is shown, never swallowed", async () => {
    nextThrow = "network down";
    mount();
    validForm();
    await press();
    expect(screen.getByText("network down")).toBeTruthy();
    expect(screen.queryByTestId("register-interest-done")).toBeNull();
    expect(submit().hasAttribute("disabled")).toBe(false);
  });

  test("a honeypot refusal is worded for people, not screened as a bot message", async () => {
    nextResult = { ok: false, errors: { honeypot: "SPAM_REFUSED" } };
    mount();
    validForm();
    await press();
    expect(screen.getByText(/please check the details and try again/i)).toBeTruthy();
    expect(screen.getByText(/message us through the contact page/i)).toBeTruthy();
    expect(screen.queryByText(/SPAM_REFUSED/)).toBeNull();
    expect(textOf("ri-email-error")).toBeNull();
  });
});
