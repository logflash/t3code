import { describe, expect, it } from "vite-plus/test";
import { EventId, type OrchestrationThreadActivity, TurnId } from "@t3tools/contracts";

import { sumThreadApiCostUsd } from "./threadCost";

function makeActivity(id: string, kind: string, payload: unknown): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    tone: "info",
    kind,
    summary: kind,
    payload,
    turnId: TurnId.make("turn-1"),
    createdAt: "2026-03-23T00:00:00.000Z",
  };
}

describe("sumThreadApiCostUsd", () => {
  it("sums per-turn API cost across cost activities", () => {
    const total = sumThreadApiCostUsd([
      makeActivity("a1", "turn.api-cost", { totalCostUsd: 0.12 }),
      makeActivity("a2", "tool.completed", {}),
      makeActivity("a3", "turn.api-cost", { totalCostUsd: 0.3 }),
    ]);
    expect(total).toBeCloseTo(0.42, 10);
  });

  it("returns 0 when no cost activities are present", () => {
    expect(
      sumThreadApiCostUsd([
        makeActivity("a1", "context-window.updated", { usedTokens: 1000 }),
        makeActivity("a2", "tool.started", {}),
      ]),
    ).toBe(0);
  });

  it("ignores malformed, zero, and negative cost payloads", () => {
    const total = sumThreadApiCostUsd([
      makeActivity("a1", "turn.api-cost", { totalCostUsd: 0.5 }),
      makeActivity("a2", "turn.api-cost", { totalCostUsd: 0 }),
      makeActivity("a3", "turn.api-cost", { totalCostUsd: -1 }),
      makeActivity("a4", "turn.api-cost", { totalCostUsd: "1.00" }),
      makeActivity("a5", "turn.api-cost", null),
    ]);
    expect(total).toBeCloseTo(0.5, 10);
  });
});
