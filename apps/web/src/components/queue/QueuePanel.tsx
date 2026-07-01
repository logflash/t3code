import {
  closestCorners,
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Circle,
  CircleCheck,
  Pause,
  Play,
  Plus,
  X,
} from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { cn } from "~/lib/utils";
import {
  type QueueItem,
  type QueueListId,
  selectThreadMessageQueue,
  useMessageQueueStore,
} from "~/messageQueueStore";

interface QueuePanelProps {
  threadRef: ScopedThreadRef;
  /**
   * Why the top staged message is not sending right now (e.g. "Agent is
   * working"). `null` means the runner will send the next staged message as
   * soon as the thread is idle.
   */
  blockedReason: string | null;
}

export function QueuePanel({ threadRef, blockedReason }: QueuePanelProps) {
  const state = useMessageQueueStore((store) =>
    selectThreadMessageQueue(store.byThreadKey, threadRef),
  );
  const addItem = useMessageQueueStore((store) => store.addItem);
  const editItem = useMessageQueueStore((store) => store.editItem);
  const removeItem = useMessageQueueStore((store) => store.removeItem);
  const reorderWithin = useMessageQueueStore((store) => store.reorderWithin);
  const moveAcross = useMessageQueueStore((store) => store.moveAcross);
  const togglePaused = useMessageQueueStore((store) => store.togglePaused);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Show the grabbing cursor while a card is in flight, not just on press.
  useEffect(() => {
    if (!activeId) return;
    const previous = document.body.style.cursor;
    document.body.style.cursor = "grabbing";
    return () => {
      document.body.style.cursor = previous;
    };
  }, [activeId]);

  // Escape dismisses a pending draft-deletion confirmation.
  useEffect(() => {
    if (!pendingDeleteId) return;
    const controller = new AbortController();
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") setPendingDeleteId(null);
      },
      { signal: controller.signal },
    );
    return () => controller.abort();
  }, [pendingDeleteId]);

  const listOf = useCallback(
    (id: string): QueueListId | null => {
      if (id === "staged" || id === "unstaged") return id;
      if (state.staged.some((item) => item.id === id)) return "staged";
      if (state.unstaged.some((item) => item.id === id)) return "unstaged";
      return null;
    },
    [state.staged, state.unstaged],
  );

  const activeItem = activeId
    ? ([...state.staged, ...state.unstaged].find((item) => item.id === activeId) ?? null)
    : null;
  const activeIsUpNext =
    activeItem != null && !state.paused && state.staged[0]?.id === activeItem.id;

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!over) return;
      const activeKey = String(active.id);
      const overKey = String(over.id);
      if (activeKey === overKey) return;
      const from = listOf(activeKey);
      const to = listOf(overKey);
      if (!from || !to) return;
      if (from === to) {
        // Dropping onto the list container itself (not an item) is a no-op.
        if (overKey === from) return;
        reorderWithin(threadRef, from, activeKey, overKey);
      } else {
        const overItemId = overKey === to ? null : overKey;
        moveAcross(threadRef, from, to, activeKey, overItemId);
      }
    },
    [listOf, moveAcross, reorderWithin, threadRef],
  );

  const queueStatus = state.paused
    ? "Paused"
    : state.staged.length === 0
      ? "Nothing staged"
      : (blockedReason ?? "Sending next message…");

  const pendingDeleteItem = pendingDeleteId
    ? (state.unstaged.find((item) => item.id === pendingDeleteId) ?? null)
    : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-sm font-medium text-foreground">Queue</span>
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                state.paused || state.staged.length === 0
                  ? "bg-muted-foreground/40"
                  : blockedReason
                    ? "bg-amber-500"
                    : "bg-emerald-500",
              )}
              aria-hidden
            />
            <span className="truncate text-xs text-muted-foreground">{queueStatus}</span>
          </div>
          <button
            type="button"
            onClick={() => togglePaused(threadRef)}
            className={cn(
              "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors",
              state.paused
                ? "bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-400"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            aria-label={state.paused ? "Resume sending" : "Pause sending"}
          >
            {state.paused ? (
              <>
                <Play className="size-3.5" />
                Resume
              </>
            ) : (
              <>
                <Pause className="size-3.5" />
                Pause
              </>
            )}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <QueueZone
            listId="staged"
            label="Staged"
            icon={<CircleCheck className="size-3.5" />}
            items={state.staged}
            emptyHint="Staged messages send top to bottom when idle."
            highlightTop={!state.paused}
            pendingDeleteId={null}
            editingId={editingId}
            onStartEdit={setEditingId}
            onCommitEdit={(id, text) => {
              editItem(threadRef, "staged", id, text);
              setEditingId(null);
            }}
            onCancelEdit={() => setEditingId(null)}
            onRemove={(id) => removeItem(threadRef, "staged", id)}
            onForceRemove={(id) => removeItem(threadRef, "staged", id)}
            onMiddleClick={(id) =>
              moveAcross(threadRef, "staged", "unstaged", id, state.unstaged[0]?.id ?? null)
            }
            onMove={(id) =>
              moveAcross(threadRef, "staged", "unstaged", id, state.unstaged[0]?.id ?? null)
            }
            moveLabel="Unstage"
            moveIcon={<ArrowDownToLine className="size-3.5" />}
            onAdd={(text) => addItem(threadRef, "staged", text)}
            addPlaceholder="Stage a message…"
          />

          <div className="my-3 border-t border-border/50" />

          <QueueZone
            listId="unstaged"
            label="Unstaged"
            icon={<Circle className="size-3.5" />}
            items={state.unstaged}
            emptyHint="Drafts wait here until you stage them."
            highlightTop={false}
            pendingDeleteId={pendingDeleteId}
            editingId={editingId}
            onStartEdit={setEditingId}
            onCommitEdit={(id, text) => {
              editItem(threadRef, "unstaged", id, text);
              setEditingId(null);
            }}
            onCancelEdit={() => setEditingId(null)}
            onRemove={(id) => setPendingDeleteId(id)}
            onForceRemove={(id) => {
              removeItem(threadRef, "unstaged", id);
              setPendingDeleteId((current) => (current === id ? null : current));
            }}
            onMiddleClick={(id) => setPendingDeleteId(id)}
            onMove={(id) => moveAcross(threadRef, "unstaged", "staged", id, null)}
            moveLabel="Stage"
            moveIcon={<ArrowUpToLine className="size-3.5" />}
            onAdd={(text) => addItem(threadRef, "unstaged", text)}
            addPlaceholder="Draft a message…"
          />
        </div>

        {pendingDeleteItem ? (
          <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-card px-3 py-2">
            <span className="min-w-0 truncate text-xs text-foreground">Delete this draft?</span>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPendingDeleteId(null)}
                className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  removeItem(threadRef, "unstaged", pendingDeleteItem.id);
                  setPendingDeleteId(null);
                }}
                className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Full-size clone that tracks the cursor so the card drags smoothly and
          only settles into its new slot on release (no mid-drag layout jump). */}
      <DragOverlay dropAnimation={null}>
        {activeItem ? <QueueCardPreview item={activeItem} isUpNext={activeIsUpNext} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function QueueCardPreview({ item, isUpNext }: { item: QueueItem; isUpNext: boolean }) {
  return (
    <div
      className={cn(
        "flex cursor-grabbing items-start gap-1 rounded-md border bg-card py-3 pl-2 pr-1 shadow-lg",
        isUpNext ? "border-emerald-500/50 bg-emerald-500/5" : "border-border",
      )}
    >
      <span className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 whitespace-pre-wrap break-words py-0.5 text-sm leading-snug text-foreground">
        {isUpNext ? (
          <span className="mr-1.5 inline-flex items-center rounded bg-emerald-500/15 px-1 py-px align-middle text-[10px] font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
            Up next
          </span>
        ) : null}
        {item.text}
      </div>
      <span className="mt-0.5 size-5 shrink-0" aria-hidden />
    </div>
  );
}

interface QueueZoneProps {
  listId: QueueListId;
  label: string;
  icon: React.ReactNode;
  items: QueueItem[];
  emptyHint: string;
  highlightTop: boolean;
  pendingDeleteId: string | null;
  editingId: string | null;
  onStartEdit: (id: string) => void;
  onCommitEdit: (id: string, text: string) => void;
  onCancelEdit: () => void;
  onRemove: (id: string) => void;
  onForceRemove: (id: string) => void;
  onMiddleClick: (id: string) => void;
  onMove: (id: string) => void;
  moveLabel: string;
  moveIcon: React.ReactNode;
  onAdd: (text: string) => void;
  addPlaceholder: string;
}

function QueueZone(props: QueueZoneProps) {
  const { setNodeRef, isOver } = useDroppable({ id: props.listId });
  return (
    <section>
      <div className="mb-1.5 flex items-center gap-1.5 px-0.5 text-xs font-medium text-muted-foreground">
        {props.icon}
        <span>{props.label}</span>
        {props.items.length > 0 ? (
          <span className="text-muted-foreground/60">{props.items.length}</span>
        ) : null}
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-12 flex-col gap-1.5 rounded-md transition-colors",
          isOver && "bg-accent/40 outline outline-1 outline-dashed outline-border",
        )}
      >
        <SortableContext
          items={props.items.map((item) => item.id)}
          strategy={verticalListSortingStrategy}
        >
          {props.items.length === 0 ? (
            <p className="px-2 py-3 text-xs leading-relaxed text-muted-foreground/70">
              {props.emptyHint}
            </p>
          ) : (
            props.items.map((item, index) => (
              <SortableQueueCard
                key={item.id}
                item={item}
                isUpNext={props.highlightTop && index === 0}
                pendingDelete={item.id === props.pendingDeleteId}
                editing={props.editingId === item.id}
                onStartEdit={() => props.onStartEdit(item.id)}
                onCommitEdit={(text) => props.onCommitEdit(item.id, text)}
                onCancelEdit={props.onCancelEdit}
                onRemove={() => props.onRemove(item.id)}
                onForceRemove={() => props.onForceRemove(item.id)}
                onMiddleClick={() => props.onMiddleClick(item.id)}
                onMove={() => props.onMove(item.id)}
                moveLabel={props.moveLabel}
                moveIcon={props.moveIcon}
              />
            ))
          )}
        </SortableContext>
      </div>
      <QueueAddInput placeholder={props.addPlaceholder} onAdd={props.onAdd} />
    </section>
  );
}

