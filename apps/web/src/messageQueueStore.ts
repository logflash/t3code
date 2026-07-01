/**
 * Thread-scoped, git-style message staging.
 *
 * Messages live in one of two lists: `unstaged` (drafts you haven't committed
 * to send) and `staged` (committed to send, in order). The runner dispatches
 * the top staged message whenever the thread goes idle — staging is the trigger,
 * so there's no separate run/pause. Both lists are per-thread and persisted to
 * localStorage, mirroring `rightPanelStore`.
 */
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

export type QueueListId = "staged" | "unstaged";

export interface QueueItem {
  id: string;
  text: string;
  createdAt: string;
}

export interface ThreadMessageQueueState {
  staged: QueueItem[];
  unstaged: QueueItem[];
  /** When true, staged messages are held and never auto-sent. Defaults to not paused. */
  paused: boolean;
}

interface MessageQueueStoreState {
  byThreadKey: Record<string, ThreadMessageQueueState>;
  addItem: (ref: ScopedThreadRef, list: QueueListId, text: string) => void;
  editItem: (ref: ScopedThreadRef, list: QueueListId, id: string, text: string) => void;
  removeItem: (ref: ScopedThreadRef, list: QueueListId, id: string) => void;
  reorderWithin: (
    ref: ScopedThreadRef,
    list: QueueListId,
    activeId: string,
    overId: string,
  ) => void;
  moveAcross: (
    ref: ScopedThreadRef,
    fromList: QueueListId,
    toList: QueueListId,
    activeId: string,
    overId: string | null,
  ) => void;
  /** Remove and return the top staged item (used by the auto-send runner). */
  dequeueTop: (ref: ScopedThreadRef) => QueueItem | null;
  /** Insert an item at the front of a list (used to recover a failed send). */
  unshift: (ref: ScopedThreadRef, list: QueueListId, item: QueueItem) => void;
  setPaused: (ref: ScopedThreadRef, paused: boolean) => void;
  togglePaused: (ref: ScopedThreadRef) => void;
  clearList: (ref: ScopedThreadRef, list: QueueListId) => void;
  removeThread: (ref: ScopedThreadRef) => void;
}

const MESSAGE_QUEUE_STORAGE_KEY = "t3code:message-queue:v1";
const MESSAGE_QUEUE_STORAGE_VERSION = 2;

const DEFAULT_STATE: ThreadMessageQueueState = { staged: [], unstaged: [], paused: false };

function newQueueItemId(): string {
  const cryptoRef = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoRef && typeof cryptoRef.randomUUID === "function") return cryptoRef.randomUUID();
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function makeItem(text: string): QueueItem {
  return { id: newQueueItemId(), text, createdAt: new Date().toISOString() };
}

function isDefaultState(state: ThreadMessageQueueState): boolean {
  return state.staged.length === 0 && state.unstaged.length === 0 && !state.paused;
}

function writeThread(
  byThreadKey: Record<string, ThreadMessageQueueState>,
  key: string,
  next: ThreadMessageQueueState,
): Record<string, ThreadMessageQueueState> {
  if (isDefaultState(next)) {
    if (!(key in byThreadKey)) return byThreadKey;
    const { [key]: _removed, ...rest } = byThreadKey;
    return rest;
  }
  return { ...byThreadKey, [key]: next };
}

function update(
  byThreadKey: Record<string, ThreadMessageQueueState>,
  ref: ScopedThreadRef,
  updater: (current: ThreadMessageQueueState) => ThreadMessageQueueState,
): Record<string, ThreadMessageQueueState> {
  const key = scopedThreadKey(ref);
  const current = byThreadKey[key] ?? DEFAULT_STATE;
  const next = updater(current);
  if (next === current) return byThreadKey;
  return writeThread(byThreadKey, key, next);
}

function moveInArray<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

// v1 stored `{ queue, notes, armed }`; v2 renames to `{ staged, unstaged }` and
// drops the global armed flag (staging is now the send trigger).
export function migratePersistedMessageQueue(persistedState: unknown): {
  byThreadKey: Record<string, ThreadMessageQueueState>;
} {
  if (!persistedState || typeof persistedState !== "object" || !("byThreadKey" in persistedState)) {
    return { byThreadKey: {} };
  }
  const raw = (persistedState as { byThreadKey?: unknown }).byThreadKey;
  if (!raw || typeof raw !== "object") return { byThreadKey: {} };
  const byThreadKey: Record<string, ThreadMessageQueueState> = {};
  for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    const staged = Array.isArray(candidate.staged)
      ? (candidate.staged as QueueItem[])
      : Array.isArray(candidate.queue)
        ? (candidate.queue as QueueItem[])
        : [];
    const unstaged = Array.isArray(candidate.unstaged)
      ? (candidate.unstaged as QueueItem[])
      : Array.isArray(candidate.notes)
        ? (candidate.notes as QueueItem[])
        : [];
    if (staged.length > 0 || unstaged.length > 0) {
      byThreadKey[key] = { staged, unstaged, paused: false };
    }
  }
  return { byThreadKey };
}

