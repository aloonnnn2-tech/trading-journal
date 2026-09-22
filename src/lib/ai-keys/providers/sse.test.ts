import { describe, expect, it } from "vitest";
import { sseData } from "./sse";

// Builds a Response whose body delivers the given chunks one read() at a
// time -- the point is to split events at awkward places, which is what real
// network chunking does.
function streamOf(chunks: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(body);
}

async function collect(res: Response, signal?: AbortSignal) {
  const out: { event: string | null; data: string }[] = [];
  for await (const ev of sseData(res, signal)) out.push(ev);
  return out;
}

describe("sseData", () => {
  it("yields one event per blank-line-delimited block", async () => {
    const events = await collect(streamOf(['data: {"a":1}\n\ndata: {"a":2}\n\n']));
    expect(events.map((e) => e.data)).toEqual(['{"a":1}', '{"a":2}']);
  });

  it("reassembles an event split across chunks, including mid-line", async () => {
    const events = await collect(streamOf(['data: {"te', 'xt":"hel', 'lo"}\n', "\n"]));
    expect(events).toEqual([{ event: null, data: '{"text":"hello"}' }]);
  });

  it("reassembles a multi-byte character split across chunks", async () => {
    // "€" is 3 bytes in UTF-8; split it in the middle.
    const bytes = new TextEncoder().encode('data: "€"\n\n');
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 8));
        c.enqueue(bytes.slice(8));
        c.close();
      },
    });
    const events = await collect(new Response(body));
    expect(events[0].data).toBe('"€"');
  });

  it("carries the event name and joins multi-line data with newlines", async () => {
    const events = await collect(streamOf(["event: message_delta\ndata: line1\ndata: line2\n\n"]));
    expect(events).toEqual([{ event: "message_delta", data: "line1\nline2" }]);
  });

  it("passes [DONE] through as data for the adapter to recognise", async () => {
    const events = await collect(streamOf(["data: [DONE]\n\n"]));
    expect(events[0].data).toBe("[DONE]");
  });

  it("ignores comments and blank keep-alive lines", async () => {
    const events = await collect(streamOf([": keep-alive\n\n\n\ndata: x\n\n"]));
    expect(events.map((e) => e.data)).toEqual(["x"]);
  });

  it("accepts CRLF line endings", async () => {
    const events = await collect(streamOf(['data: {"a":1}\r\n\r\n']));
    expect(events[0].data).toBe('{"a":1}');
  });

  it("delivers CRLF events as they arrive, not all at the end", async () => {
    // The first version normalised CRLF only when parsing a block, AFTER
    // searching the buffer for "\n\n" -- which a CRLF stream never contains
    // until the final flush. Every event was buffered until the stream
    // closed: correct output, no streaming. Each event here must be yielded
    // before the next chunk is even pulled.
    const enc = new TextEncoder();
    let pulls = 0;
    const seenAtPull: number[] = [];
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulls += 1;
        if (pulls > 3) return c.close();
        c.enqueue(enc.encode(`data: ${pulls}\r\n\r\n`));
      },
    });
    for await (const ev of sseData(new Response(body))) seenAtPull.push(pulls - Number(ev.data));
    // Each event was yielded from the chunk that carried it (the stream may
    // pre-pull one chunk ahead), never held until the close on pull 4.
    expect(seenAtPull).toHaveLength(3);
    for (const lag of seenAtPull) expect(lag).toBeLessThanOrEqual(1);
  });

  it("handles a CRLF split across two chunks", async () => {
    const events = await collect(streamOf(["data: a\r", "\n\r", "\ndata: b\r\n\r\n"]));
    expect(events.map((e) => e.data)).toEqual(["a", "b"]);
  });

  it("flushes a final event that has no trailing blank line", async () => {
    const events = await collect(streamOf(["data: last"]));
    expect(events.map((e) => e.data)).toEqual(["last"]);
  });

  it("stops when the signal aborts", async () => {
    const enc = new TextEncoder();
    const controller = new AbortController();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulls += 1;
        c.enqueue(enc.encode(`data: ${pulls}\n\n`));
        if (pulls === 2) controller.abort();
      },
    });
    const seen: string[] = [];
    try {
      for await (const ev of sseData(new Response(body), controller.signal)) {
        seen.push(ev.data);
      }
    } catch {
      // A cancelled reader may reject the pending read; either way we stop.
    }
    expect(seen.length).toBeLessThanOrEqual(3);
    expect(controller.signal.aborted).toBe(true);
  });
});
