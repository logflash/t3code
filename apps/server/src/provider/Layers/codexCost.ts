import type { ProviderRuntimeEvent, ThreadTokenUsageSnapshot } from "@t3tools/contracts";

/**
 * ESTIMATED OpenAI API pricing for Codex models, in USD per 1,000,000 tokens.
 *
 * Codex (unlike Claude) does not report a dollar cost — only token counts — so
 * we estimate cost = tokens × these rates. This table is the single place to
 * maintain. Rates below are USD per 1M tokens, verified against OpenAI's API
 * pricing pages in June 2026 — ⚠️ re-verify and update when prices change or new
 * models are used. Models absent here yield no estimate (the UI shows nothing
 * rather than a wrong number). Keys are lowercased model ids; lookup normalizes
 * case.
 *
 * Note: under a ChatGPT subscription (not a metered API key) there is no
 * per-token billing, so this figure represents API-equivalent value, not spend
 * — surfaced in the UI as an estimate.
 */
interface ModelRate {
  readonly inputPerMTok: number;
  readonly cachedInputPerMTok: number;
  readonly outputPerMTok: number;
}

const CODEX_MODEL_PRICING: Record<string, ModelRate> = {
  "gpt-5.5": { inputPerMTok: 5.0, cachedInputPerMTok: 0.5, outputPerMTok: 30.0 },
  "gpt-5.4": { inputPerMTok: 2.5, cachedInputPerMTok: 0.25, outputPerMTok: 15.0 },
  "gpt-5.4-mini": { inputPerMTok: 0.75, cachedInputPerMTok: 0.075, outputPerMTok: 4.5 },
  "gpt-5.3-codex": { inputPerMTok: 1.75, cachedInputPerMTok: 0.175, outputPerMTok: 14.0 },
  "gpt-5.2": { inputPerMTok: 1.75, cachedInputPerMTok: 0.175, outputPerMTok: 14.0 },
};

export interface CodexTurnTokens {
  readonly inputTokens?: number | undefined;
  readonly cachedInputTokens?: number | undefined;
  readonly outputTokens?: number | undefined;
}

/**
 * Estimate the USD cost of a single Codex turn from its token breakdown and the
 * model that ran it. `outputTokens` is assumed to already include reasoning
 * tokens (OpenAI bills reasoning as output). Returns null when the model is
 * unknown/unpriced or the cost rounds to nothing.
 */
export function estimateCodexTurnCostUsd(
  model: string | undefined,
  tokens: CodexTurnTokens,
): number | null {
  if (!model) {
    return null;
  }
  const rate = CODEX_MODEL_PRICING[model.trim().toLowerCase()];
  if (!rate) {
    return null;
  }
  const input = Math.max(0, tokens.inputTokens ?? 0);
  const cached = Math.min(input, Math.max(0, tokens.cachedInputTokens ?? 0));
  const nonCached = Math.max(0, input - cached);
  const output = Math.max(0, tokens.outputTokens ?? 0);
  const cost =
    (nonCached * rate.inputPerMTok +
      cached * rate.cachedInputPerMTok +
      output * rate.outputPerMTok) /
    1_000_000;
  return cost > 0 ? cost : null;
}

/**
 * Per-session mutable state used to attribute Codex token usage to the model
 * that produced it. Codex delivers the turn's model (at turn start / on reroute)
 * and its token usage on separate events, so we hold both here and combine them
 * when the turn completes.
 */
export interface CodexCostState {
  /** Model id of the in-flight turn (from sendTurn, updated by `model.rerouted`). */
  currentModel: string | undefined;
  /** Latest per-turn token breakdown seen from `thread.token-usage.updated`. */
  latestTurnTokens: CodexTurnTokens | undefined;
}

export function makeCodexCostState(): CodexCostState {
  return { currentModel: undefined, latestTurnTokens: undefined };
}

function turnTokensFromUsage(usage: ThreadTokenUsageSnapshot): CodexTurnTokens {
  return {
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    outputTokens: usage.outputTokens,
  };
}

/**
 * Thread per-turn cost estimation into the Codex runtime-event stream: track the
 * model and token usage, and stamp `totalCostUsd` onto each `turn.completed`
 * event. Mutates `state`. Pricing each turn by its own model means the client's
 * per-turn sum stays correct across mid-thread model changes.
 */
export function applyCodexTurnCost(
  events: ReadonlyArray<ProviderRuntimeEvent>,
  state: CodexCostState,
): ReadonlyArray<ProviderRuntimeEvent> {
  return events.map((event) => {
    switch (event.type) {
      case "thread.token-usage.updated": {
        if (event.payload.usage) {
          state.latestTurnTokens = turnTokensFromUsage(event.payload.usage);
        }
        return event;
      }
      case "model.rerouted": {
        const toModel = event.payload.toModel?.trim();
        if (toModel) {
          state.currentModel = toModel;
        }
        return event;
      }
      case "turn.completed": {
        const estimate = estimateCodexTurnCostUsd(state.currentModel, state.latestTurnTokens ?? {});
        // The turn is over; clear so the next turn can't reuse stale tokens.
        state.latestTurnTokens = undefined;
        if (estimate === null || event.payload.totalCostUsd !== undefined) {
          return event;
        }
        return { ...event, payload: { ...event.payload, totalCostUsd: estimate } };
      }
      default:
        return event;
    }
  });
}