export const useMessageQueueStore = create<MessageQueueStoreState>()(
  persist(
    (set, get) => ({
      byThreadKey: {},
      addItem: (ref, list, text) => {
        const trimmed = text.trim();
        if (trimmed.length === 0) return;
        set((state) => ({
          byThreadKey: update(state.byThreadKey, ref, (current) => ({
            ...current,
            [list]: [...current[list], makeItem(trimmed)],
          })),
        }));
      },
      editItem: (ref, list, id, text) => {
        const trimmed = text.trim();
        set((state) => ({
          byThreadKey: update(state.byThreadKey, ref, (current) => {
            if (trimmed.length === 0) {
              return { ...current, [list]: current[list].filter((item) => item.id !== id) };
            }
            return {
              ...current,
              [list]: current[list].map((item) =>
                item.id === id ? { ...item, text: trimmed } : item,
              ),
            };
          }),
        }));
      },
      removeItem: (ref, list, id) =>
        set((state) => ({
          byThreadKey: update(state.byThreadKey, ref, (current) => ({
            ...current,
            [list]: current[list].filter((item) => item.id !== id),
          })),
        })),
      reorderWithin: (ref, list, activeId, overId) =>
        set((state) => ({
          byThreadKey: update(state.byThreadKey, ref, (current) => {
            const items = current[list];
            const from = items.findIndex((item) => item.id === activeId);
            const to = items.findIndex((item) => item.id === overId);
            const next = moveInArray(items, from, to);
            return next === items ? current : { ...current, [list]: next };
          }),
        })),
      moveAcross: (ref, fromList, toList, activeId, overId) =>
        set((state) => ({
          byThreadKey: update(state.byThreadKey, ref, (current) => {
            if (fromList === toList) return current;
            const source = current[fromList];
            const moved = source.find((item) => item.id === activeId);
            if (!moved) return current;
            const target = current[toList];
            const overIndex = overId ? target.findIndex((item) => item.id === overId) : -1;
            const insertAt = overIndex >= 0 ? overIndex : target.length;
            const nextTarget = target.slice();
            nextTarget.splice(insertAt, 0, moved);
            return {
              ...current,
              [fromList]: source.filter((item) => item.id !== activeId),
              [toList]: nextTarget,
            };
          }),
        })),
      dequeueTop: (ref) => {
        const key = scopedThreadKey(ref);
        const current = get().byThreadKey[key];
        const top = current?.staged[0];
        if (!current || !top) return null;
        set((state) => ({
          byThreadKey: update(state.byThreadKey, ref, (entry) => ({
            ...entry,
            staged: entry.staged.slice(1),
          })),
        }));
        return top;
      },
      unshift: (ref, list, item) =>
        set((state) => ({
          byThreadKey: update(state.byThreadKey, ref, (current) => ({
            ...current,
            [list]: [item, ...current[list].filter((entry) => entry.id !== item.id)],
          })),
        })),
      setPaused: (ref, paused) =>
        set((state) => ({
          byThreadKey: update(state.byThreadKey, ref, (current) =>
            current.paused === paused ? current : { ...current, paused },
          ),
        })),
      togglePaused: (ref) =>
        set((state) => ({
          byThreadKey: update(state.byThreadKey, ref, (current) => ({
            ...current,
            paused: !current.paused,
          })),
        })),
      clearList: (ref, list) =>
        set((state) => ({
          byThreadKey: update(state.byThreadKey, ref, (current) =>
            current[list].length === 0 ? current : { ...current, [list]: [] },
          ),
        })),
      removeThread: (ref) =>
        set((state) => {
          const key = scopedThreadKey(ref);
          if (!(key in state.byThreadKey)) return state;
          const { [key]: _removed, ...rest } = state.byThreadKey;
          return { byThreadKey: rest };
        }),
    }),
    {
      name: MESSAGE_QUEUE_STORAGE_KEY,
      version: MESSAGE_QUEUE_STORAGE_VERSION,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ byThreadKey: state.byThreadKey }),
      migrate: migratePersistedMessageQueue,
    },
  ),
);

export function selectThreadMessageQueue(
  byThreadKey: Record<string, ThreadMessageQueueState>,
  ref: ScopedThreadRef | null | undefined,
): ThreadMessageQueueState {
  if (!ref) return DEFAULT_STATE;
  return byThreadKey[scopedThreadKey(ref)] ?? DEFAULT_STATE;
}
