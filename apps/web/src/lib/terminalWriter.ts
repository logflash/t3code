/**
 * Backpressure-aware writer for an xterm.js terminal.
 *
 * xterm throws `"write data discarded, use flow control to avoid losing data"`
 * once its internal pending-write buffer exceeds a hard limit (~50 MB). A
 * high-throughput command (e.g. `yes`, `cat huge.log`, a chatty build) can push
 * data into `terminal.write()` faster than xterm parses it, blow past that
 * limit, and throw — which, unguarded, crashes the whole app via the root error
 * boundary.
 *
 * This writer bounds what is in flight: at most ONE write is outstanding at a
 * time (gated on xterm's write callback), and while a write is in flight further
 * buffer updates are coalesced into a single render of the latest buffer. Since
 * the stored terminal buffer is itself capped (see `terminalSession.ts`), xterm's
 * pending data stays on the order of that cap rather than growing without bound.
 * Every write is also guarded so a write can never crash the app.
 */

/** Minimal slice of the xterm `Terminal` API this writer needs (keeps it testable). */
export interface XtermWriteTarget {
  write(data: string, callback?: () => void): void;
}

export interface TerminalWriter {
  /**
   * Render `buffer` as the terminal's content. Writes the appended suffix when
   * `buffer` extends what's already shown, otherwise resets and rewrites. Safe
   * to call on every update — calls that arrive while a write is in flight are
   * coalesced into a single render of the most recent buffer.
   */
  renderBuffer(buffer: string): void;
  /** Append a one-off system message (ordered after the current buffer render). */
  writeMessage(text: string): void;
  /** Stop processing; pending coalesced work and write callbacks become no-ops. */
  dispose(): void;
}

// ESC c (full reset) + the new buffer — matches the previous full rewrite path.
const RESET_SEQUENCE = "\u001bc";

export function createTerminalWriter(terminal: XtermWriteTarget): TerminalWriter {
  let inFlight = false;
  let disposed = false;
  // What xterm currently shows for the buffer portion (excludes one-off messages).
  let renderedBuffer = "";
  // The latest buffer we want xterm to show.
  let desiredBuffer = "";
  let bufferDirty = false;
  const messages: string[] = [];

  function schedule(): void {
    if (inFlight || disposed) {
      return;
    }
    // Flush buffer content before messages so a message lands after the output
    // it accompanies (e.g. "[terminal] Process exited" after the final output).
    if (bufferDirty) {
      flushBuffer();
      return;
    }
    if (messages.length > 0) {
      flushMessage();
    }
  }

  function flushBuffer(): void {
    const target = desiredBuffer;
    bufferDirty = false;
    // Append-only growth is the common case; fall back to reset + full rewrite
    // when the buffer diverged (its capped sliding window dropped leading bytes).
    const isAppend = target.startsWith(renderedBuffer);
    const payload = isAppend ? target.slice(renderedBuffer.length) : `${RESET_SEQUENCE}${target}`;
    if (payload.length === 0) {
      renderedBuffer = target;
      schedule();
      return;
    }
    doWrite(payload, () => {
      renderedBuffer = target;
      schedule();
    });
  }

  function flushMessage(): void {
    const text = messages.shift();
    if (text === undefined) {
      return;
    }
    doWrite(text, schedule);
  }

  function doWrite(payload: string, onDone: () => void): void {
    inFlight = true;
    try {
      terminal.write(payload, () => {
        inFlight = false;
        if (!disposed) {
          onDone();
        }
      });
    } catch (error) {
      // Effectively unreachable: writes are coalesced to at most the capped
      // buffer, so xterm's pending data stays far below its internal limit.
      // Last-resort guard so a terminal write can never crash the app — drop
      // this write; the next buffer update re-renders once xterm has drained.
      inFlight = false;
      console.error("[terminal] xterm write failed; dropping write", error);
    }
  }

  return {
    renderBuffer(buffer: string): void {
      if (disposed) {
        return;
      }
      desiredBuffer = buffer;
      if (buffer !== renderedBuffer) {
        bufferDirty = true;
      }
      schedule();
    },
    writeMessage(text: string): void {
      if (disposed || text.length === 0) {
        return;
      }
      messages.push(text);
      schedule();
    },
    dispose(): void {
      disposed = true;
      messages.length = 0;
    },
  };
}