interface SortableQueueCardProps {
  item: QueueItem;
  isUpNext: boolean;
  pendingDelete: boolean;
  editing: boolean;
  onStartEdit: () => void;
  onCommitEdit: (text: string) => void;
  onCancelEdit: () => void;
  onRemove: () => void;
  onForceRemove: () => void;
  onMiddleClick: () => void;
  onMove: () => void;
  moveLabel: string;
  moveIcon: React.ReactNode;
}

// Stops a pointer-down on an interactive control from starting a card drag.
const stopDragStart = (event: { stopPropagation: () => void }) => event.stopPropagation();

// Maps a viewport click point to the character offset of the text underneath,
// so a double-click can drop the editing caret exactly where the user clicked.
function caretOffsetFromPoint(x: number, y: number): number | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (typeof doc.caretPositionFromPoint === "function") {
    return doc.caretPositionFromPoint(x, y)?.offset ?? null;
  }
  if (typeof doc.caretRangeFromPoint === "function") {
    return doc.caretRangeFromPoint(x, y)?.startOffset ?? null;
  }
  return null;
}

function SortableQueueCard(props: SortableQueueCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } =
    useSortable({ id: props.item.id });

  // The whole card is the drag handle (except while editing, so text selection
  // and the textarea work normally).
  const dragProps = props.editing ? {} : { ...attributes, ...listeners };

  // Caret offset captured from the double-click point so the editor opens with
  // the cursor where the user clicked.
  const caretRef = useRef<number | null>(null);
  const handleDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (props.editing) return;
    caretRef.current = caretOffsetFromPoint(event.clientX, event.clientY);
    props.onStartEdit();
  };
  // Middle-click (scroll-wheel button): a single click unstages a staged card or
  // asks before deleting a draft; a double click force-deletes, skipping confirm.
  const handleAuxMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 1 || props.editing) return;
    event.preventDefault();
    if (event.detail >= 2) {
      props.onForceRemove();
    } else {
      props.onMiddleClick();
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      onDoubleClick={handleDoubleClick}
      onMouseDown={handleAuxMouseDown}
      className={cn(
        "group/card relative flex items-start gap-1 rounded-md border bg-card/60 py-3 pl-2 pr-1",
        props.editing ? "cursor-text" : "cursor-grab active:cursor-grabbing",
        isDragging ? "opacity-40" : "",
        props.isUpNext ? "border-emerald-500/50 bg-emerald-500/5" : "border-border/70",
      )}
      {...dragProps}
    >
      {/* Drop-target indicator: the slot the dragged card will land in flashes. */}
      {isOver && !isDragging ? (
        <span
          className="pointer-events-none absolute inset-0 z-10 animate-pulse rounded-md bg-card"
          aria-hidden
        />
      ) : null}

      {/* Tints the draft awaiting delete confirmation a light red. */}
      {props.pendingDelete ? (
        <span
          className="pointer-events-none absolute inset-0 z-10 rounded-md bg-red-500/20"
          aria-hidden
        />
      ) : null}

      <button
        type="button"
        onClick={props.onMove}
        onPointerDown={stopDragStart}
        aria-label={props.moveLabel}
        title={props.moveLabel}
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/60 opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus:opacity-100 group-hover/card:opacity-100"
      >
        {props.moveIcon}
      </button>

      {props.editing ? (
        <QueueCardEditor
          initialText={props.item.text}
          initialCaret={caretRef.current}
          onCommit={props.onCommitEdit}
          onCancel={props.onCancelEdit}
        />
      ) : (
        <div
          title="Double-click to edit"
          className="min-w-0 flex-1 select-none whitespace-pre-wrap break-words py-0.5 text-sm leading-snug text-foreground"
        >
          {props.isUpNext ? (
            <span className="mr-1.5 inline-flex items-center rounded bg-emerald-500/15 px-1 py-px align-middle text-[10px] font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
              Up next
            </span>
          ) : null}
          {props.item.text}
        </div>
      )}

      <button
        type="button"
        onClick={props.onRemove}
        onDoubleClick={(event) => {
          event.stopPropagation();
          props.onForceRemove();
        }}
        onPointerDown={stopDragStart}
        aria-label="Remove"
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/60 opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus:opacity-100 group-hover/card:opacity-100"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function QueueCardEditor(props: {
  initialText: string;
  initialCaret?: number | null;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(props.initialText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Grow the textarea to fit the full draft (including wrapped lines) so editing
  // always shows the whole message rather than a clipped, collapsed version.
  const autoSize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  useLayoutEffect(autoSize, [autoSize, text]);

  // Focus on open, placing the caret where the user clicked (or at the end).
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const caret =
      props.initialCaret == null
        ? el.value.length
        : Math.max(0, Math.min(props.initialCaret, el.value.length));
    el.focus();
    el.setSelectionRange(caret, caret);
  }, [props.initialCaret]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      props.onCommit(text);
    } else if (event.key === "Escape") {
      event.preventDefault();
      props.onCancel();
    }
  };
  return (
    <textarea
      ref={textareaRef}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => props.onCommit(text)}
      rows={1}
      className="min-w-0 flex-1 resize-none overflow-hidden rounded bg-transparent py-0.5 text-sm leading-snug text-foreground outline-none"
    />
  );
}

function QueueAddInput(props: { placeholder: string; onAdd: (text: string) => void }) {
  const [text, setText] = useState("");
  const submit = () => {
    if (text.trim().length === 0) return;
    props.onAdd(text);
    setText("");
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };
  return (
    <div className="mt-1.5 flex items-start gap-1.5">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={props.placeholder}
        rows={1}
        className="min-h-8 min-w-0 flex-1 resize-none rounded-md border border-border/70 bg-card/40 px-2 py-1.5 text-sm leading-snug text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-border"
      />
      <button
        type="button"
        onClick={submit}
        disabled={text.trim().length === 0}
        aria-label="Add"
        className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}

export default QueuePanel;
