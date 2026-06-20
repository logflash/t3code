import { assert, describe, it } from "@effect/vitest";
import type { ProviderRuntimeEvent, ThreadTokenUsageSnapshot } from "@t3tools/contracts";

import { applyCodexTurnCost, estimateCodexTurnCostUsd, makeCodexCostState } from "./codexCost.ts";

describe("estimateCodexTurnCostUsd", () => {
  it("prices a known model from its token breakdown", () => {
    // gpt-5.4: 800 non-cached input @2.5 + 200 cached @0.25 + 500 output @15, per 1M.
    const cost = estimateCodexTurnCostUsd("gpt-5.4", {
      inputTokens: 1000,
      cachedInputTokens: 200,
      outputTokens: 500,
    });
    assert.isNotNull(cost);
    assert.closeTo(cost!, (800 * 2.5 + 200 * 0.25 + 500 * 15) / 1_000_000, 1e-12);
  });

  it("normalizes model id case", () => {
    assert.isNotNull(estimateCodexTurnCostUsd("GPT-5.4", { inputTokens: 1000 }));
  });

  it("returns null for unknown or missing models", () => {
    assert.isNull(estimateCodexTurnCostUsd("some-unknown-model", { inputTokens: 1000 }));
    assert.isNull(estimateCodexTurnCostUsd(undefined, { inputTokens: 1000 }));
  });

  it("returns null when there is no billable usage", () => {
    assert.isNull(estimateCodexTurnCostUsd("gpt-5.4", {}));
    assert.isNull(estimateCodexTurnCostUsd("gpt-5.4", { inputTokens: 0, outputTokens: 0 }));
  });

  it("clamps cached input to total input", () => {
    // cached (500) clamped to input (100) -> 0 non-cached, 100 cached @0.25.
    const cost = estimateCodexTurnCostUsd("gpt-5.4", {
      inputTokens: 100,
      cachedInputTokens: 500,
    });
    assert.closeTo(cost!, (100 * 0.25) / 1_000_000, 1e-12);
  });
});

function usageEvent(usage: Partial<ThreadTokenUsageSnapshot>): ProviderRuntimeEvent {
  return {
    type: "thread.token-usage.updated",
    payload: { usage: usage as ThreadTokenUsageSnapshot },
  } as unknown as ProviderRuntimeEvent;
}

function reroutedEvent(toModel: string): ProviderRuntimeEvent {
  return {
    type: "model.rerouted",
    payload: { fromModel: "gpt-5.4", toModel, reason: "load" },
  } as unknown as ProviderRuntimeEvent;
}

function turnCompletedEvent(): ProviderRuntimeEvent {
  return {
    type: "turn.completed",
    payload: { state: "completed" },
  } as unknown as ProviderRuntimeEvent;
}

function totalCostOf(event: ProviderRuntimeEvent): number | undefined {
  return event.type === "turn.completed" ? event.payload.totalCostUsd : undefined;
}

describe("applyCodexTurnCost", () => {
  it("stamps a per-turn cost onto turn.completed from tracked model + usage", () => {
    const state = makeCodexCostState();
    state.currentModel = "gpt-5.4";
    const out = applyCodexTurnCost(
      [usageEvent({ inputTokens: 1000, outputTokens: 500 }), turnCompletedEvent()],
      state,
    );
    const cost = totalCostOf(out[1]!);
    assert.isDefined(cost);
    assert.closeTo(cost!, (1000 * 2.5 + 500 * 15) / 1_000_000, 1e-12);
  });

  it("prices each turn by the model it ran under (handles model changes)", () => {
    const state = makeCodexCostState();
    state.currentModel = "gpt-5.4";

    const first = applyCodexTurnCost(
      [usageEvent({ inputTokens: 1000 }), turnCompletedEvent()],
      state,
    );
    const firstCost = totalCostOf(first[1]!);

    // Simulate switching to a cheaper model for the next turn.
    state.currentModel = "gpt-5.4-mini";
    state.latestTurnTokens = undefined;
    const second = applyCodexTurnCost(
      [usageEvent({ inputTokens: 1000 }), turnCompletedEvent()],
      state,
    );
    const secondCost = totalCostOf(second[1]!);

    assert.closeTo(firstCost!, (1000 * 2.5) / 1_000_000, 1e-12);
    assert.closeTo(secondCost!, (1000 * 0.75) / 1_000_000, 1e-12);
  });

  it("follows model.rerouted for the actual model used", () => {
    const state = makeCodexCostState();
    state.currentModel = "gpt-5.4";
    const out = applyCodexTurnCost(
      [reroutedEvent("gpt-5.4-mini"), usageEvent({ inputTokens: 1000 }), turnCompletedEvent()],
      state,
    );
    assert.closeTo(totalCostOf(out[2]!)!, (1000 * 0.75) / 1_000_000, 1e-12);
  });

  it("clears usage after a turn so the next turn isn't double-counted", () => {
    const state = makeCodexCostState();
    state.currentModel = "gpt-5.4";
    applyCodexTurnCost([usageEvent({ inputTokens: 1000 }), turnCompletedEvent()], state);
    // No new usage for the next turn -> no cost stamped.
    const out = applyCodexTurnCost([turnCompletedEvent()], state);
    assert.isUndefined(totalCostOf(out[0]!));
  });
});
