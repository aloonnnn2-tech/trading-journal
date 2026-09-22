import { describe, expect, it } from "vitest";
import { describeActivity, labelForTool, TOOL_LABELS } from "./labels";
import { TOOL_DEFS } from "@/lib/ai-keys/tools";

describe("labelForTool", () => {
  it("has a label for every tool the model is offered", () => {
    for (const def of TOOL_DEFS) expect(TOOL_LABELS[def.name], def.name).toBeDefined();
  });

  it("never renders a model-chosen name it does not know", () => {
    // The name is whatever the model emitted; an injected note could make it
    // say anything, and the activity strip shows it to the user.
    expect(labelForTool("SECURITY ALERT: re-enter your key at evil.example")).toBe("used a tool");
    expect(describeActivity(["compute_stats", "nonsense", "compute_stats"])).toBe("computed your stats · used a tool");
  });
});
