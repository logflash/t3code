import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { useMessageQueueStore } from "~/messageQueueStore";

interface QueueRunnerOptions {
  threadRef: ScopedThreadRef | null;
  /**
   * True only when it is safe to send the next staged message: the thread is
   * idle, there is no pending approval or user-input prompt, and the composer
   * is empty. The caller owns this computation.
   */
  ready: boolean;
  /** Sends the given text through the normal pipeline. Resolves true on success. */
  sendQueued: (text: string) => Promise<boolean>;
  /** Surfaced to the user when a send fails and the message is returned to Unstaged. */
  onAutoSendError?: (message: string) => void;
}

// No artificial wait — fire as soon as the thread is idle. The setTimeout still
// defers past the current commit so the readiness and double-fire guards apply.
const AUTO_SEND_DELAY_MS = 0;

const AUTO_SEND_FAILURE_MESSAGE = "Couldn't send the staged message — moved it back to Unstaged.";

/**
 * Watches the staged list and dispatches the top message whenever the thread
 * becomes idle. Staging is the trigger, so there's no run/pause — one message
 * is sent per idle window, and sending flips the thread back to busy, which
 * naturally gates the next item until it settles. A failed send is moved back
 * to Unstaged so it doesn't retry in a loop.
 */
export function useQueueRunner({
  threadRef,
  ready,
  sendQueued,
  onAutoSendError,
}: QueueRunnerOptions) {
  const threadKey = threadRef ? scopedThreadKey(threadRef) : null;
  const stagedLength = useMessageQueueStore((store) =>
    threadKey ? (store.byThreadKey[threadKey]?.staged.length ?? 0) : 0,
  );
  const paused = useMessageQueueStore((store) =>
    threadKey ? (store.byThreadKey[threadKey]?.paused ?? false) : false,
  );

  const threadRefRef = useRef(threadRef);
  threadRefRef.current = threadRef;
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const sendQueuedRef = useRef(sendQueued);
  sendQueuedRef.current = sendQueued;
  const onErrorRef = useRef(onAutoSendError);
  onErrorRef.current = onAutoSendError;
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!threadKey || !ready || paused || stagedLength === 0 || inFlightRef.current) return;
    const timer = window.setTimeout(() => {
      const ref = threadRefRef.current;
      if (!ref || !readyRef.current || inFlightRef.current) return;
      const store = useMessageQueueStore.getState();
      const latest = store.byThreadKey[scopedThreadKey(ref)];
      if (!latest || latest.paused || latest.staged.length === 0) return;
      const item = store.dequeueTop(ref);
      if (!item) return;
      // Set the guard synchronously (no await before this point) so a second
      // queued timer firing in the same tick sees the in-flight flag and bails.
      inFlightRef.current = true;
      void (async () => {
        try {
          const ok = await sendQueuedRef.current(item.text);
          if (!ok) {
            useMessageQueueStore.getState().unshift(ref, "unstaged", item);
            onErrorRef.current?.(AUTO_SEND_FAILURE_MESSAGE);
          }
        } catch {
          useMessageQueueStore.getState().unshift(ref, "unstaged", item);
          onErrorRef.current?.(AUTO_SEND_FAILURE_MESSAGE);
        } finally {
          inFlightRef.current = false;
        }
      })();
    }, AUTO_SEND_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [threadKey, ready, paused, stagedLength]);
}
