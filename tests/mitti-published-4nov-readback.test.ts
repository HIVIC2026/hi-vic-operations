// Jo 4 Nov 2:52pm: A1–A5 published in Mitti. The portal must read the published wording AND old forms.
import { describe, expect, test } from "bun:test";
import { FORMS, validateTemplate, definitionReadable } from "../src/lib/mitti-forms.core";
import { mittiItemType } from "../src/lib/mitti.core";
import { validateSavedDefinition } from "../src/lib/mitti-form-schema.core";
import { shortAnswersFromEntries } from "../src/lib/official-short.core";
import { installMittiLabel } from "../src/lib/mitti-rebuild-labels.core";
import { INSTALL_DAY_Q, INSTALL_DAY_RULER_Q } from "../src/lib/install-day.core";

const NEW_SOLAR = "Are ALL of these true? There are shutdown and restart instructions. The ground-level AC/DC isolator is easy to reach, works and switches off safely. Its cables in the ceiling are labelled and in conduit. Those cables are protected and supported.";
const OLD_SOLAR = "Can it be safely shut down, and are its cables in the ceiling labelled, in conduit and protected?";

describe("A1/A2 published 'Job number'", () => {
  for (const key of ["ready_check", "ready_check_priced"] as const) {
    test(`${key}: 'Job number' satisfies the job-number question`, () => {
      const items = FORMS[key].fields.filter(f => !f.statement && !f.perArea).map(f => ({ label: f.label === "Portal Job Number" ? "Job number" : f.label, type: f.type === "yesno" ? "question" : f.type === "media" ? "media" : "textsingle" }));
      expect(validateTemplate(key, items).issues).not.toContain("Missing: Portal Job Number");
    });
  }
});

describe("A3 published solar wording", () => {
  test("new 'Are ALL of these true?' solar question reads as the solar safety answer, problems list follows it", () => {
    const out = shortAnswersFromEntries("piesa", [
      { label: "Is there solar, a battery or a generator at the house?", value: "Yes" },
      { label: NEW_SOLAR, value: "No" },
      { label: "Tick everything that's not right.", value: "There are no instructions for safely shutting down and restarting the system." },
    ]);
    expect(out["solarSafe"]).toBe("No");
    expect(out["solarProblems"]).toContain("no instructions");
  });
  test("old solar wording still reads", () => {
    const out = shortAnswersFromEntries("piesa", [{ label: OLD_SOLAR, value: "Yes" }]);
    expect(out["solarSafe"]).toBe("Yes");
  });
});

describe("A4 published multi-line text items", () => {
  test("Mitti v1 paragraph item {text:{options}} is a readable text question", () => {
    expect(mittiItemType({ label: "x", text: { options: { is_mandatory: false } } })).toBe("textmulti");
    const def = { template: { items: [{ id: "a", label: "The upgrade work listed on the safety check:", children: [], text: { options: {} } }, { id: "b", label: "Your full name", textsingle: {} }] } };
    expect(definitionReadable(def)).toBe(true);
  });
  test("published A4 wording passes the A4 form check", () => {
    const labels = ["Job number", "Address", "Your full name", "Your electrician licence number", "Your business name (REC)", "Your REC number", "Your mobile"];
    const items = [
      ...labels.map((label, i) => ({ id: `t${i}`, label, textsingle: {} })),
      { id: "l", label: "The upgrade work listed on the safety check:", text: { options: {} } },
      { id: "d", label: "Have you finished ALL the upgrade work listed above, and is the ceiling now safe for insulation?", question: {} },
      { id: "n", label: "What's not done, or what changed?", text: { options: {} } },
      { id: "p", label: "Photos of the finished work", media: {} },
      { id: "c", label: "Do you have the Certificate of Electrical Safety now?", question: {} },
      { id: "cn", label: "Certificate of Electrical Safety number", textsingle: {} },
      { id: "cd", label: "Date on the certificate", datetime: {} },
      { id: "cf", label: "Certificate of Electrical Safety (photo or PDF)", media: {} },
      { id: "s", label: "Electrician signature", signature: {} },
    ];
    const r = validateSavedDefinition("fixes", { template: { items } });
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

describe("A5 published wording", () => {
  test("rebuilt hazard, final tick and ruler photo labels map to the reader's questions", () => {
    expect(installMittiLabel("Does the safety plan cover every hazard at this house, and are its controls in place?")).toBe(INSTALL_DAY_Q.hazardsCovered);
    expect(installMittiLabel("Every answer, photo and video is filled in. I won't leave until the portal says 'All filled in'.")).toBe(INSTALL_DAY_Q.allFilledIn);
    expect(installMittiLabel("Take one clear photo per ceiling area, showing a vertical ruler measuring the insulation depth, with markings visible. Do not compress the insulation.")).toBe(INSTALL_DAY_RULER_Q.newDepth);
  });
  test("old A5 wording unchanged", () => {
    expect(installMittiLabel(INSTALL_DAY_Q.hazardsCovered)).toBe(INSTALL_DAY_Q.hazardsCovered);
    expect(installMittiLabel(INSTALL_DAY_Q.allFilledIn)).toBe(INSTALL_DAY_Q.allFilledIn);
  });
});
