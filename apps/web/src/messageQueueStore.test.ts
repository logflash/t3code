import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { selectThreadMessageQueue, useMessageQueueStore } from "./messageQueueStore";

const THREAD_REF = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-1"));
const OTHER_REF = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-2"));

function queue() {
  return selectThreadMessageQueue(useMessageQueueStore.getState().byThreadKey, THREAD_REF);
}

describe("messageQueueStore", () => {
  beforeEach(() => useMessageQueueStore.setState({ byThreadKey: {} }));

  it("defaults to empty, unpaused staged and unstaged lists", () => {
    expect(queue()).toEqual({ staged: [], unstaged: [], paused: false });
  });

  it("toggles paused and prunes back to the default when empty", () => {
    const store = useMessageQueueStore.getState();
    store.togglePaused(THREAD_REF);
    expect(queue().paused).toBe(true);

    store.togglePaused(THREAD_REF);
    expect(useMessageQueueStore.getState().byThreadKey).toEqual({});
  });

  it("adds trimmed items and ignores blank input", () => {
    const store = useMessageQueueStore.getState();
    store.addItem(THREAD_REF, "staged", "  run the tests  ");
    store.addItem(THREAD_REF, "staged", "   ");
    const items = queue().staged;
    expect(items).toHaveLength(1);
    expect(items[0]!.text).toBe("run the tests");
  });

  it("dequeues from the top of staged and returns the removed item", () => {
    const store = useMessageQueueStore.getState();
    store.addItem(THREAD_REF, "staged", "first");
    store.addItem(THREAD_REF, "staged", "second");

    const top = useMessageQueueStore.getState().dequeueTop(THREAD_REF);
    expect(top?.text).toBe("first");
    expect(queue().staged.map((item) => item.text)).toEqual(["second"]);

    useMessageQueueStore.getState().dequeueTop(THREAD_REF);
    expect(useMessageQueueStore.getState().dequeueTop(THREAD_REF)).toBeNull();
  });

  it("recovers a failed send to the front of unstaged without duplicating", () => {
    const store = useMessageQueueStore.getState();
    store.addItem(THREAD_REF, "staged", "keep");
    const failed = useMessageQueueStore.getState().dequeueTop(THREAD_REF)!;
    useMessageQueueStore.getState().unshift(THREAD_REF, "unstaged", failed);
    useMessageQueueStore.getState().unshift(THREAD_REF, "unstaged", failed);

    expect(queue().unstaged.map((item) => item.id)).toEqual([failed.id]);
  });

  it("reorders within a list by item id", () => {
    const store = useMessageQueueStore.getState();
    store.addItem(THREAD_REF, "staged", "a");
    store.addItem(THREAD_REF, "staged", "b");
    store.addItem(THREAD_REF, "staged", "c");
    const first = queue().staged[0]!;
    const last = queue().staged[2]!;

    useMessageQueueStore.getState().reorderWithin(THREAD_REF, "staged", first.id, last.id);
    expect(queue().staged.map((item) => item.text)).toEqual(["b", "c", "a"]);
  });

  it("stages a draft, inserting before the target", () => {
    const store = useMessageQueueStore.getState();
    store.addItem(THREAD_REF, "unstaged", "idea");
    store.addItem(THREAD_REF, "staged", "existing");
    const draft = queue().unstaged[0]!;
    const existing = queue().staged[0]!;

    useMessageQueueStore
      .getState()
      .moveAcross(THREAD_REF, "unstaged", "staged", draft.id, existing.id);

    expect(queue().unstaged).toHaveLength(0);
    expect(queue().staged.map((item) => item.text)).toEqual(["idea", "existing"]);
  });

  it("prunes the thread entry once both lists are emptied", () => {
    const store = useMessageQueueStore.getState();
    store.addItem(THREAD_REF, "staged", "temp");
    const item = queue().staged[0]!;
    useMessageQueueStore.getState().removeItem(THREAD_REF, "staged", item.id);
    expect(useMessageQueueStore.getState().byThreadKey).toEqual({});
  });

  it("keeps thread queues isolated", () => {
    const store = useMessageQueueStore.getState();
    store.addItem(THREAD_REF, "staged", "mine");
    expect(
      selectThreadMessageQueue(useMessageQueueStore.getState().byThreadKey, OTHER_REF),
    ).toEqual({ staged: [], unstaged: [], paused: false });
  });
});
