import { describe, expect, it } from "bun:test";
import { mittiReadyCheckStage } from "@/lib/mitti-pickup.core";
import { planStep } from "@/lib/autoadvance.core";

describe("Installer-led Mitti jobs wait on the installer (Jo 23 Oct)", () => {
  it("early stages move to ready_check_scheduled, never 'No reply'", () => {
    expect(mittiReadyCheckStage({ stage: "preliminary_estimate_ready", channel: "installer_sourced" })).toBe("ready_check_scheduled");
    expect(mittiReadyCheckStage({ stage: "new_enquiry", channel: "installer_sourced" })).toBe("ready_check_scheduled");
  });
  it("HIV leads and later stages are untouched", () => {
    expect(mittiReadyCheckStage({ stage: "preliminary_estimate_ready", channel: "hivic_sourced" })).toBeNull();
    expect(mittiReadyCheckStage({ stage: "ready_check_complete", channel: "installer_sourced" })).toBeNull();
    expect(mittiReadyCheckStage({ stage: "ready_check_scheduled", channel: "installer_sourced" })).toBeNull();
  });
  it("auto-advance never moves a ready_check_scheduled job", () => {
    expect(planStep("ready_check_scheduled" as never, {} as never).kind).toBe("stop");
  });
});
