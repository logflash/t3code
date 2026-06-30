import { describe, expect, it, vi } from "vite-plus/test";

import { createTerminalWriter, type XtermWriteTarget } from "./terminalWriter";

const RESET = "\u001bc"; // ESC c (full reset) the writer emits on divergence

/**
 * Stand-in for xterm's `Terminal` that mimics its write-buffer back-pressure:
 * `write()` accumulates pending bytes and throws past `throwOver` (xterm's real
 * limit is ~50 MB), and only drains — invoking write callbacks — when the test
 * "parses" a queued chunk. Lets us assert the writer never lets pending grow
 * without bound.
 */
class FakeXterm implements XtermWriteTarget {
  pending = 0;
  maxPending = 0;
  content = "";
  writeCount = 0;
  private readonly queue: Array<{ data: string; callback?: () => void }> = [];

  constructor(private readonly throwOver = 50_000_000) {}

  write(data: string, callback?: () => void): void {
    this.writeCount += 1;
    this.pending += data.length;
    this.maxPending = Math.max(this.maxPending, this.pending);
    if (this.pending > this.throwOver) {
      throw new Error("write data discarded, use flow control to avoid losing data");
    }
    this.queue.push({ data, ...(callback ? { callback } : {}) });
  }

  /** Parse one queued chunk: apply it to `content` and fire its callback. */
  flushOne(): boolean {
    const next = this.queue.shift();
    if (!next) {
      return false;
    }
    this.pending -= next.data.length;
    this.content = next.data.startsWith(RESET)
      ? next.data.slice(RESET.length)
      : this.content + next.data;
    next.callback?.();
    return true;
  }

  flushAll(): void {
    // Draining can enqueue more work (coalesced renders), so loop until settled.
    while (this.flushOne()) {
      /* keep draining */
    }
  }
}

function blockOf(size: number, fill: string): string {
  return fill.repeat(Math.ceil(size / fill.length)).slice(0, size);
}

describe("createTerminalWriter", () => {
  it("appends deltas when the buffer grows", () => {
    const term = new FakeXterm();
    const writer = createTerminalWriter(term);

    writer.renderBuffer("abc");
    term.flushAll();
    expect(term.content).toBe("abc");

    writer.renderBuffer("abcdef");
    term.flushAll();
    expect(term.content).toBe("abcdef");
    // "abc" then delta "def" — never a reset.
    expect(term.content.includes(RESET)).toBe(false);
  });

  it("resets and rewrites when the buffer diverges (sliding window)", () => {
    const term = new FakeXterm();
    const writer = createTerminalWriter(term);

    writer.renderBuffer("hello world");
    term.flushAll();
    // Window slid: new buffer is not a continuation of what's shown.
    writer.renderBuffer("different");
    term.flushAll();

    expect(term.content).toBe("different");
  });

  it("coalesces updates that arrive while a write is in flight", () => {
    const term = new FakeXterm();
    const writer = createTerminalWriter(term);

    // First render starts a write (in flight, not yet parsed).
    writer.renderBuffer("a");
    // These arrive before the first write's callback → coalesced.
    writer.renderBuffer("ab");
    writer.renderBuffer("abc");
    expect(term.writeCount).toBe(1);

    term.flushAll();
    expect(term.content).toBe("abc");
    // One write for "a", then a single coalesced delta "bc" — not three writes.
    expect(term.writeCount).toBe(2);
  });

  it("keeps xterm pending bounded under a sustained high-throughput burst", () => {
    const term = new FakeXterm();
    const writer = createTerminalWriter(term);

    // Simulate a noisy command: 500 updates of a ~512 KB sliding-window buffer.
    // Without back-pressure these would pile ~256 MB of pending into xterm and
    // throw; the writer must keep at most ~one buffer in flight.
    const bufferBytes = 512 * 1024;
    for (let i = 0; i < 500; i += 1) {
      writer.renderBuffer(blockOf(bufferBytes, `line-${i % 97} `));
      // Parse at most one chunk per tick — xterm lagging behind the producer.
      term.flushOne();
    }
    term.flushAll();

    // Never anywhere near xterm's ~50 MB limit; bounded by a couple of buffers.
    expect(term.maxPending).toBeLessThan(2 * bufferBytes + 1024);
    expect(term.content.length).toBe(bufferBytes);
  });

  it("never throws to the caller even if xterm rejects the write", () => {
    // throwOver=10 forces every non-trivial write to throw like an overflow.
    const term = new FakeXterm(10);
    const writer = createTerminalWriter(term);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => {
      writer.renderBuffer("a much longer line than ten bytes");
      term.flushAll();
    }).not.toThrow();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("writes one-off messages after the current buffer content", () => {
    const term = new FakeXterm();
    const writer = createTerminalWriter(term);

    writer.renderBuffer("output");
    writer.writeMessage("\r\n[terminal] Process exited\r\n");
    term.flushAll();

    expect(term.content).toBe("output\r\n[terminal] Process exited\r\n");
  });

  it("ignores writes after dispose", () => {
    const term = new FakeXterm();
    const writer = createTerminalWriter(term);
    writer.dispose();

    writer.renderBuffer("ignored");
    writer.writeMessage("ignored");
    term.flushAll();

    expect(term.writeCount).toBe(0);
    expect(term.content).toBe("");
  });
});
