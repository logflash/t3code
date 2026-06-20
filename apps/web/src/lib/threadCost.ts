import type { OrchestrationThreadActivity } from "@t3tools/contracts";

/**
 * Activity kind carrying a completed turn's API cost in USD, emitted server-side
 * from the provider `turn.completed` event (see ProviderRuntimeIngestion). Kept
 * in sync with the literal used there.
 */
export const TURN_API_COST_ACTIVITY_KIND = "turn.api-cost";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/**
 * Sum the per-turn API cost (USD) recorded for a thread. Each completed turn that
 * reports a dollar cost contributes one activity; summing them yields the thread
 * total. Only some providers (Claude) report a cost today — threads on providers
 * that don't return 0.
 */
export function sumThreadApiCostUsd(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): number {
  let total = 0;
  for (const activity of activities) {
    if (activity.kind !== TURN_API_COST_ACTIVITY_KIND) {
      continue;
    }
    const cost = asRecord(activity.payload)?.totalCostUsd;
    if (typeof cost === "number" && Number.isFinite(cost) && cost > 0) {
      total += cost;
    }
  }
  return total;
}
